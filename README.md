# qnyproj
一个没什么东西的七牛云项目，但愿之后能变得有东西
> ### 致七牛云评审员
> - 本项目有CI和CD，有新的commit到达main分支时会自动执行deploy到Github Pages和AWS
>   因此，线上版本始终保持为最新版。您可以随时访问本项目对应的Github Pages页面以体验最新版本
> - 我们使用了qwen-plus与imagen 3模型来完成任务，这是综合模型的收费和质量作出的决定。我们发现中国企业开发的模型具有更好的中文语境表达能力，在对中文的情感理解和创作
> - 我们致力于使生成的漫画稳定，引入了场景圣经和角色圣经，并且允许在多个不同的生成间延续使用这些圣经。因此，人设和场景设定可以保持跨画面，跨页面和跨生成稳定。
> - 我们在开发时就以生产标准要求，有完善的测试框架，使用了AWS Serverless架构，天然具有可扩展性，可以承载很大的用户量。
> - 我们允许用户在模型的基础上自行填写（修改）圣经，并且可以上传人设图，这使得产出能够更贴近用户心目中的期望。
> - 由于我们可以跨生成保持人设和场景的一致性，因此即使是非常长的小说，我们也可以通过区分章节来进行完整的生成，并保持产出具有一定的可用性。（不过，根据目前的测试，5000字左右的章节需要10分钟以上来完成生成，这是目前qwen-plus和imagen3的性能限制）
> - 我们致力于保证我们的产出真的可用，因为我们希望为以下两类用户提供价值：真正的粉丝和漫画创作者。

（粉丝的User Story）
（创作者的User Story）

## 🎯 项目特点

本项目使用 **OpenAPI/Swagger 作为 API 的唯一事实来源**，实现前后端类型安全的自动化开发流程。

## 📋 目录

