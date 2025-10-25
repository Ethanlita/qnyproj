const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
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

    const storyboardId = event.pathParameters?.id;
    if (!storyboardId) {
      return errorResponse(400, 'Missing storyboard ID');
    }

    const userId = getUserId(event);
    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }
    console.log(`[StoryboardsFunction] user=${userId} storyboard=${storyboardId}`);

    const panels = await loadPanels(storyboardId);
    if (panels.length === 0) {
      return errorResponse(404, `Storyboard ${storyboardId} not found`);
    }

    const novelId = panels[0].novelId;
    const storyboardMeta = await loadStoryboardMeta(novelId, storyboardId);

    const responsePanels = await Promise.all(
      panels.map(async (panel) => {
        const images = await buildPanelImages(panel.imagesS3 || {});
        return {
          id: panel.id,
          storyboardId,
          novelId,
          chapterNumber: panel.chapterNumber,
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
        };
      })
    );

    return successResponse({
      id: storyboardId,
      novelId,
      chapterNumber: storyboardMeta?.chapterNumber,
      totalPages: storyboardMeta?.totalPages || estimatePages(responsePanels),
      panelCount: responsePanels.length,
      status: storyboardMeta?.status || 'generated',
      createdAt: storyboardMeta?.createdAt || panels[0].createdAt,
      updatedAt: storyboardMeta?.updatedAt || panels[0].updatedAt,
      panels: responsePanels
    });
  } catch (error) {
    console.error('[StoryboardsFunction] Error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

async function loadPanels(storyboardId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `STORYBOARD#${storyboardId}`,
        ':sk': 'PANEL#'
      },
      ScanIndexForward: true
    })
  );
  return result.Items || [];
}

async function loadStoryboardMeta(novelId, storyboardId) {
  if (!novelId) return null;

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `NOVEL#${novelId}`,
        SK: `STORYBOARD#${storyboardId}`
      }
    })
  );
  return result.Item || null;
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

function estimatePages(panels) {
  if (!panels || panels.length === 0) return 0;
  return Math.max(...panels.map((panel) => panel.page || 1));
}
