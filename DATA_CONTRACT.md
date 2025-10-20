# 数据契约文档

本文档定义了小说转漫画系统的所有数据契约,包括 API 规范、数据库 Schema、存储结构和 AI API 契约。

---

## 目录

1. [OpenAPI 规范](#1-openapi-规范)
2. [DynamoDB Schema](#2-dynamodb-schema)
3. [S3 存储结构](#3-s3-存储结构)
4. [AI API 契约](#4-ai-api-契约)
5. [运行时校验](#5-运行时校验)
6. [版本控制与迁移](#6-版本控制与迁移)
7. [测试数据集](#7-测试数据集)

---

## 1. OpenAPI 规范

### 1.1 端点清单

#### 小说管理

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/novels` | POST | 创建作品 | ✅ |
| `/novels/{id}` | GET | 获取作品详情 | ✅ |
| `/novels/{id}/analyze` | POST | 分析文本生成分镜 | ✅ |
| `/novels/{id}` | DELETE | 删除作品 | ✅ |

#### 角色管理

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/characters/{charId}` | GET | 获取角色详情 (含所有配置) | ✅ |
| `/characters/{charId}` | PUT | 更新角色基础信息 | ✅ |
| `/characters/{charId}/configurations` | POST | 创建新配置 | ✅ |
| `/characters/{charId}/configurations/{configId}` | GET | 获取指定配置详情 | ✅ |
| `/characters/{charId}/configurations/{configId}` | PUT | 更新配置 | ✅ |
| `/characters/{charId}/configurations/{configId}` | DELETE | 删除配置 | ✅ |
| `/characters/{charId}/configurations/{configId}/refs` | POST | 上传配置的参考图 | ✅ |
| `/characters/{charId}/configurations/{configId}/portraits` | POST | 为配置生成标准像 | ✅ |

#### 分镜与出图

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/storyboards/{id}` | GET | 获取分镜 | ✅ |
| `/storyboards/{id}/generate` | POST | 批量生成面板 (query: mode=preview\|hd) | ✅ |
| `/panels/{panelId}` | GET | 获取面板详情 | ✅ |

#### 编辑

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/panels/{panelId}/edit` | POST | 编辑面板 (inpaint/outpaint/bg_swap) | ✅ |
| `/change-requests` | POST | 提交修改请求 (自然语言→CR-DSL) | ✅ |

#### 任务与导出

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/jobs/{id}` | GET | 查询任务进度 | ✅ |
| `/exports` | POST | 创建导出任务 | ✅ |
| `/exports/{id}` | GET | 下载导出文件 (返回预签名 URL) | ✅ |

#### 诊断 (公开)

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/edge-probe` | GET | CDN 诊断 | ❌ |

---

### 1.2 数据模型 (OpenAPI Schemas)

#### Novel (作品)

```yaml
Novel:
  type: object
  required:
    - id
    - title
    - status
    - userId
    - createdAt
  properties:
    id:
      type: string
      format: uuid
      description: 作品唯一标识
      example: "550e8400-e29b-41d4-a716-446655440000"
    
    title:
      type: string
      minLength: 1
      maxLength: 200
      description: 作品标题
      example: "我的奇幻冒险"
    
    originalText:
      type: string
      description: 原文内容 (如果直接提交) 或 S3 URL
      example: "从前有一个勇士..."
    
    originalTextS3:
      type: string
      description: 原文 S3 Key
      example: "novels/550e8400-xxx/original.txt"
    
    status:
      type: string
      enum:
        - created       # 已创建,未分析
        - analyzing     # 正在分析
        - analyzed      # 分析完成
        - generating    # 正在生成图像
        - completed     # 全部完成
        - error         # 发生错误
      description: 作品状态
    
    storyboardId:
      type: string
      format: uuid
      description: 关联的分镜 ID
    
    userId:
      type: string
      description: Cognito 用户 ID (sub)
      example: "us-east-1:xxxxx"
    
    metadata:
      type: object
      description: 元数据
      properties:
        genre:
          type: string
          example: "奇幻"
        tags:
          type: array
          items:
            type: string
          example: ["冒险", "魔法"]
        language:
          type: string
          example: "zh-CN"
    
    createdAt:
      type: string
      format: date-time
      description: 创建时间
    
    updatedAt:
      type: string
      format: date-time
      description: 最后更新时间
```

#### Character (角色)

```yaml
Character:
  type: object
  required:
    - id
    - name
    - novelId
  properties:
    id:
      type: string
      format: uuid
      description: 角色唯一标识
    
    name:
      type: string
      minLength: 1
      maxLength: 50
      description: 角色名称
      example: "艾莉娅"
    
    role:
      type: string
      enum:
        - protagonist   # 主角
        - antagonist    # 反派
        - supporting    # 配角
        - background    # 背景角色
      description: 角色类型
    
    novelId:
      type: string
      format: uuid
      description: 所属作品 ID
    
    baseInfo:
      type: object
      description: 角色基础信息 (适用于所有配置)
      properties:
        gender:
          type: string
          enum: [male, female, other]
          example: "female"
        
        age:
          type: integer
          minimum: 1
          maximum: 200
          example: 18
        
        personality:
          type: array
          items:
            type: string
          description: 性格特征
          example: ["勇敢", "善良", "有时冲动"]
    
    configurations:
      type: array
      description: 角色的多个配置 (不同情况下的不同设定)
      items:
        type: object
        required:
          - id
          - name
        properties:
          id:
            type: string
            format: uuid
            description: 配置唯一标识
          
          name:
            type: string
            description: 配置名称
            example: "战斗模式" | "日常装扮" | "正式场合"
          
          description:
            type: string
            description: 配置的详细文字描述
            example: "艾莉娅穿着银白色铠甲，手持魔法剑，准备战斗"
          
          tags:
            type: array
            items:
              type: string
            description: 配置标签 (便于搜索和筛选)
            example: ["战斗", "铠甲", "持剑"]
          
          appearance:
            type: object
            description: 该配置下的外貌描述
            properties:
              height:
                type: string
                example: "中等身高"
              
              build:
                type: string
                example: "苗条但结实"
              
              hairColor:
                type: string
                example: "银色"
              
              hairStyle:
                type: string
                example: "战斗马尾"
              
              eyeColor:
                type: string
                example: "蓝色"
              
              clothing:
                type: array
                items:
                  type: string
                description: 服装描述
                example: ["银白色铠甲", "蓝色斗篷", "魔法剑"]
              
              accessories:
                type: array
                items:
                  type: string
                description: 配饰
                example: ["头盔", "护腕", "魔法宝石项链"]
              
              distinguishingFeatures:
                type: array
                items:
                  type: string
                description: 特征标记
                example: ["额头星形印记发光"]
          
          referenceImages:
            type: array
            items:
              type: object
              properties:
                url:
                  type: string
                  format: uri
                  description: 参考图预签名 URL
                caption:
                  type: string
                  description: 图片说明
                  example: "正面视角"
                uploadedAt:
                  type: string
                  format: date-time
            description: 用户为该配置上传的参考图
          
          generatedPortraits:
            type: array
            items:
              type: object
              properties:
                view:
                  type: string
                  enum: [front, side, three-quarter, 45-degree, full-body]
                  description: 视角类型
                url:
                  type: string
                  format: uri
                  description: AI 生成的标准像 URL
                generatedAt:
                  type: string
                  format: date-time
            description: AI 生成的标准像
          
          isDefault:
            type: boolean
            description: 是否为默认配置
            default: false
          
          createdAt:
            type: string
            format: date-time
          
          updatedAt:
            type: string
            format: date-time
    
    createdAt:
      type: string
      format: date-time
    
    updatedAt:
      type: string
      format: date-time

CharacterConfiguration:
  description: 角色配置的独立 Schema (用于 POST/PUT 请求)
  type: object
  required:
    - name
    - description
  properties:
    name:
      type: string
      minLength: 1
      maxLength: 100
    description:
      type: string
      minLength: 1
      maxLength: 2000
    tags:
      type: array
      items:
        type: string
    appearance:
      type: object
    isDefault:
      type: boolean
```

#### Storyboard (分镜)

```yaml
Storyboard:
  type: object
  required:
    - id
    - novelId
    - version
    - panels
  properties:
    id:
      type: string
      format: uuid
      description: 分镜唯一标识
    
    novelId:
      type: string
      format: uuid
      description: 所属作品 ID
    
    version:
      type: integer
      minimum: 1
      description: 版本号 (支持多版本)
      example: 1
    
    totalPages:
      type: integer
      minimum: 1
      description: 总页数
      example: 10
    
    panelCount:
      type: integer
      description: 面板总数
      example: 48
    
    panels:
      type: array
      items:
        $ref: '#/components/schemas/Panel'
      description: 面板列表
    
    createdAt:
      type: string
      format: date-time
```

#### Panel (面板)

```yaml
Panel:
  type: object
  required:
    - id
    - page
    - index
    - content
  properties:
    id:
      type: string
      format: uuid
      description: 面板唯一标识
    
    storyboardId:
      type: string
      format: uuid
      description: 所属分镜 ID
    
    page:
      type: integer
      minimum: 1
      description: 页码 (从 1 开始)
      example: 1
    
    index:
      type: integer
      minimum: 0
      description: 页内序号 (从 0 开始)
      example: 0
    
    content:
      type: object
      required:
        - scene
      properties:
        scene:
          type: string
          minLength: 1
          maxLength: 500
          description: 场景描述
          example: "森林入口,阳光透过树叶,中景镜头"
        
        shotType:
          type: string
          enum:
            - close-up      # 特写
            - medium        # 中景
            - wide          # 远景
            - extreme-wide  # 大远景
          description: 镜头类型
        
        characters:
          type: array
          items:
            type: object
            required:
              - charId
            properties:
              charId:
                type: string
                format: uuid
                description: 角色 ID
              
              name:
                type: string
                description: 角色名称 (冗余,便于显示)
              
              pose:
                type: string
                description: 姿态描述
                example: "站立,右手指向前方"
              
              expression:
                type: string
                enum:
                  - neutral
                  - happy
                  - sad
                  - angry
                  - surprised
                  - determined
                  - fearful
                description: 表情
              
              position:
                type: string
                enum: [left, center, right, foreground, background]
                description: 画面位置
        
        dialogue:
          type: array
          items:
            type: object
            required:
              - speaker
              - text
            properties:
              speaker:
                type: string
                description: 说话者名称
                example: "艾莉娅"
              
              text:
                type: string
                minLength: 1
                maxLength: 200
                description: 对白内容
                example: "我们一起去冒险吧!"
              
              bubbleType:
                type: string
                enum:
                  - speech      # 普通对话
                  - thought     # 内心独白
                  - narration   # 旁白
                  - scream      # 大喊
                description: 气泡类型
              
              position:
                type: object
                description: 气泡位置 (前端布局)
                properties:
                  x:
                    type: number
                  y:
                    type: number
        
        visualPrompt:
          type: string
          description: 给 Imagen 的完整 prompt (英文)
          example: "manga style, forest entrance, sunlight through trees, medium shot, character standing with determined expression, high quality"
    
    images:
      type: object
      description: 生成的图像
      properties:
        preview:
          type: string
          format: uri
          description: 预览图 URL (512x288)
        
        hd:
          type: string
          format: uri
          description: 高清图 URL (1920x1080)
    
    layout:
      type: object
      description: 面板布局信息 (前端使用)
      properties:
        width:
          type: number
          description: 宽度 (相对单位)
        
        height:
          type: number
          description: 高度
        
        x:
          type: number
          description: X 坐标
        
        y:
          type: number
          description: Y 坐标
```

#### Job (任务)

```yaml
Job:
  type: object
  required:
    - id
    - type
    - status
  properties:
    id:
      type: string
      format: uuid
      description: 任务唯一标识
    
    type:
      type: string
      enum:
        - analyze           # 文本分析
        - generate_preview  # 生成预览图
        - generate_hd       # 生成高清图
        - edit              # 编辑面板
        - export            # 导出
      description: 任务类型
    
    status:
      type: string
      enum:
        - pending       # 等待中
        - in_progress   # 进行中
        - completed     # 已完成
        - failed        # 失败
      description: 任务状态
    
    progress:
      type: object
      description: 进度信息
      properties:
        total:
          type: integer
          description: 总任务数
          example: 100
        
        completed:
          type: integer
          description: 已完成数
          example: 45
        
        failed:
          type: integer
          description: 失败数
          example: 2
        
        percentage:
          type: number
          format: float
          description: 完成百分比
          example: 45.0
    
    result:
      type: object
      description: 任务结果 (内容依赖于 type)
      additionalProperties: true
      example:
        storyboardId: "uuid"
        panelCount: 48
    
    error:
      type: string
      description: 错误信息 (如果失败)
      example: "Qwen API rate limit exceeded"
    
    createdAt:
      type: string
      format: date-time
    
    updatedAt:
      type: string
      format: date-time
```

#### ChangeRequest (修改请求)

```yaml
ChangeRequest:
  type: object
  required:
    - id
    - novelId
    - naturalLanguage
  properties:
    id:
      type: string
      format: uuid
      description: CR 唯一标识
    
    novelId:
      type: string
      format: uuid
      description: 所属作品 ID
    
    naturalLanguage:
      type: string
      minLength: 1
      maxLength: 1000
      description: 用户的自然语言诉求
      example: "把第 3 页第 2 个面板中艾莉娅的表情改为微笑"
    
    dsl:
      $ref: '#/components/schemas/CRDSL'
      description: 解析后的 CR-DSL
    
    status:
      type: string
      enum:
        - parsing     # 正在解析
        - pending     # 等待执行
        - executing   # 执行中
        - completed   # 已完成
        - failed      # 失败
      description: CR 状态
    
    jobId:
      type: string
      format: uuid
      description: 关联的任务 ID
    
    createdAt:
      type: string
      format: date-time
    
    updatedAt:
      type: string
      format: date-time

CRDSL:
  type: object
  required:
    - scope
    - type
    - ops
  description: Change Request Domain-Specific Language
  properties:
    scope:
      type: string
      enum:
        - global      # 全局 (整个作品)
        - character   # 角色级别
        - panel       # 面板级别
        - page        # 页级别
      description: 修改作用域
    
    targetId:
      type: string
      description: 目标对象 ID (charId/panelId/pageNum)
      example: "panel-uuid-xxx"
    
    type:
      type: string
      enum:
        - art       # 美术修改 (重绘/编辑)
        - dialogue  # 对白修改
        - layout    # 布局修改 (排序/重排)
        - style     # 风格修改 (全局)
      description: 修改类型
    
    ops:
      type: array
      minItems: 1
      items:
        type: object
        required:
          - action
        properties:
          action:
            type: string
            enum:
              - inpaint        # 局部重绘
              - outpaint       # 外延扩展
              - bg_swap        # 背景替换
              - repose         # 重新摆姿
              - regen_panel    # 完全重新生成面板
              - rewrite_dialogue  # 重写对白
              - reorder        # 重新排序
            description: 操作动作
          
          params:
            type: object
            description: 操作参数 (内容依赖于 action)
            additionalProperties: true
            example:
              mask: "data:image/png;base64,..."
              instruction: "把表情改为微笑"
      description: 操作列表 (按顺序执行)
```

#### Export (导出)

```yaml
Export:
  type: object
  required:
    - id
    - novelId
    - format
  properties:
    id:
      type: string
      format: uuid
    
    novelId:
      type: string
      format: uuid
    
    format:
      type: string
      enum:
        - pdf        # PDF 文件
        - webtoon    # 长图 (PNG)
        - resources  # 资源包 (ZIP: PNG/SVG + JSON)
      description: 导出格式
    
    status:
      type: string
      enum: [pending, processing, completed, failed]
    
    fileUrl:
      type: string
      format: uri
      description: 导出文件的预签名 URL (有效期 15 分钟)
    
    fileSize:
      type: integer
      description: 文件大小 (字节)
    
    createdAt:
      type: string
      format: date-time
```

---

### 1.3 请求/响应示例

#### POST /novels/{id}/analyze

**请求**:

```http
POST /novels/550e8400-xxx/analyze HTTP/1.1
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "options": {
    "panelsPerPage": 6,
    "style": "manga"
  }
}
```

**响应** (202 Accepted):

```json
{
  "jobId": "job-uuid-xxx",
  "status": "pending",
  "message": "Analysis started. Use GET /jobs/{jobId} to check progress."
}
```

#### GET /jobs/{id}

**响应** (200 OK):

```json
{
  "id": "job-uuid-xxx",
  "type": "analyze",
  "status": "completed",
  "progress": {
    "total": 1,
    "completed": 1,
    "failed": 0,
    "percentage": 100.0
  },
  "result": {
    "storyboardId": "story-uuid-xxx",
    "version": 1,
    "totalPages": 10,
    "panelCount": 48,
    "characters": [
      { "id": "char-001", "name": "艾莉娅" },
      { "id": "char-002", "name": "雷恩" }
    ]
  },
  "createdAt": "2025-10-19T08:00:00Z",
  "updatedAt": "2025-10-19T08:02:30Z"
}
```

#### POST /change-requests

**请求**:

```json
{
  "novelId": "novel-uuid-xxx",
  "naturalLanguage": "把第 3 页第 2 个面板中艾莉娅的表情改为微笑"
}
```

**响应** (202 Accepted):

```json
{
  "crId": "cr-uuid-xxx",
  "jobId": "job-uuid-yyy",
  "dsl": {
    "scope": "panel",
    "targetId": "panel-uuid-xxx",
    "type": "art",
    "ops": [
      {
        "action": "inpaint",
        "params": {
          "region": "face",
          "instruction": "change expression to smile"
        }
      }
    ]
  },
  "message": "Change request is being processed"
}
```

---

### 1.4 认证与授权

#### Security Schemes

```yaml
securitySchemes:
  CognitoAuthorizer:
    type: openIdConnect
    openIdConnectUrl: !Sub "https://cognito-idp.${AWS::Region}.amazonaws.com/${CognitoUserPoolId}"
    x-amazon-apigateway-authorizer:
      type: cognito_user_pools
      providerARNs:
        - !Sub "arn:aws:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/${CognitoUserPoolId}"
      identitySource: "$request.header.Authorization"
```

#### 端点安全配置

- **公开端点**: `/edge-probe` (无需认证)
- **需认证**: 所有业务端点 (`security: [CognitoAuthorizer: []]`)

#### JWT Claims

Lambda 可从 `event.requestContext.authorizer.claims` 获取:

```json
{
  "sub": "us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "email": "user@example.com",
  "cognito:username": "user123",
  "aud": "client-id",
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxx",
  "exp": 1729670400
}
```

---

## 2. DynamoDB Schema

### 2.1 单表设计原则

- **主键**: `PK` (Partition Key) + `SK` (Sort Key)
- **GSI**: 用于反向查询与任务队列扫描
- **Streams**: 触发 Worker 函数实现异步处理
- **按需计费**: 无需预置容量,自动伸缩

### 2.2 实体类型与键模式

#### Novel (作品)

```
PK: NOVEL#<novelId>
SK: NOVEL#<novelId>

属性:
- id: String (novelId)
- title: String
- originalTextS3: String (S3 key)
- status: String (created|analyzing|analyzed|generating|completed|error)
- storyboardId: String (关联的分镜 ID)
- userId: String (Cognito sub)
- metadata: Map { genre, tags, language }
- createdAt: Number (timestamp 毫秒)
- updatedAt: Number (timestamp 毫秒)

示例:
{
  "PK": "NOVEL#550e8400-e29b-41d4-a716-446655440000",
  "SK": "NOVEL#550e8400-e29b-41d4-a716-446655440000",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "我的奇幻冒险",
  "originalTextS3": "novels/550e8400-xxx/original.txt",
  "status": "analyzed",
  "storyboardId": "story-uuid-xxx",
  "userId": "us-east-1:xxxxx",
  "metadata": {
    "genre": "奇幻",
    "tags": ["冒险", "魔法"]
  },
  "createdAt": 1729420800000,
  "updatedAt": 1729424400000
}
```

#### Character (角色)

```
PK: NOVEL#<novelId>
SK: CHAR#<charId>

属性:
- id: String (charId)
- novelId: String
- name: String
- role: String (protagonist|antagonist|supporting|background)
- baseInfo: Map {
    gender: String,
    age: Number,
    personality: List<String>
  }
- defaultConfigId: String (默认配置 ID)
- createdAt: Number (timestamp)
- updatedAt: Number (timestamp)

示例:
{
  "PK": "NOVEL#550e8400-xxx",
  "SK": "CHAR#char-001",
  "id": "char-001",
  "novelId": "550e8400-xxx",
  "name": "艾莉娅",
  "role": "protagonist",
  "baseInfo": {
    "gender": "female",
    "age": 18,
    "personality": ["勇敢", "善良", "有时冲动"]
  },
  "defaultConfigId": "config-001",
  "createdAt": 1729420800000,
  "updatedAt": 1729424400000
}
```

#### CharacterConfiguration (角色配置)

```
PK: CHAR#<charId>
SK: CONFIG#<configId>

GSI1:
- GSI1PK: CONFIG#<configId>
- GSI1SK: CONFIG#<configId>

属性:
- id: String (configId)
- charId: String
- name: String (配置名称,如"战斗模式")
- description: String (详细文字描述)
- tags: List<String> (标签)
- appearance: Map {
    height: String,
    build: String,
    hairColor: String,
    hairStyle: String,
    eyeColor: String,
    clothing: List<String>,
    accessories: List<String>,
    distinguishingFeatures: List<String>
  }
- referenceImagesS3: List<Map> [
    { s3Key: String, caption: String, uploadedAt: Number }
  ]
- generatedPortraitsS3: List<Map> [
    { view: String, s3Key: String, generatedAt: Number }
  ]
- isDefault: Boolean
- createdAt: Number
- updatedAt: Number

示例:
{
  "PK": "CHAR#char-001",
  "SK": "CONFIG#config-001",
  "GSI1PK": "CONFIG#config-001",
  "GSI1SK": "CONFIG#config-001",
  "id": "config-001",
  "charId": "char-001",
  "name": "战斗模式",
  "description": "艾莉娅穿着银白色铠甲，手持魔法剑，准备战斗。头发扎成战斗马尾，额头的星形印记发光。",
  "tags": ["战斗", "铠甲", "持剑"],
  "appearance": {
    "hairStyle": "战斗马尾",
    "eyeColor": "蓝色",
    "clothing": ["银白色铠甲", "蓝色斗篷", "魔法剑"],
    "accessories": ["头盔", "护腕", "魔法宝石项链"],
    "distinguishingFeatures": ["额头星形印记发光"]
  },
  "referenceImagesS3": [
    {
      "s3Key": "characters/char-001/config-001/ref-001.png",
      "caption": "正面视角-穿着铠甲",
      "uploadedAt": 1729420800000
    },
    {
      "s3Key": "characters/char-001/config-001/ref-002.png",
      "caption": "侧面视角-手持魔法剑",
      "uploadedAt": 1729420900000
    }
  ],
  "generatedPortraitsS3": [
    {
      "view": "front",
      "s3Key": "characters/char-001/config-001/portrait-front.png",
      "generatedAt": 1729424400000
    },
    {
      "view": "side",
      "s3Key": "characters/char-001/config-001/portrait-side.png",
      "generatedAt": 1729424500000
    }
  ],
  "isDefault": true
}
```

#### Storyboard (分镜版本)

```
PK: NOVEL#<novelId>
SK: STORY#<storyboardId>#v<version>

属性:
- id: String (storyboardId)
- novelId: String
- version: Number
- totalPages: Number
- panelCount: Number
- createdAt: Number

示例:
{
  "PK": "NOVEL#550e8400-xxx",
  "SK": "STORY#story-001#v1",
  "id": "story-001",
  "novelId": "550e8400-xxx",
  "version": 1,
  "totalPages": 10,
  "panelCount": 48,
  "createdAt": 1729424400000
}
```

#### Panel (面板)

```
PK: STORY#<storyboardId>
SK: PANEL#<page:04d>#<index:03d>

GSI1:
- GSI1PK: PANEL#<panelId>
- GSI1SK: PANEL#<panelId>

属性:
- id: String (panelId)
- storyboardId: String
- page: Number
- index: Number
- content: Map {
    scene: String,
    shotType: String,
    characters: List<Map>,
    dialogue: List<Map>
  }
- visualPrompt: String
- imagesS3: Map { preview: String, hd: String }
- layout: Map { width, height, x, y }

示例:
{
  "PK": "STORY#story-001",
  "SK": "PANEL#0003#001",
  "GSI1PK": "PANEL#panel-uuid-xxx",
  "GSI1SK": "PANEL#panel-uuid-xxx",
  "id": "panel-uuid-xxx",
  "storyboardId": "story-001",
  "page": 3,
  "index": 1,
  "content": {
    "scene": "森林入口,阳光透过树叶",
    "shotType": "medium",
    "characters": [
      {
        "charId": "char-001",
        "name": "艾莉娅",
        "pose": "站立",
        "expression": "determined"
      }
    ],
    "dialogue": [
      {
        "speaker": "艾莉娅",
        "text": "我们一起去冒险吧!",
        "bubbleType": "speech"
      }
    ]
  },
  "visualPrompt": "manga style, forest entrance, sunlight through trees, medium shot, female character standing with determined expression",
  "imagesS3": {
    "preview": "panels/job-xxx/panel-uuid-xxx-preview.png",
    "hd": "panels/job-xxx/panel-uuid-xxx-hd.png"
  }
}
```

#### Job (任务)

```
PK: JOB#<jobId>
SK: JOB#<jobId>

GSI2:
- GSI2PK: JOB#status#<status>
- GSI2SK: updatedAt (Number)

属性:
- id: String (jobId)
- type: String (analyze|generate_preview|generate_hd|edit|export)
- status: String (pending|in_progress|completed|failed)
- novelId: String (可选,用于关联)
- storyboardId: String (可选)
- progress: Map { total, completed, failed }
- result: Map (依赖类型)
- error: String
- createdAt: Number
- updatedAt: Number

示例:
{
  "PK": "JOB#job-uuid-xxx",
  "SK": "JOB#job-uuid-xxx",
  "GSI2PK": "JOB#status#in_progress",
  "GSI2SK": 1729425000000,
  "id": "job-uuid-xxx",
  "type": "generate_preview",
  "status": "in_progress",
  "novelId": "550e8400-xxx",
  "storyboardId": "story-001",
  "progress": {
    "total": 48,
    "completed": 20,
    "failed": 1
  },
  "createdAt": 1729424800000,
  "updatedAt": 1729425000000
}
```

#### Panel Task (子任务,用于 Streams 触发)

```
PK: JOB#<jobId>
SK: PANEL_TASK#<panelId>

属性:
- panelId: String
- panelData: Map (Panel 内容)
- characterRefs: Map (角色参考图 URI)
- mode: String (preview|hd)
- status: String (pending|in_progress|completed|failed)
- s3Key: String (结果)
- retryCount: Number
- error: String
- createdAt: Number
- updatedAt: Number

示例:
{
  "PK": "JOB#job-uuid-xxx",
  "SK": "PANEL_TASK#panel-uuid-yyy",
  "panelId": "panel-uuid-yyy",
  "panelData": { /* Panel content */ },
  "characterRefs": {
    "char-001": {
      "portraitsGcsUris": ["gs://bucket/char-001/portrait-front.png"]
    }
  },
  "mode": "preview",
  "status": "pending",
  "retryCount": 0,
  "createdAt": 1729424800000
}
```

#### ChangeRequest (修改请求)

```
PK: NOVEL#<novelId>
SK: CR#<crId>

属性:
- id: String (crId)
- novelId: String
- userId: String
- naturalLanguage: String
- dsl: Map (CRDSL)
- status: String (parsing|pending|executing|completed|failed)
- jobId: String
- createdAt: Number
- updatedAt: Number

示例:
{
  "PK": "NOVEL#550e8400-xxx",
  "SK": "CR#cr-uuid-xxx",
  "id": "cr-uuid-xxx",
  "novelId": "550e8400-xxx",
  "userId": "us-east-1:xxxxx",
  "naturalLanguage": "把第 3 页第 2 个面板中艾莉娅的表情改为微笑",
  "dsl": {
    "scope": "panel",
    "targetId": "panel-uuid-xxx",
    "type": "art",
    "ops": [
      {
        "action": "inpaint",
        "params": {
          "region": "face",
          "instruction": "change expression to smile"
        }
      }
    ]
  },
  "status": "completed",
  "jobId": "job-uuid-zzz",
  "createdAt": 1729425200000,
  "updatedAt": 1729425400000
}
```

---

### 2.3 查询模式

| 需求 | 查询方式 |
|------|----------|
| 获取作品详情 | `GetItem(PK=NOVEL#id, SK=NOVEL#id)` |
| 获取作品所有角色 | `Query(PK=NOVEL#id, SK begins_with CHAR#)` |
| 获取角色的所有配置 | `Query(PK=CHAR#id, SK begins_with CONFIG#)` |
| 通过 configId 查配置 | `Query(GSI1, GSI1PK=CONFIG#id)` |
| 获取分镜版本 | `Query(PK=NOVEL#id, SK begins_with STORY#)` |
| 获取分镜的所有面板 | `Query(PK=STORY#id, SK begins_with PANEL#)` |
| 通过 panelId 查面板 | `Query(GSI1, GSI1PK=PANEL#id)` |
| 扫描待处理任务 | `Query(GSI2, GSI2PK=JOB#status#pending, ScanIndexForward=false)` |
| 获取作品的所有 CR | `Query(PK=NOVEL#id, SK begins_with CR#)` |
| 获取任务的所有子任务 | `Query(PK=JOB#id, SK begins_with PANEL_TASK#)` |

**性能优化**:
- 避免 Scan 操作,始终使用 Query
- 利用 `begins_with` 条件进行前缀匹配
- GSI2 用于任务队列扫描,按 `updatedAt` 倒序
- 批量读取使用 `BatchGetItem`,批量写入使用 `BatchWriteItem`

---

### 2.4 Streams 触发规则

**触发条件**: `PANEL_TASK` 插入事件且 `status = pending`

**Worker 函数**: `PanelWorkerFunction`

**处理逻辑**:
1. 过滤 Streams 记录 (`eventName = INSERT`, `SK begins_with PANEL_TASK#`)
2. 读取任务数据 (panelData, characterRefs, mode)
3. 幂等性检查 (基于 `jobId:panelId:mode`)
4. 调用 Imagen API 生成图像
5. 上传 S3
6. 事务性更新: PANEL_TASK 状态 + JOB 进度
7. 失败时指数退避重试 (最多 3 次)

**Streams 配置**:

```yaml
StreamSpecification:
  StreamViewType: NEW_AND_OLD_IMAGES

Lambda Event Source Mapping:
  BatchSize: 10
  MaximumBatchingWindowInSeconds: 1
  StartingPosition: LATEST
  BisectBatchOnFunctionError: true
  MaximumRetryAttempts: 2
```

---

## 3. S3 存储结构

### 3.1 Bucket 命名

```
qnyproj-assets-{environment}

示例:
- qnyproj-assets-dev
- qnyproj-assets-prod
```

### 3.2 目录结构

```
/
├── novels/
│   └── {novelId}/
│       └── original.txt              # 原文 (UTF-8 编码)
│
├── characters/
│   └── {charId}/
│       ├── config-001/               # 配置1 (如"战斗模式")
│       │   ├── ref-001.png           # 用户上传的参考图1
│       │   ├── ref-002.png           # 用户上传的参考图2
│       │   ├── ref-003.png           # 用户上传的参考图3
│       │   ├── portrait-front.png    # AI 生成的标准像 (正面)
│       │   ├── portrait-side.png     # 侧面
│       │   ├── portrait-three-quarter.png  # 四分之三
│       │   └── portrait-45-degree.png      # 45 度
│       │
│       ├── config-002/               # 配置2 (如"日常装扮")
│       │   ├── ref-001.png
│       │   ├── ref-002.png
│       │   └── portrait-front.png
│       │
│       └── config-003/               # 配置3 (如"正式场合")
│           ├── ref-001.png
│           └── portrait-front.png
│
├── panels/
│   └── {jobId}/
│       ├── {panelId}-preview.png     # 预览版 (512x288)
│       └── {panelId}-hd.png          # 高清版 (1920x1080)
│
├── edits/
│   └── {crId}/
│       ├── {panelId}-edit-1.png      # 编辑后的版本 (版本号递增)
│       ├── {panelId}-edit-2.png
│       └── mask-{timestamp}.png      # 遮罩图 (临时)
│
└── exports/
    └── {exportId}/
        ├── comic.pdf                 # PDF 导出
        ├── webtoon.png               # 长图导出 (拼接所有面板)
        └── resources.zip             # 资源包 (PNG + SVG 气泡 + JSON 元数据)
```

**关键变更说明**:
- 每个角色下按 `config-{id}/` 分组存储
- 每个配置独立管理自己的参考图和标准像
- 避免不同配置的图片混淆

### 3.3 对象元数据

**标准元数据**:

```json
{
  "ContentType": "image/png",
  "Metadata": {
    "novel-id": "550e8400-xxx",
    "character-id": "char-001",
    "panel-id": "panel-uuid-xxx",
    "content-type": "portrait|panel|export",
    "version": "1",
    "created-by": "GeneratePortraitFunction",
    "created-at": "2025-10-19T08:00:00Z"
  },
  "Tagging": "Environment=prod&Type=portrait&NovelId=550e8400-xxx"
}
```

**用途**:
- 便于审计与追踪
- 生命周期策略按标签过滤
- 成本分析 (按 NovelId 标签)

---

### 3.4 生命周期策略

```yaml
LifecycleRules:
  # 预览图归档
  - Id: ArchiveOldPreviews
    Status: Enabled
    Filter:
      Prefix: panels/
      Tags:
        - Key: Type
          Value: preview
    Transitions:
      - Days: 30
        StorageClass: STANDARD_IA       # 30 天后转 IA (不常访问)
      - Days: 90
        StorageClass: GLACIER_IR        # 90 天后转 Glacier (即时检索)
  
  # 临时编辑文件自动删除
  - Id: DeleteTempEdits
    Status: Enabled
    Filter:
      Prefix: edits/
      Tags:
        - Key: Type
          Value: temp
    Expiration:
      Days: 7                           # 7 天后自动删除
  
  # 导出文件归档
  - Id: ArchiveExports
    Status: Enabled
    Filter:
      Prefix: exports/
    Transitions:
      - Days: 7
        StorageClass: STANDARD_IA
      - Days: 30
        StorageClass: GLACIER_IR
```

**成本优化**:
- Preview 图短期频繁访问后归档
- 临时文件自动清理
- 导出文件快速归档 (用户下载后通常不再访问)

---

### 3.5 访问模式

#### 写入

Lambda 通过 IAM Role 直接写入:

```javascript
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client();

await s3.send(new PutObjectCommand({
  Bucket: process.env.ASSETS_BUCKET,
  Key: `characters/${charId}/portrait-front.png`,
  Body: imageBuffer,
  ContentType: 'image/png',
  Metadata: {
    'character-id': charId,
    'content-type': 'portrait',
    'view': 'front'
  },
  Tagging: 'Environment=prod&Type=portrait'
}));
```

#### 读取

生成预签名 URL (有效期 15 分钟) 返回给前端:

```javascript
const { S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client();

async function getPresignedUrl(s3Key, expiresIn = 900) {
  const command = new GetObjectCommand({
    Bucket: process.env.ASSETS_BUCKET,
    Key: s3Key
  });
  
  return await getSignedUrl(s3, command, { expiresIn });
}

// 使用
const url = await getPresignedUrl('panels/job-xxx/panel-yyy-hd.png');
// 返回给前端: https://bucket.s3.amazonaws.com/panels/...?AWSAccessKeyId=xxx&Expires=xxx&Signature=xxx
```

#### 公开 URL (可选)

导出文件可选通过 CloudFront 公开分发:

```javascript
// CloudFront 配置
const cloudfrontDomain = 'd1234567890abc.cloudfront.net';
const publicUrl = `https://${cloudfrontDomain}/exports/${exportId}/comic.pdf`;
```

---

## 4. AI API 契约

### 4.1 Qwen API

#### 端点

```
POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
```

#### 认证

```http
Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxx
```

#### 请求格式 (JSON 严格模式)

```json
{
  "model": "qwen-max",
  "messages": [
    {
      "role": "system",
      "content": "你是一个专业的漫画分镜师..."
    },
    {
      "role": "user",
      "content": "从前有一个勇士..."
    }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "storyboard",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "panels": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "page": { "type": "integer" },
                "index": { "type": "integer" },
                "scene": { "type": "string" },
                "characters": { "type": "array" },
                "dialogue": { "type": "array" }
              },
              "required": ["page", "index", "scene"]
            }
          },
          "characters": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "role": { "type": "string" },
                "appearance": { "type": "object" }
              },
              "required": ["name", "role"]
            }
          }
        },
        "required": ["panels", "characters"]
      }
    }
  },
  "temperature": 0.3,
  "max_tokens": 8000
}
```

#### 响应格式

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1729424800,
  "model": "qwen-max",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\"panels\": [...], \"characters\": [...]}"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 500,
    "completion_tokens": 2000,
    "total_tokens": 2500
  }
}
```

