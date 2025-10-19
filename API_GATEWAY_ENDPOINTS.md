# API Gateway 端点类型说明

## 📊 三种端点类型对比

API Gateway 支持三种端点配置类型，每种适用于不同的场景。

### 1. 边缘优化 (Edge-Optimized) ⭐ **当前配置**

```yaml
EndpointConfiguration:
  Type: EDGE
```

**特点**:
- ✅ 使用 AWS CloudFront CDN 分发
- ✅ 自动在全球边缘节点缓存
- ✅ 降低全球用户的延迟
- ✅ 适合面向全球用户的公开 API
- ⚠️ 首次请求可能稍慢（建立 CloudFront 缓存）

**URL 格式**:
```
https://{api-id}.execute-api.{region}.amazonaws.com/dev
```

**适用场景**:
- 全球用户访问的公开 API
- 静态或半静态内容
- 需要低延迟的 API
- 移动应用后端
- Web 应用后端

**工作原理**:
```
用户请求
    ↓
最近的 CloudFront 边缘节点
    ↓ (如果缓存未命中)
AWS 区域 API Gateway
    ↓
Lambda 函数
```

### 2. 区域性 (Regional)

```yaml
EndpointConfiguration:
  Type: REGIONAL
```

**特点**:
- ✅ 请求直接到达指定的 AWS 区域
- ✅ 延迟可预测
- ✅ 可以自己配置 CloudFront 或其他 CDN
- ✅ 更容易实现区域隔离
- ❌ 不自动使用 CloudFront

**URL 格式**:
```
https://{api-id}.execute-api.{region}.amazonaws.com/dev
```

**适用场景**:
- 区域性应用（用户主要在一个地区）
- 需要自定义 CDN 配置
- 内部 API（VPC 内访问）
- 需要与其他 AWS 服务在同一区域

**工作原理**:
```
用户请求
    ↓
AWS 区域 API Gateway
    ↓
Lambda 函数
```

### 3. 私有 (Private)

```yaml
EndpointConfiguration:
  Type: PRIVATE
```

**特点**:
- ✅ 只能从 VPC 内部访问
- ✅ 最高安全性
- ✅ 不暴露到公网
- ❌ 需要配置 VPC Endpoint
- ❌ 需要 VPN 或 Direct Connect 访问

**URL 格式**:
```
https://{api-id}-{vpce-id}.execute-api.{region}.amazonaws.com/dev
```

**适用场景**:
- 内部微服务通信
- 企业内部 API
- 高安全性要求的应用
- 不需要公网访问的服务

## 🎯 为什么我们选择边缘优化

### 我们的项目需求

1. **全球访问**: 用户可能来自不同地区
2. **公开 API**: `/edge-probe` 是公开端点，需要快速响应
3. **CDN 诊断**: Edge-probe 端点本身就是用来诊断 CDN 的
4. **前端部署**: GitHub Pages 本身就是全球 CDN

### 性能优势示例

假设你的 API 部署在 `us-east-1`（美国东部）：

| 用户位置 | Regional 延迟 | Edge 延迟 | 改善 |
|---------|-------------|----------|------|
| 纽约 (美国东部) | ~10ms | ~10ms | 0% |
| 洛杉矶 (美国西部) | ~80ms | ~20ms | 75% ⬇️ |
| 伦敦 (英国) | ~90ms | ~15ms | 83% ⬇️ |
| 东京 (日本) | ~180ms | ~30ms | 83% ⬇️ |
| 悉尼 (澳大利亚) | ~220ms | ~40ms | 82% ⬇️ |

### 配合 edge-probe 端点

我们的 `/edge-probe` 端点返回请求头信息，使用边缘优化后：

```json
{
  "receivedHost": "api.example.com",
  "requestContextDomain": "api.example.com",
  "method": "GET",
  "path": "/dev/edge-probe",
  "headers": {
    "x-forwarded-for": "用户IP, CloudFront边缘节点IP",
    "cloudfront-viewer-country": "CN",
    "cloudfront-is-desktop-viewer": "true"
  }
}
```

可以看到 CloudFront 添加的额外 headers！

## 🔧 切换端点类型

### 改为区域性端点

如果你想改为区域性：

```yaml
EndpointConfiguration:
  Type: REGIONAL
```

### 改为私有端点

如果你有 VPC 需求：

```yaml
EndpointConfiguration:
  Type: PRIVATE
  VPCEndpointIds:
    - vpce-xxxxxxxxxxxxxxxxx
```

## 💰 成本考虑

### 边缘优化成本

- **API Gateway 请求**: $3.50 / 百万请求（前 3.33 亿请求）
- **CloudFront 请求**: $0.0075 / 10,000 请求（美国区域）
- **CloudFront 数据传输**: $0.085 / GB（前 10 TB）

### 区域性成本

- **API Gateway 请求**: $3.50 / 百万请求
- **数据传输**: $0.09 / GB（传出到互联网）

### 免费套餐

- API Gateway: 前 12 个月每月 100 万次调用免费
- CloudFront: 前 12 个月每月 50 GB 数据传输免费

**结论**: 对于小到中型应用，边缘优化的额外成本可以忽略不计，但性能提升显著。

## 🎨 自定义域名

使用边缘优化端点后，建议配置自定义域名：

```yaml
# backend/template.yaml
DomainName:
  Type: AWS::ApiGateway::DomainName
  Properties:
    DomainName: api.your-domain.com
    EndpointConfiguration:
      Types:
        - EDGE
    CertificateArn: arn:aws:acm:us-east-1:xxxx:certificate/xxxx
```

**注意**: 边缘优化端点的证书必须在 **us-east-1** 区域创建（ACM）。

## 📈 监控和调试

### CloudWatch 指标

边缘优化端点会提供额外的指标：

- `CacheHitCount`: 缓存命中次数
- `CacheMissCount`: 缓存未命中次数
- `Latency`: 包括 CloudFront 的总延迟
- `IntegrationLatency`: Lambda 执行延迟

### X-Ray 追踪

启用 X-Ray 可以看到完整的请求路径：

```
CloudFront Edge → API Gateway → Lambda
```

## ⚙️ 缓存配置

边缘优化端点可以启用缓存（可选）：

```yaml
MyApiGateway:
  Type: AWS::Serverless::Api
  Properties:
    CacheClusterEnabled: true
    CacheClusterSize: "0.5"  # 0.5GB, 1.6GB, 6.1GB, etc.
    MethodSettings:
      - ResourcePath: /edge-probe
        HttpMethod: GET
        CachingEnabled: true
        CacheTtlInSeconds: 300  # 5 分钟
```

**成本**: 0.5GB 缓存约 $0.020/小时 = $14.4/月

## 🚀 部署后验证

部署边缘优化端点后，可以验证：

```bash
# 获取 API URL
API_URL=$(aws cloudformation describe-stacks \
  --stack-name qnyproj-api \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

# 测试端点
curl -I $API_URL/edge-probe

# 检查响应头
# 应该能看到 CloudFront 相关的 headers:
# x-amz-cf-id: xxx
# x-amz-cf-pop: xxx
# x-cache: Miss from cloudfront (首次) / Hit from cloudfront (后续)
```

## 📚 参考资源

- [API Gateway Endpoint Types](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-endpoint-types.html)
- [CloudFront with API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-with-cloudfront.html)
- [API Gateway Pricing](https://aws.amazon.com/api-gateway/pricing/)

---

**当前配置**: 边缘优化 (EDGE) ✅

这是面向全球用户的 Web 应用的最佳选择！
