const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { getPresignedUrl } = require('../../lib/s3-utils');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

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

    const panelId = event.pathParameters?.panelId;
    if (!panelId) {
      return errorResponse(400, 'Missing panel ID');
    }

    const userId = getUserId(event);
    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }
    console.log(`[PanelsFunction] user=${userId} panel=${panelId}`);

    const panel = await loadPanel(panelId);
    if (!panel) {
      return errorResponse(404, `Panel ${panelId} not found`);
    }

    if (method === 'PATCH') {
      const userId = getUserId(event);
      if (!userId) {
        return errorResponse(401, 'Unauthorized');
      }

      let payload;
      try {
        payload = parseJsonBody(event.body);
      } catch (err) {
        return errorResponse(400, err.message);
      }

      const updatedPanel = await updatePanel(panel, payload);
      return successResponse(await formatPanelResponse(updatedPanel));
    }

    return successResponse(await formatPanelResponse(panel));
  } catch (error) {
    console.error('[PanelsFunction] Error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

async function loadPanel(panelId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `PANEL#${panelId}`,
        ':sk': `PANEL#${panelId}`
      },
      Limit: 1
    })
  );
  return result.Items?.[0] || null;
}

async function buildPanelImages(imagesS3) {
  const entries = Object.entries(imagesS3 || {});
  if (entries.length === 0) {
    return { urls: {}, s3: {} };
  }

  const urls = {};
  const s3 = {};
  for (const [mode, key] of entries) {
    s3[mode] = key;
    urls[mode] = await getPresignedUrl(key);
  }
  return { urls, s3 };
}

function parseJsonBody(body) {
  if (!body) {
    throw new Error('Missing request body');
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

async function updatePanel(panel, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload must be an object');
  }

  const next = { ...panel };
  const assign = (field, transformer) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      next[field] = transformer ? transformer(payload[field]) : payload[field];
    }
  };

  assign('scene', (value) => (typeof value === 'string' ? value : panel.scene));
  assign('shotType', (value) => (typeof value === 'string' ? value : panel.shotType));
  assign('cameraAngle', (value) => (typeof value === 'string' ? value : panel.cameraAngle));
  assign('composition', (value) => (value && typeof value === 'object' ? value : panel.composition));
  assign('visualPrompt', (value) => (typeof value === 'string' ? value : panel.visualPrompt));
  assign('background', (value) => (value && typeof value === 'object' ? value : panel.background));
  assign('atmosphere', (value) => (value && typeof value === 'object' ? value : panel.atmosphere));
  assign('characters', (value) => normalizeCharacters(value, panel.characters));
  assign('dialogue', (value) => normalizeDialogue(value, panel.dialogue));

  next.updatedAt = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: next
    })
  );

  return next;
}

async function formatPanelResponse(panel) {
  const images = await buildPanelImages(panel.imagesS3 || {});
  return {
    id: panel.id,
    storyboardId: panel.storyboardId,
    novelId: panel.novelId,
    page: panel.page,
    index: panel.index,
    scene: panel.scene,
    shotType: panel.shotType,
    cameraAngle: panel.cameraAngle,
    composition: panel.composition,
    characters: panel.characters || [],
    dialogue: panel.dialogue || [],
    visualPrompt: panel.visualPrompt || '',
    background: panel.background || null,
    atmosphere: panel.atmosphere || null,
    status: panel.status || 'pending',
    images: images.urls,
    imagesS3: images.s3
  };
}

function normalizeCharacters(value, fallback = []) {
  if (!value) {
    return Array.isArray(fallback) ? fallback : [];
  }
  if (!Array.isArray(value)) {
    return Array.isArray(fallback) ? fallback : [];
  }
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      charId: item.charId || null,
      configId: item.configId || null,
      name: item.name || '',
      pose: item.pose || '',
      expression: item.expression || ''
    }));
}

function normalizeDialogue(value, fallback = []) {
  if (!value) {
    return Array.isArray(fallback) ? fallback : [];
  }
  if (!Array.isArray(value)) {
    return Array.isArray(fallback) ? fallback : [];
  }
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      speaker: item.speaker || '',
      text: item.text || '',
      bubbleType: item.bubbleType || 'speech'
    }));
}