#### 错误处理

| 状态码 | 错误 | 处理方式 |
|--------|------|----------|
| 429 | Rate Limit Exceeded | 指数退避重试 (1s → 2s → 4s) |
| 400 | Invalid Request / Schema Error | 调用 `correctJson` 方法纠偏 |
| 401 | Invalid API Key | 返回错误,提示管理员检查 Secret |
| 500 | Internal Server Error | 重试最多 3 次 |

---

### 4.2 Imagen 3 API

#### 服务

Google Cloud Vertex AI - Image Generation API

#### 认证

服务账号 JSON 密钥:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "xxx",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "imagen@your-project.iam.gserviceaccount.com",
  "client_id": "xxx",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

#### 生成图像 (Node.js SDK)

```javascript
const { ImageGenerationClient } = require('@google-cloud/aiplatform');

const client = new ImageGenerationClient({
  projectId: 'your-project-id',
  location: 'us-central1',
  credentials: JSON.parse(gcpSaKey)
});

const request = {
  parent: `projects/your-project-id/locations/us-central1`,
  instances: [
    {
      prompt: "manga style, close-up, character standing",
      negativePrompt: "blurry, low quality, NSFW",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080
    }
  ],
  parameters: {
    sampleCount: 1,
    referenceImages: [
      {
        referenceImage: {
          gcsUri: "gs://bucket/character/portrait-front.png"
        }
      }
    ]
  }
};

const [response] = await client.predict(request);
const image = response.predictions[0];

// 结果
{
  bytesBase64Encoded: "iVBORw0KGgoAAAANSUhEUgAA...",
  mimeType: "image/png",
  safetyAttributes: {
    scores: {
      nsfw: 0.05,
      violence: 0.02
    }
  }
}
```

