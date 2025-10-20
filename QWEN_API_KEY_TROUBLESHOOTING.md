# Qwen API Key 配置问题排查

## ❌ 当前问题

API Key `sk-7cbdcbd149a349c8a9d79973425300dc` 被 DashScope 服务器拒绝：

```
401 Incorrect API key provided.
code: 'invalid_api_key'
```

## 🔍 可能原因

### 1. API Key 未激活

- **症状**: 刚申请的 Key，还没有在阿里云控制台激活
- **解决**: 访问 [Model Studio控制台](https://modelstudio.console.alibabacloud.com/) 激活 Key

### 2. API Key 权限不足

- **症状**: Key 可能没有 `qwen-plus` 模型的调用权限
- **解决**: 检查 Key 的权限配置，确保有通义千问模型的访问权限

### 3. API Key 格式错误

- **症状**: Key 可能被截断或复制时出错
- **解决**: 重新从阿里云控制台复制完整的 Key

### 4. 需要账户充值

- **症状**: DashScope 需要先充值才能使用
- **解决**: 在阿里云控制台充值

### 5. 区域限制

- **症状**: Key 可能限制了特定区域
- **解决**: 检查是否需要使用特定区域的 endpoint

## ✅ 验证步骤

### 步骤 1: 访问控制台

https://modelstudio.console.alibabacloud.com/

### 步骤 2: 查看 API Key

1. 点击右上角头像 → "API-KEY管理"
2. 查看 Key 状态（是否激活、是否有余额）
3. 查看 Key 权限（是否可以调用 qwen-plus）

### 步骤 3: 测试简单调用

使用 curl 命令测试（替换 YOUR_API_KEY）:

```bash
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

**预期成功响应**:
```json
{
  "id": "chatcmpl-xxx",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "你好！..."
    }
  }],
  "usage": {...}
}
```

**失败响应** (401):
```json
{
  "error": {
    "message": "Incorrect API key provided.",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

### 步骤 4: 获取新的 API Key

如果 Key 确认有问题，重新申请：

1. 访问 https://modelstudio.console.alibabacloud.com/
2. 点击 "API-KEY管理"
3. 点击 "创建新的API-KEY"
4. 复制新的 Key（格式应该是 `sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`）
5. 更新 `backend/.env` 文件

## 📝 配置文件位置

**本地开发**: `backend/.env`
```env
QWEN_API_KEY=sk-NEW_KEY_HERE
DASHSCOPE_API_KEY=sk-NEW_KEY_HERE
QWEN_ENDPOINT=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
```

**AWS Secrets Manager** (生产环境):
```bash
aws secretsmanager update-secret \
  --secret-id qnyproj-api-qwen-api-key \
  --secret-string '{
    "apiKey": "sk-NEW_KEY_HERE",
    "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "model": "qwen-plus"
  }'
```

**GitHub Actions** (CI/CD):
在 GitHub 仓库设置中添加 Secret:
- Name: `QWEN_API_KEY`
- Value: `sk-NEW_KEY_HERE`

## 🧪 测试脚本

运行测试脚本验证 Key:
```bash
cd backend
node test-qwen-key.js
```

成功输出应该包含：
```
✅ Success!
响应: 我是通义千问，由阿里云开发...
```

## 📚 参考文档

- [获取API Key](https://help.aliyun.com/zh/model-studio/developer-reference/get-api-key)
- [通义千问API参考](https://help.aliyun.com/zh/dashscope/developer-reference/api-details)
- [OpenAI兼容模式](https://help.aliyun.com/zh/dashscope/developer-reference/compatibility-of-openai-with-dashscope/)

## ⏸️ 当前状态

- ❌ API Key 验证失败
- ⏳ 等待用户提供有效的 API Key
- ✅ 本地环境配置文件已创建 (`backend/.env`)
- ✅ 集成测试代码已准备 (`backend/lib/qwen-adapter.integration.test.js`)
- ✅ 测试脚本已准备 (`backend/test-qwen-key.js`)

## 🎯 下一步

**用户需要做的**:

1. 访问阿里云 Model Studio 控制台
2. 确认 API Key 状态（激活、权限、余额）
3. 如需要，创建新的 API Key
4. 将新 Key 更新到 `backend/.env`
5. 运行 `node test-qwen-key.js` 验证

**验证成功后**:

- 运行集成测试: `node --test lib/qwen-adapter.integration.test.js`
- 继续 M2 其他任务（SQS架构、单元测试等）

---

**文档创建时间**: 2025-10-20  
**最后更新**: 2025-10-20
