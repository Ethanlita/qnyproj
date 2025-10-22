/**
 * Retry Handler Lambda Function
 * 
 * Triggered by EventBridge Scheduler to retry failed panel generation tasks.
 * This function re-inserts failed tasks into DynamoDB to trigger the Stream again.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Handle EventBridge retry events
 */
exports.handler = async (event) => {
  console.log('[RetryHandler] Received event:', JSON.stringify(event, null, 2));

  if (!TABLE_NAME) {
    console.error('[RetryHandler] TABLE_NAME not configured');
    return { statusCode: 500, error: 'TABLE_NAME not configured' };
  }

  let processed = 0;
  const errors = [];

  // EventBridge sends events in the "detail" field
  const events = Array.isArray(event) ? event : [event];

  for (const evt of events) {
    const task = evt.detail || evt;

    if (!task.PK || !task.SK) {
      console.error('[RetryHandler] Invalid task (missing PK/SK):', task);
      errors.push({ task, error: 'Missing PK/SK' });
      continue;
    }

    try {
      await retryTask(task);
      processed += 1;
      console.log(`[RetryHandler] Successfully requeued task: ${task.panelId}`);
    } catch (error) {
      console.error(`[RetryHandler] Failed to retry task ${task.panelId}:`, error);
      errors.push({ task, error: error.message });
    }
  }

  console.log(`[RetryHandler] Processed ${processed} tasks, ${errors.length} errors`);

  return {
    statusCode: 200,
    processed,
    errors: errors.length > 0 ? errors : undefined
  };
};

/**
 * Re-insert task into DynamoDB to trigger Stream INSERT event
 */
async function retryTask(task) {
  const timestamp = new Date().toISOString();
  const MAX_ATTEMPTS = 3; // 总尝试次数（初次 + 2次重试）
  const currentRetry = task.retryCount || 0;

  // ⭐ 问题修复: 检查重试次数护栏，防止超过最大尝试次数
  if (currentRetry >= MAX_ATTEMPTS - 1) {
    console.warn(
      `[RetryHandler] Task ${task.panelId} has reached max attempts (${currentRetry + 1}/${MAX_ATTEMPTS}), skipping retry`
    );
    return; // 不重新插入，任务将保持 failed 状态
  }

  // Re-insert with updated metadata
  const updatedTask = {
    ...task,
    status: 'pending',
    updatedAt: timestamp,
    retriedAt: timestamp
  };

  console.log(
    `[RetryHandler] Reinserting task ${task.panelId} ` +
    `(retry ${currentRetry}/${MAX_ATTEMPTS - 1})`
  );

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: updatedTask
    })
  );
}