#### 编辑图像

```javascript
const request = {
  parent: `projects/your-project-id/locations/us-central1`,
  instances: [
    {
      prompt: "change expression to smile",
      image: {
        bytesBase64Encoded: baseImageBase64
      },
      mask: {
        bytesBase64Encoded: maskImageBase64
      },
      editMode: "inpaint"  // 或 "outpaint" | "product"
    }
  ],
  parameters: {
    sampleCount: 1,
    guidanceScale: 8.0
  }
};

const [response] = await client.predict(request);
```

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `bytesBase64Encoded` | String | 图像的 Base64 编码 |
| `mimeType` | String | MIME 类型 (通常是 `image/png`) |
| `safetyAttributes.scores.nsfw` | Float | NSFW 分数 (0-1,越高越危险) |
| `safetyAttributes.scores.violence` | Float | 暴力分数 |

#### 错误处理

| 错误 | 处理方式 |
|------|----------|
| NSFW 检测 | `nsfw > 0.5` 时拒绝,返回错误提示用户修改 prompt |
| API Quota Exceeded | 暂停 1 分钟后重试 |
| Invalid Prompt | 返回错误,提示用户检查 prompt |
| Timeout | 重试最多 2 次 (Imagen 生成较慢,timeout 设置为 60s) |

---

