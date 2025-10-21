# AGENTS.md - AI Agent 开发指南

## 📋 文档目的

本文档专为 **AI Agent**（如 GitHub Copilot、Claude、ChatGPT 等）设计，提供项目的结构化信息，帮助 AI Agent 更好地理解项目上下文并提供准确的开发建议。

## 🎯 项目概览

### 项目名称
**qnyproj** - 基于 OpenAPI 规范的全栈 Serverless 应用

### 技术栈摘要

```yaml
架构模式: OpenAPI-First Development
前端: React 19 + TypeScript 5 + Vite 7
后端: AWS Lambda (Node.js 18) + API Gateway (Edge-Optimized)
部署: AWS SAM + GitHub Actions
API规范: OpenAPI 3.0.1
```

### 核心理念

1. **OpenAPI 作为唯一事实来源** - 所有 API 定义都在 `openapi.template.yaml` 中
2. **类型安全的自动化** - 前端 TypeScript 客户端从 OpenAPI 自动生成
3. **边缘优化** - API Gateway 使用 CloudFront CDN 实现全球加速
4. **无服务器架构** - Lambda 函数自动伸缩，按需付费

## 📁 项目结构

```
qnyproj/
├── openapi.template.yaml          # ⭐ API 定义主文件（包含 CloudFormation 扩展）
├── openapi.yaml                   # 🤖 自动生成，不要编辑
├── package.json                   # 根目录任务脚本
├── scripts/
│   └── generate-openapi.js        # OpenAPI 生成脚本（处理 CloudFormation 标签）
│
├── frontend/                      # React 前端
│   ├── src/
│   │   ├── api/generated/         # 🤖 自动生成的 TypeScript API 客户端
│   │   │   ├── core/
│   │   │   │   └── OpenAPI.ts     # API 配置（BASE URL 等）
│   │   │   ├── models/            # TypeScript 类型定义
│   │   │   └── services/          # API 服务类
│   │   ├── App.tsx                # 主应用组件
│   │   ├── AppWithSwagger.tsx     # 包含 Swagger UI 的应用
│   │   ├── SwaggerDocs.tsx        # Swagger UI 组件
│   │   ├── ApiTest.tsx            # API 测试组件
│   │   └── EdgeProbeDemo.tsx      # Edge Probe 演示组件
│   ├── package.json               # 前端依赖（pnpm 管理）
│   └── vite.config.ts             # Vite 配置
│
├── backend/                       # AWS SAM 后端
│   ├── template.yaml              # SAM CloudFormation 模板
│   ├── samconfig.toml             # SAM 部署配置
│   ├── hello-world/
│   │   ├── app.js                 # ⭐ Lambda 函数主文件
│   │   ├── package.json
│   │   └── tests/                 # 单元测试
│   └── iam-policy-sam-deploy.json # IAM 权限策略示例
│
└── .github/workflows/
    └── deploy.yml                 # CI/CD 流程配置
```

## 🔑 关键文件说明

### 1. `openapi.template.yaml` ⭐ 最重要

**用途**: API 的唯一事实来源，包含 OpenAPI 3.0 规范 + AWS 扩展

**关键特性**:
- 使用 CloudFormation 内置函数 (`Fn::Sub`, `!Sub`)
- 定义 API 端点、数据模型、安全方案
- 包含 `x-amazon-apigateway-integration` AWS 扩展

**编辑规则**:
- ✅ **必须** 手动编辑此文件来定义/修改 API
- ✅ 可以使用 CloudFormation 内置函数引用资源
- ❌ 不要直接编辑 `openapi.yaml`

**示例结构**:
```yaml
paths:
  /items:
    get:
      summary: Get items
      security:
        - CognitoAuthorizer: []
      responses:
        '200':
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Item'
      x-amazon-apigateway-integration:
        type: aws_proxy
        httpMethod: POST
        uri:
          Fn::Sub: "arn:aws:apigateway:${AWS::Region}:lambda:path/.../functions/${HelloWorldFunction.Arn}/invocations"
```

### 2. `backend/hello-world/app.js` ⭐ Lambda 函数

**当前实现**: 路由处理器，支持多个端点

**关键代码模式**:
```javascript
exports.lambdaHandler = async (event, context) => {
    const path = event.path || event.rawPath;
    const method = event.httpMethod || event.requestContext?.http?.method;
    
    if (path === '/edge-probe' || path === '/dev/edge-probe') {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                receivedHost: event.headers?.Host,
                requestContextDomain: event.requestContext?.domainName,
                headers: event.headers,
                // ...
            })
        };
    }
    
    if (path === '/items' || path === '/dev/items') {
        return {
            statusCode: 200,
            headers: { /* ... */ },
            body: JSON.stringify([/* items */])
        };
    }
};
```

