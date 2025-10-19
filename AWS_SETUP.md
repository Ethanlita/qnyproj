# AWS 配置指南

本文档详细说明如何配置 AWS 环境以部署此应用。

## 📋 目录

1. [前置要求](#前置要求)
2. [AWS 账户准备](#aws-账户准备)
3. [配置 AWS CLI](#配置-aws-cli)
4. [创建 Cognito 用户池](#创建-cognito-用户池)
5. [首次手动部署](#首次手动部署)
6. [理解部署架构](#理解部署架构)
7. [配置 GitHub Actions](#配置-github-actions)
8. [验证部署](#验证部署)

## 🔧 前置要求

### 安装的工具

```bash
# 检查是否已安装
aws --version        # AWS CLI
sam --version        # AWS SAM CLI
docker --version     # Docker (SAM 构建需要)
node --version       # Node.js
```

如果未安装，请参考 README.md 中的环境准备部分。

## 🏗️ AWS 账户准备

### 1. 创建或使用现有的 AWS 账户

访问 https://aws.amazon.com/ 创建账户或登录。

### 2. 创建 IAM 用户（用于部署）

**为什么需要**: 不应该使用 root 用户进行日常操作。

**步骤**:

```bash
# 方式 1: 使用 AWS 控制台
# 1. 登录 AWS Console
# 2. 进入 IAM → Users → Add user
# 3. 用户名: github-actions-deploy
# 4. 勾选 "Programmatic access"
# 5. 权限: 附加 "AdministratorAccess" 策略（或更细粒度的权限）
# 6. 创建后保存 Access Key ID 和 Secret Access Key

# 方式 2: 使用 AWS CLI（如果你已配置了管理员账户）
aws iam create-user --user-name github-actions-deploy

# 附加管理员权限（生产环境应该使用更细粒度的权限）
aws iam attach-user-policy \
  --user-name github-actions-deploy \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# 创建访问密钥
aws iam create-access-key --user-name github-actions-deploy
```

**保存输出的**:
- `AccessKeyId`: 例如 `AKIAIOSFODNN7EXAMPLE`
- `SecretAccessKey`: 例如 `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`

⚠️ **重要**: 这些凭证只会显示一次，请妥善保存！

## ⚙️ 配置 AWS CLI

### 配置默认 Profile

```bash
# 运行配置命令
aws configure

# 输入以下信息：
# AWS Access Key ID [None]: 你的 Access Key ID
# AWS Secret Access Key [None]: 你的 Secret Access Key
# Default region name [None]: us-east-1  # 或你选择的区域
# Default output format [None]: json

# 验证配置
aws sts get-caller-identity
```

**预期输出**:
```json
{
    "UserId": "AIDACKCEVSQ6C2EXAMPLE",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/github-actions-deploy"
}
```

## 👤 创建 Cognito 用户池

### 为什么需要

`/items` 端点需要 Cognito 认证。即使现在不用，也需要创建一个占位符。

### 创建步骤

#### 方式 1: 使用 AWS Console（推荐初次使用）

```
1. 登录 AWS Console
2. 服务 → Cognito → Create user pool
3. 配置选项:
   - Sign-in options: Email
   - Password policy: Cognito defaults
   - MFA: No MFA (开发环境)
   - User account recovery: Email only
   - Self-registration: Enabled
   - Attribute verification: Send email message, verify email address
   - Required attributes: name, email
   - Email provider: Send email with Cognito
4. 配置 app client:
   - App client name: qnyproj-client
   - Authentication flows: ALLOW_USER_PASSWORD_AUTH, ALLOW_REFRESH_TOKEN_AUTH
   - Don't generate a client secret (用于前端应用)
5. Review and create
```

**记录下**:
- User Pool ID: 例如 `us-east-1_abc123XYZ`
- App Client ID: 例如 `1a2b3c4d5e6f7g8h9i0j1k2l3m`

#### 方式 2: 使用 AWS CLI

```bash
# 创建用户池
aws cognito-idp create-user-pool \
  --pool-name qnyproj-users \
  --policies "PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}" \
  --auto-verified-attributes email \
  --username-attributes email \
  --region us-east-1

# 记录输出中的 UserPool Id

# 创建 App Client
aws cognito-idp create-user-pool-client \
  --user-pool-id <your-user-pool-id> \
  --client-name qnyproj-client \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --region us-east-1

# 记录输出中的 ClientId
```

### 更新配置

将 Cognito User Pool ID 更新到 `backend/samconfig.toml`:

```toml
[default.deploy.parameters]
# ...
parameter_overrides = "MyCognitoUserPoolId=us-east-1_abc123XYZ"  # 替换为你的 User Pool ID
```

## 🚀 首次手动部署

在配置 CI/CD 之前，建议先手动部署一次以确保配置正确。

### 步骤

```bash
# 1. 确保在项目根目录
cd C:\Users\11985\WebstormProjects\qnyproj

# 2. 生成 OpenAPI 规范
npm run generate:openapi

# 3. 进入 backend 目录
cd backend

# 4. 构建应用
sam build --use-container

# 5. 首次部署（交互式）
sam deploy --guided

# 在交互式配置中：
# - Stack Name: qnyproj-api
# - AWS Region: us-east-1 (或你选择的区域)
# - Parameter MyCognitoUserPoolId: <你的 User Pool ID>
# - Confirm changes before deploy: Y
# - Allow SAM CLI IAM role creation: Y
# - Disable rollback: N
# - HelloWorldFunction has no authorization: Y
# - Save arguments to configuration file: Y
# - SAM configuration file: samconfig.toml
# - SAM configuration environment: default

# 6. 等待部署完成（需要几分钟）
```

### 部署成功后

你会看到类似输出：

```
CloudFormation outputs from deployed stack
-------------------------------------------------------
Outputs                                                
-------------------------------------------------------
Key                 ApiUrl                             
Description         API Gateway endpoint URL for Dev stage
Value               https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev

Key                 ApiId                              
Description         API Gateway ID                     
Value               abc123xyz                          
-------------------------------------------------------
```

**保存这个 API URL！** 这就是你的后端 API 地址。

### 测试部署

```bash
# 测试公开端点（不需要认证）
curl https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev/edge-probe

# 应该返回类似：
# {
#   "receivedHost": "abc123xyz.execute-api.us-east-1.amazonaws.com",
#   "requestContextDomain": "...",
#   "method": "GET",
#   "path": "/dev/edge-probe"
# }
```

## 📐 理解部署架构

### 部署后的 AWS 资源

```
CloudFormation Stack: qnyproj-api
├── API Gateway: MyApiGateway
│   ├── Stage: dev
│   ├── Resources:
│   │   ├── /items (GET) → HelloWorldFunction
│   │   └── /edge-probe (GET) → EdgeProbeFunction (TODO)
│   └── Authorization: Cognito User Pool
│
├── Lambda Functions:
│   └── HelloWorldFunction
│       ├── Runtime: Node.js 18
│       ├── Code: backend/hello-world/
│       └── Logs: CloudWatch Log Group
│
├── IAM Roles:
│   └── Lambda Execution Role (自动创建)
│
└── CloudWatch Logs
```

### API Gateway 端点结构

```
Base URL: https://{api-id}.execute-api.{region}.amazonaws.com/dev
├── /items           → 需要 Cognito 认证
└── /edge-probe      → 公开访问
```

### 前端如何连接

前端会通过以下方式连接到 API：

```typescript
// frontend/src/api/generated/core/OpenAPI.ts
export const OpenAPI: OpenAPIConfig = {
  BASE: 'https://abc123xyz.execute-api.us-east-1.amazonaws.com/dev',
  // ...
};
```

## 🔄 配置 GitHub Actions

现在你已经手动部署成功，可以配置自动部署了。

### 添加 GitHub Secrets

**GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret**

添加以下 Secrets：

| 名称 | 值 | 来源 |
|------|---|------|
| `AWS_ACCESS_KEY_ID` | `AKIAIOSFODNN7EXAMPLE` | IAM 用户访问密钥 |
| `AWS_SECRET_ACCESS_KEY` | `wJalrXUt...` | IAM 用户秘密密钥 |
| `AWS_REGION` | `us-east-1` | 你选择的 AWS 区域 |

### 验证 Secrets 配置

```bash
# 在本地测试（使用相同的凭证）
export AWS_ACCESS_KEY_ID="你的密钥"
export AWS_SECRET_ACCESS_KEY="你的秘密"
export AWS_REGION="us-east-1"

# 测试凭证
aws sts get-caller-identity

# 清除环境变量
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
```

### 更新前端 API Base URL

部署后，需要更新前端的 API 端点：

```typescript
// frontend/src/api/generated/core/OpenAPI.ts
export const OpenAPI: OpenAPIConfig = {
  BASE: 'https://你的api-id.execute-api.us-east-1.amazonaws.com/dev',
  // ...
};
```

或者通过环境变量配置（推荐）：

```typescript
// vite.config.ts
export default defineConfig({
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
      process.env.VITE_API_BASE_URL || ''
    ),
  },
});

// 在 OpenAPI.ts 中使用
export const OpenAPI: OpenAPIConfig = {
  BASE: import.meta.env.VITE_API_BASE_URL || '',
  // ...
};
```

## ✅ 验证部署

### 检查 CloudFormation Stack

```bash
# 查看 Stack 状态
aws cloudformation describe-stacks \
  --stack-name qnyproj-api \
  --region us-east-1

# 查看 Stack 资源
aws cloudformation list-stack-resources \
  --stack-name qnyproj-api \
  --region us-east-1
```

### 测试 API 端点

```bash
# 获取 API URL
API_URL=$(aws cloudformation describe-stacks \
  --stack-name qnyproj-api \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

echo "API URL: $API_URL"

# 测试 edge-probe 端点
curl $API_URL/edge-probe

# 测试 items 端点（需要认证，应该返回 401）
curl $API_URL/items
```

### 查看 Lambda 日志

```bash
# 列出所有 Log Groups
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/qnyproj

# 查看最新日志
aws logs tail /aws/lambda/qnyproj-api-HelloWorldFunction-xxx --follow
```

## 🛠️ 故障排除

### 问题 1: SAM build 失败

```bash
# 错误: "Docker is not running"
# 解决: 启动 Docker Desktop

# 错误: "Unable to upload artifact"
# 解决: 检查 S3 权限，或使用 --guided 重新配置
```

### 问题 2: 部署时 Cognito 相关错误

```bash
# 错误: "Invalid Cognito User Pool ID"
# 解决: 检查 samconfig.toml 中的 parameter_overrides
# 确保 User Pool ID 格式正确: us-east-1_abc123XYZ
```

### 问题 3: API Gateway 返回 403

```bash
# 可能原因: CORS 配置问题
# 解决: 检查 template.yaml 中的 Cors 配置
# 或在 Lambda 中添加 CORS headers
```

### 问题 4: Lambda 执行超时

```bash
# 解决: 在 template.yaml 中增加 Timeout
Properties:
  Timeout: 30  # 增加到 30 秒
```

## 📚 参考资源

- [AWS SAM 官方文档](https://docs.aws.amazon.com/serverless-application-model/)
- [API Gateway 开发指南](https://docs.aws.amazon.com/apigateway/)
- [Cognito 开发指南](https://docs.aws.amazon.com/cognito/)
- [CloudFormation 参考](https://docs.aws.amazon.com/AWSCloudFormation/)

## 🎯 下一步

配置完成后，你可以：

1. ✅ 推送代码到 GitHub
2. ✅ GitHub Actions 会自动部署
3. ✅ 前端会部署到 GitHub Pages
4. ✅ 后端会部署到 AWS

确保所有配置正确后，运行：

```bash
git push origin main
```

然后在 GitHub Actions 标签页查看部署进度！