## 5. 运行时校验

### 5.1 Lambda 入参校验 (AJV)

```javascript
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({ allErrors: true, removeAdditional: true });
addFormats(ajv);

// 从 OpenAPI 加载 Schema
const schemas = {
  CreateNovelRequest: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      text: { type: 'string', minLength: 1 }
    }
  },
  // ... 其他 Schema
};

function validateRequest(schemaName, data) {
  const validate = ajv.compile(schemas[schemaName]);
  const valid = validate(data);
  
  if (!valid) {
    const errors = validate.errors.map(err => ({
      field: err.instancePath,
      message: err.message
    }));
    throw new ValidationError('Request validation failed', errors);
  }
}

// 使用示例
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    
    validateRequest('CreateNovelRequest', body);
    
    // ... 业务逻辑
    
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Validation Error',
          details: error.details
        })
      };
    }
    throw error;
  }
};

class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}
```

### 5.2 DynamoDB 写入前校验

```javascript
function validateNovelItem(item) {
  assert(item.PK.startsWith('NOVEL#'), 'Invalid PK for Novel');
  assert(item.SK.startsWith('NOVEL#'), 'Invalid SK for Novel');
  assert(item.SK === item.PK, 'PK and SK must be identical for Novel');
  assert(['created', 'analyzing', 'analyzed', 'generating', 'completed', 'error'].includes(item.status), 'Invalid status');
  assert(typeof item.createdAt === 'number', 'createdAt must be a number');
}

function validatePanelItem(item) {
  assert(item.PK.startsWith('STORY#'), 'Invalid PK for Panel');
  assert(item.SK.startsWith('PANEL#'), 'Invalid SK for Panel');
  assert(/^PANEL#\d{4}#\d{3}$/.test(item.SK), 'Invalid SK format for Panel');
  assert(typeof item.page === 'number' && item.page >= 1, 'Invalid page number');
  assert(typeof item.index === 'number' && item.index >= 0, 'Invalid index');
}
```

