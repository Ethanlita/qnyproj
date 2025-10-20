/**
 * 准备本地测试环境
 * 上传测试小说到 DynamoDB，用于测试 AnalyzeWorkerFunction
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

// 配置
const TABLE_NAME = process.env.TABLE_NAME || 'qnyproj-api-data';
const NOVEL_ID = 'test-novel-001';
const USER_ID = 'test-user-001';

// AWS Client
const dynamodbClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamodbClient);

async function uploadTestNovel() {
  try {
    // 读取测试小说（路径在项目根目录）
    const novelPath = path.join(__dirname, '../../test-data/novels/sample-novel-01.txt');
    const novelText = fs.readFileSync(novelPath, 'utf-8');
    
    console.log(`📖 读取测试小说: ${novelPath}`);
    console.log(`   字数: ${novelText.length} 字`);
    
    // 创建 Novel 数据
    const timestamp = Date.now();
    const novelItem = {
      PK: `NOVEL#${NOVEL_ID}`,
      SK: `NOVEL#${NOVEL_ID}`,
      entityType: 'Novel',
      id: NOVEL_ID,
      userId: USER_ID,
      title: '测试小说 - 高考之后',
      author: '测试作者',
      originalText: novelText,
      wordCount: novelText.length,
      status: 'uploaded',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    
    // 上传到 DynamoDB
    console.log(`\n📤 上传小说到 DynamoDB...`);
    console.log(`   Table: ${TABLE_NAME}`);
    console.log(`   Novel ID: ${NOVEL_ID}`);
    
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: novelItem
      })
    );
    
    console.log(`\n✅ 测试环境准备完成！`);
    console.log(`\n📝 测试命令:`);
    console.log(`   cd backend`);
    console.log(`   sam build --use-container`);
    console.log(`   sam local invoke AnalyzeWorkerFunction -e events/analyze-worker-test.json\n`);
    
    console.log(`📊 测试数据:`);
    console.log(`   Novel ID: ${NOVEL_ID}`);
    console.log(`   User ID: ${USER_ID}`);
    console.log(`   Job ID: test-job-001 (需要手动创建)\n`);
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  }
}

// 运行
uploadTestNovel();
