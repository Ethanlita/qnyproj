# 部署和测试指南

## 📦 部署到 AWS

### 前提条件
- ✅ AWS CLI 已配置（有效凭证）
- ✅ IAM 权限已附加（SQS, DynamoDB, S3, Secrets Manager, Lambda）
- ✅ sam build 已完成

### 部署命令

```powershell
cd backend
sam deploy --no-confirm-changeset
```

### 部署内容

CloudFormation 将创建/更新：

1. **DynamoDB 表**
   - `ComicDataTable` - 主数据表（小说、分镜、角色等）

2. **S3 存储桶**
   - `AssetsBucket` - 存储大文本和生成的图片

3. **SQS 队列**
   - `AnalysisQueue` - 分析任务队列
   - `AnalysisDeadLetterQueue` - 失败任务死信队列

4. **Secrets Manager**
   - `QwenApiKeySecret` - Qwen API 密钥

5. **Lambda 函数**
   - `AnalyzeNovelFunction` - 触发函数（创建 Job + 发送 SQS）
   - `AnalyzeWorkerFunction` - Worker 函数（处理分析任务）
   - 其他现有函数的更新

6. **IAM 角色和策略**
   - 各函数的执行角色
   - SQS 触发权限

### 预期部署时间
- 首次部署：8-12 分钟
- 后续更新：3-5 分钟

---

## 🧪 部署后测试

### 步骤 1: 验证资源创建

```powershell
# 检查 DynamoDB 表
aws dynamodb list-tables --region us-east-1 | Select-String "qnyproj"

# 检查 SQS 队列
aws sqs list-queues --region us-east-1 | Select-String "analysis"

# 检查 Secrets Manager
aws secretsmanager list-secrets --region us-east-1 | Select-String "qwen"

# 检查 Lambda 函数
aws lambda list-functions --region us-east-1 | Select-String "qnyproj-api"
```

### 步骤 2: 配置 Qwen API 密钥

```powershell
# 获取 Secret ARN
aws secretsmanager list-secrets --region us-east-1 --query "SecretList[?contains(Name, 'qwen')].ARN" --output text

# 更新密钥值（替换为您的实际密钥）
$secretArn = "arn:aws:secretsmanager:us-east-1:296821242554:secret:qnyproj-api-qwen-api-key-XXXXX"
$secretValue = @{
    apiKey = "sk-your-actual-qwen-api-key"
    endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1"
} | ConvertTo-Json

aws secretsmanager put-secret-value --secret-id $secretArn --secret-string $secretValue
```

### 步骤 3: 上传测试小说

```powershell
cd backend
node scripts/prepare-test-data.js
```

**预期输出**:
```
📖 读取测试小说: ...\sample-novel-01.txt
   字数: 4602 字

📤 上传小说到 DynamoDB...
   Table: qnyproj-api-data
   Novel ID: test-novel-001

✅ 测试环境准备完成！
```

### 步骤 4: 创建测试 Job

```powershell
node scripts/create-test-job.js
```

**预期输出**:
```
📤 创建测试 Job...
   Job ID: test-job-001
   Novel ID: test-novel-001
   Status: queued

✅ 测试 Job 创建完成！
```

### 步骤 5: 触发分析（两种方式）

#### 方式 A: 通过 API Gateway

```powershell
# 获取 API Gateway URL
$apiUrl = aws cloudformation describe-stacks --stack-name qnyproj-api --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" --output text

# 调用分析端点
Invoke-WebRequest -Method POST -Uri "$apiUrl/novels/test-novel-001/analyze" -Headers @{"Content-Type"="application/json"}
```

#### 方式 B: 直接发送 SQS 消息（测试 Worker）

```powershell
# 获取队列 URL
$queueUrl = aws sqs list-queues --region us-east-1 --query "QueueUrls[?contains(@, 'analysis-queue')]" --output text

# 发送测试消息
$message = @{
    jobId = "test-job-001"
    novelId = "test-novel-001"
    userId = "test-user-001"
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
} | ConvertTo-Json

aws sqs send-message --queue-url $queueUrl --message-body $message
```