**添加新端点时**:
1. 在 `openapi.template.yaml` 定义端点
2. 在 `app.js` 添加路由处理
3. 确保路径匹配（考虑 `/dev` 前缀）

### 3. `backend/template.yaml` ⭐ SAM 模板

**关键配置**:
```yaml
Resources:
  MyApiGateway:
    Type: AWS::Serverless::Api
    Properties:
      StageName: dev
      EndpointConfiguration:
        Type: EDGE  # 使用 CloudFront 边缘优化
      DefinitionBody:
        # 内联 OpenAPI 规范
        openapi: 3.0.1
        paths: { /* ... */ }
  
  HelloWorldFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: hello-world/
      Handler: app.lambdaHandler
      Runtime: nodejs18.x
      Events:  # 自动创建 API Gateway 权限
        ItemsApi:
          Type: Api
          Properties:
            RestApiId: !Ref MyApiGateway
            Path: /items
            Method: GET
```

**重要提示**:
- `DefinitionBody` 必须内联（不能使用 `DefinitionUri` 引用外部文件）
- `Events` 配置自动创建 Lambda 权限，使 API Gateway 可以调用 Lambda
- `EndpointConfiguration: EDGE` 启用 CloudFront CDN

### 4. `frontend/src/api/generated/` 🤖 自动生成

**生成工具**: `openapi-typescript-codegen`

**生成命令**: `npm run generate:frontend-api`

**包含文件**:
- `core/OpenAPI.ts` - 配置文件（BASE URL、认证等）
- `models/*.ts` - TypeScript 接口/类型
- `services/*.ts` - API 调用服务类

**使用示例**:
```typescript
import { DefaultService, EdgeDiagnosticsService } from './api/generated';

// 调用 /items
const items = await DefaultService.getItems();

// 调用 /edge-probe
const probeResult = await EdgeDiagnosticsService.getEdgeProbe();
```

## 🔄 开发工作流

### 添加新 API 端点的完整流程

**场景**: 添加一个 `GET /users` 端点

#### 步骤 1: 定义 API（编辑 `openapi.template.yaml`）

```yaml
paths:
  /users:
    get:
      summary: Get all users
      tags:
        - Users
      security:
        - CognitoAuthorizer: []  # 如果需要认证
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
          Fn::Sub: "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${HelloWorldFunction.Arn}/invocations"

components:
  schemas:
    User:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: string
        name:
          type: string
        email:
          type: string
          format: email
```

#### 步骤 2: 生成前端客户端

```bash
npm run generate:frontend-api
```

**生成结果**:
- `frontend/src/api/generated/models/User.ts` - User 类型定义
- `frontend/src/api/generated/services/UsersService.ts` - API 调用方法

#### 步骤 3: 实现 Lambda 后端（编辑 `backend/hello-world/app.js`）

```javascript
exports.lambdaHandler = async (event, context) => {
    const path = event.path || event.rawPath;
    
    // 新增路由
    if (path === '/users' || path === '/dev/users') {
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify([
                { id: '1', name: 'Alice', email: 'alice@example.com' },
                { id: '2', name: 'Bob', email: 'bob@example.com' }
            ])
        };
    }
    
    // 其他路由...
};
```

#### 步骤 4: 更新 SAM 模板（编辑 `backend/template.yaml`）

在 `HelloWorldFunction` 的 `Events` 中添加：

```yaml
HelloWorldFunction:
  Type: AWS::Serverless::Function
  Properties:
    # ...
    Events:
      ItemsApi: { /* 现有 */ }
      EdgeProbeApi: { /* 现有 */ }
      UsersApi:  # 新增
        Type: Api
        Properties:
          RestApiId: !Ref MyApiGateway
          Path: /users
          Method: GET
```

在 `MyApiGateway` 的 `DefinitionBody` 中也要添加 `/users` 路径定义。

#### 步骤 5: 前端调用（新建 `frontend/src/UsersList.tsx`）

```typescript
import { useEffect, useState } from 'react';
import { UsersService, type User } from './api/generated';

export function UsersList() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    useEffect(() => {
        UsersService.getUsers()
            .then(data => {
                setUsers(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, []);
    
    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error}</div>;
    
    return (
        <ul>
            {users.map(user => (
                <li key={user.id}>{user.name} - {user.email}</li>
            ))}
        </ul>
    );
}
```

