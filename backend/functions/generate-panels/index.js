const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  BatchWriteCommand,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { v4: uuid } = require('uuid');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const VALID_MODES = new Set(['preview', 'hd']);
const BATCH_SIZE = 25;

exports.handler = async (event) => {
  try {
    if (!TABLE_NAME) {
      throw new Error('TABLE_NAME environment variable not set');
    }

    const storyboardId = event.pathParameters?.id;
    const mode = (event.queryStringParameters?.mode || 'preview').toLowerCase();
    const userId = getUserId(event) || 'anonymous';

    if (!storyboardId) {
      return errorResponse(400, 'Missing storyboard ID');
    }

    if (!VALID_MODES.has(mode)) {
      return errorResponse(400, 'Invalid mode. Must be preview or hd.');
    }

    const panels = await loadPanels(storyboardId);
    if (panels.length === 0) {
      return errorResponse(404, `Storyboard ${storyboardId} not found or has no panels`);
    }

    // ⭐ 问题 4 修复: 幂等性检查（防止重复生成）
    const jobType = mode === 'preview' ? 'generate_preview' : 'generate_hd';
    const existingJob = await checkInProgressJob(storyboardId, jobType);
    if (existingJob) {
      console.log(`[GeneratePanels] Job already in progress: ${existingJob.id}`);
      return errorResponse(409, 'A panel generation task is already in progress for this storyboard', {
        jobId: existingJob.id,
        status: existingJob.status,
        mode: existingJob.mode,
        progress: existingJob.progress
      });
    }

    const novelId = panels[0].novelId;
    const timestamp = new Date().toISOString();
    const timestampNumber = Date.now();

    const jobId = uuid();
    const jobItem = {
      PK: `JOB#${jobId}`,
      SK: `JOB#${jobId}`,
      id: jobId,
      type: mode === 'preview' ? 'generate_preview' : 'generate_hd',
      status: 'pending',
      mode,
      storyboardId,
      novelId,
      userId,
      progress: {
        total: panels.length,
        completed: 0,
        failed: 0,
        percentage: 0
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      GSI1PK: `USER#${userId}`,
      GSI1SK: `JOB#${timestampNumber}`,
      GSI2PK: `STORYBOARD#${storyboardId}`,
      GSI2SK: timestampNumber
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: jobItem
      })
    );

    const tasks = panels.map((panel) => ({
      PK: `JOB#${jobId}`,
      SK: `PANEL_TASK#${panel.id}`,
      jobId,
      panelId: panel.id,
      panelKey: panel.SK,
      storyboardId,
      novelId,
      mode,
      status: 'pending',
      retryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    }));

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAME]: batch.map((task) => ({
              PutRequest: { Item: task }
            }))
          }
        })
      );
    }

    await markPanelsInProgress(storyboardId, tasks, timestamp);

    return successResponse(
      {
        jobId,
        status: 'pending',
        totalPanels: panels.length,
        mode,
        message: 'Panel generation started. Use GET /jobs/{jobId} to check progress.'
      },
      202
    );
  } catch (error) {
    console.error('[GeneratePanelsFunction] Error:', error);
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

/**
 * Check if there's an in-progress job for the same storyboard and type.
 * Returns the existing job if found, null otherwise.
 */
async function checkInProgressJob(storyboardId, jobType) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      FilterExpression: '#status IN (:pending, :inProgress) AND #type = :jobType',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#type': 'type'
      },
      ExpressionAttributeValues: {
        ':pk': `STORYBOARD#${storyboardId}`,
        ':pending': 'pending',
        ':inProgress': 'in_progress',
        ':jobType': jobType
      },
      Limit: 1,
      ScanIndexForward: false // Most recent first
    })
  );

  return result.Items?.[0] || null;
}

async function markPanelsInProgress(storyboardId, tasks, timestamp) {
  for (const task of tasks) {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `STORYBOARD#${storyboardId}`,
            SK: task.panelKey
          },
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':status': 'queued',
            ':updatedAt': timestamp
          }
        })
      );
    } catch (error) {
      console.warn(`[GeneratePanelsFunction] Failed to mark panel ${task.panelId} queued:`, error.message);
    }
  }
}

