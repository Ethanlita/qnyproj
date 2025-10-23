const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand
} = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { v4: uuid } = require('uuid');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const MAX_LIMIT = 100;

exports.handler = async (event) => {
  try {
    if (!TABLE_NAME) {
      throw new Error('TABLE_NAME environment variable not set');
    }

    const method = event.httpMethod || event.requestContext?.http?.method;
    const path = event.rawPath || event.path || '';
    const userId = getUserId(event) || 'anonymous';

    if (method === 'GET' && isRootPath(path)) {
      return await handleListNovels(event, userId);
    }

    if (method === 'POST' && isRootPath(path)) {
      return await handleCreateNovel(event, userId);
    }

    if (isDetailPath(path)) {
      const novelId = event.pathParameters?.id;
      if (!novelId) {
        return errorResponse(400, 'Missing novel ID');
      }

      if (method === 'GET') {
        return await handleGetNovel(novelId, userId);
      }

      if (method === 'DELETE') {
        return await handleDeleteNovel(novelId, userId);
      }
    }

    return errorResponse(404, 'Not found');
  } catch (error) {
    console.error('[NovelsFunction] Error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

async function handleListNovels(event, userId) {
  const qs = event.queryStringParameters || {};
  const limitRaw = parseInt(qs.limit ?? '20', 10);
  const limit = clampLimit(limitRaw);
  const lastKey = decodeCursor(qs.lastKey);
  const statusFilter = qs.status;

  console.log(`[Novels] Listing novels for user ${userId} limit=${limit} cursor=${qs.lastKey || 'null'}`);

  const query = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':sk': 'NOVEL#'
    },
    Limit: limit,
    ScanIndexForward: false
  };

  if (lastKey) {
    query.ExclusiveStartKey = lastKey;
  }

  const result = await docClient.send(new QueryCommand(query));
  let items = (result.Items || []).filter((item) => item.entityType === 'Novel');

  if (statusFilter) {
    items = items.filter((item) => item.status === statusFilter);
  }

  const novels = items.map(deserializeNovel);
  return successResponse({
    items: novels,
    lastKey: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : undefined
  });
}

async function handleCreateNovel(event, userId) {
  const body = safeJsonParse(event.body);
  if (!body || typeof body !== 'object') {
    return errorResponse(400, 'Invalid request payload');
  }

  const { title, text, metadata } = body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return errorResponse(400, 'title is required');
  }

  const novelId = uuid();
  const timestamp = Date.now();
  const item = {
    PK: `NOVEL#${novelId}`,
    SK: `NOVEL#${novelId}`,
    entityType: 'Novel',
    id: novelId,
    userId,
    title: title.trim(),
    originalText: typeof text === 'string' && text.trim().length > 0 ? text : null,
    originalTextS3: null,
    status: 'created',
    storyboardId: null,
    metadata: sanitizeMetadata(metadata),
    createdAt: timestamp,
    updatedAt: timestamp,
    GSI1PK: `USER#${userId}`,
    GSI1SK: `NOVEL#${timestamp}`,
    GSI2PK: `NOVEL#${novelId}`,
    GSI2SK: timestamp
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item
    })
  );

  console.log(`[Novels] Created novel ${novelId} for user ${userId}`);
  return successResponse(deserializeNovel(item), 201);
}

async function handleGetNovel(novelId, userId) {
  const item = await loadNovel(novelId);
  if (!item) {
    return errorResponse(404, `Novel ${novelId} not found`);
  }

  if (item.userId && item.userId !== userId) {
    return errorResponse(403, 'You are not allowed to access this novel');
  }

  return successResponse(deserializeNovel(item));
}

async function handleDeleteNovel(novelId, userId) {
  const item = await loadNovel(novelId);
  if (!item) {
    return errorResponse(404, `Novel ${novelId} not found`);
  }
  if (item.userId && item.userId !== userId) {
    return errorResponse(403, 'You are not allowed to delete this novel');
  }

  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `NOVEL#${novelId}`,
        SK: `NOVEL#${novelId}`
      }
    })
  );

  console.log(`[Novels] Deleted novel ${novelId} for user ${userId}`);
  return {
    statusCode: 204,
    headers: require('../../lib/response').corsHeaders(),
    body: ''
  };
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

function deserializeNovel(item) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    storyboardId: item.storyboardId || undefined,
    originalText: item.originalText || undefined,
    originalTextS3: item.originalTextS3 || undefined,
    userId: item.userId,
    metadata: item.metadata || {},
    createdAt: toIsoString(item.createdAt),
    updatedAt: toIsoString(item.updatedAt)
  };
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  const result = {};
  if (metadata.genre && typeof metadata.genre === 'string') {
    result.genre = metadata.genre;
  }
  if (Array.isArray(metadata.tags)) {
    result.tags = metadata.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0);
  }
  if (metadata.language && typeof metadata.language === 'string') {
    result.language = metadata.language;
  }
  return result;
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

function safeJsonParse(payload) {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch (error) {
    console.warn('[Novels] Failed to parse JSON body:', error);
    return null;
  }
}

function clampLimit(value) {
  if (Number.isNaN(value) || value <= 0) {
    return 20;
  }
  return Math.min(value, MAX_LIMIT);
}

function encodeCursor(key) {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64');
}

function decodeCursor(cursor) {
  if (!cursor) {
    return undefined;
  }
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf8');
    const key = JSON.parse(json);
    return key;
  } catch (error) {
    console.warn('[Novels] Failed to decode cursor:', error);
    return undefined;
  }
}

function isRootPath(path) {
  return path === '/novels' || path === '/dev/novels';
}

function isDetailPath(path) {
  return /\/novels\/[^/]+$/.test(path) || /\/dev\/novels\/[^/]+$/.test(path);
}
