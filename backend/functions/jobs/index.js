const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  try {
    if (!TABLE_NAME) {
      throw new Error('TABLE_NAME environment variable not set');
    }

    const jobId = event.pathParameters?.id;
    if (!jobId) {
      return errorResponse(400, 'Missing job ID');
    }

    const userId = getUserId(event) || 'anonymous';

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
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      tasks: tasksSummary
    });
  } catch (error) {
    console.error('[JobsFunction] Error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

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
      pending: 0
    };
  }

  let completed = 0;
  let failed = 0;
  let inProgress = 0;
  let pending = 0;

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
      default:
        pending += 1;
    }
  }

  return {
    total: tasks.length,
    completed,
    failed,
    inProgress,
    pending
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