### 5.3 S3 对象验证

```javascript
async function validateImage(s3Key) {
  const { Body, ContentType } = await s3.send(new GetObjectCommand({
    Bucket: process.env.ASSETS_BUCKET,
    Key: s3Key
  }));
  
  // 检查 MIME 类型
  assert(['image/png', 'image/jpeg'].includes(ContentType), 'Invalid content type');
  
  // 检查文件大小
  const buffer = await streamToBuffer(Body);
  assert(buffer.length < 10 * 1024 * 1024, 'File size exceeds 10MB');
  
  // 使用 sharp 检查图像尺寸
  const metadata = await sharp(buffer).metadata();
  assert(metadata.width >= 512 && metadata.width <= 4096, 'Invalid width');
  assert(metadata.height >= 288 && metadata.height <= 4096, 'Invalid height');
  
  return true;
}
```

---

## 6. 版本控制与迁移

### 6.1 OpenAPI 版本

- **当前版本**: `v1.0`
- **版本策略**: 语义化版本控制 (Semantic Versioning)
  - **Major** (v2.0): 破坏性变更 (删除端点/字段,修改响应结构)
  - **Minor** (v1.1): 新增功能 (新增端点/字段,向后兼容)
  - **Patch** (v1.0.1): Bug 修复 (不影响 API 契约)

