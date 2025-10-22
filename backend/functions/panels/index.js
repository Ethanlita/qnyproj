const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { getPresignedUrl } = require('../../lib/s3-utils');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  try {
    if (!TABLE_NAME) {
      throw new Error('TABLE_NAME environment variable not set');
    }

    const panelId = event.pathParameters?.panelId;
    if (!panelId) {
      return errorResponse(400, 'Missing panel ID');
    }

    const userId = getUserId(event) || 'anonymous';
    console.log(`[PanelsFunction] user=${userId} panel=${panelId}`);

    const panel = await loadPanel(panelId);
    if (!panel) {
      return errorResponse(404, `Panel ${panelId} not found`);
    }

    const images = await buildPanelImages(panel.imagesS3 || {});

    return successResponse({
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
      status: panel.status || 'pending',
      images: images.urls,
      imagesS3: images.s3
    });
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
