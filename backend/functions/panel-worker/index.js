const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  PutCommand
} = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { S3Client } = require('@aws-sdk/client-s3');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { uploadImage } = require('../../lib/s3-utils');
const { s3ImagesToBase64 } = require('../../lib/s3-image-utils');
const { buildPanelPrompt } = require('../../lib/prompt-builder');
const ImagenAdapter = require('../../lib/imagen-adapter');
const { getGeminiConfig } = require('../../lib/ai-secrets');
const BibleManager = require('../../lib/bible-manager');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});
const eventBridgeClient = new EventBridgeClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const ASSETS_BUCKET = process.env.ASSETS_BUCKET;
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
const QWEN_SECRET_ARN = process.env.QWEN_SECRET_ARN;
const MAX_ATTEMPTS = 3;

let imagenAdapterPromise = null;
const configCache = new Map(); // key => config
const bibleCache = new Map(); // key => bible snapshot
let bibleManagerInstance;

function getBibleManager() {
  if (!bibleManagerInstance) {
    const tableName = process.env.BIBLES_TABLE_NAME;
    const bucket = process.env.BIBLES_BUCKET || process.env.ASSETS_BUCKET;
    if (!tableName || !bucket) {
      throw new Error('Bibles table or bucket not configured');
    }
    bibleManagerInstance = new BibleManager(docClient, s3Client, tableName, bucket);
  }
  return bibleManagerInstance;
}

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

  const bibleContext = await loadBibleContext(task.novelId, task.bibleVersion);
  const workingPanel = bibleContext ? enrichPanelWithBible(panel, bibleContext) : panel;

  const characterRefs = await buildCharacterReferences(workingPanel.characters || [], bibleContext);
  const prompt = buildPanelPrompt(workingPanel, characterRefs.byId, { mode: task.mode });
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

