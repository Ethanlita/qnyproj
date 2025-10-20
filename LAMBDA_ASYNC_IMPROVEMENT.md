# M2.3 Lambda 异步处理改进建议

## ⚠️ 当前实现的问题

当前的 `analyze-novel/index.js` 使用 `setImmediate` 进行后台异步处理：

```javascript
// 当前实现（不可靠）
setImmediate(async () => {
  // 长时间运行的分析任务...
});

// 立即返回 jobId
return successResponse({ jobId, status: 'running' }, 202);
```

**问题**: 根据 AWS Lambda 文档，当 handler 返回后，Lambda 会**冻结执行环境**。这意味着 `setImmediate` 中的代码可能：
- 不会执行
- 部分执行后被中断
- 导致不可预测的行为

## ✅ 推荐解决方案

### 选项 1: 使用 Amazon SQS（推荐）

**架构**:
```
API Gateway → AnalyzeNovelFunction → SQS Queue → WorkerFunction
                ↓ (立即返回)              ↓ (异步处理)
            创建 Job 记录              更新 Job 进度
```

**优势**:
- 解耦请求和处理
- 自动重试机制
- 可扩展（多个 Worker）
- 成本效益高

**实现步骤**:

1. **在 SAM template 中添加 SQS Queue**:
```yaml
AnalysisQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub '${AWS::StackName}-analysis-queue'
    VisibilityTimeout: 900  # 15 minutes (Lambda max timeout)
    MessageRetentionPeriod: 1209600  # 14 days
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt AnalysisDeadLetterQueue.Arn
      maxReceiveCount: 3

AnalysisDeadLetterQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub '${AWS::StackName}-analysis-dlq'
    MessageRetentionPeriod: 1209600
```

2. **修改 AnalyzeNovelFunction**:
```javascript
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const sqsClient = new SQSClient({});

exports.handler = async (event) => {
  const novelId = event.pathParameters?.id;
  const userId = getUserId(event) || 'mock-user';
  
  // 创建 Job
  const jobId = await createJob(novelId, userId, 'analyze');
  
  // 发送消息到 SQS
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.ANALYSIS_QUEUE_URL,
    MessageBody: JSON.stringify({
      jobId,
      novelId,
      userId
    })
  }));
  
  // 立即返回
  return successResponse({
    jobId,
    status: 'queued',
    message: 'Analysis queued. Use GET /jobs/{jobId} to check progress.'
  }, 202);
};
```

3. **创建 Worker Function**:
```javascript
// backend/functions/analyze-worker/index.js
exports.handler = async (event) => {
  for (const record of event.Records) {
    const { jobId, novelId, userId } = JSON.parse(record.body);
    
    try {
      // 执行实际的分析工作
      await updateJob(jobId, 'running', { percentage: 10 });
      const { novel, text } = await getNovelText(novelId);
      
      await updateJob(jobId, 'running', { percentage: 30 });
      const qwenAdapter = await getQwenAdapter();
      
      await updateJob(jobId, 'running', { percentage: 50 });
      const storyboard = await qwenAdapter.generateStoryboard({...});
      
      await updateJob(jobId, 'running', { percentage: 90 });
      await writeStoryboardToDynamoDB(novelId, userId, storyboard);
      
      await updateJob(jobId, 'completed', { percentage: 100 });
      
    } catch (error) {
      console.error('Analysis failed:', error);
      await updateJob(jobId, 'failed', { percentage: 0 }, error.message);
      throw error;  // 让 SQS 重试或发送到 DLQ
    }
  }
};
```

4. **在 template.yaml 中配置 Worker**:
```yaml
AnalyzeWorkerFunction:
  Type: AWS::Serverless::Function
  Properties:
    CodeUri: .
    Handler: functions/analyze-worker/index.handler
    Runtime: nodejs22.x
    Timeout: 900  # 15 minutes
    MemorySize: 2048
    Environment:
      Variables:
        TABLE_NAME: !Ref ComicDataTable
        ASSETS_BUCKET: !Ref AssetsBucket
        QWEN_SECRET_ARN: !Ref QwenApiKeySecret
    Policies:
      - DynamoDBCrudPolicy:
          TableName: !Ref ComicDataTable
      - S3CrudPolicy:
          BucketName: !Ref AssetsBucket
      - Statement:
          - Effect: Allow
            Action:
              - secretsmanager:GetSecretValue
            Resource: !Ref QwenApiKeySecret
    Events:
      SQSEvent:
        Type: SQS
        Properties:
          Queue: !GetAtt AnalysisQueue.Arn
          BatchSize: 1
```

### 选项 2: 使用 AWS Step Functions

**架构**:
```
API Gateway → AnalyzeNovelFunction → Step Functions State Machine
                ↓ (立即返回)              ↓ (编排工作流)
            启动执行                   Task1 → Task2 → Task3
```

**优势**:
- 可视化工作流
- 内置重试和错误处理
- 支持并行任务
- 适合复杂工作流

**适用场景**:
- 需要多步骤编排
- 需要人工审核
- 需要条件分支

### 选项 3: 同步处理（简单但有限制）

如果文本较短（<5k字）且 Qwen 响应快（<30s），可以同步处理：

```javascript
exports.handler = async (event) => {
  const novelId = event.pathParameters?.id;
  const userId = getUserId(event) || 'mock-user';
  
  try {
    // 同步处理（handler 会等待完成）
    const { novel, text } = await getNovelText(novelId);
    const qwenAdapter = await getQwenAdapter();
    const storyboard = await qwenAdapter.generateStoryboard({...});
    await writeStoryboardToDynamoDB(novelId, userId, storyboard);
    
    return successResponse({
      message: 'Analysis completed',
      storyboardId: storyboard.id
    }, 200);
    
  } catch (error) {
    console.error('Analysis failed:', error);
    return errorResponse(500, error.message);
  }
};
```

**限制**:
- Lambda 最大超时 15 分钟
- API Gateway 超时 29 秒（HTTP API）/ 30 秒（REST API）
- 用户体验差（长时间等待）

## 📝 M2 实施建议

**短期（M2 完成前）**:
- ✅ 保持当前实现用于开发和测试
- ✅ 在文档中标注已知限制
- ✅ 添加 TODO 注释说明需要改进

**中期（M3）**:
- 实施 SQS + Worker 架构
- 更新部署文档
- 进行负载测试

**长期（M4/M5）**:
- 考虑 Step Functions（如果需要复杂工作流）
- 实施进度通知（WebSocket / SNS）
- 优化成本和性能

## 🔧 当前代码改进

在 `analyze-novel/index.js` 添加注释说明限制：

```javascript
/**
 * ⚠️ KNOWN LIMITATION:
 * 
 * This function currently uses setImmediate for async processing,
 * which is unreliable in AWS Lambda. The execution environment
 * may be frozen after the handler returns, potentially causing
 * incomplete processing.
 * 
 * TODO (M3): Migrate to SQS-based architecture:
 * 1. Create SQS queue for analysis tasks
 * 2. Split into two functions:
 *    - AnalyzeNovelFunction: Create job + send to SQS
 *    - AnalyzeWorkerFunction: Process from SQS + update job
 * 3. Enable automatic retries via SQS
 * 
 * Current workaround: For MVP testing only. Use synchronous
 * processing for production until SQS migration is complete.
 */
```

---

**创建日期**: 2025-10-20  
**最后更新**: 2025-10-20
