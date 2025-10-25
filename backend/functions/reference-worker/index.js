const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
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

  if (message.type === 'character') {
    await processCharacterMessage(message);
    return;
  }

  if (message.type === 'scene') {
    await processSceneMessage(message);
    return;
  }

  console.warn('[ReferenceWorker] Unknown message type:', message.type);
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
