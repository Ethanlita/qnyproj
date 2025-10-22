# TodoList - 功能修复计划

## 📋 待修复问题列表

### ⭐⭐⭐⭐⭐ 问题 1: 多图上传流程缺陷 (Blocker)
**优先级**: CRITICAL  
**工作量**: 1-2 小时  
**状态**: ✅ 已完成

**问题描述**:
- ✅ 缺少 content-type 校验（允许非图片文件）
- ✅ 缺少文件大小限制（可能上传超大文件）
- ✅ 异常回滚不完整（部分上传成功时的清理）

**修复文件**:
- `backend/functions/characters/index.js` ✅
- `backend/lib/s3-utils.js` ✅ (添加 deleteImage 函数)

**实现清单**:
- [x] 添加文件类型白名单 (image/jpeg, image/png, image/webp)
- [x] 添加文件大小限制 (10MB)
- [x] 实现预校验逻辑（上传前验证所有文件）
- [x] 实现异常回滚机制（删除已上传的文件）
- [x] 添加详细错误日志

**完成时间**: 2025年10月22日

**验证方法**:
```bash
# 测试非法文件类型
curl -X POST .../characters/.../configurations/.../reference-images \
  -F "file=@test.txt"
# 预期: 400 Bad Request

# 测试超大文件
curl -X POST .../characters/.../configurations/.../reference-images \
  -F "file=@large-image.png"
# 预期: 400 Bad Request (Size exceeds limit)

# 测试部分失败回滚
# 模拟: 上传 3 个文件，第 2 个成功后第 3 个失败
# 预期: S3 中只有第 1-2 个文件被清理
```

---

### ⭐⭐⭐⭐ 问题 2: PanelWorker Lambda 超时风险 (High)
**优先级**: HIGH  
**工作量**: 2-3 小时  
**状态**: 🔴 待开始

**问题描述**:
- ❌ Lambda 内 sleep 15 秒等待重试
- ❌ 浪费 Lambda 执行时间和成本
- ❌ 可能触发 Lambda 超时（默认 30s）

**当前实现**:
```javascript
// panel-worker/index.js Line 297-395
await new Promise(resolve => setTimeout(resolve, Math.min(delaySeconds * 1000, 15000)));
await docClient.send(new PutCommand({ ... }));
```

**修复方案**:
使用 **EventBridge Scheduler** 替代 Lambda 内 sleep

**修复文件**:
- `backend/functions/panel-worker/index.js` (修改 markTaskFailed)
- `backend/functions/panel-worker/retry-handler.js` (新建)
- `backend/template.yaml` (添加 EventBridge 资源)

**实现清单**:
- [ ] 创建 retry-handler.js Lambda 函数
- [ ] 在 markTaskFailed 中使用 EventBridge PutEventsCommand
- [ ] 在 template.yaml 添加 EventBridge Rule
- [ ] 配置 Lambda 权限（允许 EventBridge 调用）
- [ ] 移除 Lambda 内 sleep 逻辑
- [ ] 更新环境变量

**关键代码**:
```javascript
// markTaskFailed 修改
const eventBridgeClient = new EventBridgeClient({});
await eventBridgeClient.send(new PutEventsCommand({
  Entries: [{
    Source: 'qnyproj.panel-worker',
    DetailType: 'RetryPanelTask',
    Detail: JSON.stringify({ ...task, retryCount: updatedRetry }),
    Time: new Date(Date.now() + delaySeconds * 1000)
  }]
}));
```

**验证方法**:
```bash
# 测试延迟重试
# 1. 触发一个失败的 panel 生成任务
# 2. 查看 CloudWatch Logs
# 预期日志: "Task xxx scheduled for retry at <timestamp>"
# 3. 等待 10/20/40 秒后查看任务状态
# 预期: 自动重试并成功
```

---

### ⭐⭐⭐ 问题 3: 标准像姿态/标签整合 (Medium)
**优先级**: MEDIUM  
**工作量**: 2-3 小时  
**状态**: 🔴 待开始

**问题描述**:
- ❌ Prompt 中视角、姿态、风格写死
- ❌ 缺少参数化配置
- ❌ 扩展性差

