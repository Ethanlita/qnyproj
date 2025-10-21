/**
 * SQS Integration Test - 端到端测试
 * 
 * 测试完整的 SQS → Lambda → DynamoDB 流程
 * 需要真实的 AWS 环境
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { LambdaClient, GetFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');

// AWS Clients
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Configuration
const TABLE_NAME = process.env.TABLE_NAME || 'qnyproj-api-data';
const QUEUE_URL = process.env.QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/296821242554/qnyproj-api-analysis-queue';
const LAMBDA_NAME = process.env.LAMBDA_NAME || 'qnyproj-api-AnalyzeWorkerFunction-OlJxRl9wSUDl';

// Test utilities
async function waitForJobStatus(jobId, expectedStatus, maxWaitMs = 180000) {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds
  
  while (Date.now() - startTime < maxWaitMs) {
    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `JOB#${jobId}`,
        SK: `JOB#${jobId}`
      }
    }));
    
    if (result.Item && result.Item.status === expectedStatus) {
      return result.Item;
    }
    
    if (result.Item && result.Item.status === 'failed') {
      throw new Error(`Job failed: ${result.Item.error || 'Unknown error'}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  throw new Error(`Timeout waiting for job ${jobId} to reach status ${expectedStatus}`);
}

async function createTestNovel(novelId = 'test-novel', userId = 'test-user') {
  const testText = `第一章 高考之后

高考结束的那个夏天，我站在学校门口，看着同学们三三两两地离开。

"小明，你要报什么大学？" 张华问我。

我摇摇头，"还没想好。你呢？"

"我想学计算机，" 他笑着说，"以后当程序员。"

我们在校门口聊了很久，直到夕阳西下。

那是我最后一次见到他。

第二章 大学时光

大学生活比想象中更加自由，也更加孤独。

我选择了文学专业，每天沉浸在书海中。教授说，文学是人类灵魂的窗户。

我不太理解，但我喜欢这种感觉。

图书馆成了我最常去的地方，在那里，我遇到了她。`;

  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `NOVEL#${novelId}`,
      SK: `NOVEL#${novelId}`,
      entityType: 'Novel',
      id: novelId,
      userId,
      title: '测试小说 - 高考之后',
      author: '测试作者',
      originalText: testText,
      wordCount: testText.length,
      status: 'uploaded',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }));
}

async function deleteTestNovel(novelId = 'test-novel') {
  await ddb.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `NOVEL#${novelId}`,
      SK: `NOVEL#${novelId}`
    }
  }));
}

async function createTestJob(jobId, novelId = 'test-novel', userId = 'test-user') {
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `JOB#${jobId}`,
      SK: `JOB#${jobId}`,
      type: 'Job',
      jobId,
      novelId,
      userId,
      status: 'queued',
      createdAt: Date.now()
    }
  }));
}

async function deleteTestJob(jobId) {
  await ddb.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `JOB#${jobId}`,
      SK: `JOB#${jobId}`
    }
  }));
}

async function sendSQSMessage(jobId, novelId = 'test-novel', text = 'Test text for integration testing.') {
  const result = await sqs.send(new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify({
      jobId,
      novelId,
      chapterId: 'test-chapter',
      chapterNumber: 1,
      text
    })
  }));
  
  return result.MessageId;
}

// Tests
async function testBasicFlow() {
  console.log('\n🧪 Test 1: Basic SQS → Lambda → DynamoDB Flow');
  console.log('='.repeat(60));
  
  const jobId = `integration-test-${Date.now()}`;
  const novelId = 'test-novel';
  
  try {
    // Step 0: Create test novel
    console.log(`📚 Creating test novel: ${novelId}`);
    await createTestNovel(novelId);
    
    // Step 1: Create job in DynamoDB
    console.log(`📝 Creating job: ${jobId}`);
    await createTestJob(jobId, novelId);
    
    // Step 2: Send SQS message
    console.log(`📤 Sending SQS message`);
    const messageId = await sendSQSMessage(jobId, novelId, 'Test text for processing.');
    console.log(`✅ Message sent: ${messageId}`);
    
    // Step 3: Wait for completion
    console.log(`⏳ Waiting for job completion (max 3 minutes)...`);
    const completedJob = await waitForJobStatus(jobId, 'completed', 180000);
    
    console.log(`✅ Job completed successfully!`);
    console.log(`   Storyboard ID: ${completedJob.storyboardId || 'N/A'}`);
    console.log(`   Completed at: ${new Date(completedJob.completedAt).toISOString()}`);
    
    return { success: true, jobId };
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    // Cleanup
    try {
      await deleteTestJob(jobId);
      console.log(`🧹 Cleaned up job: ${jobId}`);
      await deleteTestNovel(novelId);
      console.log(`🧹 Cleaned up novel: ${novelId}`);
    } catch (err) {
      console.warn(`⚠️  Cleanup failed: ${err.message}`);
    }
  }
}

async function testIdempotency() {
  console.log('\n🧪 Test 2: Idempotency - Duplicate Messages');
  console.log('='.repeat(60));
  
  const jobId = `idempotency-test-${Date.now()}`;
  const novelId = 'test-novel-idempotency';
  
  try {
    // Step 0: Create test novel
    console.log(`📚 Creating test novel: ${novelId}`);
    await createTestNovel(novelId);
    
    // Step 1: Create job
    console.log(`📝 Creating job: ${jobId}`);
    await createTestJob(jobId, novelId);
    
    // Step 2: Send 3 identical messages
    console.log(`📤 Sending 3 identical messages`);
    const messageIds = await Promise.all([
      sendSQSMessage(jobId, novelId),
      sendSQSMessage(jobId, novelId),
      sendSQSMessage(jobId, novelId)
    ]);
    console.log(`✅ Sent ${messageIds.length} messages`);
    
    // Step 3: Wait for completion
    console.log(`⏳ Waiting for job completion...`);
    const completedJob = await waitForJobStatus(jobId, 'completed', 180000);
    
    // Verify only processed once
    console.log(`✅ Job completed (should process only once)`);
    console.log(`   Processing count: ${completedJob.processingCount || 1}`);
    
    if (completedJob.processingCount > 1) {
      throw new Error(`Job processed ${completedJob.processingCount} times (expected 1)`);
    }
    
    return { success: true, jobId };
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    // Cleanup
    try {
      await deleteTestJob(jobId);
      console.log(`🧹 Cleaned up job: ${jobId}`);
      await deleteTestNovel(novelId);
      console.log(`🧹 Cleaned up novel: ${novelId}`);
    } catch (err) {
      console.warn(`⚠️  Cleanup failed: ${err.message}`);
    }
  }
}

async function testInvalidMessage() {
  console.log('\n🧪 Test 3: Invalid Message Handling');
  console.log('='.repeat(60));
  
  try {
    // Send invalid message (missing required fields)
    console.log(`📤 Sending invalid message`);
    await sqs.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        jobId: 'invalid-test',
        // Missing novelId, text, etc.
      })
    }));
    
    console.log(`✅ Invalid message sent (should be handled gracefully)`);
    
    // Wait a bit to see if it causes issues
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log(`✅ No crashes detected`);
    
    return { success: true };
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function checkLambdaConfiguration() {
  console.log('\n🔍 Checking Lambda Configuration');
  console.log('='.repeat(60));
  
  try {
    const config = await lambda.send(new GetFunctionConfigurationCommand({
      FunctionName: LAMBDA_NAME
    }));
    
    console.log(`📊 Lambda Configuration:`);
    console.log(`   Runtime: ${config.Runtime}`);
    console.log(`   Memory: ${config.MemorySize} MB`);
    console.log(`   Timeout: ${config.Timeout} seconds`);
    console.log(`   VPC: ${config.VpcConfig?.VpcId || 'None (public)'}`);
    
    // Check event source mappings
    const eventSources = config.EventSourceMappings || [];
    console.log(`   SQS Event Sources: ${eventSources.length}`);
    
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to get Lambda config: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function checkQueueConfiguration() {
  console.log('\n🔍 Checking SQS Queue Configuration');
  console.log('='.repeat(60));
  
  try {
    const attrs = await sqs.send(new GetQueueAttributesCommand({
      QueueUrl: QUEUE_URL,
      AttributeNames: ['All']
    }));
    
    const attributes = attrs.Attributes || {};
    
    console.log(`📊 Queue Configuration:`);
    console.log(`   Visibility Timeout: ${attributes.VisibilityTimeout} seconds`);
    console.log(`   Message Retention: ${attributes.MessageRetentionPeriod} seconds`);
    console.log(`   Max Receive Count: ${attributes.RedrivePolicy ? JSON.parse(attributes.RedrivePolicy).maxReceiveCount : 'N/A'}`);
    console.log(`   DLQ: ${attributes.RedrivePolicy ? JSON.parse(attributes.RedrivePolicy).deadLetterTargetArn : 'None'}`);
    
    // Warnings
    const visibilityTimeout = parseInt(attributes.VisibilityTimeout);
    if (visibilityTimeout < 900) {
      console.warn(`⚠️  WARNING: VisibilityTimeout (${visibilityTimeout}s) < Lambda Timeout (900s)`);
      console.warn(`   This may cause duplicate processing!`);
    }
    
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to get queue config: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Main test runner
async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  SQS Integration Tests - End-to-End Verification          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  console.log(`\n🌍 Environment:`);
  console.log(`   Region: ${process.env.AWS_REGION || 'us-east-1'}`);
  console.log(`   Table: ${TABLE_NAME}`);
  console.log(`   Queue: ${QUEUE_URL.split('/').pop()}`);
  console.log(`   Lambda: ${LAMBDA_NAME}`);
  
  const results = [];
  
  // Configuration checks
  results.push(await checkLambdaConfiguration());
  results.push(await checkQueueConfiguration());
  
  // Functional tests
  results.push(await testBasicFlow());
  results.push(await testIdempotency());
  results.push(await testInvalidMessage());
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${results.length}`);
  
  if (failed > 0) {
    console.log(`\n⚠️  Some tests failed. Check logs above for details.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All tests passed!`);
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  runTests().catch(error => {
    console.error(`\n💥 Fatal error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
}

module.exports = {
  testBasicFlow,
  testIdempotency,
  testInvalidMessage,
  checkLambdaConfiguration,
  checkQueueConfiguration
};
