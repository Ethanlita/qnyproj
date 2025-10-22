const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  PutCommand
} = require('@aws-sdk/lib-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { uploadImage } = require('../../lib/s3-utils');
const { s3ImagesToBase64 } = require('../../lib/s3-image-utils');
const { buildPanelPrompt } = require('../../lib/prompt-builder');
const ImagenAdapter = require('../../lib/imagen-adapter');
const { getGeminiConfig } = require('../../lib/ai-secrets');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const secretsClient = new SecretsManagerClient({});
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME;
const ASSETS_BUCKET = process.env.ASSETS_BUCKET;
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
const QWEN_SECRET_ARN = process.env.QWEN_SECRET_ARN;
const MAX_ATTEMPTS = 3;

let imagenAdapterPromise = null;
const configCache = new Map(); // key => config

exports.handler = async (event) => {
  if (!TABLE_NAME) {
    console.error('[PanelWorker] TABLE_NAME not configured');
    return { statusCode: 500, body: JSON.stringify({ error: 'TABLE_NAME not configured' }) };
  }

  let processed = 0;
  for (const record of event.Records || []) {
    if (record.eventName !== 'INSERT') {
      continue;
    }
    const newImage = record.dynamodb?.NewImage;
    if (!newImage || !newImage.SK || !newImage.SK.S || !newImage.SK.S.startsWith('PANEL_TASK#')) {
      continue;
    }

    const task = unmarshall(newImage);
    try {
      await processTask(task);
      processed += 1;
    } catch (error) {
      console.error(`[PanelWorker] Task ${task.panelId} failed with unexpected error:`, error);
      await markTaskFailed(task, error.message || 'Unknown error');
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ processed })
  };
};

async function processTask(task) {
  if (task.status !== 'pending') {
    return;
  }

  const taskKey = {
    PK: task.PK,
    SK: task.SK
  };

  const startTimestamp = new Date().toISOString();
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: taskKey,
        ConditionExpression: '#status = :pending',
        UpdateExpression: 'SET #status = :inProgress, startedAt = :startedAt, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':pending': 'pending',
          ':inProgress': 'in_progress',
          ':startedAt': startTimestamp,
          ':updatedAt': startTimestamp
        }
      })
    );
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log(`[PanelWorker] Task ${task.panelId} already processed`);
      return;
    }
    throw error;
  }

  const panel = await loadPanel(task.storyboardId, task.panelKey);
  if (!panel) {
    await markTaskFailed(task, `Panel ${task.panelId} not found`);
    return;
  }

  const characterRefs = await buildCharacterReferences(panel.characters || []);
  const prompt = buildPanelPrompt(panel, characterRefs, { mode: task.mode });
  const adapter = await getImagenAdapter();

  try {
    const referenceUris = collectReferenceUris(characterRefs);
    
    // Convert S3 URIs to base64 (parallel download)
    const referenceImagesBase64 = referenceUris.length > 0
      ? await s3ImagesToBase64(referenceUris)
      : [];
    
    console.log(`[PanelWorker] Downloaded ${referenceImagesBase64.length} reference images from S3`);
    
    const aspectRatio = determineAspectRatio(panel) || (task.mode === 'hd' ? '16:9' : '16:9');

    const result = await adapter.generate({
      prompt: prompt.text,
      negativePrompt: prompt.negativePrompt,
      referenceImages: referenceImagesBase64,  // Pass base64-encoded reference images
      aspectRatio,
      mode: task.mode
    });

    const s3Key = `panels/${task.jobId}/${task.panelId}-${task.mode}.png`;
    await uploadImage(s3Key, result.buffer, {
      contentType: result.mimeType || 'image/png',
      metadata: {
        'panel-id': task.panelId,
        mode: task.mode,
        'storyboard-id': task.storyboardId
      },
      tagging: `Type=panel&Mode=${task.mode}`
    });

    await finalizeSuccess(task, panel, s3Key);
  } catch (error) {
    console.error(`[PanelWorker] Generation failed for panel ${task.panelId}:`, error);
    await markTaskFailed(task, error.message || 'Generation failed');
  }
}

async function loadPanel(storyboardId, panelKey) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `STORYBOARD#${storyboardId}`,
        SK: panelKey
      }
    })
  );
  return result.Item || null;
}

async function buildCharacterReferences(characters) {
  const refs = {};

  for (const char of characters) {
    const charId = char.charId;
    const configId = char.configId;
    if (!charId) continue;

    const cacheKey = `${charId}:${configId || 'default'}`;
    if (!configCache.has(cacheKey)) {
      const config = await loadCharacterConfiguration(charId, configId);
      configCache.set(cacheKey, config);
    }

    const config = configCache.get(cacheKey);
    if (!config) continue;

    refs[charId] = {
      portraitsS3: (config.generatedPortraitsS3 || []).map((item) => item.s3Key),
      referenceImagesS3: (config.referenceImagesS3 || []).map((item) => item.s3Key)
    };
  }

  return refs;
}

async function loadCharacterConfiguration(charId, configId) {
  if (!charId) return null;

  if (configId) {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `CHAR#${charId}`,
          SK: `CONFIG#${configId}`
        }
      })
    );
    if (result.Item) {
      return result.Item;
    }
  }

  const defaultResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `CHAR#${charId}`,
        SK: 'CONFIG#default'
      }
    })
  );
  return defaultResult.Item || null;
}

function collectReferenceUris(characterRefs) {
  const uris = [];
  const bucket = process.env.ASSETS_BUCKET;
  for (const ref of Object.values(characterRefs)) {
    for (const key of ref.portraitsS3 || []) {
      if (key.startsWith('s3://')) {
        uris.push(key);
      } else if (bucket) {
        uris.push(`s3://${bucket}/${key}`);
      }
    }
    for (const key of ref.referenceImagesS3 || []) {
      if (key.startsWith('s3://')) {
        uris.push(key);
      } else if (bucket) {
        uris.push(`s3://${bucket}/${key}`);
      }
    }
  }
  return Array.from(new Set(uris));
}