- [环境准备](#环境准备)
- [首次安装](#首次安装)
- [AWS 配置](#aws-配置)
- [Swagger UI 集成](#swagger-ui-集成)
- [OpenAPI 工作流](#openapi-工作流)
- [开发流程](#开发流程)
- [构建和部署](#构建和部署)
- [CI/CD 自动部署](#cicd)
- [常用命令](#常用命令)
- [故障排除](#故障排除)

## 🔧 环境准备

### 必需工具
- **Node.js** (推荐 v22.17.1，至少 v22.0.0)
- **pnpm** - 前端包管理器：`npm install -g pnpm`
- **AWS CLI**: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
- **AWS SAM CLI**: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
- **Docker Desktop** - 后端本地开发需要

### 配置文件
- 配置 `.env.local` 文件，填入真正的后端参数
- ⚠️ **重要**: `.env.local` 仅用于本地测试，**绝对不能提交到代码库**！

## 🚀 首次安装

```bash
# 1. 克隆项目
git clone <repository-url>
cd qnyproj

# 2. 安装根目录依赖（用于 OpenAPI 生成）
npm install

# 3. 安装前端依赖
cd frontend
pnpm install
cd ..

# 4. 生成前端 API 客户端（基于 OpenAPI 规范）
npm run generate:frontend-api

# 5. 启动开发服务器
npm run dev:frontend
```

启动后访问 http://localhost:5173，你会看到：
- 🏠 **首页** - 项目介绍和快速开始
- 📚 **API 文档 (Swagger)** - 完整的交互式 API 文档
- 🧪 **API 测试** - 实时测试 API 调用
- 🌐 **CDN 探测** - Edge Probe 诊断工具，返回请求 Header 信息

## ☁️ AWS 配置

在部署到 AWS 之前，需要完成以下配置步骤：

### 快速开始

1. **配置 AWS CLI**
   ```bash
   aws configure
   # 输入 Access Key ID, Secret Access Key, Region
   ```

2. **创建 Cognito 用户池** (可选，用于认证端点)
   - 访问 AWS Console → Cognito
   - 创建用户池并记录 User Pool ID
   - 更新到 `backend/samconfig.toml`

3. **首次手动部署** (推荐)
   ```bash
   cd backend
   sam build --use-container
   sam deploy --guided
   ```

4. **记录 API URL**
   - 部署成功后会输出 API Gateway URL
   - 格式: `https://{api-id}.execute-api.{region}.amazonaws.com/dev`

### 详细配置指南

完整的 AWS 配置步骤、架构说明和故障排除，请查看：

👉 **[AWS_SETUP.md](./AWS_SETUP.md)** - AWS 配置完整指南

该文档包含：
- IAM 用户创建和权限配置
- Cognito 用户池详细配置
- 手动部署步骤
- 部署架构说明
- API Gateway 端点结构
- 常见问题排查

## 📚 Swagger UI 集成

本项目已经集成了 **Swagger UI**，可以在浏览器中直接查看和测试 API！

### 特性

✨ **交互式 API 文档** - 在浏览器中实时查看所有 API 端点  
🧪 **在线测试** - 无需 Postman，直接在 Swagger UI 中测试 API  
🔐 **认证支持** - 配置 Bearer Token 进行认证测试  
📊 **数据模型** - 查看所有请求/响应的数据结构  
🎨 **美观界面** - 专业的 API 文档展示

### 访问 Swagger UI

启动开发服务器后：

```bash
npm run dev:frontend
```

在浏览器中访问 http://localhost:5173，然后点击顶部的 **"📚 API 文档 (Swagger)"** 标签。

### 使用 Swagger UI

1. **查看 API 端点** - 展开任意端点查看详细信息
2. **测试 API** - 点击 "Try it out" 按钮进行测试
3. **配置认证** - 点击右上角 🔓 "Authorize" 按钮输入 Token
4. **查看模型** - 滚动到底部查看数据模型定义

### 更新 Swagger 文档

当你修改 `openapi.template.yaml` 后：

```bash
# 重新生成 API 客户端（会自动更新 Swagger 文档）
npm run generate:frontend-api

# 刷新浏览器即可看到最新的 API 文档
```

💡 **提示**: 查看 `SWAGGER_INSTALLED.md` 了解 Swagger 集成的详细信息。

## 📝 OpenAPI 工作流

### API 定义文件说明

| 文件 | 用途 | 是否手动编辑 |
|------|------|------------|
| `openapi.template.yaml` | **主文件**：包含完整 OpenAPI 规范 + AWS 扩展 | ✅ **是** |
| `openapi.yaml` | 自动生成的纯 OpenAPI 文件（供前端使用） | ❌ **否** |
| `frontend/src/api/generated/` | 自动生成的 TypeScript API 客户端 | ❌ **否** |

### 添加新的 API 端点

**步骤 1**: 编辑 `openapi.template.yaml`

```yaml
paths:
  /users:  # 新端点
    get:
      summary: Get all users
      security:
        - CognitoAuthorizer: []
      responses:
        '200':
          description: List of users
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/User'
      x-amazon-apigateway-integration:
        type: aws_proxy
        httpMethod: POST
        uri:
          Fn::Sub: "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetUsersFunction.Arn}/invocations"

components:
  schemas:
    User:  # 新模型
      type: object
      properties:
        id:
          type: string
        name:
          type: string
```

**步骤 2**: 生成前端 API 客户端

```bash
npm run generate:frontend-api
```

**步骤 3**: 在前端代码中使用

```typescript
import { DefaultService } from './api/generated';

// 类型安全的 API 调用
const users = await DefaultService.getUsers();
```

**步骤 4**: 实现后端 Lambda 函数并部署

```bash
npm run deploy:backend
```

### ⚠️ 重要注意事项

1. **唯一事实来源**: 只编辑 `openapi.template.yaml`
2. **自动生成**: `openapi.yaml` 和 `frontend/src/api/generated/` 都是自动生成的，不要手动编辑
3. **版本控制**: 这些自动生成的文件已添加到 `.gitignore`，不会提交到 Git
4. **每次修改 API 后**: 必须运行 `npm run generate:frontend-api` 重新生成客户端代码
5. **跨平台兼容**: 所有脚本在 Windows (PowerShell/CMD) 和 Unix-like 系统 (Bash/Zsh) 中都能正常工作

## 🔄 开发流程

### 功能开发流程
1. 创建新分支: `git checkout -b feature/your-feature-name`
2. 如果涉及 API 修改:
   - 编辑 `openapi.template.yaml`
   - 运行 `npm run generate:frontend-api`
3. 开发功能
4. 本地测试
5. 提交代码并创建 Pull Request
6. 代码评审
7. 合并后自动部署

### 本地开发

```bash
# 前端开发
npm run dev:frontend
# 或直接在 frontend 目录：pnpm dev

# 后端本地测试（需要 Docker）
cd backend
sam local start-api
```

## 🏗️ 构建和部署

### 前端构建
```bash
npm run build:frontend
# 或直接在 frontend 目录：pnpm build
```

### 后端构建和部署
```bash
# 本地构建
cd backend
sam build --use-container

# 部署到 AWS（自动生成最新的 openapi.yaml）
npm run deploy:backend
```

## 📋 常用命令

### OpenAPI 相关
```bash
# 从 template 生成纯净的 openapi.yaml
npm run generate:openapi

# 生成前端 TypeScript API 客户端
npm run generate:frontend-api
```

### 前端开发
```bash
# 启动开发服务器
npm run dev:frontend

# 构建生产版本（会自动生成最新的 API 客户端）
npm run build:frontend
```

### 后端开发
```bash
# 本地启动 API（需要 Docker）
cd backend
sam local start-api

# 部署到 AWS
npm run deploy:backend
```

### 运维脚本
```bash
# 清空堆栈内所有 SQS 队列并标记未完成 Job 为 failed
npm run purge:sqs

# 自定义参数示例
# node scripts/clear-sqs.js --stack=qnyproj-api --types=analyze,reference_image --skip-purge
```
> `purge:sqs` 会自动从 CloudFormation 堆栈（默认 `qnyproj-api`）读取所有 SQS 队列和 DynamoDB 表，先清空队列再把状态为 `queued/pending/running` 的 Job 写成 `failed`。若只想标记 Job 而暂时保留队列中的消息，可附加 `--skip-purge`。

## 🔍 故障排除

### 问题：`Cannot find module 'yaml'`
**解决方案**: 
```bash
npm install
```

### 问题：前端代码生成失败
**解决方案**:
```bash
cd frontend
pnpm install
cd ..
npm run generate:frontend-api
```

### 问题：生成的 `openapi.yaml` 包含未替换的变量
**解决方案**: 检查 `scripts/generate-openapi.js` 是否正确处理了 CloudFormation 标签

### 问题：API 类型不匹配
**解决方案**: 确保在修改 API 定义后运行了 `npm run generate:frontend-api`

### 问题：已携带 `Authorization` 仍然 401
**解决方案**: API Gateway 使用 Cognito User Pool Authorizer，对 ID Token 的兼容性优于 Access Token。前端已经内置 `getApiToken()` 逻辑，优先发送 `id_token`，但如果你在 Postman、`curl` 或其他脚本中手动调试，需要：
1. 在登录后从浏览器本地存储或 OIDC 回调结果中取 **ID Token** (`id_token` 字段)，不要用 `access_token`。
2. 若仍旧 401，清除本地缓存重新登录（确保生成的新 ID Token 未过期），再重试 `curl -H "Authorization: Bearer <id_token>" https://.../dev/your-endpoint`。
3. 必要时使用 `aws apigateway test-invoke-authorizer` 并把 ID Token 传入 `Authorization` 头，确认鉴权层通过后再排查后端。

### 问题：`npm audit` 在根目录报告 Dredd 相关漏洞
**说明**: API contract 测试依赖的 [Dredd](https://github.com/apiaryio/dredd) 及其传递依赖目前存在公开漏洞，已放在 `devDependencies`。它只在执行 `npm run test:contract*` 时使用，生产部署会通过 `npm ci --omit=dev` 跳过。若本地 `npm install` 仍看到告警，可忽略或在隔离环境中运行 contract 测试；等上游修复后再升级。

## 🤖 CI/CD 自动部署

本项目使用 GitHub Actions 实现完全自动化的 CI/CD 流程。

### 部署架构

```
Push to main → GitHub Actions
                ├─→ Backend: AWS SAM Deploy (Lambda + API Gateway)
                └─→ Frontend: GitHub Pages Deploy (gh-pages branch)
```

### 当前部署状态

**后端 (AWS)**:
- 📍 **API URL**: `https://ds0yqv9fn816.execute-api.us-east-1.amazonaws.com/dev`
- 🌐 **端点类型**: Edge-Optimized (CloudFront CDN 全球加速)
- 📦 **Lambda**: `qnyproj-api-HelloWorldFunction-7vF4AmhBaeOA`
- 🏷️ **Stack**: `qnyproj-api` (us-east-1)

**可用 API 端点**:
```bash
# Edge Probe - 返回请求头信息（包含 CloudFront headers）
GET https://ds0yqv9fn816.execute-api.us-east-1.amazonaws.com/dev/edge-probe

# Items - 示例数据列表
GET https://ds0yqv9fn816.execute-api.us-east-1.amazonaws.com/dev/items
```

**前端 (GitHub Pages)**:
- 🔗 **URL**: `https://ethanlita.github.io/qnyproj/` (即将部署)
- 📂 **部署方式**: Deploy from Branch (`gh-pages`)
- ⚡ **构建工具**: Vite

### 自动化流程

**当你 Push 到 main 分支时**:
1. ✅ **Backend Deploy** - SAM build & deploy 到 AWS
2. ✅ **Frontend Build** - pnpm build 生产版本
3. ✅ **GitHub Pages Deploy** - 推送到 gh-pages 分支，自动发布

**当你创建 Pull Request 时**:
- 🧪 TypeScript 类型检查
- 🔍 ESLint 代码检查
- 🏗️ 前端构建测试
- 🧪 后端单元测试

### 配置步骤

#### 1. 配置 GitHub Secrets

在 **Settings → Secrets and variables → Actions** 添加：

| Secret 名称 | 说明 | 获取方式 |
|------------|------|---------|
| `AWS_ACCESS_KEY_ID` | AWS 访问密钥 ID | IAM 用户凭证 |
| `AWS_SECRET_ACCESS_KEY` | AWS 秘密访问密钥 | IAM 用户凭证 |
| `AWS_REGION` | AWS 区域 | `us-east-1` |

💡 **提示**: 详细的 IAM 用户创建步骤请查看 [AWS_SETUP.md](./AWS_SETUP.md)

#### 2. 启用 GitHub Pages

**Settings → Pages**:
- **Source**: Deploy from a branch
- **Branch**: `gh-pages` / `root`
- **保存后等待 GitHub Actions 首次部署**

#### 3. 验证部署

**检查 Backend**:
```bash
# 测试 Edge Probe 端点
curl https://ds0yqv9fn816.execute-api.us-east-1.amazonaws.com/dev/edge-probe

# 应该返回包含 CloudFront headers 的 JSON
```

**检查 Frontend**:
- 访问 `https://<username>.github.io/<repo-name>/`
- 应该看到完整的应用界面（包括 Swagger UI）

### 监控部署

**GitHub Actions**:
- 📊 仓库 → **Actions** 标签
- 查看每次部署的详细日志

**AWS 监控**:
```bash
# 查看 CloudFormation Stack 状态
aws cloudformation describe-stacks --stack-name qnyproj-api

# 查看 Lambda 日志
aws logs tail /aws/lambda/qnyproj-api-HelloWorldFunction-7vF4AmhBaeOA --since 10m
```

### Workflow 详情

文件: `.github/workflows/deploy.yml`

**3 个主要 Jobs**:

1. **deploy-backend** (Push to main)
   - Setup Node.js & Python
   - Install AWS SAM CLI
   - Build with Docker container
   - Deploy to AWS CloudFormation

2. **deploy-frontend** (Push to main)
   - Setup Node.js & pnpm
   - Generate API client from OpenAPI
   - Build production bundle
   - Push to `gh-pages` branch

3. **test** (Pull Requests)
   - TypeScript check (`tsc --noEmit`)
   - Lint (`pnpm lint`)
   - Build test
   - Backend unit tests

### 故障排除

**Backend 部署失败**:
```bash
# 检查 SAM 配置
cat backend/samconfig.toml

# 手动部署测试
cd backend
sam build --use-container
sam deploy --debug
```

**Frontend 部署失败**:
- 检查 `pnpm-lock.yaml` 是否提交
- 确认 `npm run build:frontend` 本地可以成功
- 查看 Actions 日志中的具体错误

**GitHub Pages 404**:
- 确认 `gh-pages` 分支已创建且包含 `index.html`
- 检查 Settings → Pages 配置是否正确
- 等待几分钟让 GitHub 完成部署

## 📚 相关文档

- [OpenAPI Specification](https://swagger.io/specification/)
- [AWS API Gateway OpenAPI Extensions](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-swagger-extensions.html)
- [AWS SAM Documentation](https://docs.aws.amazon.com/serverless-application-model/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)

## 🤝 贡献指南

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request
