# ✅ Qwen API 新加坡端点配置成功

**日期**: 2025-10-20  
**状态**: ✅ API 连接成功，集成测试 2/3 通过

---

## 🎉 主要成果

### 1. 确认了地域配置问题

**问题根源**: 不同地域有不同的接入端点和 API Key

| 地域 | 端点 | API Key | 状态 |
|------|------|---------|------|
| **北京** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `sk-dde5903c0674449985f24037709a69a2` | ❌ 403 AccessDenied.Unpurchased |
| **新加坡** | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `sk-7cbdcbd149a349c8a9d79973425300dc` | ✅ 成功连接 |

**教训**: API Key 和 Endpoint 必须匹配对应地域！

---

## 🔧 配置文件更新

### `backend/.env` (最终配置)

```env
# Qwen API Configuration
# Region: Singapore (International)
QWEN_API_KEY=sk-7cbdcbd149a349c8a9d79973425300dc
DASHSCOPE_API_KEY=sk-7cbdcbd149a349c8a9d79973425300dc

# OpenAI Compatible Endpoint
QWEN_ENDPOINT=https://dashscope-intl.aliyuncs.com/compatible-mode/v1

# Model Name
QWEN_MODEL=qwen-plus
```

### `backend/test-qwen-key.js` (修复)

**问题**: 硬编码了北京端点  
**修复**: 从环境变量读取 `QWEN_ENDPOINT`

```javascript
const endpoint = process.env.QWEN_ENDPOINT || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const client = new OpenAI({
  apiKey: apiKey,
  baseURL: endpoint  // ✅ 使用环境变量
});
```

---

## 📊 测试结果

### 简单 API 测试 ✅

```bash
$ node test-qwen-key.js

🔑 API Key: sk-7cbdcbd149a3...
🌐 Endpoint: https://dashscope-intl.aliyuncs.com/compatible-mode/v1

✅ Success!
响应: 你好，我是通义千问（Qwen），由阿里云研发的超大规模语言模型...
Token 使用: { prompt_tokens: 26, completion_tokens: 34, total_tokens: 60 }
```

### 集成测试结果 (2/3 通过)

```bash
$ node --test lib/qwen-adapter.integration.test.js

✖ should successfully call Qwen API with simple text (28901ms)
  - 原因: Qwen 返回空结果 (0 panels, 0 characters)
  - 状态: API 调用成功，但需要调试提示词

✔ should match previously saved fixture structure (22788ms)
  - Fixture 已保存: test-fixtures/qwen-response.json

✔ should handle rate limiting gracefully (2296ms)
  - 速率限制处理正常
```

---

## ⚠️ 发现的问题

### 问题 1: Qwen 返回空结果

**现象**:
```json
{
  "response": {
    "panels": [],
    "characters": [],
    "totalPages": 0
  }
}
```

**可能原因**:
1. **JSON 严格模式未启用**: 当前 `strictMode: false`
2. **提示词不够明确**: `STORYBOARD_SYSTEM_PROMPT` 可能需要优化
3. **测试文本太短**: 只有 171 字符

**下一步行动** (新任务 ID 8):
1. 在集成测试中启用 `strictMode: true`
2. 优化 `STORYBOARD_SYSTEM_PROMPT`，添加示例输出
3. 使用更长的测试文本 (500+ 字符)
4. 验证 Qwen 是否支持 JSON Schema 严格模式

### 问题 2: 免费额度可能未开通

**北京地域错误**: `AccessDenied.Unpurchased`