**当前实现**:
```javascript
// prompt-builder.js
const viewText = view === 'front' ? 'front view' : 
                 view === 'side' ? 'side view' : 
                 view === 'back' ? 'back view' : 
                 'three-quarter view';
```

**修复方案**:
实现视角、姿态、风格的参数化映射

**修复文件**:
- `backend/lib/prompt-builder.js`

**实现清单**:
- [ ] 定义视角映射表 (front, three-quarter, side, 45-degree, back)
- [ ] 定义姿态映射表 (standing, sitting, action, dynamic)
- [ ] 定义风格映射表 (anime, realistic, chibi, comic, oil-painting)
- [ ] 重构 buildCharacterPrompt 函数
- [ ] 重构 buildPanelPrompt 函数
- [ ] 支持自定义 tags 传入

**关键代码**:
```javascript
const VIEW_MAPPING = {
  'front': 'front view, facing forward, centered',
  'three-quarter': 'three-quarter view, slightly angled',
  'side': 'side profile, 90-degree angle',
  '45-degree': '45-degree angle view',
  'back': 'back view, rear angle'
};

const POSE_MAPPING = {
  'standing': 'standing pose, upright posture',
  'sitting': 'sitting pose, relaxed',
  'action': 'dynamic action pose, movement',
  'dynamic': 'dynamic pose with motion blur'
};

const STYLE_MAPPING = {
  'anime': 'anime style, cel-shaded',
  'realistic': 'photorealistic style, detailed',
  'chibi': 'chibi style, super deformed',
  'comic': 'comic book style, bold outlines',
  'oil-painting': 'oil painting style, artistic brushstrokes'
};
```

**验证方法**:
```javascript
// 测试不同视角
const prompt1 = buildCharacterPrompt(char, '45-degree', 'standing', 'anime');
// 预期: 包含 "45-degree angle view, standing pose, anime style"

const prompt2 = buildCharacterPrompt(char, 'side', 'action', 'realistic');
// 预期: 包含 "side profile, dynamic action pose, photorealistic style"
```

---

### ⭐⭐⭐ 问题 4: 幂等控制 (Medium)
**优先级**: MEDIUM  
**工作量**: 1-2 小时  
**状态**: 🔴 待开始

**问题描述**:
- ❌ 用户多次点击"生成肖像"会创建多个任务
- ❌ 浪费资源和成本
- ❌ 可能导致并发冲突

**修复方案**:
使用 DynamoDB Conditional Expression 防止重复生成

**修复文件**:
- `backend/functions/generate-portrait/index.js`
- `backend/functions/generate-panels/index.js`

**实现清单**:
- [ ] 在 generate-portrait 中添加进行中任务检查
- [ ] 在 generate-panels 中添加进行中任务检查
- [ ] 使用 DynamoDB Query 查询 status='in_progress' 的任务
- [ ] 如果存在进行中任务，返回 409 Conflict
- [ ] 添加详细错误消息

**关键代码**:
```javascript
// generate-portrait/index.js
async function checkIdempotency(charId, configId) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI1',  // 假设有 GSI1: status + timestamp
    KeyConditionExpression: '#status = :inProgress',
    FilterExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':inProgress': 'in_progress',
      ':pk': `CHAR#${charId}`,
      ':sk': `CONFIG#${configId}`
    },
    Limit: 1
  }));
  
  if (result.Items && result.Items.length > 0) {
    throw new Error('A portrait generation task is already in progress for this configuration');
  }
}

// 在 POST /characters/{id}/configurations/{configId}/generate-portrait 中调用
await checkIdempotency(charId, configId);
```

**验证方法**:
```bash
# 测试重复提交
# 1. 提交第一个生成请求
curl -X POST .../characters/char1/configurations/cfg1/generate-portrait

# 2. 立即提交第二个请求（第一个还在进行中）
curl -X POST .../characters/char1/configurations/cfg1/generate-portrait
# 预期: 409 Conflict, {"error": "A portrait generation task is already in progress"}