- **向后兼容原则**:
  - 保留已废弃字段,标记 `deprecated: true`
  - 新增字段使用 `required: false`
  - 旧端点重定向到新端点 (使用 API Gateway stage variables)

**示例** (废弃字段):

```yaml
Character:
  properties:
    portraitsS3:
      type: array
      deprecated: true
      description: 已废弃,请使用 portraits 字段
    
    portraits:
      type: array
      items:
        type: object
        properties:
          view:
            type: string
          url:
            type: string
      description: 新版标准像结构
```

### 6.2 DynamoDB Schema 迁移

**迁移策略**:
1. 创建迁移脚本 (Lambda 函数)
2. 扫描表中所有受影响的项
3. 批量更新 (使用 `BatchWriteItem`)
4. 记录迁移日志到 CloudWatch

**迁移脚本示例** (添加新字段):

```javascript
// migrations/add-portraits-field.js
const { DynamoDBClient, ScanCommand, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient();

async function migrate() {
  console.log('Starting migration: add portraits field to Character items');
  
  let lastEvaluatedKey = null;
  let migratedCount = 0;
  
  do {
    // 扫描所有 Character 项
    const scanResult = await dynamodb.send(new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(SK, :char)',
      ExpressionAttributeValues: {
        ':char': { S: 'CHAR#' }
      },
      ExclusiveStartKey: lastEvaluatedKey
    }));
    
    const itemsToUpdate = scanResult.Items
      .filter(item => !item.portraits); // 只处理没有新字段的项
    
    if (itemsToUpdate.length > 0) {
      // 批量更新 (每批最多 25 项)
      for (let i = 0; i < itemsToUpdate.length; i += 25) {
        const batch = itemsToUpdate.slice(i, i + 25);
        
        await dynamodb.send(new BatchWriteItemCommand({
          RequestItems: {
            [process.env.TABLE_NAME]: batch.map(item => ({
              PutRequest: {
                Item: {
                  ...item,
                  portraits: {
                    L: (item.portraitsS3?.L || []).map(s3Key => ({
                      M: {
                        view: { S: extractView(s3Key.S) },
                        s3Key: { S: s3Key.S }
                      }
                    }))
                  }
                }
              }
            }))
          }
        }));
        
        migratedCount += batch.length;
        console.log(`Migrated ${migratedCount} items`);
      }
    }
    
    lastEvaluatedKey = scanResult.LastEvaluatedKey;
    
  } while (lastEvaluatedKey);
  
  console.log(`Migration completed. Total migrated: ${migratedCount}`);
}

function extractView(s3Key) {
  // 从 "characters/char-001/portrait-front.png" 提取 "front"
  const match = s3Key.match(/portrait-(\w+)\.png$/);
  return match ? match[1] : 'unknown';
}

// 执行迁移
migrate().catch(console.error);
```

