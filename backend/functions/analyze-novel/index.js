/**
 * AnalyzeNovelFunction - 创建分析任务并发送到 SQS
 * 
 * 功能（重构后）：
 * 1. 验证小说存在性
 * 2. 创建 Job（状态: queued）
 * 3. 发送消息到 SQS AnalysisQueue
 * 4. 立即返回 jobId（202 Accepted）
 * 
 * 实际的分析处理由 AnalyzeWorkerFunction 完成（从 SQS 触发）
 * 
 * @module AnalyzeNovelFunction
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { v4: uuid } = require('uuid');

const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');

// AWS Clients
const dynamodbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamodbClient);
const sqsClient = new SQSClient({});

// Environment variables
const TABLE_NAME = process.env.TABLE_NAME;
const ANALYSIS_QUEUE_URL = process.env.ANALYSIS_QUEUE_URL;

/**
 * Verify that the novel exists in DynamoDB
 */
async function verifyNovelExists(novelId) {
  console.log(`[AnalyzeNovel] Verifying novel ${novelId} exists`);
  
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `NOVEL#${novelId}`,
        SK: `NOVEL#${novelId}`
      }
    })
  );
  
  if (!result.Item) {
    throw new Error(`Novel ${novelId} not found`);
  }
  
  console.log(`[AnalyzeNovel] Novel ${novelId} exists, title: ${result.Item.title || 'N/A'}`);
  return result.Item;
}

/**
 * Create Job item in DynamoDB (status: queued)
 */
async function createJob(novelId, userId, type = 'analyze') {
  const jobId = uuid();
  const timestamp = Date.now();
  
  const jobItem = {
    PK: `JOB#${jobId}`,
    SK: `JOB#${jobId}`,
    GSI1PK: `USER#${userId}`,
    GSI1SK: `JOB#${timestamp}`,
    GSI2PK: `NOVEL#${novelId}`,
    GSI2SK: timestamp,
    entityType: 'Job',
    id: jobId,
    type,
    status: 'queued',  // Changed from 'running' to 'queued'
    novelId,
    userId,
    progress: {
      percentage: 0,
      stage: 'queued',
      message: 'Analysis task queued, waiting for worker...'
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
  
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: jobItem
    })
  );
  
  console.log(`[AnalyzeNovel] Created job ${jobId} with status 'queued'`);
  return jobId;
}

/**
 * Send message to SQS for async processing
 */
async function sendToSQS(jobId, novelId, userId) {
  if (!ANALYSIS_QUEUE_URL) {
    throw new Error('ANALYSIS_QUEUE_URL environment variable not set');
  }
  
  const message = {
    jobId,
    novelId,
    userId,
    timestamp: Date.now()
  };
  
  console.log(`[AnalyzeNovel] Sending message to SQS: ${JSON.stringify(message)}`);
  
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: ANALYSIS_QUEUE_URL,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        jobId: {
          DataType: 'String',
          StringValue: jobId
        },
        novelId: {
          DataType: 'String',
          StringValue: novelId
        }
      }
    })
  );
  
  console.log(`[AnalyzeNovel] Message sent to SQS successfully`);
}

/**
 * Main Lambda handler
 * 
 * Refactored to use SQS-based async architecture:
 * 1. Verify novel exists
 * 2. Create Job (status: queued)
 * 3. Send message to SQS AnalysisQueue
 * 4. Return 202 immediately with jobId
 * 
 * Actual processing is done by AnalyzeWorkerFunction (triggered by SQS).
 * This eliminates the unreliable setImmediate() pattern.
 */
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

    const novelId = event.pathParameters?.id;
    const userId = getUserId(event);
    
    if (!novelId) {
      return errorResponse(400, 'Missing novel ID');
    }
    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }
    
    console.log(`[AnalyzeNovel] Creating analysis task for novel ${novelId}, user ${userId}`);
    
    // Step 1: Verify novel exists (fail fast)
    await verifyNovelExists(novelId);
    
    // Step 2: Create job with status 'queued'
    const jobId = await createJob(novelId, userId, 'analyze');
    
    // Step 3: Send to SQS for async processing
    await sendToSQS(jobId, novelId, userId);
    
    console.log(`[AnalyzeNovel] Successfully queued analysis task, jobId: ${jobId}`);
    
    // Step 4: Return immediately (202 Accepted)
    return successResponse({
      jobId,
      status: 'queued',
      message: 'Analysis task queued successfully. Use GET /jobs/{jobId} to check progress.',
      estimatedDuration: '2-5 minutes'
    }, 202);
    
  } catch (error) {
    console.error('[AnalyzeNovel] Error:', error);
    return errorResponse(500, error.message);
  }
};