根据[阿里云文档](https://help.aliyun.com/zh/model-studio/models)，qwen-plus 应该有：
- **免费额度**: 每模型 100 万 Token
- **有效期**: 百炼开通后 90 天内

**建议**: 检查阿里云控制台，确认：
1. 百炼服务是否已开通
2. 免费额度是否已激活
3. 账户是否有余额

---

## 📝 Fixture 文件分析

### `test-fixtures/qwen-response.json`

**元数据**:
```json
{
  "metadata": {
    "timestamp": "2025-10-20T07:41:49.856Z",
    "model": "qwen-plus",
    "endpoint": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "elapsedMs": 28898,  // 28.9 秒响应时间
    "textLength": 171
  }
}
```

**请求配置**:
```json
{
  "request": {
    "strictMode": false,  // ⚠️ 未启用严格模式
    "schema": { /* JSON Schema */ }
  }
}
```

**响应内容**:
```json
{
  "response": {
    "panels": [],      // ⚠️ 空数组
    "characters": [],  // ⚠️ 空数组
    "totalPages": 0
  }
}
```

---

## 🎯 下一步计划

### 优先级 1: 调试提示词 (任务 ID 8)

**目标**: 让 Qwen 正确生成分镜脚本

**行动项**:
1. 修改 `lib/qwen-adapter.integration.test.js`:
   ```javascript
   strictMode: true,  // 启用严格模式
   maxChunkLength: 8000
   ```

2. 优化 `STORYBOARD_SYSTEM_PROMPT`，添加示例：
   ```javascript
   const STORYBOARD_SYSTEM_PROMPT = `你是一个专业的漫画分镜师。

   示例输出：
   {
     "panels": [
       {
         "page": 1,
         "index": 0,
         "scene": "小镇石板路",
         "shotType": "中景",
         "characters": ["李明"],
         "dialogue": [],
         "visualPrompt": "A young man walking on a cobblestone street at sunset..."
       }
     ],
     "characters": [
       {
         "name": "李明",
         "role": "主角",
         "appearance": {
           "age": "teenager",
           "clothing": "school backpack"
         }
       }
     ]
   }
   
   现在请根据以下小说文本生成分镜...`;
   ```

3. 使用更长的测试文本（从 `test-data/novels/sample-novel-01.txt` 读取）

4. 重新运行集成测试验证

### 优先级 2: 配置 GitHub Actions (任务 ID 9)

**操作步骤**:
1. 在 GitHub 仓库添加 Secret: `QWEN_API_KEY`
   ```
   Value: sk-7cbdcbd149a349c8a9d79973425300dc
   ```

2. 更新 `.github/workflows/deploy.yml`:
   ```yaml
   - name: Update Qwen API Key in AWS Secrets Manager
     run: |
       aws secretsmanager put-secret-value \
         --secret-id ${{ secrets.QWEN_SECRET_ARN }} \
         --secret-string '{"apiKey":"${{ secrets.QWEN_API_KEY }}"}'
   ```

### 优先级 3: 修复异步架构 (任务 ID 10)

**原始用户需求**: "先修复异步问题"

**方案**: 实施 SQS + Worker 模式  
**参考**: `LAMBDA_ASYNC_IMPROVEMENT.md`

---

## 📚 相关文档

### 阿里云官方文档

- [首次调用通义千问API](https://help.aliyun.com/zh/model-studio/getting-started/first-api-call-to-qwen)
- [模型列表与价格](https://help.aliyun.com/zh/model-studio/models)
- [通义千问API参考](https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api)

### 项目文档

- `AGENTS.md` - AI Agent 开发指南
- `QWEN_API_KEY_TROUBLESHOOTING.md` - API Key 问题排查
- `QWEN_API_INTEGRATION_SUMMARY.md` - 之前的工作总结
- `LAMBDA_ASYNC_IMPROVEMENT.md` - 异步架构改进方案

---

## ✅ 验收标准

### 当前状态

- [x] API 连接成功（新加坡端点）
- [x] 简单测试通过（`test-qwen-key.js`）
- [x] 集成测试代码准备完毕
- [x] Fixture 文件生成成功
- [ ] Qwen 正确生成分镜内容
- [ ] 所有集成测试 (3/3) 通过
- [ ] GitHub Actions 配置完成

### 完整验收（任务 ID 8 完成后）

```bash
# 1. 简单测试
$ node test-qwen-key.js
✅ Success! 响应: 我是通义千问...

# 2. 集成测试
$ node --test lib/qwen-adapter.integration.test.js
✔ should successfully call Qwen API (3/3 tests passed)

# 3. 单元测试
$ npm test
✔ 25/25 tests passed

# 4. Fixture 验证
$ cat test-fixtures/qwen-response.json
{
  "response": {
    "panels": [ /* 有内容 */ ],
    "characters": [ /* 有内容 */ ]
  }
}
```

---

**最后更新**: 2025-10-20 15:41  
**下次更新触发**: 当提示词调试完成并通过所有测试后
