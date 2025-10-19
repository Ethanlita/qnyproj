# 部署前检查清单

在推送代码触发自动部署之前，请确认以下所有项目都已完成。

## ✅ 本地环境检查

- [ ] Node.js 已安装 (`node --version`)
- [ ] pnpm 已安装 (`pnpm --version`)
- [ ] AWS CLI 已安装 (`aws --version`)
- [ ] AWS SAM CLI 已安装 (`sam --version`)
- [ ] Docker Desktop 已安装并运行 (`docker --version`)

## ✅ AWS 配置检查

### AWS CLI 配置

- [ ] AWS CLI 已配置凭证
  ```bash
  aws configure list
  ```

- [ ] 可以成功调用 AWS API
  ```bash
  aws sts get-caller-identity
  ```
  应该返回你的账户信息

### Cognito 配置

- [ ] 已创建 Cognito User Pool
- [ ] 已记录 User Pool ID (格式: `us-east-1_abc123XYZ`)
- [ ] 已更新到 `backend/samconfig.toml`:
  ```toml
  parameter_overrides = "MyCognitoUserPoolId=你的UserPoolID"
  ```

### 手动部署测试

- [ ] 已成功执行首次手动部署
  ```bash
  cd backend
  sam build --use-container
  sam deploy --guided
  ```

- [ ] 部署成功并获得 API URL
- [ ] 已记录 API Gateway URL
- [ ] 已测试 `/edge-probe` 端点可以访问

## ✅ GitHub 配置检查

### GitHub Secrets

进入仓库的 **Settings → Secrets and variables → Actions**，确认已添加：

- [ ] `AWS_ACCESS_KEY_ID` - IAM 用户访问密钥
- [ ] `AWS_SECRET_ACCESS_KEY` - IAM 用户秘密密钥  
- [ ] `AWS_REGION` - AWS 区域 (如 `us-east-1`)

### GitHub Pages

- [ ] 已启用 GitHub Pages
  - **Settings → Pages → Source**: 选择 **GitHub Actions**

## ✅ 代码配置检查

### Backend 配置

- [ ] `backend/samconfig.toml` 配置正确
  ```toml
  stack_name = "qnyproj-api"
  region = "us-east-1"
  parameter_overrides = "MyCognitoUserPoolId=实际的ID"
  ```

- [ ] `backend/template.yaml` StageName 正确
  ```yaml
  StageName: dev  # 应该是 dev 而不是 prod
  ```

### Frontend 配置

- [ ] `frontend/vite.config.ts` base 路径正确
  ```typescript
  base: '/qnyproj/',  // 如果仓库名是 qnyproj
  // 或
  base: '/',  // 如果使用自定义域名
  ```

- [ ] API Base URL 已配置 (如果需要)
  ```typescript
  // frontend/src/api/generated/core/OpenAPI.ts
  BASE: 'https://你的api-id.execute-api.us-east-1.amazonaws.com/dev'
  ```

### Git 配置

- [ ] 所有更改已提交
  ```bash
  git status  # 应该是干净的
  ```

- [ ] 确认要推送的 commit
  ```bash
  git log --oneline -5
  ```

## ✅ 工作流文件检查

- [ ] `.github/workflows/deploy.yml` 文件存在
- [ ] Workflow 配置的触发条件正确
- [ ] Workflow 中的步骤顺序正确

## 🚀 准备推送

如果所有检查都通过，执行：

```bash
# 查看当前状态
git status

# 查看将要推送的 commits
git log origin/main..HEAD --oneline

# 推送到远程仓库（触发自动部署）
git push origin main
```

## 📊 推送后监控

### 1. GitHub Actions

- [ ] 访问 `https://github.com/你的用户名/qnyproj/actions`
- [ ] 查看 workflow 运行状态
- [ ] 展开查看每个 job 的日志

### 2. AWS CloudFormation

```bash
# 查看 Stack 状态
aws cloudformation describe-stacks \
  --stack-name qnyproj-api \
  --query 'Stacks[0].StackStatus'
```

### 3. GitHub Pages

- [ ] 部署完成后访问 `https://你的用户名.github.io/qnyproj/`
- [ ] 检查页面是否正常显示
- [ ] 检查 Swagger UI 是否可以加载

## ⚠️ 如果部署失败

### 后端部署失败

1. 检查 GitHub Actions 日志
2. 检查 AWS CloudFormation 控制台的错误信息
3. 查看 CloudWatch Logs

### 前端部署失败

1. 检查 GitHub Actions 日志中的构建错误
2. 检查是否有 TypeScript 类型错误
3. 检查 Vite 构建是否成功

### 常见问题

**问题**: AWS 凭证无效
```bash
# 解决: 检查 GitHub Secrets 是否正确
# 在本地测试
aws sts get-caller-identity
```

**问题**: Cognito User Pool ID 错误
```bash
# 解决: 检查 backend/samconfig.toml
# 验证格式: us-east-1_abc123XYZ
```

**问题**: GitHub Pages 404
```bash
# 解决: 检查 vite.config.ts 中的 base 配置
# 确保与仓库名匹配
```

## 🎯 成功标志

部署成功后，你应该能够：

- [ ] 在 GitHub Pages 上访问前端应用
- [ ] 在 Swagger UI 中看到 API 文档
- [ ] 通过前端调用后端 API
- [ ] 在 AWS Console 中看到部署的资源

---

**全部检查通过？** 开始部署吧！ 🚀

```bash
git push origin main
```
