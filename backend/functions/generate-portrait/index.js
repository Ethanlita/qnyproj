const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { uploadImage, getPresignedUrl } = require('../../lib/s3-utils');
const { s3ImagesToBase64 } = require('../../lib/s3-image-utils');
const ImagenAdapter = require('../../lib/imagen-adapter');
const { buildCharacterPrompt } = require('../../lib/prompt-builder');
const { getGeminiConfig } = require('../../lib/ai-secrets');
const { v4: uuid } = require('uuid');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const VIEWS = ['front', 'three-quarter', 'side', '45-degree'];
const PORTRAIT_MODE = 'hd';

let imagenAdapterPromise = null;

exports.handler = async (event) => {
  try {
    const method = event.httpMethod || event.requestContext?.http?.method;

    // Handle OPTIONS preflight request
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Max-Age': '86400'
        },
        body: ''
      };
    }

    if (!TABLE_NAME) {
      throw new Error('TABLE_NAME environment variable not set');
    }

    const { charId, configId } = event.pathParameters || {};
    if (!charId || !configId) {
      return errorResponse(400, 'charId and configId are required');
    }

    const userId = getUserId(event) || 'anonymous';
    console.log(`[GeneratePortrait] user=${userId} char=${charId} config=${configId}`);

    const character = await loadCharacter(charId);
    if (!character) {
      return errorResponse(404, `Character ${charId} not found`);
    }

    const config = await loadConfiguration(charId, configId);
    if (!config) {
      return errorResponse(404, `Configuration ${configId} not found`);
    }

    // ⭐ 问题 4 修复: 幂等性检查（防止重复生成）
    const existingJob = await checkInProgressJob(charId, configId, 'generate_portrait');
    if (existingJob) {
      console.log(`[GeneratePortrait] Job already in progress: ${existingJob.id}`);
      return errorResponse(409, 'A portrait generation task is already in progress for this configuration', {
        jobId: existingJob.id,
        status: existingJob.status,
        progress: existingJob.progress
      });
    }

    const jobId = uuid();
    const createdAt = new Date().toISOString();
    const createdAtNumber = Date.now();

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `JOB#${jobId}`,
          SK: `JOB#${jobId}`,
          id: jobId,
          type: 'generate_portrait',
          status: 'in_progress',
          charId,
          configId,
          novelId: character.novelId,
          userId,
          progress: {
            total: VIEWS.length,
            completed: 0,
            failed: 0,
            percentage: 0
          },
          result: {
            portraits: []
          },
          createdAt,
          updatedAt: createdAt,
          GSI1PK: `USER#${userId}`,
          GSI1SK: `JOB#${createdAtNumber}`,
          GSI2PK: `CHAR#${charId}`,
          GSI2SK: createdAtNumber
        }
      })
    );

    const adapter = await getImagenAdapter();
    
    // Convert S3 reference images to base64 (parallel download)
    // referenceImagesS3 is array of objects: [{ s3Key: 'path/to/image.png' }, ...]
    const referenceS3Uris = (config.referenceImagesS3 || []).map(item => {
      // Extract s3Key from object and convert to s3:// URI
      const key = typeof item === 'string' ? item : item.s3Key;
      return key.startsWith('s3://') ? key : `s3://${process.env.ASSETS_BUCKET}/${key}`;
    });
    
    const referenceImagesBase64 = referenceS3Uris.length > 0
      ? await s3ImagesToBase64(referenceS3Uris)
      : [];
    
    console.log(`[GeneratePortrait] Downloaded ${referenceImagesBase64.length} reference images from S3`);

    // Generate all 4 views concurrently (performance optimization)
    const generationPromises = VIEWS.map(async (view) => {
      const prompt = buildCharacterPrompt(
        {
          ...character,
          appearance: {
            ...(character.baseInfo || {}),
            ...(config.appearance || {})
          },
          tags: config.tags || []
        },
        { view, mode: PORTRAIT_MODE }
      );

      console.log(`[GeneratePortrait] Generating view=${view} prompt="${prompt.text}" refs=${referenceImagesBase64.length}`);

      const response = await adapter.generate({
        prompt: prompt.text,
        negativePrompt: prompt.negativePrompt,
        referenceImages: referenceImagesBase64,  // Pass base64-encoded reference images
        aspectRatio: '1:1',
        mode: PORTRAIT_MODE
      });

      const key = `characters/${charId}/${configId}/portrait-${view}.png`;
      await uploadImage(key, response.buffer, {
        contentType: response.mimeType || 'image/png',
        metadata: {
          'char-id': charId,
          'config-id': configId,
          view
        },
        tagging: `Type=portrait&Character=${charId}`
      });

      await updateJobProgress(jobId, {
        view,
        s3Key: key
      });

      return {
        view,
        s3Key: key,
        generatedAt: new Date().toISOString()
      };
    });

    // Wait for all portraits to complete (parallel execution)
    const generatedPortraits = await Promise.all(generationPromises);

    console.log(`[GeneratePortrait] Generated ${generatedPortraits.length} portraits in parallel`);

    const mergedPortraits = mergePortraits(config.generatedPortraitsS3 || [], generatedPortraits);
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: buildConfigKey(charId, configId),
        UpdateExpression: 'SET generatedPortraitsS3 = :portraits, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':portraits': mergedPortraits,
          ':updatedAt': new Date().toISOString()
        }
      })
    );

    await updateCharacterPortraitSummary(character, mergedPortraits);

    const signed = await Promise.all(
      generatedPortraits.map(async (item) => ({
        ...item,
        url: await getPresignedUrl(item.s3Key)
      }))
    );

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `JOB#${jobId}`,
          SK: `JOB#${jobId}`
        },
        UpdateExpression: 'SET #status = :completed, updatedAt = :updatedAt, progress = :progress, result = :result',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':completed': 'completed',
          ':updatedAt': new Date().toISOString(),
          ':progress': {
            total: VIEWS.length,
            completed: VIEWS.length,
            failed: 0,
            percentage: 100
          },
          ':result': {
            portraits: generatedPortraits
          }
        }
      })
    );

    return successResponse(
      {
        jobId,
        status: 'completed',
        portraits: signed,
        message: 'Portrait generation completed successfully.'
      },
      202
    );
  } catch (error) {
    console.error('[GeneratePortrait] Error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

async function loadCharacter(charId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `CHAR#${charId}`,
        ':sk': `CHAR#${charId}`
      },
      Limit: 1
    })
  );

  return result.Items?.[0] || null;
}