#### 步骤 6: 本地测试

```bash
# 前端
npm run dev:frontend

# 后端（需要 Docker）
cd backend
sam build --use-container
sam local start-api
```

#### 步骤 7: 部署

```bash
# 推荐方式：推送到Github main分支后CD
git commit xxxxxx
git push

# 或者手动部署
npm run deploy:backend


**重要提示**：
- ✅ **不要直接使用sam deploy**，否则 Secrets Manager 会被更新为占位符！
- ✅ `backend/.env` 文件必须包含 `QWEN_API_KEY`、`QWEN_ENDPOINT`、`QWEN_MODEL`

## 🚀 部署信息

### 当前部署状态

```yaml
后端 API:
  URL: https://ds0yqv9fn8.execute-api.us-east-1.amazonaws.com/dev
  类型: Edge-Optimized (使用 CloudFront CDN)
  区域: us-east-1
  Lambda: qnyproj-api-HelloWorldFunction-7vF4AmhBaeOA

可用端点:
  - GET /edge-probe (公开)
  - GET /items (公开，应该配置认证)
  - 以及其他deploy后的端点

前端:
  部署方式: GitHub Pages (Deploy from Branch: gh-pages)
  构建工具: Vite
  预期 URL: https://Ethanlita.github.io/qnyproj/
```

### GitHub Actions Secrets 配置

需要在 GitHub 仓库配置以下 Secrets：

```yaml
AWS_ACCESS_KEY_ID: "AKIA..."
AWS_SECRET_ACCESS_KEY: "wJal..."
AWS_REGION: "us-east-1"
QWEN_API_KEY: "sk-7cbd..."  # ⭐ 新增！Qwen API Key
QWEN_ENDPOINT: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"  # ⭐ 新增！
QWEN_MODEL: "qwen-plus"  # ⭐ 新增！
```

**配置步骤**：
1. 进入 GitHub 仓库：https://github.com/Ethanlita/qnyproj
2. 点击 `Settings` → `Secrets and variables` → `Actions`
3. 点击 `New repository secret`
4. 添加以上所有 Secret（名称和值完全一致）

**重要提示**：
- ✅ 所有 Secret 都必须配置，否则 CI/CD 部署会失败
- ✅ `QWEN_API_KEY`、`QWEN_ENDPOINT`、`QWEN_MODEL` 必须与 `backend/.env` 中的值一致
- ✅ GitHub Actions 会在每次推送到 `main` 分支时自动部署

### 本地部署脚本 (npm run deploy:backend)
cd (project root dir)
npm run deploy:backend
```

**关键特性**：
- ✅ 自动从 `.env` 加载环境变量
- ✅ 验证必需的 Qwen 配置
- ✅ 确保 Secrets Manager 被正确更新
- ✅ 前台运行，实时显示部署进度

## 🔧 常用 NPM 脚本

### 根目录 (`package.json`)

```json
{
  "generate:openapi": "生成纯净的 openapi.yaml（去除 CloudFormation 标签）",
  "generate:frontend-api": "生成前端 TypeScript API 客户端",
  "dev:frontend": "启动前端开发服务器",
  "build:frontend": "构建前端生产版本",
  "deploy:backend": "部署后端到 AWS"
}
```

### 执行顺序

**开发新 API**:
```bash
# 1. 编辑 openapi.template.yaml
# 2. 生成客户端
npm run generate:frontend-api

# 3. 开发前端
npm run dev:frontend

# 4. 实现后端 Lambda
# 5. 部署
cd backend
```

## ⚠️ 重要注意事项

### DO's ✅

1. **编辑 `openapi.template.yaml`** - 这是 API 的唯一事实来源
2. **使用生成的客户端** - 前端调用 API 必须使用 `api/generated/services/*`
3. **保持类型安全** - TypeScript 类型从 OpenAPI 自动生成，利用类型检查
4. **测试边缘优化** - 使用 `/edge-probe` 端点检查 CloudFront 请求头
5. **考虑 CORS** - Lambda 响应必须包含 `Access-Control-Allow-Origin` 头

### DON'Ts ❌

1. **不要编辑 `openapi.yaml`** - 这是自动生成的
2. **不要编辑 `frontend/src/api/generated/`** - 会被覆盖
3. **不要在 Lambda 中硬编码端点路径** - 使用 `event.path` 动态判断
4. **不要忘记处理 `/dev` 前缀** - API Gateway Stage 会添加前缀
5. **不要跳过 `npm run generate:frontend-api`** - 修改 API 后必须重新生成