### 6.3 S3 目录重构

**场景**: 将 `panels/{jobId}/{panelId}-{mode}.png` 重构为 `panels/{novelId}/{storyboardId}/{panelId}-{mode}.png`

**步骤**:

1. **双写期** (1 周):
   - 新生成的面板同时写入旧路径和新路径
   - DynamoDB 保存两个 S3 Key

2. **迁移期** (1 周):
   - 后台任务扫描所有 Panel 项
   - 使用 S3 CopyObject 复制到新路径
   - 更新 DynamoDB Panel 项的 `imagesS3` 字段

3. **清理期** (1 周):
   - 删除旧路径的对象 (使用 S3 Batch Operations)
   - 从 DynamoDB 移除旧路径字段

**S3 Batch Operations**:

```yaml
Job:
  Operation: S3DeleteObject
  Report:
    Bucket: qnyproj-logs
    Prefix: s3-batch-delete-old-panels/
  Manifest:
    Spec:
      Format: S3InventoryReport_CSV_20211130
    Location:
      ObjectArn: arn:aws:s3:::qnyproj-inventory/old-panels-manifest.csv
```

---

## 7. 测试数据集

### 7.1 Mock 数据 (开发环境)

#### mock-novel.json

```json
{
  "id": "novel-001",
  "title": "测试小说 - 勇士的冒险",
  "originalText": "从前有一个勇士,名叫雷恩。他生活在一个和平的村庄...",
  "originalTextS3": "novels/novel-001/original.txt",
  "status": "analyzed",
  "storyboardId": "story-001",
  "userId": "us-east-1:test-user-001",
  "metadata": {
    "genre": "奇幻",
    "tags": ["冒险", "魔法"],
    "language": "zh-CN"
  },
  "createdAt": 1729420800000,
  "updatedAt": 1729424400000
}
```

