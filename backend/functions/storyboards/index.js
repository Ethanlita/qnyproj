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

    const userId = getUserId(event);
    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    const { pathParameters = {} } = event;
    const novelIdForList = pathParameters.novelId ?? pathParameters.id;

    if (method === 'GET' && novelIdForList) {
      console.log(`[StoryboardsFunction] user=${userId} list novel=${novelIdForList}`);
      return await handleListStoryboards(novelIdForList, userId);
    }

    const storyboardId = pathParameters.id;
    if (method === 'GET' && storyboardId) {
      console.log(`[StoryboardsFunction] user=${userId} storyboard=${storyboardId}`);
      return await handleGetStoryboard(storyboardId, userId);
    }

    return errorResponse(404, 'Not found');
  } catch (error) {
    console.error('[StoryboardsFunction] Error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

async function handleGetStoryboard(storyboardId, userId) {
  const panels = await loadPanels(storyboardId);
  if (panels.length === 0) {
    return errorResponse(404, `Storyboard ${storyboardId} not found`);
  }

  const novelId = panels[0].novelId;
  if (!novelId) {
    return errorResponse(500, 'Storyboard is missing novel reference');
  }

  const novel = await loadNovel(novelId);
  if (!novel) {
    return errorResponse(404, `Novel ${novelId} not found`);
  }
  if (novel.userId && novel.userId !== userId) {
    return errorResponse(403, 'You are not allowed to access this storyboard');
  }

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
}

async function handleListStoryboards(novelId, userId) {
  const novel = await loadNovel(novelId);
  if (!novel) {
    return errorResponse(404, `Novel ${novelId} not found`);
  }
  if (novel.userId && novel.userId !== userId) {
    return errorResponse(403, 'You are not allowed to access this novel');
  }

  const storyboardItems = await listStoryboardItems(novelId);
  const normalized = storyboardItems
    .map(normalizeStoryboardSummary)
    .sort((a, b) => {
      const left = a.chapterNumber ?? 0;
      const right = b.chapterNumber ?? 0;
      if (left === right) {
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      }
      return left - right;
    });

  return successResponse({
    items: normalized
  });
}

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

async function listStoryboardItems(novelId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `NOVEL#${novelId}`,
        ':sk': 'STORYBOARD#'
      }
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

async function loadNovel(novelId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `NOVEL#${novelId}`,
        SK: `NOVEL#${novelId}`
      }
    })
  );
  return result.Item || null;
}

function normalizeStoryboardSummary(item) {
  const totalPanels = typeof item.totalPanels === 'number' ? item.totalPanels : undefined;
  const panelCount = typeof item.panelCount === 'number' ? item.panelCount : totalPanels;
  return {
    id: item.id,
    novelId: item.novelId,
    chapterNumber: typeof item.chapterNumber === 'number' ? item.chapterNumber : undefined,
    totalPages: typeof item.totalPages === 'number' ? item.totalPages : undefined,
    totalPanels,
    panelCount,
    status: item.status || 'generated',
    createdAt: toIsoString(item.createdAt),
    updatedAt: toIsoString(item.updatedAt)
  };
}

function toIsoString(value) {
  if (!value) return undefined;
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  return undefined;
}