### 步骤 6: 监控执行

```powershell
# 方法 1: 使用脚本检查结果
node scripts/check-test-results.js

# 方法 2: 查看 CloudWatch Logs
aws logs tail /aws/lambda/qnyproj-api-AnalyzeWorkerFunction --follow

# 方法 3: 检查 SQS 队列
aws sqs get-queue-attributes --queue-url $queueUrl --attribute-names All
```

### 步骤 7: 验证结果

```powershell
# 再次检查结果
node scripts/check-test-results.js
```

**预期输出**:
```
🔍 检查测试结果...

📋 Job 状态:
   ✅ Job 存在
   状态: completed
   进度: 100%
   阶段: completed
   消息: Analysis completed

📖 Novel 状态:
   ✅ Novel 存在
   状态: analyzed
   Storyboard ID: <uuid>

🎬 Storyboard 详情:
   ✅ Storyboard 存在
   总页数: 6
   总分镜: 30
   总角色: 5

🎞️  Panels (前5个):
   找到 30 个分镜...

👥 Characters (前5个):
   找到 5 个角色...

✅ 检查完成！
```

---

## 🐛 故障排除

### 问题 1: DynamoDB 表未找到

**症状**: `Requested resource not found`

**解决**:
```powershell
# 检查表是否存在
aws dynamodb describe-table --table-name qnyproj-api-data --region us-east-1

# 如果不存在，检查 CloudFormation stack 状态
aws cloudformation describe-stacks --stack-name qnyproj-api --region us-east-1
```

### 问题 2: SQS 消息未处理

**症状**: Job 状态一直是 `queued`

**可能原因**:
1. Worker 函数未启动
2. SQS 事件源映射未启用
3. Lambda 权限不足

**检查**:
```powershell
# 检查事件源映射
aws lambda list-event-source-mappings --function-name qnyproj-api-AnalyzeWorkerFunction

# 检查 Worker 函数日志
aws logs tail /aws/lambda/qnyproj-api-AnalyzeWorkerFunction --follow
```

### 问题 3: Qwen API 调用失败

**症状**: Job 状态变为 `failed`，错误信息包含 API key

**解决**:
```powershell
# 验证密钥是否正确设置
aws secretsmanager get-secret-value --secret-id qnyproj-api-qwen-api-key --query SecretString --output text

# 更新密钥
aws secretsmanager put-secret-value --secret-id qnyproj-api-qwen-api-key --secret-string '{"apiKey":"sk-xxx","endpoint":"https://dashscope.aliyuncs.com/compatible-mode/v1"}'
```

### 问题 4: Lambda 超时

**症状**: Worker 函数执行超时（15分钟）

**解决**:
- 检查小说长度（是否超过 50k 字）
- 检查网络连接到 Qwen API
- 查看 CloudWatch Logs 了解具体卡在哪里

---

## 📊 性能指标

### 预期处理时间

| 小说长度 | 预期时间 | 状态 |
|---------|---------|------|
| < 5k 字  | 30-60秒 | ✅ |
| 5k-20k 字 | 1-3分钟 | ✅ |
| 20k-50k 字 | 3-8分钟 | ✅ |
| > 50k 字  | 8-15分钟 | ⚠️ 可能超时 |

### Job 状态流转

```
queued (0%)
  ↓ AnalyzeNovelFunction 发送 SQS 消息
  ↓ AnalyzeWorkerFunction 接收消息
running (5%) - initializing
  ↓
running (10%) - fetching_text
  ↓
running (20%) - initializing_qwen
  ↓
running (30%) - generating_storyboard (最耗时)
  ↓
running (85%) - validating
  ↓
running (90%) - writing_database
  ↓
completed (100%)
```

---

## 🎯 下一步

测试成功后：
1. ✅ M2.4.1 部署完成
2. ✅ M2.4.2 真实环境测试完成
3. 继续 M2.5 单元测试
4. 继续 M2.6 集成测试
5. 提交代码到 GitHub
6. 配置 CI/CD（M2.8）