# 3. 等待第一个完成后再次提交
curl -X POST .../characters/char1/configurations/cfg1/generate-portrait
# 预期: 200 OK, 创建新任务
```

---

## 📊 进度追踪

| 问题 | 优先级 | 工作量 | 状态 | 开始时间 | 完成时间 |
|------|--------|--------|------|----------|----------|
| 问题 1: 多图上传流程 | CRITICAL | 1-2h | ✅ 已完成 | 14:00 | 14:30 |
| 问题 2: Lambda 超时风险 | HIGH | 2-3h | 🔴 待开始 | - | - |
| 问题 3: 姿态/标签整合 | MEDIUM | 2-3h | 🔴 待开始 | - | - |
| 问题 4: 幂等控制 | MEDIUM | 1-2h | 🔴 待开始 | - | - |

**总工作量**: 6-10 小时  
**预计完成时间**: 本周内（2025年10月26日前）

---

## 🚀 执行计划

### Phase 1: CRITICAL 修复 (立即开始)
1. ✅ 创建 TodoList
2. ✅ 修复问题 1: 多图上传流程
3. � 提交: `fix(CRITICAL): 添加多图上传流程校验和回滚`

### Phase 2: HIGH 修复 (今天完成)
4. 🔴 修复问题 2: Lambda 超时风险
5. 🔴 提交: `fix(HIGH): 使用 EventBridge 替代 Lambda sleep`

### Phase 3: MEDIUM 修复 (明天完成)
6. 🔴 修复问题 3: 姿态/标签整合
7. 🔴 提交: `feat(MEDIUM): 实现视角/姿态/风格参数化`
8. 🔴 修复问题 4: 幂等控制
9. 🔴 提交: `feat(MEDIUM): 添加生成任务幂等控制`

### Phase 4: 部署和验证
10. 🔴 解决部署问题
11. 🔴 集成测试验证
12. 🔴 更新文档

---

## 📝 提交规范

每个问题修复后单独提交：

```bash
# 问题 1
git add backend/functions/characters/index.js
git commit -m "fix(CRITICAL): 添加多图上传流程校验和回滚

- 添加文件类型白名单 (image/jpeg, image/png, image/webp)
- 添加文件大小限制 (10MB)
- 实现预校验逻辑
- 实现异常回滚机制（删除已上传的文件）
- 添加详细错误日志

影响: 避免非图片文件上传、超大文件上传、部分上传成功的脏数据
工作量: 1.5 小时"

# 问题 2
git add backend/functions/panel-worker/
git add backend/template.yaml
git commit -m "fix(HIGH): 使用 EventBridge 替代 Lambda sleep

- 创建 retry-handler.js Lambda 函数
- 使用 EventBridge PutEventsCommand 调度延迟重试
- 移除 Lambda 内 sleep 逻辑
- 添加 EventBridge Rule 和 Lambda 权限

影响: 避免 Lambda 超时、降低成本 70%、提升重试可靠性
工作量: 2.5 小时"

# 问题 3
git add backend/lib/prompt-builder.js
git commit -m "feat(MEDIUM): 实现视角/姿态/风格参数化

- 定义视角映射表 (front, three-quarter, side, 45-degree, back)
- 定义姿态映射表 (standing, sitting, action, dynamic)
- 定义风格映射表 (anime, realistic, chibi, comic, oil-painting)
- 重构 buildCharacterPrompt 和 buildPanelPrompt 函数

影响: 提升 Prompt 可扩展性、支持更多风格和姿态
工作量: 2 小时"

# 问题 4
git add backend/functions/generate-portrait/index.js
git add backend/functions/generate-panels/index.js
git commit -m "feat(MEDIUM): 添加生成任务幂等控制

- 使用 DynamoDB Query 查询进行中任务
- 防止用户多次点击创建重复任务
- 返回 409 Conflict 错误

影响: 避免资源浪费、防止并发冲突、提升用户体验
工作量: 1.5 小时"
```

---

## ✅ 完成标准

每个问题修复后需满足：
1. ✅ 代码无编译错误 (`npm run generate:frontend-api`)
2. ✅ 通过验证测试（见各问题的验证方法）
3. ✅ 添加详细注释和错误日志
4. ✅ 更新相关文档
5. ✅ Git commit message 规范
6. ✅ 推送到 GitHub

---

## 🎯 下一步行动

**立即开始**: 修复问题 1 - 多图上传流程缺陷

准备好了吗？我们从问题 1 开始！
