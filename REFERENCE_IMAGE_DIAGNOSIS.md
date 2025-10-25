# 参考图"暂无预览"问题诊断报告

## 📋 问题概述

**现象**: 执行小说分析任务后,自动触发的参考图生成任务(#f1e6dfc9)完成,但角色和场景的参考图显示为"暂无预览"。

**诊断日期**: 2025-10-26

## 🔍 根本原因

发现了 **3个关键问题**:

### 1. ❌ S3 Bucket不存在

```bash
错误信息: NoSuchBucket: The specified bucket does not exist
Bucket名称: qnyproj-assets-prod
```

**原因**: 代码中硬编码了 `qnyproj-assets-prod`,但实际部署的bucket名称可能不同。

**影响**: ReferenceWorker无法上传生成的参考图到S3。

### 2. ❌ Gemini API返回空响应

```
日志: [ImagenAdapter] Gemini API response empty, falling back to placeholder
```

**可能原因**:
- Gemini API密钥未配置或无效
- API配额用尽
- 网络连接问题
- API端点配置错误
- `forceMock: true` 被错误启用

**影响**: 所有生成的"参考图"都是灰色占位符文字图片,不是真实的AI生成图片。

### 3. ❌ Placeholder图片未保存到Bible

**原因**: 虽然生成了占位符图片,但由于S3上传失败,导致:
- 图片的 `s3Key` 没有写入Bible的 `referenceImages` 数组
- 前端查询Bible时,`referenceImages` 为空数组
- 前端显示"暂无预览"

## 📊 当前数据状态

### Bible数据(506c0c0a-f05c-43a4-97e8-b633713eda4c)

```
📖 版本: 1
🎭 角色: 5个 (花阳, 思伟, 杰哥...)
   └─ 参考图: 0 ❌
🎬 场景: 5个 (高中校园全景, 校园中心雕塑...)
   └─ 参考图: 0 ❌
```

### ReferenceWorker执行日志

时间: 2025-10-25 17:29:08 - 17:29:33

```
✅ 处理了多个角色和场景
✅ 为每个条目调用了ImagenAdapter
❌ Gemini API全部返回空
⚠️ 全部使用Placeholder图片
❌ S3上传失败(bucket不存在)
❌ Bible未更新referenceImages
```

## 🛠️ 完整的漫画生成流程

### 阶段1: 小说分析 ✅

```
用户提交小说文本
  ↓
AnalyzeNovelFunction (创建Job → SQS)
  ↓
AnalyzeWorkerFunction (SQS触发)
  ├─ 调用Qwen API解析文本
  ├─ 生成分镜数据 (panels)
  ├─ 提取角色信息 (characters)
  ├─ 提取场景信息 (scenes)
  ├─ 保存到DynamoDB: NOVEL#/STORYBOARD#/PANEL#/CHAR#
  └─ 保存到BibleManager: qnyproj-api-bibles表
      └─ 创建参考图自动生成任务 (#f1e6dfc9)
```

**数据存储位置**:
- 分镜/面板: `qnyproj-api-data` 表
- 角色圣经: `qnyproj-api-bibles` 表 (或S3 if >390KB)
- 场景圣经: `qnyproj-api-bibles` 表 (或S3 if >390KB)

### 阶段2: 参考图自动生成 ❌ (失败)

```
AnalyzeWorker完成后
  ↓
遍历所有characters和scenes
  └─ 筛选出没有referenceImages的条目
      ↓
创建Job (type: reference_autogen)
  ↓
发送消息到ReferenceImageQueue (SQS)
  ↓
ReferenceWorkerFunction (SQS触发)
  ├─ 读取角色/场景描述
  ├─ 调用buildCharacterPrompt() / buildScenePrompt()
  ├─ 调用ImagenAdapter.generate()
  │   └─❌ Gemini API返回空 → Placeholder
  ├─❌ 尝试uploadImage()到S3
  │   └─❌ Bucket不存在,上传失败
  └─❌ 尝试更新Bible
      └─❌ 未执行(因为上传失败)
```

**预期存储位置**:
```
S3: bibles/{novelId}/characters/{name}/auto/{timestamp}-{uuid}.png
S3: bibles/{novelId}/scenes/{id}/auto/{timestamp}-{uuid}.png
```

**Bible更新预期**:
```json
{
  "characters": [
    {
      "name": "花阳",
      "referenceImages": [
        {
          "s3Key": "bibles/.../characters/花阳/auto/xxx.png",
          "label": "花阳 自动参考图",
          "source": "auto"
        }
      ]
    }
  ]
}
```

### 阶段3: 面板图片生成 (尚未执行)

```
用户点击"生成分镜图片"
  ↓
GeneratePanelsFunction
  ├─ 创建Job (type: generate_preview/hd)
  ├─ 批量创建PANEL_TASK → DynamoDB
  └─ DynamoDB Streams触发
      ↓
PanelWorkerFunction
  ├─ 读取Panel内容 (场景、角色、对白)
  ├─ 从Bible读取角色的referenceImages
  │   └─⚠️ 如果referenceImages为空,生成质量差
  ├─ 构建完整Imagen prompt
  ├─ 调用Imagen生成面板图片
  ├─ 上传到S3: panels/{jobId}/{panelId}-{mode}.png
  └─ 更新Panel.imagesS3字段
```

**关键依赖**: Panel生成需要角色的参考图来保证一致性!

## 🔧 修复方案

### 方案1: 修复S3 Bucket配置 (推荐)

**步骤**:

1. **确认实际的Bucket名称**:
   ```bash
   aws s3 ls | grep qnyproj
   ```

2. **更新环境变量**:
   
   在 `backend/template.yaml` 中检查 `BIBLES_BUCKET` 和 `ASSETS_BUCKET`:
   ```yaml
   Environment:
     Variables:
       BIBLES_BUCKET: !Ref AssetsBucket  # 应该引用实际的bucket
       ASSETS_BUCKET: !Ref AssetsBucket
   ```

3. **如果bucket不存在,创建它**:
   ```bash
   aws s3 mb s3://qnyproj-assets-prod --region us-east-1
   ```

   或在SAM template中确保bucket被创建:
   ```yaml
   AssetsBucket:
     Type: AWS::S3::Bucket
     Properties:
       BucketName: !Sub 'qnyproj-assets-${AWS::StackName}'
   ```

4. **重新部署**:
   ```bash
   cd backend
   sam build
   sam deploy
   ```

### 方案2: 修复Gemini API配置

**步骤**:

1. **检查Secrets Manager中的配置**:
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id qnyproj-api-gemini-config \
     --region us-east-1 \
     --query SecretString --output text | jq .
   ```

2. **确认包含以下字段**:
   ```json
   {
     "apiKey": "YOUR_GEMINI_API_KEY",
     "projectId": "YOUR_GCP_PROJECT_ID",
     "location": "us-central1",
     "model": "gemini-2.0-flash-exp"
   }
   ```

3. **如果缺失,创建或更新Secret**:
   ```bash
   aws secretsmanager create-secret \
     --name qnyproj-api-gemini-config \
     --secret-string '{
       "apiKey": "YOUR_KEY",
       "projectId": "YOUR_PROJECT",
       "location": "us-central1",
       "model": "gemini-2.0-flash-exp"
     }' \
     --region us-east-1
   ```

4. **检查ImagenAdapter代码**:
   
   在 `backend/lib/imagen-adapter.js` 中,确认 `forceMock` 不是硬编码为 `true`:
   ```javascript
   const adapter = new ImagenAdapter({
     apiKey: config.apiKey,
     projectId: config.projectId,
     location: config.location,
     model: config.model,
     forceMock: !config.apiKey  // ✅ 只有在没有apiKey时才使用mock
   });
   ```

### 方案3: 手动触发参考图重新生成

修复配置后,重新触发参考图生成:

1. **删除现有的Bible记录** (可选,如果想清空):
   ```bash
   aws dynamodb delete-item \
     --table-name qnyproj-api-bibles \
     --key '{"novelId":{"S":"506c0c0a-f05c-43a4-97e8-b633713eda4c"},"version":{"N":"1"}}' \
     --region us-east-1
   ```

2. **重新执行小说分析**:
   ```bash
   curl -X POST https://YOUR_API/novels/506c0c0a-f05c-43a4-97e8-b633713eda4c/analyze \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

