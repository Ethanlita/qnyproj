/**
 * 创建测试 Job
 * 用于测试 AnalyzeWorkerFunction 的 Job 更新逻辑
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

// 配置
const TABLE_NAME = process.env.TABLE_NAME || 'qnyproj-api-data';
const JOB_ID = 'test-job-001';
const NOVEL_ID = 'test-novel-001';
const USER_ID = 'test-user-001';

// AWS Client
const dynamodbClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamodbClient);

async function createTestJob() {
  try {
    const timestamp = Date.now();
    
    const jobItem = {
      PK: `JOB#${JOB_ID}`,
      SK: `JOB#${JOB_ID}`,
      GSI1PK: `USER#${USER_ID}`,
      GSI1SK: `JOB#${timestamp}`,
      GSI2PK: `NOVEL#${NOVEL_ID}`,
      GSI2SK: timestamp,
      entityType: 'Job',
      id: JOB_ID,
      type: 'analyze',
      status: 'queued',
      novelId: NOVEL_ID,
      userId: USER_ID,
      progress: {
        percentage: 0,
        stage: 'queued',
        message: 'Test job created, ready for processing'
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    
    console.log(`\n📤 创建测试 Job...`);
    console.log(`   Table: ${TABLE_NAME}`);
    console.log(`   Job ID: ${JOB_ID}`);
    console.log(`   Novel ID: ${NOVEL_ID}`);
    console.log(`   Status: queued`);
    
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: jobItem
      })
    );
    
    console.log(`\n✅ 测试 Job 创建完成！`);
    console.log(`\n🚀 现在可以运行 Worker 测试:\n`);
    console.log(`   sam local invoke AnalyzeWorkerFunction -e events/analyze-worker-test.json\n`);
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  }
}

// 运行
createTestJob();