async function finalizeSuccess(task, panel, s3Key) {
  const timestamp = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: task.PK,
        SK: task.SK
      },
      UpdateExpression: 'SET #status = :completed, updatedAt = :updatedAt, s3Key = :s3Key',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':completed': 'completed',
        ':updatedAt': timestamp,
        ':s3Key': s3Key
      }
    })
  );

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `STORYBOARD#${task.storyboardId}`,
        SK: task.panelKey
      },
      UpdateExpression: 'SET imagesS3.#mode = :s3Key, #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#mode': task.mode,
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':s3Key': s3Key,
        ':status': 'completed',
        ':updatedAt': timestamp
      }
    })
  );

  await updateJobProgress(task.jobId, (progress) => {
    const total = progress.total || 1;
    const completed = Math.min((progress.completed || 0) + 1, total);
    const failed = progress.failed || 0;
    const percentage = Math.round((completed / total) * 100);
    const status = completed === total && failed === 0 ? 'completed' : 'in_progress';

    return {
      progress: {
        ...progress,
        completed,
        percentage
      },
      status
    };
  });
}

async function markTaskFailed(task, reason) {
  const timestamp = new Date().toISOString();
  const currentRetry = task.retryCount || 0;
  const updatedRetry = Math.min(currentRetry + 1, MAX_ATTEMPTS);
  
  console.log(`[PanelWorker] Task ${task.panelId} failed (attempt ${currentRetry + 1}/${MAX_ATTEMPTS}): ${reason}`);

  // Check if we should retry
  if (currentRetry < MAX_ATTEMPTS - 1) {
    // Retry by DELETE + INSERT to re-trigger DynamoDB Stream
    console.log(`[PanelWorker] Retrying task ${task.panelId} (retry ${updatedRetry}/${MAX_ATTEMPTS})`);
    
    try {
      // Calculate exponential backoff delay (10s, 20s, 40s...)
      const delaySeconds = Math.pow(2, currentRetry) * 10;
      const retryAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      
      // Delete current task record
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: task.PK,
            SK: task.SK
          }
        })
      );
      
      // Wait for the delay period before re-inserting
      console.log(`[PanelWorker] Task ${task.panelId} will be retried at ${retryAt} (delay: ${delaySeconds}s)`);
      
      // Re-insert task with updated retry count to trigger Stream INSERT event
      // Note: In production, use a separate retry queue/scheduler service
      // For now, we re-insert immediately and rely on Lambda concurrency
      await new Promise(resolve => setTimeout(resolve, Math.min(delaySeconds * 1000, 15000))); // Max 15s in-Lambda delay
      
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            ...task,
            status: 'pending',
            retryCount: updatedRetry,
            lastError: reason,
            lastAttemptAt: timestamp,
            retryAt,
            updatedAt: new Date().toISOString()
          }
        })
      );
      
      console.log(`[PanelWorker] Task ${task.panelId} re-inserted for retry`);
      return; // Don't mark job as failed yet
    } catch (retryError) {
      console.error(`[PanelWorker] Failed to retry task ${task.panelId}:`, retryError);
      // Fall through to mark as failed
    }
  }
  
  // Final failure after MAX_ATTEMPTS
  console.log(`[PanelWorker] Task ${task.panelId} permanently failed after ${MAX_ATTEMPTS} attempts`);

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: task.PK,
        SK: task.SK
      },
      UpdateExpression: 'SET #status = :failed, updatedAt = :updatedAt, errorMessage = :error, retryCount = :retryCount',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':failed': 'failed',
        ':updatedAt': timestamp,
        ':error': reason,
        ':retryCount': updatedRetry
      }
    })
  );

  await updateJobProgress(task.jobId, (progress) => {
    const failed = (progress.failed || 0) + 1;
    const total = progress.total || 1;
    const completed = progress.completed || 0;
    const percentage = Math.round((completed / total) * 100);
    return {
      progress: {
        ...progress,
        failed,
        percentage
      },
      status: 'failed'
    };
  });
}

async function updateJobProgress(jobId, updater) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `JOB#${jobId}`,
          SK: `JOB#${jobId}`
        }
      })
    );

    if (!current.Item) {
      return;
    }

    const progress = current.Item.progress || {};
    const next = updater(progress);
    const status = next.status || current.Item.status;

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `JOB#${jobId}`,
            SK: `JOB#${jobId}`
          },
          ConditionExpression: 'updatedAt = :expected',
          UpdateExpression: 'SET progress = :progress, updatedAt = :updatedAt, #status = :status',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':expected': current.Item.updatedAt,
            ':progress': next.progress,
            ':updatedAt': new Date().toISOString(),
            ':status': status
          }
        })
      );
      return;
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') {
        throw error;
      }
    }
  }
}

function determineAspectRatio(panel) {
  if (!panel) return null;
  const layout = panel.layout || {};
  if (layout.aspectRatio) {
    return layout.aspectRatio;
  }
  if (layout.width && layout.height) {
    return `${layout.width}:${layout.height}`;
  }
  return null;
}

async function getImagenAdapter() {
  if (!imagenAdapterPromise) {
    imagenAdapterPromise = (async () => {
      const config = await getGeminiConfig();
      return new ImagenAdapter({
        apiKey: config.apiKey,
        projectId: config.projectId,
        location: config.location,
        model: config.model,
        forceMock: !config.apiKey
      });
    })();
  }
  return imagenAdapterPromise;
}