3. **或者手动触发参考图生成** (需要实现API端点):
   ```bash
   curl -X POST https://YOUR_API/novels/506c0c0a-f05c-43a4-97e8-b633713eda4c/bible/regenerate-references \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

## 📝 后续优化建议

### 1. 添加错误处理和重试机制

在 `ReferenceWorkerFunction` 中:
- 捕获S3上传错误并记录
- 失败时发送到DLQ (Dead Letter Queue)
- 实现指数退避重试

### 2. 改进Placeholder处理

- Placeholder图片也应该上传到S3
- 或者在Bible中标记 `source: "placeholder"`
- 前端显示"生成中..."而不是"暂无预览"

### 3. 添加监控告警

- CloudWatch告警: S3上传失败率 > 10%
- CloudWatch告警: Gemini API失败率 > 50%
- 定期检查Bible中referenceImages为空的比例

### 4. 实现手动上传参考图功能

允许用户手动上传参考图,不完全依赖AI生成:
```
POST /novels/{id}/bible/characters/{name}/references
Content-Type: multipart/form-data
```

## 🎯 验证步骤

修复后,按以下步骤验证:

1. **检查S3 bucket**:
   ```bash
   aws s3 ls s3://qnyproj-assets-{env}/bibles/
   ```

2. **检查Gemini配置**:
   ```bash
   aws logs tail /aws/lambda/qnyproj-api-ReferenceWorkerFunction-xxx \
     --since 5m --follow
   ```
   应该看到: `✅ Image generated successfully` 而不是 `Placeholder`

3. **查询Bible**:
   ```bash
   aws dynamodb get-item \
     --table-name qnyproj-api-bibles \
     --key '{"novelId":{"S":"YOUR_NOVEL_ID"},"version":{"N":"1"}}'
   ```
   `referenceImages` 数组应该包含 `s3Key`

4. **前端验证**:
   - 打开角色/场景列表
   - 应该能看到参考图缩略图
   - 点击可以查看大图

## 📚 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 系统架构详解
- [DATA_CONTRACT.md](./DATA_CONTRACT.md) - 数据契约和存储结构
- [AGENTS.md](./AGENTS.md) - AI Agent开发指南

---

**生成日期**: 2025-10-26  
**诊断对象**: Job #a60a0b55 (小说分析) → Job #f1e6dfc9 (参考图自动生成)  
**小说ID**: 506c0c0a-f05c-43a4-97e8-b633713eda4c
