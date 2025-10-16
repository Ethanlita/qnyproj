# qnyproj
一个没什么东西的七牛云项目，但愿之后能变得有东西

## 🎯 项目特点

本项目使用 **OpenAPI/Swagger 作为 API 的唯一事实来源**，实现前后端类型安全的自动化开发流程。

## 📋 目录

- [环境准备](#环境准备)
- [首次安装](#首次安装)
- [Swagger UI 集成](#swagger-ui-集成)
- [OpenAPI 工作流](#openapi-工作流)
- [开发流程](#开发流程)
- [构建和部署](#构建和部署)
- [常用命令](#常用命令)
- [故障排除](#故障排除)

## 🔧 环境准备

### 必需工具
- **Node.js** (推荐 v18+)
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

## 🤖 CI/CD

本项目使用 GitHub Actions 实现自动化部署。

### 自动化流程

- **Push to main** → 自动部署后端到 AWS + 前端到 GitHub Pages
- **Pull Request** → 运行测试和构建验证（TypeScript、Lint、Build）

### 配置步骤

#### 1. 配置 GitHub Secrets

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加：

| Secret 名称 | 说明 | 示例 |
|------------|------|------|
| `AWS_ACCESS_KEY_ID` | AWS 访问密钥 ID | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | AWS 秘密访问密钥 | `wJalrXUt...` |
| `AWS_REGION` | AWS 区域 | `us-east-1` |

#### 2. 启用 GitHub Pages

**Settings → Pages → Source**: 选择 **GitHub Actions**

#### 3. 确保 SAM 配置正确

检查 `backend/samconfig.toml` 包含正确的部署配置：

```toml
[default.deploy.parameters]
stack_name = "qnyproj"
resolve_s3 = true
region = "us-east-1"
confirm_changeset = false
capabilities = "CAPABILITY_IAM"
```

### 部署后访问

- **Frontend**: `https://<username>.github.io/<repo-name>/`
- **Backend API**: 在 AWS API Gateway 控制台查看 URL

### 监控部署

- **GitHub Actions**: 仓库 → Actions 标签查看运行状态
- **AWS CloudFormation**: `aws cloudformation describe-stacks --stack-name qnyproj`

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

## 📄 许可证

[添加你的许可证信息]