async function buildCharacterReferences(characters = [], bibleContext = null) {
  const entries = [];
  const bucket = process.env.ASSETS_BUCKET;
  const byId = {};
  const byName = {};

  for (const char of characters) {
    const entry = {
      charId: char.charId || null,
      portraitsS3: [],
      referenceImagesS3: [],
      bibleReferenceImages: []
    };

    const charId = char.charId;
    const configId = char.configId;
    if (charId) {
      const cacheKey = `${charId}:${configId || 'default'}`;
      if (!configCache.has(cacheKey)) {
        const config = await loadCharacterConfiguration(charId, configId);
        configCache.set(cacheKey, config);
      }
      const config = configCache.get(cacheKey);
      if (config) {
        entry.portraitsS3 = (config.generatedPortraitsS3 || []).map((item) => item.s3Key);
        entry.referenceImagesS3 = (config.referenceImagesS3 || []).map((item) => item.s3Key);
      }
    }

    const nameKey = char.name ? char.name.toLowerCase() : null;
    if (bibleContext && nameKey && bibleContext.charactersByName.has(nameKey)) {
      const bibleEntry = bibleContext.charactersByName.get(nameKey);
      entry.bibleReferenceImages = (bibleEntry.referenceImages || [])
        .map((image) => (image && image.s3Key ? `s3://${process.env.ASSETS_BUCKET}/${image.s3Key}` : null))
        .filter(Boolean);
    }

    if (entry.portraitsS3.length === 0 && entry.referenceImagesS3.length === 0 && entry.bibleReferenceImages.length === 0) {
      if (!charId && !nameKey) {
        continue;
      }
    }

    if (charId) {
      byId[charId] = entry;
    }
    if (nameKey) {
      byName[nameKey] = entry;
    }
    entries.push(entry);
  }

  return { entries, byId, byName };
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

async function loadBibleContext(novelId, version) {
  if (!novelId) return null;
  const cacheKey = `${novelId}:${version || 'latest'}`;
  if (bibleCache.has(cacheKey)) {
    return bibleCache.get(cacheKey);
  }

  try {
    const manager = getBibleManager();
    const options = version ? { version } : undefined;
    const bible = version ? await manager.getBible(novelId, options) : await manager.getBible(novelId);
    if (!bible.exists) {
      bibleCache.set(cacheKey, null);
      return null;
    }

    const context = {
      version: bible.version,
      characters: bible.characters || [],
      scenes: bible.scenes || [],
      charactersByName: new Map(),
      scenesById: new Map()
    };

    for (const character of context.characters) {
      if (character?.name) {
        context.charactersByName.set(character.name.toLowerCase(), character);
      }
    }

    for (const scene of context.scenes) {
      if (scene?.id) {
        context.scenesById.set(scene.id, scene);
      }
    }

    bibleCache.set(cacheKey, context);
    return context;
  } catch (error) {
    console.warn('[PanelWorker] Failed to load bible context', error);
    bibleCache.set(cacheKey, null);
    return null;
  }
}

function enrichPanelWithBible(panel, bibleContext) {
  if (!bibleContext) {
    return panel;
  }
  const clone = JSON.parse(JSON.stringify(panel));

  if (Array.isArray(clone.characters)) {
    clone.characters = clone.characters.map((character) => {
      if (!character?.name) {
        return character;
      }
      const bibleEntry = bibleContext.charactersByName.get(character.name.toLowerCase());
      if (!bibleEntry) {
        return character;
      }
      const enriched = { ...character };
      enriched.appearance = {
        ...(bibleEntry.appearance || {}),
        ...(character.appearance || {})
      };
      if ((!enriched.personality || enriched.personality.length === 0) && bibleEntry.personality) {
        enriched.personality = bibleEntry.personality;
      }
      return enriched;
    });
  }

  const sceneId = clone.background?.sceneId;
  if (sceneId) {
    const sceneEntry = bibleContext.scenesById.get(sceneId);
    if (sceneEntry) {
      clone.scene = clone.scene || sceneEntry.description;
      clone.background = {
        ...clone.background,
        setting: clone.background.setting || sceneEntry.name,
        details: clone.background.details || sceneEntry.visualCharacteristics?.keyLandmarks
      };
    }
  }

  return clone;
}

function collectReferenceUris(characterRefs) {
  const uris = [];
  const bucket = process.env.ASSETS_BUCKET;
  const entries = (characterRefs && characterRefs.entries) || [];

  for (const ref of entries) {
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
    for (const uri of ref.bibleReferenceImages || []) {
      uris.push(uri);
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
  
  console.log(`[PanelWorker] Task ${task.panelId} failed (attempt ${currentRetry + 1}/${MAX_ATTEMPTS}): ${reason}`);

  // ⭐ 代码评审修复: 确保总尝试次数 = MAX_ATTEMPTS
  // 修改前: if (currentRetry < MAX_ATTEMPTS - 1)  // 会导致 4 次尝试
  // 修改后: if (currentRetry + 1 < MAX_ATTEMPTS)  // 确保 3 次尝试
  if (currentRetry + 1 < MAX_ATTEMPTS) {
    // 使用 EventBridge 替代 Lambda 内 sleep
    const nextRetry = currentRetry + 1;
    console.log(`[PanelWorker] Scheduling retry for task ${task.panelId} (retry ${nextRetry}/${MAX_ATTEMPTS})`);
    
    try {
      // Calculate exponential backoff delay (10s, 20s, 40s...)
      const delaySeconds = Math.pow(2, currentRetry) * 10;
      const retryAt = new Date(Date.now() + delaySeconds * 1000);
      
      // ⭐ 修复 3: 不删除任务记录，而是更新为 pending_retry 状态
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: task.PK,
            SK: task.SK
          },
          UpdateExpression: 'SET #status = :status, retryCount = :retryCount, lastError = :lastError, lastAttemptAt = :lastAttemptAt, retryAt = :retryAt, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':status': 'pending_retry',  // 新状态：等待重试
            ':retryCount': nextRetry,
            ':lastError': reason,
            ':lastAttemptAt': timestamp,
            ':retryAt': retryAt.toISOString(),
            ':updatedAt': timestamp
          }
        })
      );
      
      console.log(`[PanelWorker] Task ${task.panelId} will be retried at ${retryAt.toISOString()} (delay: ${delaySeconds}s)`);
      
      // Use EventBridge to schedule the retry (no Lambda sleep!)
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'qnyproj.panel-worker',
              DetailType: 'RetryPanelTask',
              Detail: JSON.stringify({
                ...task,
                status: 'pending',
                retryCount: nextRetry,
                lastError: reason,
                lastAttemptAt: timestamp,
                retryAt: retryAt.toISOString(),
                maxRetries: MAX_ATTEMPTS
              }),
              Time: retryAt // EventBridge will deliver at this time
            }
          ]
        })
      );
      
      console.log(`[PanelWorker] Task ${task.panelId} scheduled for retry via EventBridge`);
      return; // Don't mark job as failed yet
    } catch (retryError) {
      console.error(`[PanelWorker] Failed to schedule retry for task ${task.panelId}:`, retryError);
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
        ':retryCount': currentRetry  // ⭐ 修复 2: 修正变量名（原为 updatedRetry）
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
