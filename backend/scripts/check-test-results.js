/**
 * 检查测试结果
 * 查询 DynamoDB 中的 Job、Storyboard、Panels、Characters
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

// 配置
const TABLE_NAME = process.env.TABLE_NAME || 'qnyproj-api-data';
const JOB_ID = process.argv[2] || 'test-job-001';
const NOVEL_ID = process.argv[3] || 'test-novel-001';

// AWS Client
const dynamodbClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamodbClient);

async function checkTestResults() {
  try {
    console.log(`\n🔍 检查测试结果...`);
    console.log(`   Table: ${TABLE_NAME}`);
    console.log(`   Job ID: ${JOB_ID}`);
    console.log(`   Novel ID: ${NOVEL_ID}\n`);
    
    // 1. 检查 Job 状态
    console.log(`📋 Job 状态:`);
    const jobResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `JOB#${JOB_ID}`,
          SK: `JOB#${JOB_ID}`
        }
      })
    );
    
    if (jobResult.Item) {
      console.log(`   ✅ Job 存在`);
      console.log(`   状态: ${jobResult.Item.status}`);
      console.log(`   进度: ${jobResult.Item.progress?.percentage || 0}%`);
      console.log(`   阶段: ${jobResult.Item.progress?.stage || 'N/A'}`);
      console.log(`   消息: ${jobResult.Item.progress?.message || 'N/A'}`);
      if (jobResult.Item.error) {
        console.log(`   ❌ 错误: ${jobResult.Item.error}`);
      }
    } else {
      console.log(`   ❌ Job 不存在`);
      return;
    }
    
    // 2. 检查 Novel 状态
    console.log(`\n📖 Novel 状态:`);
    const novelResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `NOVEL#${NOVEL_ID}`,
          SK: `NOVEL#${NOVEL_ID}`
        }
      })
    );
    
    if (novelResult.Item) {
      console.log(`   ✅ Novel 存在`);
      console.log(`   状态: ${novelResult.Item.status}`);
      console.log(`   Storyboard ID: ${novelResult.Item.storyboardId || 'N/A'}`);
      
      // 3. 如果有 Storyboard，检查详情
      if (novelResult.Item.storyboardId) {
        const storyboardId = novelResult.Item.storyboardId;
        
        console.log(`\n🎬 Storyboard 详情:`);
        const storyboardResult = await docClient.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: {
              PK: `NOVEL#${NOVEL_ID}`,
              SK: `STORY#${storyboardId}`
            }
          })
        );
        
        if (storyboardResult.Item) {
          console.log(`   ✅ Storyboard 存在`);
          console.log(`   总页数: ${storyboardResult.Item.totalPages}`);
          console.log(`   总分镜: ${storyboardResult.Item.totalPanels}`);
          console.log(`   总角色: ${storyboardResult.Item.totalCharacters}`);
        }
        
        // 4. 查询 Panels（前5个）
        console.log(`\n🎞️  Panels (前5个):`);
        const panelsResult = await docClient.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: {
              ':pk': `STORY#${storyboardId}`,
              ':sk': 'PANEL#'
            },
            Limit: 5
          })
        );
        
        if (panelsResult.Items && panelsResult.Items.length > 0) {
          console.log(`   找到 ${panelsResult.Items.length} 个分镜 (显示前5个):`);
          panelsResult.Items.forEach((panel, idx) => {
            console.log(`   ${idx + 1}. Page ${panel.page}, Index ${panel.index}`);
            console.log(`      Scene: ${panel.scene || 'N/A'}`);
            console.log(`      Characters: ${panel.characters?.join(', ') || 'N/A'}`);
          });
        } else {
          console.log(`   ❌ 未找到 Panels`);
        }
        
        // 5. 查询 Characters（前5个）
        console.log(`\n👥 Characters (前5个):`);
        const charsResult = await docClient.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: {
              ':pk': `NOVEL#${NOVEL_ID}`,
              ':sk': 'CHAR#'
            },
            Limit: 5
          })
        );
        
        if (charsResult.Items && charsResult.Items.length > 0) {
          console.log(`   找到 ${charsResult.Items.length} 个角色 (显示前5个):`);
          charsResult.Items.forEach((char, idx) => {
            console.log(`   ${idx + 1}. ${char.name} (${char.role})`);
            if (char.appearance) {
              console.log(`      外貌: ${JSON.stringify(char.appearance)}`);
            }
          });
        } else {
          console.log(`   ❌ 未找到 Characters`);
        }
      }
    } else {
      console.log(`   ❌ Novel 不存在`);
    }
    
    console.log(`\n✅ 检查完成！\n`);
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  }
}

// 运行
checkTestResults();