/**
 * Check if there's an in-progress job for the same character configuration.
 * Returns the existing job if found, null otherwise.
 */
async function checkInProgressJob(charId, configId, jobType) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      FilterExpression: '#status = :inProgress AND #type = :jobType AND configId = :configId',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#type': 'type'
      },
      ExpressionAttributeValues: {
        ':pk': `CHAR#${charId}`,
        ':inProgress': 'in_progress',
        ':jobType': jobType,
        ':configId': configId
      },
      Limit: 1,
      ScanIndexForward: false // Most recent first
    })
  );

  return result.Items?.[0] || null;
}

async function loadConfiguration(charId, configId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: buildConfigKey(charId, configId)
    })
  );
  return result.Item || null;
}

function buildConfigKey(charId, configId) {
  return {
    PK: `CHAR#${charId}`,
    SK: `CONFIG#${configId}`
  };
}

function mergePortraits(existing, incoming) {
  const merged = [...existing];
  const index = new Map(merged.map((item) => [item.view, item]));

  for (const portrait of incoming) {
    if (index.has(portrait.view)) {
      Object.assign(index.get(portrait.view), portrait);
    } else {
      merged.push(portrait);
      index.set(portrait.view, portrait);
    }
  }

  return merged;
}

function buildReferenceUris(referenceImages) {
  return referenceImages
    .filter((item) => item && item.s3Key)
    .map((item) => `s3://${process.env.ASSETS_BUCKET}/${item.s3Key}`);
}

async function updateJobProgress(jobId, portraitSummary) {
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

    const progress = current.Item.progress || { total: VIEWS.length, completed: 0, failed: 0 };
    const completed = Math.min(progress.completed + 1, progress.total);
    const percentage = Math.round((completed / progress.total) * 100);

    const portraits = current.Item.result?.portraits || [];
    const updatedPortraits = [...portraits, portraitSummary];

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `JOB#${jobId}`,
            SK: `JOB#${jobId}`
          },
          ConditionExpression: 'updatedAt = :expected',
          UpdateExpression: 'SET updatedAt = :updatedAt, progress = :progress, result = :result',
          ExpressionAttributeValues: {
            ':expected': current.Item.updatedAt,
            ':updatedAt': new Date().toISOString(),
            ':progress': {
              ...progress,
              completed,
              percentage
            },
            ':result': {
              portraits: updatedPortraits
            }
          }
        })
      );
      return;
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') {
        throw error;
      }
      // Retry
    }
  }
}

async function updateCharacterPortraitSummary(character, portraits) {
  if (!character || !character.PK || !character.SK) return;

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: character.PK,
        SK: character.SK
      },
      UpdateExpression: 'SET portraits = :portraits, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':portraits': portraits,
        ':updatedAt': new Date().toISOString()
      }
    })
  );
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