#### mock-storyboard.json

```json
{
  "id": "story-001",
  "novelId": "novel-001",
  "version": 1,
  "totalPages": 2,
  "panelCount": 8,
  "panels": [
    {
      "id": "panel-001",
      "storyboardId": "story-001",
      "page": 1,
      "index": 0,
      "content": {
        "scene": "村庄广场,清晨,阳光洒在石板路上",
        "shotType": "wide",
        "characters": [
          {
            "charId": "char-001",
            "name": "雷恩",
            "pose": "站在广场中央,环顾四周",
            "expression": "peaceful",
            "position": "center"
          }
        ],
        "dialogue": [
          {
            "speaker": "雷恩",
            "text": "又是美好的一天。",
            "bubbleType": "thought"
          }
        ],
        "visualPrompt": "manga style, village square, morning light, wide shot, male character standing in center with peaceful expression, stone pavement, buildings in background"
      },
      "imagesS3": {
        "preview": "panels/job-001/panel-001-preview.png",
        "hd": "panels/job-001/panel-001-hd.png"
      },
      "layout": {
        "width": 1.0,
        "height": 0.5,
        "x": 0,
        "y": 0
      }
    },
    {
      "id": "panel-002",
      "storyboardId": "story-001",
      "page": 1,
      "index": 1,
      "content": {
        "scene": "森林入口,树影斑驳",
        "shotType": "medium",
        "characters": [
          {
            "charId": "char-001",
            "name": "雷恩",
            "pose": "准备出发,右手按在剑柄上",
            "expression": "determined",
            "position": "center"
          }
        ],
        "dialogue": [
          {
            "speaker": "雷恩",
            "text": "是时候开始我的冒险了!",
            "bubbleType": "speech"
          }
        ],
        "visualPrompt": "manga style, forest entrance, dappled shadows, medium shot, warrior character with determined expression, hand on sword hilt"
      },
      "imagesS3": {
        "preview": "panels/job-001/panel-002-preview.png",
        "hd": "panels/job-001/panel-002-hd.png"
      }
    }
    // ... 更多面板
  ],
  "createdAt": 1729424400000
}
```

#### mock-character.json

```json
{
  "id": "char-001",
  "name": "雷恩",
  "role": "protagonist",
  "novelId": "novel-001",
  "appearance": {
    "gender": "male",
    "age": 25,
    "height": "高大",
    "build": "强壮",
    "hairColor": "棕色",
    "hairStyle": "短发",
    "eyeColor": "蓝色",
    "skinTone": "健康的小麦色",
    "clothing": ["皮甲", "长剑", "旅行斗篷"],
    "distinguishingFeatures": ["左臂有伤疤"]
  },
  "personality": ["勇敢", "正直", "有时冲动"],
  "portraits": [
    {
      "view": "front",
      "url": "https://bucket.s3.amazonaws.com/characters/char-001/portrait-front.png?..."
    },
    {
      "view": "side",
      "url": "https://bucket.s3.amazonaws.com/characters/char-001/portrait-side.png?..."
    }
  ]
}
```

### 7.2 合约测试 Fixtures

#### dredd.yml

```yaml
# Dredd 配置文件
reporter:
  - cli
  - html
loglevel: info
path: []
blueprint: openapi.yaml
endpoint: http://localhost:3000

hooks:
  beforeAll:
    - ./dredd-hooks.js > setupMockAuth

  before:
    - ./dredd-hooks.js > injectAuthToken

only:
  - "Novels > Create Novel"
  - "Novels > Analyze Novel"
  - "Jobs > Get Job Status"
```

#### dredd-hooks.js

```javascript
const hooks = require('hooks');

const MOCK_JWT_TOKEN = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ...';

hooks.beforeAll((transactions, done) => {
  console.log('Setting up mock authentication');
  // 可选: 启动本地 Mock Cognito
  done();
});

hooks.beforeEach((transaction, done) => {
  // 为所有需要认证的请求注入 Token
  if (transaction.request.headers['Authorization']) {
    transaction.request.headers['Authorization'] = `Bearer ${MOCK_JWT_TOKEN}`;
  }
  done();
});

hooks.before('Novels > Create Novel', (transaction, done) => {
  // 自定义请求体
  transaction.request.body = JSON.stringify({
    title: '测试小说',
    text: '从前有一个勇士...'
  });
  done();
});

hooks.after('Novels > Create Novel', (transaction, done) => {
  // 验证响应
  const body = JSON.parse(transaction.real.body);
  
  if (!body.id || !body.title) {
    done(new Error('Response missing required fields'));
  } else {
    // 保存 novelId 供后续测试使用
    hooks.novelId = body.id;
    done();
  }
});

hooks.before('Novels > Analyze Novel', (transaction, done) => {
  // 使用之前创建的 novelId
  transaction.fullPath = transaction.fullPath.replace('{id}', hooks.novelId);
  done();
});
```

---

## 附录: 常用查询语句

### A.1 查询用户的所有作品

```javascript
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamodb = new DynamoDBClient();

async function queryNovelsByUser(userId) {
  const result = await dynamodb.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI-UserIndex', // 假设创建了 userId 索引
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: {
      ':uid': { S: userId }
    }
  }));
  
  return result.Items.map(item => unmarshall(item));
}
```

### A.2 批量获取面板

```javascript
async function getPanelsBatch(panelIds) {
  const { BatchGetItemCommand } = require('@aws-sdk/client-dynamodb');
  
  const result = await dynamodb.send(new BatchGetItemCommand({
    RequestItems: {
      [process.env.TABLE_NAME]: {
        Keys: panelIds.map(id => ({
          PK: { S: 'STORY#story-001' },
          SK: { S: `PANEL#${id}` }
        }))
      }
    }
  }));
  
  return result.Responses[process.env.TABLE_NAME].map(item => unmarshall(item));
}
```

### A.3 扫描待处理任务

```javascript
async function getPendingJobs(limit = 10) {
  const result = await dynamodb.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: 'JOB#status#pending' }
    },
    ScanIndexForward: false, // 按 updatedAt 倒序
    Limit: limit
  }));
  
  return result.Items.map(item => unmarshall(item));
}
```

---

**文档维护**: 本文档应随系统演进持续更新。每次 API 变更、Schema 调整时,请同步更新。

**最后更新**: 2025-10-19

