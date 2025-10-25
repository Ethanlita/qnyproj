const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const MAX_LIMIT = 50;

exports.handler = async (event) => {
  try {
    if (!TABLE_NAME) {
      throw new Error('TABLE_NAME environment variable not set');
    }

    const method = event.httpMethod || event.requestContext?.http?.method;
    const path = event.rawPath || event.path || '';

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

    if (method === 'GET' && isListPath(path) && !event.pathParameters?.id) {
      const userId = getUserId(event);
      if (!userId) {
        return errorResponse(401, 'Unauthorized');
      }
      return await handleListJobs(event, userId);
    }

    const jobId = event.pathParameters?.id;
    if (!jobId) {
      return errorResponse(400, 'Missing job ID');
    }

    const userId = getUserId(event);
    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    const job = await loadJob(jobId);
    if (!job) {
      return errorResponse(404, `Job ${jobId} not found`);
    }

    if (job.userId && job.userId !== userId) {
      return errorResponse(403, 'You are not allowed to access this job');
    }

    const tasksSummary = await summarizeTasks(jobId);

    return successResponse({
      id: job.id,
      type: job.type,
      status: job.status,
      mode: job.mode,
      novelId: job.novelId,
      storyboardId: job.storyboardId,
      charId: job.charId,
      configId: job.configId,
      progress: normalizeProgress(job.progress, tasksSummary),
      result: job.result || null,
      createdAt: toIsoString(job.createdAt),
      updatedAt: toIsoString(job.updatedAt),
      tasks: tasksSummary
    });
  } catch (error) {
    console.error('[JobsFunction] Error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

async function handleListJobs(event, userId) {
  const qs = event.queryStringParameters || {};
  const limitRaw = parseInt(qs.limit ?? '20', 10);
  const limit = clampLimit(limitRaw);
  const lastKey = decodeCursor(qs.lastKey);
  const typeFilter = qs.type;
  const statusFilter = qs.status;

  console.log(`[Jobs] Listing jobs for user ${userId} limit=${limit} cursor=${qs.lastKey || 'null'}`);

  const query = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':sk': 'JOB#'
    },
    Limit: limit,
    ScanIndexForward: false
  };

  if (lastKey) {
    query.ExclusiveStartKey = lastKey;
  }

  const result = await docClient.send(new QueryCommand(query));
  let items = result.Items || [];

  if (typeFilter) {
    items = items.filter((item) => item.type === typeFilter);
  }
  if (statusFilter) {
    items = items.filter((item) => item.status === statusFilter);
  }

  const jobs = items.map((item) => ({
    id: item.id,
    type: item.type,
    status: item.status,
    mode: item.mode,
    novelId: item.novelId,
    storyboardId: item.storyboardId,
    charId: item.charId,
    configId: item.configId,
    progress: normalizeProgress(item.progress || {}, {}),
    result: item.result || null,
    createdAt: toIsoString(item.createdAt),
    updatedAt: toIsoString(item.updatedAt)
  }));

  return successResponse({
    items: jobs,
    lastKey: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : undefined
  });
}

async function loadJob(jobId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `JOB#${jobId}`,
        SK: `JOB#${jobId}`
      }
    })
  );
  return result.Item || null;
}

async function summarizeTasks(jobId) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `JOB#${jobId}`,
        ':sk': 'PANEL_TASK#'
      }
    })
  );

  const tasks = result.Items || [];
  if (tasks.length === 0) {
    return {
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      inProgress: 0,
      retrying: 0  // ⭐ 修复 3: 新增重试中状态
    };
  }

  let completed = 0;
  let failed = 0;
  let inProgress = 0;
  let pending = 0;
  let retrying = 0;  // ⭐ 修复 3: 新增重试中计数

  for (const task of tasks) {
    switch (task.status) {
      case 'completed':
        completed += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      case 'in_progress':
        inProgress += 1;
        break;
      case 'pending_retry':  // ⭐ 修复 3: 处理重试中状态
        retrying += 1;
        break;
      default:
        pending += 1;
    }
  }

  return {
    total: tasks.length,
    completed,
    failed,
    inProgress,
    pending,
    retrying  // ⭐ 修复 3: 返回重试中数量
  };
}

function normalizeProgress(progress = {}, tasks = {}) {
  const total = progress.total || tasks.total || 0;
  const completed = progress.completed || tasks.completed || 0;
  const failed = progress.failed || tasks.failed || 0;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    total,
    completed,
    failed,
    percentage
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

function encodeCursor(key) {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64');
}

function decodeCursor(cursor) {
  if (!cursor) return undefined;
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    console.warn('[Jobs] Failed to decode cursor:', error);
    return undefined;
  }
}

function clampLimit(value) {
  if (Number.isNaN(value) || value <= 0) {
    return 20;
  }
  return Math.min(value, MAX_LIMIT);
}

function isListPath(path) {
  return path === '/jobs' || path === '/dev/jobs';
}
