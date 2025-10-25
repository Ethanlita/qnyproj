const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { v4: uuid } = require('uuid');

const ImagenAdapter = require('../../lib/imagen-adapter');
const { uploadImage } = require('../../lib/s3-utils');
const { getGeminiConfig } = require('../../lib/ai-secrets');
const BibleManager = require('../../lib/bible-manager');
const { buildCharacterPrompt, buildScenePrompt } = require('../../lib/prompt-builder');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});
const TABLE_NAME = process.env.TABLE_NAME;

let bibleManager;
let imagenAdapterPromise = null;

function getBibleManager() {
  if (!bibleManager) {
    const tableName = process.env.BIBLES_TABLE_NAME;
    const bucket = process.env.BIBLES_BUCKET || process.env.ASSETS_BUCKET;
    if (!tableName || !bucket) {
      throw new Error('Bibles table or bucket not configured');
    }
    bibleManager = new BibleManager(docClient, s3Client, tableName, bucket);
  }
  return bibleManager;
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

exports.handler = async (event) => {
  const failures = [];

  for (const record of event.Records || []) {
    try {
      const payload = JSON.parse(record.body);
      await processMessage(payload);
    } catch (error) {
      console.error('[ReferenceWorker] Failed to process message', error);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return {
    batchItemFailures: failures
  };
};

async function processMessage(message) {
  if (!message || !message.type) {
    throw new Error('Invalid message payload');
  }

  try {
    if (message.type === 'character') {
      await processCharacterMessage(message);
    } else if (message.type === 'scene') {
      await processSceneMessage(message);
    } else {
      console.warn('[ReferenceWorker] Unknown message type:', message.type);
      return;
    }

    await updateReferenceJobProgress(message.referenceJobId, { succeeded: true });
  } catch (error) {
    await updateReferenceJobProgress(message.referenceJobId, { succeeded: false, error });
    throw error;
  }
}

async function processCharacterMessage(message) {
  const character = message.character || {};
  const prompt = buildCharacterPrompt(character, {
    view: 'three-quarter',
    pose: character.pose || 'standing',
    mode: 'preview'
  });

  const adapter = await getImagenAdapter();
  const result = await adapter.generate({
    prompt: prompt.text,
    negativePrompt: prompt.negativePrompt,
    aspectRatio: '1:1',
    mode: 'preview'
  });

  const key = buildReferenceKey('characters', message.novelId, message.identifier || character.name || uuid());
  await uploadImage(key, result.buffer, {
    contentType: result.mimeType || 'image/png',
    metadata: {
      type: 'reference',
      entry: 'character',
      novel: message.novelId || 'unknown'
    },
    tagging: 'Type=bible-reference&Entity=character'
  });

  await getBibleManager().appendReferenceImage(
    message.novelId,
    'character',
    message.identifier || character.name,
    {
      s3Key: key,
      label: `${character.name || '角色'} 自动参考图`,
      source: 'auto'
    },
    { updatedBy: 'system' }
  );
}

async function processSceneMessage(message) {
  const scene = message.scene || {};
  const prompt = buildScenePrompt(scene);
  const adapter = await getImagenAdapter();
  const result = await adapter.generate({
    prompt: prompt.text,
    negativePrompt: prompt.negativePrompt,
    aspectRatio: '16:9',
    mode: 'preview'
  });

  const key = buildReferenceKey('scenes', message.novelId, message.identifier || scene.id || uuid());
  await uploadImage(key, result.buffer, {
    contentType: result.mimeType || 'image/png',
    metadata: {
      type: 'reference',
      entry: 'scene',
      novel: message.novelId || 'unknown'
    },
    tagging: 'Type=bible-reference&Entity=scene'
  });

  await getBibleManager().appendReferenceImage(
    message.novelId,
    'scene',
    message.identifier || scene.id,
    {
      s3Key: key,
      label: `${scene.name || '场景'} 自动参考图`,
      source: 'auto'
    },
    { updatedBy: 'system' }
  );
}

function buildReferenceKey(scope, novelId, identifier) {
  const safeIdentifier = (identifier || uuid())
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '_');
  return `bibles/${novelId}/${scope}/${safeIdentifier}/auto/${Date.now()}-${uuid()}.png`;
}

async function updateReferenceJobProgress(referenceJobId, { succeeded, error }) {
  if (!referenceJobId || !TABLE_NAME) {
    return;
  }

  try {
    const jobResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `JOB#${referenceJobId}`,
          SK: `JOB#${referenceJobId}`
        }
      })
    );

    if (!jobResult.Item) {
      return;
    }

    const currentProgress = jobResult.Item.progress || {};
    const total = currentProgress.total || 0;
    const completed = (currentProgress.completed || 0) + (succeeded ? 1 : 0);
    const failed = (currentProgress.failed || 0) + (succeeded ? 0 : 1);
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const nextProgress = {
      ...currentProgress,
      total,
      completed,
      failed,
      percentage
    };

    let nextStatus = jobResult.Item.status;
    if (completed + failed >= total && total > 0) {
      nextStatus = failed > 0 ? 'failed' : 'completed';
    } else if (nextStatus === 'queued') {
      nextStatus = 'in_progress';
    }

    const updateExpressions = ['SET updatedAt = :updatedAt', 'progress = :progress'];
    const expressionAttributeValues = {
      ':updatedAt': new Date().toISOString(),
      ':progress': nextProgress
    };
    const expressionAttributeNames = {};

    if (nextStatus !== jobResult.Item.status) {
      updateExpressions.push('#status = :status');
      expressionAttributeValues[':status'] = nextStatus;
      expressionAttributeNames['#status'] = 'status';
    }

    if (!succeeded && error) {
      updateExpressions.push('lastErrorMessage = :lastErrorMessage');
      expressionAttributeValues[':lastErrorMessage'] =
        error instanceof Error ? error.message : String(error);
    }

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `JOB#${referenceJobId}`,
          SK: `JOB#${referenceJobId}`
        },
        UpdateExpression: updateExpressions.join(', '),
        ExpressionAttributeValues: expressionAttributeValues,
        ...(Object.keys(expressionAttributeNames).length > 0
          ? { ExpressionAttributeNames: expressionAttributeNames }
          : {})
      })
    );
  } catch (updateError) {
    console.warn('[ReferenceWorker] Failed to update reference job progress', updateError);
  }
}
