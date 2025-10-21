# 系统架构文档

## 1. 架构概览

### 1.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      GitHub Pages (SPA)                         │
│              React 19 + TypeScript + Vite                       │
│  - 作品管理  - 分镜编辑  - 漫画画布  - Swagger UI              │
└───────────────────────┬─────────────────────────────────────────┘
                        │ HTTPS + Cognito JWT
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              API Gateway (Edge-Optimized + CDN)                 │
│                    Cognito Authorizer                           │
└───────┬───────────┬──────────┬──────────┬──────────────────────┘
        │           │          │          │
        ▼           ▼          ▼          ▼
   ┌────────┐ ┌─────────┐ ┌────────┐ ┌──────────┐
   │Analyze │ │Generate │ │  Edit  │ │  Change  │  
   │ Lambda │ │ Lambda  │ │ Lambda │ │  Lambda  │  ... 更多 Lambda
   └────┬───┘ └────┬────┘ └───┬────┘ └────┬─────┘
        │          │           │           │
        └──────────┴───────────┴───────────┘
                   │                │
        ┌──────────▼────────────┐   │
        │  DynamoDB Single Table│   │
        │  - Novel/Story/Panel  │   │
        │  - Character/Job/CR   │   │
        │  + Streams Worker     │   │
        └───────────────────────┘   │
                   │                │
        ┌──────────▼────────────────▼────┐
        │         S3 Bucket              │
        │  /novels/  /characters/        │
        │  /panels/  /exports/           │
        └────────────────────────────────┘
                   │
        ┌──────────┴────────────┐
        │    External AI APIs    │
        │  - Qwen (文本解析)     │
        │  - Imagen 3 (图像生成) │
        └────────────────────────┘
```

### 1.2 技术栈选型理由

#### 前端: React 19 + Vite 7 + TypeScript 5

**选择理由:**
- **React 19**: 最新的并发特性,提升复杂 UI 渲染性能
- **Vite 7**: 极速的 HMR (热模块替换),开发体验优秀
- **TypeScript 5**: 强类型系统,与 OpenAPI 生成的类型无缝集成
- **GitHub Pages**: 零成本托管,自动 HTTPS,全球 CDN

#### 后端: Node.js 18 Lambda + API Gateway EDGE

**选择理由:**
- **Lambda**: 按需付费,自动伸缩,无需维护服务器
- **Node.js 18**: 与前端同构,共享类型定义,生态丰富
- **API Gateway EDGE**: CloudFront 边缘优化,全球低延迟
- **aws_proxy 集成**: 无缝传递 HTTP 请求,简化开发

#### 存储: DynamoDB 单表 + S3 分层

**DynamoDB 单表设计:**
- **优势**: 单次查询获取关联数据,成本更低
- **访问模式**: 预先设计 PK/SK 与 GSI,支持所有查询需求
- **Streams**: 触发异步 Worker,实现批量并发

**S3 分层存储:**
- **原文/参考图**: Standard (频繁访问)
- **预览图**: Standard → IA (30 天) → Glacier (90 天)
- **临时编辑**: 7 天自动删除
- **导出文件**: CloudFront CDN 加速下载

#### AI 服务: Qwen + Imagen 3

**Qwen (阿里云 DashScope):**
- **OpenAI 兼容接口**: 无缝迁移,生态工具支持
- **JSON 严格模式**: 确保输出符合 Schema,减少后处理
- **中文优化**: 对中文小说理解能力强
- **成本**: 相比 GPT-4 更低,适合批量处理

**Gemini Imagen (Google Vertex AI):**
- **参考图一致性**: 支持多张参考图,角色一致性好
- **编辑能力**: 支持 edit_image 功能进行图像编辑
- **分辨率**: 支持高清输出

#### 认证: Cognito OIDC

**选择理由:**
- **无服务器**: 完全托管,自动伸缩
- **标准协议**: OIDC/OAuth2,与 API Gateway 原生集成
- **社交登录**: 可扩展支持 Google/GitHub 登录
- **JWT**: 无状态认证,适合 Serverless 架构

### 1.3 设计原则

1. **OpenAPI 作为唯一事实来源**
   - 所有 API 定义在 `openapi.template.yaml`
   - 前端类型自动生成,避免类型不一致
   - Swagger UI 文档与实现同步

2. **类型安全的端到端开发**
   - OpenAPI → TypeScript 类型 → React 组件
   - AJV/Zod 运行时校验 Lambda 入参/出参
   - DynamoDB 项结构通过 TypeScript interface 约束

3. **Serverless 优先**
   - 无服务器管理,专注业务逻辑
   - 按需付费,初期成本极低
   - 自动伸缩,应对流量突增

4. **边缘优化**
   - API Gateway EDGE + CloudFront CDN
   - S3 预签名 URL 直连,减少 Lambda 流量
   - 静态资源 (前端) 通过 GitHub Pages CDN 分发

---

## 2. 核心业务流程

### 2.1 文本分析流程

**端点**: `POST /novels/{id}/analyze`

**Lambda 函数**: `AnalyzeNovelFunction`

**完整伪代码**:

```javascript
const QwenAdapter = require('../lib/qwen-adapter');
const { DynamoDBClient, PutItemCommand, TransactWriteItemsCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const Ajv = require('ajv');
const { v4: uuid } = require('uuid');

const qwen = new QwenAdapter(process.env.QWEN_API_KEY);
const dynamodb = new DynamoDBClient();
const s3 = new S3Client();
const ajv = new Ajv();

const STORYBOARD_SCHEMA = require('../schemas/storyboard.json');

exports.handler = async (event) => {
  const { id: novelId } = event.pathParameters;
  const userId = event.requestContext.authorizer.claims.sub;
  
  try {
    // 1. 获取小说原文
    const novel = await getNovel(novelId, userId);
    if (!novel) {
      return errorResponse(404, 'Novel not found');
    }
    
    const text = await getTextFromS3(novel.originalTextS3);
    
    // 2. 文本预处理与切片
    const chunks = splitTextIntelligently(text, MAX_CHUNK_SIZE);
    console.log(`Split into ${chunks.length} chunks`);
    
    // 3. 并行调用 Qwen API 生成分镜
    const qwenResponses = await Promise.all(
      chunks.map((chunk, idx) => 
        qwenAdapter.generateStoryboard({
          text: chunk,
          chunkIndex: idx,
          totalChunks: chunks.length,
          jsonSchema: STORYBOARD_SCHEMA,
          strictMode: true
        }).catch(err => {
          console.error(`Chunk ${idx} failed:`, err);
          return null; // 容错,继续处理其他分片
        })
      )
    );
    
    // 4. 合并与去重
    const mergedStoryboard = mergeStoryboards(
      qwenResponses.filter(r => r !== null)
    );
    
    // 5. Schema 校验
    const validate = ajv.compile(STORYBOARD_SCHEMA);
    let validationResult = validate(mergedStoryboard);
    
    if (!validationResult) {
      console.warn('Schema validation failed, attempting correction...');
      console.error(validate.errors);
      
      // 6. Schema 纠偏重试
      mergedStoryboard = await qwenAdapter.correctJson(
        mergedStoryboard, 
        validate.errors
      );
      
      // 再次校验
      validationResult = validate(mergedStoryboard);
      if (!validationResult) {
        throw new Error('Failed to correct JSON schema');
      }
    }
    
    // 7. 提取角色圣经
    const characterBible = extractCharacters(mergedStoryboard);
    console.log(`Extracted ${characterBible.length} characters`);
    
    // 8. 生成唯一 ID
    const storyboardId = uuid();
    const charIds = characterBible.map(() => uuid());
    
    // 9. 写入 DynamoDB (事务性)
    await dynamodb.send(new TransactWriteItemsCommand({
      TransactItems: [
        // 更新 Novel 状态
        {
          Update: {
            TableName: process.env.TABLE_NAME,
            Key: {
              PK: { S: `NOVEL#${novelId}` },
              SK: { S: `NOVEL#${novelId}` }
            },
            UpdateExpression: 'SET #status = :analyzed, #storyboardId = :sid, updatedAt = :now',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#storyboardId': 'storyboardId'
            },
            ExpressionAttributeValues: {
              ':analyzed': { S: 'analyzed' },
              ':sid': { S: storyboardId },
              ':now': { N: Date.now().toString() }
            }
          }
        },
        // 插入 Storyboard
        {
          Put: {
            TableName: process.env.TABLE_NAME,
            Item: {
              PK: { S: `NOVEL#${novelId}` },
              SK: { S: `STORY#${storyboardId}#v1` },
              id: { S: storyboardId },
              novelId: { S: novelId },
              version: { N: '1' },
              totalPages: { N: mergedStoryboard.totalPages.toString() },
              panelCount: { N: mergedStoryboard.panels.length.toString() },
              createdAt: { N: Date.now().toString() }
            }
          }
        },
        // 插入所有 Panel
        ...mergedStoryboard.panels.map((panel, idx) => ({
          Put: {
            TableName: process.env.TABLE_NAME,
            Item: {
              PK: { S: `STORY#${storyboardId}` },
              SK: { S: `PANEL#${panel.page.toString().padStart(4, '0')}#${panel.index.toString().padStart(3, '0')}` },
              GSI1PK: { S: `PANEL#${uuid()}` },
              GSI1SK: { S: `PANEL#${uuid()}` },
              id: { S: uuid() },
              storyboardId: { S: storyboardId },
              page: { N: panel.page.toString() },
              index: { N: panel.index.toString() },
              content: { M: marshalPanel(panel.content) },
              visualPrompt: { S: panel.visualPrompt }
            }
          }
        })),
        // 插入所有 Character
        ...characterBible.map((char, idx) => ({
          Put: {
            TableName: process.env.TABLE_NAME,
            Item: {
              PK: { S: `NOVEL#${novelId}` },
              SK: { S: `CHAR#${charIds[idx]}` },
              id: { S: charIds[idx] },
              novelId: { S: novelId },
              name: { S: char.name },
              role: { S: char.role },
              appearance: { M: marshalAppearance(char.appearance) },
              personality: { L: char.personality.map(p => ({ S: p })) }
            }
          }
        }))
      ]
    }));
    
    // 10. 返回结果
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        storyboardId,
        version: 1,
        totalPages: mergedStoryboard.totalPages,
        panelCount: mergedStoryboard.panels.length,
        characters: charIds.map((id, idx) => ({
          id,
          name: characterBible[idx].name
        }))
      })
    };
    
  } catch (error) {
    console.error('AnalyzeNovel error:', error);
    
    // 更新 Novel 状态为 error
    await updateNovelStatus(novelId, 'error', error.message);
    
    return errorResponse(500, error.message);
  }
};

// 辅助函数
function splitTextIntelligently(text, maxLength) {
  // 按段落/章节智能切片
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let currentChunk = '';
  
  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxLength) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = para;
    } else {
      currentChunk += '\n\n' + para;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

function mergeStoryboards(storyboards) {
  // 合并多个分镜,处理页码连续性
  let mergedPanels = [];
  let currentPage = 1;
  
  for (const sb of storyboards) {
    for (const panel of sb.panels) {
      mergedPanels.push({
        ...panel,
        page: currentPage + Math.floor(mergedPanels.length / PANELS_PER_PAGE)
      });
    }
  }
  
  return {
    panels: mergedPanels,
    totalPages: Math.ceil(mergedPanels.length / PANELS_PER_PAGE)
  };
}

function extractCharacters(storyboard) {
  // 从分镜中提取并去重角色
  const charMap = new Map();
  
  for (const panel of storyboard.panels) {
    for (const char of panel.content.characters || []) {
      if (!charMap.has(char.name)) {
        charMap.set(char.name, {
          name: char.name,
          role: inferRole(char),
          appearance: char.appearance,
          personality: char.personality || []
        });
      }
    }
  }
  
  return Array.from(charMap.values());
}
```

**涉及资源**:
- **DynamoDB**: `NOVEL#`, `STORY#`, `PANEL#`, `CHAR#` 项
- **Qwen API**: `/chat/completions` (JSON 严格模式)
- **S3**: 读取原文 (`novels/{novelId}/original.txt`)

**错误处理**:
- Qwen API 429 (Rate Limit) → 指数退避重试
- Schema 校验失败 → 自动调用 `correctJson`
- 部分分片失败 → 容错处理,使用成功的分片

---

### 2.2 角色标准像生成 (基于配置)

**端点**: `POST /characters/{charId}/configurations/{configId}/portraits`

**Lambda 函数**: `GenerateConfigPortraitsFunction`

**说明**: 为角色的**指定配置**生成多视角标准像。每个配置有独立的参考图和生成的标准像。

**完整伪代码**:

```javascript
const ImagenAdapter = require('../lib/imagen-adapter');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

const imagen = new ImagenAdapter(
  process.env.GCP_SA_KEY,
  process.env.GCP_PROJECT_ID,
  process.env.GCP_LOCATION
);
const s3 = new S3Client();
const dynamodb = new DynamoDBClient();

const PORTRAIT_VIEWS = ['front', 'side', 'three-quarter', '45-degree'];
const NEGATIVE_PROMPT = 'blurry, low quality, multiple people, NSFW, deformed';

exports.handler = async (event) => {
  const { charId, configId } = event.pathParameters;
  const userId = event.requestContext.authorizer.claims.sub;
  
  try {
    // 1. 获取角色配置数据
    const config = await getCharacterConfig(charId, configId, userId);
    if (!config) {
      return errorResponse(404, 'Configuration not found');
    }
    
    // 2. 组装该配置的 prompt
    const basePrompt = buildCharacterPrompt(config);
    console.log(`Base prompt for config "${config.name}":`, basePrompt);
    
    // 3. 如果该配置有参考图,先上传到 GCS
    let referenceImages = [];
    if (config.referenceImagesS3 && config.referenceImagesS3.length > 0) {
      referenceImages = await Promise.all(
        config.referenceImagesS3.map(async (refObj) => {
          const imageBuffer = await getS3Object(refObj.s3Key);
          const gcsUri = await imagen.uploadToGCS(imageBuffer, `${charId}-${configId}-ref`);
          return gcsUri;
        })
      );
      
      console.log(`Uploaded ${referenceImages.length} reference images to GCS`);
    }
    
    // 4. 并行生成多视角标准像
    const portraitPromises = PORTRAIT_VIEWS.map(async (view) => {
      const fullPrompt = `${basePrompt}, ${view} view, character reference sheet style`;
      
      console.log(`Generating ${view} portrait...`);
      
      const image = await imagen.generate({
        prompt: fullPrompt,
        referenceImages: referenceImages,
        mode: 'hd',
        aspectRatio: '1:1',
        negativePrompt: NEGATIVE_PROMPT,
        numberOfImages: 1
      });
      
      return {
        view,
        buffer: image.buffer,
        mimeType: image.mimeType
      };
    });
    
    const portraits = await Promise.all(portraitPromises);
    
    // 5. 上传到 S3 (按配置分组)
    const s3Keys = await Promise.all(
      portraits.map(async (portrait) => {
        const s3Key = `characters/${charId}/${configId}/portrait-${portrait.view}.png`;
        
        await s3.send(new PutObjectCommand({
          Bucket: process.env.ASSETS_BUCKET,
          Key: s3Key,
          Body: portrait.buffer,
          ContentType: 'image/png',
          Metadata: {
            'character-id': charId,
            'view': portrait.view,
            'content-type': 'portrait',
            'created-by': 'GeneratePortraitFunction'
          },
          Tagging: 'Environment=prod&Type=portrait'
        }));
        
        return {
          view: portrait.view,
          s3Key: s3Key,
          url: await getPresignedUrl(s3Key, 900) // 15 分钟有效期
        };
      })
    );
    
    // 6. 更新 DynamoDB 配置项 (不是角色项)
    await dynamodb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: { S: `CHAR#${charId}` },
        SK: { S: `CONFIG#${configId}` }
      },
      UpdateExpression: 'SET generatedPortraitsS3 = :portraits, updatedAt = :now',
      ExpressionAttributeValues: {
        ':portraits': { L: s3Keys.map(k => ({ M: {
          view: { S: k.view },
          s3Key: { S: k.s3Key },
          generatedAt: { N: Date.now().toString() }
        }})) },
        ':now': { N: Date.now().toString() }
      }
    }));
    
    // 7. 返回结果
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        charId,
        portraits: s3Keys
      })
    };
    
  } catch (error) {
    console.error('GeneratePortrait error:', error);
    return errorResponse(500, error.message);
  }
};

// 辅助函数
function buildCharacterPrompt(config) {
  const { name, description, appearance } = config;
  
  let prompt = `manga style character, ${role}, `;
  
  if (appearance.gender) prompt += `${appearance.gender}, `;
  if (appearance.age) prompt += `age ${appearance.age}, `;
  if (appearance.build) prompt += `${appearance.build} build, `;
  if (appearance.hairColor && appearance.hairStyle) {
    prompt += `${appearance.hairColor} ${appearance.hairStyle} hair, `;
  }
  if (appearance.eyeColor) prompt += `${appearance.eyeColor} eyes, `;
  if (appearance.clothing && appearance.clothing.length > 0) {
    prompt += `wearing ${appearance.clothing.join(', ')}, `;
  }
  
  prompt += 'high quality, detailed, consistent style, white background';
  
  return prompt;
}
```

**性能优化**:
- 4 个视角并行生成,总耗时约 30-45 秒
- 使用参考图提高一致性 (如果用户上传)
- S3 对象带标签,便于生命周期管理

---

### 2.3 面板批量生成 (预览/高清)

**端点**: `POST /storyboards/{id}/generate?mode=preview|hd`

**Lambda 函数**: `GeneratePanelsFunction` (主) + `PanelWorkerFunction` (Worker)

**主函数伪代码**:

```javascript
const { DynamoDBClient, QueryCommand, PutItemCommand, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');
const { v4: uuid } = require('uuid');

const dynamodb = new DynamoDBClient();

exports.handler = async (event) => {
  const { id: storyboardId } = event.pathParameters;
  const { mode } = event.queryStringParameters || { mode: 'preview' };
  const userId = event.requestContext.authorizer.claims.sub;
  
  if (!['preview', 'hd'].includes(mode)) {
    return errorResponse(400, 'Invalid mode. Must be preview or hd.');
  }
  
  try {
    // 1. 查询分镜的所有面板
    const panelsResult = await dynamodb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': { S: `STORY#${storyboardId}` },
        ':sk': { S: 'PANEL#' }
      }
    }));
    
    const panels = panelsResult.Items;
    console.log(`Found ${panels.length} panels`);
    
    // 2. 查询角色数据 (用于参考图)
    const novelId = await getNovelIdFromStoryboard(storyboardId);
    const characters = await queryCharacters(novelId);
    
    // 3. 创建任务项
    const jobId = uuid();
    await dynamodb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: { S: `JOB#${jobId}` },
        SK: { S: `JOB#${jobId}` },
        GSI2PK: { S: `JOB#status#pending` },
        GSI2SK: { N: Date.now().toString() },
        id: { S: jobId },
        type: { S: mode === 'preview' ? 'generate_preview' : 'generate_hd' },
        status: { S: 'pending' },
        novelId: { S: novelId },
        storyboardId: { S: storyboardId },
        progress: {
          M: {
            total: { N: panels.length.toString() },
            completed: { N: '0' },
            failed: { N: '0' }
          }
        },
        createdAt: { N: Date.now().toString() },
        updatedAt: { N: Date.now().toString() }
      }
    }));
    
    // 4. 批量写入面板任务 (触发 DynamoDB Streams)
    const batchSize = 25; // DynamoDB BatchWrite 限制
    for (let i = 0; i < panels.length; i += batchSize) {
      const batch = panels.slice(i, i + batchSize);
      
      await dynamodb.send(new BatchWriteItemCommand({
        RequestItems: {
          [process.env.TABLE_NAME]: batch.map(panel => ({
            PutRequest: {
              Item: {
                PK: { S: `JOB#${jobId}` },
                SK: { S: `PANEL_TASK#${panel.id.S}` },
                panelId: { S: panel.id.S },
                panelData: { M: panel.content.M },
                characterRefs: { M: buildCharacterRefs(panel, characters) },
                mode: { S: mode },
                status: { S: 'pending' },
                retryCount: { N: '0' },
                createdAt: { N: Date.now().toString() }
              }
            }
          }))
        }
      }));
    }
    
    // 5. 返回任务 ID
    return {
      statusCode: 202, // Accepted
      headers: corsHeaders(),
      body: JSON.stringify({
        jobId,
        status: 'pending',
        totalPanels: panels.length,
        message: 'Panel generation started. Use GET /jobs/{jobId} to check progress.'
      })
    };
    
  } catch (error) {
    console.error('GeneratePanels error:', error);
    return errorResponse(500, error.message);
  }
};
```

**Worker 函数伪代码** (由 DynamoDB Streams 触发):

```javascript
const ImagenAdapter = require('../lib/imagen-adapter');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, UpdateItemCommand, TransactWriteItemsCommand } = require('@aws-sdk/client-dynamodb');

const imagen = new ImagenAdapter(/* ... */);
const s3 = new S3Client();
const dynamodb = new DynamoDBClient();

exports.handler = async (event) => {
  const records = event.Records.filter(
    r => r.eventName === 'INSERT' && r.dynamodb.NewImage.SK.S.startsWith('PANEL_TASK#')
  );
  
  console.log(`Processing ${records.length} panel tasks`);
  
  for (const record of records) {
    const task = unmarshall(record.dynamodb.NewImage);
    
    // 跳过非 pending 状态的任务
    if (task.status !== 'pending') continue;
    
    // 幂等性检查 (基于 jobId:panelId:mode)
    const idempotencyKey = `${task.PK.replace('JOB#', '')}:${task.panelId}:${task.mode}`;
    if (await checkIdempotency(idempotencyKey)) {
      console.log(`Task ${idempotencyKey} already processed, skipping`);
      continue;
    }
    
    try {
      // 1. 标记为 in_progress
      await updateTaskStatus(task.PK, task.SK, 'in_progress');
      
      // 2. 构建 prompt
      const prompt = buildPanelPrompt(task.panelData, task.characterRefs);
      console.log(`Panel ${task.panelId} prompt:`, prompt);
      
      // 3. 调用 Imagen 3
      const aspectRatio = task.mode === 'preview' ? '16:9' : '16:9'; // 可根据需求调整
      const image = await imagen.generate({
        prompt: prompt.text,
        referenceImages: prompt.characterRefUris,
        mode: task.mode,
        aspectRatio: aspectRatio,
        negativePrompt: NEGATIVE_PROMPT
      });
      
      // 4. 上传 S3
      const s3Key = `panels/${task.PK.replace('JOB#', '')}/${task.panelId}-${task.mode}.png`;
      await s3.send(new PutObjectCommand({
        Bucket: process.env.ASSETS_BUCKET,
        Key: s3Key,
        Body: image.buffer,
        ContentType: 'image/png',
        Metadata: {
          'job-id': task.PK.replace('JOB#', ''),
          'panel-id': task.panelId,
          'mode': task.mode
        }
      }));
      
      // 6. 更新任务状态与 Job 进度 (事务性)
      await dynamodb.send(new TransactWriteItemsCommand({
        TransactItems: [
          // 更新 PANEL_TASK
          {
            Update: {
              TableName: process.env.TABLE_NAME,
              Key: {
                PK: { S: task.PK },
                SK: { S: task.SK }
              },
              UpdateExpression: 'SET #status = :completed, s3Key = :key, updatedAt = :now',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':completed': { S: 'completed' },
                ':key': { S: s3Key },
                ':now': { N: Date.now().toString() }
              }
            }
          },
          // 增加 JOB 的 completed 计数
          {
            Update: {
              TableName: process.env.TABLE_NAME,
              Key: {
                PK: { S: task.PK },
                SK: { S: task.PK }
              },
              UpdateExpression: 'SET progress.completed = progress.completed + :inc, updatedAt = :now',
              ExpressionAttributeValues: {
                ':inc': { N: '1' },
                ':now': { N: Date.now().toString() }
              }
            }
          }
        ]
      }));
      
      // 7. 记录幂等性
      await recordIdempotency(idempotencyKey);
      
      console.log(`Panel ${task.panelId} completed`);
      
    } catch (error) {
      console.error(`Panel ${task.panelId} failed:`, error);
      
      // 指数退避重试
      const retryCount = parseInt(task.retryCount || '0');
      if (retryCount < MAX_RETRIES) {
        const backoffMs = Math.pow(2, retryCount) * 1000;
        console.log(`Retrying after ${backoffMs}ms (attempt ${retryCount + 1})`);
        
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        
        await dynamodb.send(new UpdateItemCommand({
          TableName: process.env.TABLE_NAME,
          Key: {
            PK: { S: task.PK },
            SK: { S: task.SK }
          },
          UpdateExpression: 'SET #status = :pending, retryCount = retryCount + :inc, #error = :err',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#error': 'error'
          },
          ExpressionAttributeValues: {
            ':pending': { S: 'pending' },
            ':inc': { N: '1' },
            ':err': { S: error.message }
          }
        }));
      } else {
        // 标记为失败
        await updateTaskStatus(task.PK, task.SK, 'failed', error.message);
        await incrementJobFailed(task.PK);
      }
    }
  }
  
  return { statusCode: 200 };
};

function buildPanelPrompt(panelData, characterRefs) {
  // 组装面板级 prompt
  let prompt = 'manga style, ';
  
  // 场景描述
  prompt += panelData.scene.S + ', ';
  
  // 角色描述
  if (panelData.characters && panelData.characters.L) {
    for (const char of panelData.characters.L) {
      const charName = char.M.name?.S;
      const pose = char.M.pose?.S || 'standing';
      const expression = char.M.expression?.S || 'neutral';
      
      prompt += `${charName} ${pose} with ${expression} expression, `;
    }
  }
  
  prompt += 'high quality, detailed, cinematic composition';
  
  // 收集角色参考图 URI
  const characterRefUris = [];
  if (characterRefs && panelData.characters) {
    for (const char of panelData.characters.L) {
      const charId = char.M.charId?.S;
      if (charId && characterRefs[charId]) {
        characterRefUris.push(...characterRefs[charId].portraitsGcsUris);
      }
    }
  }
  
  return {
    text: prompt,
    characterRefUris
  };
}
```

**关键特性**:
- **并发控制**: DynamoDB Streams 批处理,最多并发 10 个任务
- **幂等性**: 基于 `jobId:panelId:mode` 的唯一键,防止重复生成
- **失败重试**: 指数退避,最多 3 次重试
- **进度跟踪**: 实时更新 Job 项的 `progress.completed`

---

### 2.4 修改闭环 (CR-DSL)

**端点**: `POST /change-requests`

**Lambda 函数**: `ChangeRequestFunction`

**完整伪代码**:

```javascript
const QwenAdapter = require('../lib/qwen-adapter');
const ImagenAdapter = require('../lib/imagen-adapter');
const { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { v4: uuid } = require('uuid');

const qwen = new QwenAdapter(/* ... */);
const imagen = new ImagenAdapter(/* ... */);
const dynamodb = new DynamoDBClient();

const CR_DSL_SCHEMA = require('../schemas/cr-dsl.json');

exports.handler = async (event) => {
  const { novelId, naturalLanguage } = JSON.parse(event.body);
  const userId = event.requestContext.authorizer.claims.sub;
  
  try {
    // 1. Qwen 解析自然语言为 CR-DSL
    console.log('Parsing change request:', naturalLanguage);
    
    const crDsl = await qwen.parseChangeRequest({
      input: naturalLanguage,
      schema: CR_DSL_SCHEMA
    });
    
    console.log('Parsed CR-DSL:', JSON.stringify(crDsl, null, 2));
    
    // 2. 写入 CR 项
    const crId = uuid();
    await dynamodb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: { S: `NOVEL#${novelId}` },
        SK: { S: `CR#${crId}` },
        id: { S: crId },
        novelId: { S: novelId },
        userId: { S: userId },
        naturalLanguage: { S: naturalLanguage },
        dsl: { M: marshalCRDSL(crDsl) },
        status: { S: 'pending' },
        createdAt: { N: Date.now().toString() },
        updatedAt: { N: Date.now().toString() }
      }
    }));
    
    // 3. 异步执行 CR
    const jobId = await executeCR(crId, crDsl);
    
    // 4. 更新 CR 项关联 jobId
    await dynamodb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: { S: `NOVEL#${novelId}` },
        SK: { S: `CR#${crId}` }
      },
      UpdateExpression: 'SET jobId = :jid, #status = :executing',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':jid': { S: jobId },
        ':executing': { S: 'executing' }
      }
    }));
    
    // 5. 返回结果
    return {
      statusCode: 202,
      headers: corsHeaders(),
      body: JSON.stringify({
        crId,
        jobId,
        dsl: crDsl,
        message: 'Change request is being processed'
      })
    };
    
  } catch (error) {
    console.error('ChangeRequest error:', error);
    return errorResponse(500, error.message);
  }
};

async function executeCR(crId, dsl) {
  const jobId = uuid();
  
  switch (dsl.type) {
    case 'art':
      return await executeArtCR(crId, dsl, jobId);
    
    case 'dialogue':
      return await executeDialogueCR(crId, dsl, jobId);
    
    case 'layout':
      return await executeLayoutCR(crId, dsl, jobId);
    
    case 'style':
      return await executeStyleCR(crId, dsl, jobId);
    
    default:
      throw new Error(`Unknown CR type: ${dsl.type}`);
  }
}

async function executeArtCR(crId, dsl, jobId) {
  const op = dsl.ops[0];
  
  switch (op.action) {
    case 'inpaint':
      // 重绘局部区域
      const panel = await getPanel(dsl.targetId);
      const baseImage = await getS3Object(panel.imagesS3[dsl.mode || 'hd']);
      const maskImage = op.params.mask; // Base64 或 S3 URL
      
      const editedImage = await imagen.edit({
        baseImage: baseImage,
        maskImage: await loadMask(maskImage),
        editMode: 'inpaint',
        instruction: op.params.instruction
      });
      
      // 上传新版本
      const newS3Key = `edits/${crId}/${dsl.targetId}-edit-${Date.now()}.png`;
      await uploadToS3(newS3Key, editedImage.buffer);
      
      // 更新 Panel 项
      await updatePanelImage(dsl.targetId, newS3Key);
      break;
    
    case 'outpaint':
      // 外延扩展
      // 类似逻辑...
      break;
    
    case 'bg_swap':
      // 背景替换
      // 类似逻辑...
      break;
    
    case 'repose':
      // 重新生成角色姿态
      // 需要重新调用 Imagen 生成
      break;
    
    case 'regen_panel':
      // 完全重新生成面板
      // 创建新的 PANEL_TASK
      break;
  }
  
  return jobId;
}

async function executeDialogueCR(crId, dsl, jobId) {
  const op = dsl.ops[0];
  
  if (op.action === 'rewrite_dialogue') {
    // 调用 Qwen 重写对白
    const panel = await getPanel(dsl.targetId);
    const newDialogue = await qwen.rewriteDialogue(
      panel.content.dialogue,
      op.params.instruction
    );
    
    // 更新 Panel 项
    await dynamodb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: { S: panel.PK },
        SK: { S: panel.SK }
      },
      UpdateExpression: 'SET content.dialogue = :dlg, updatedAt = :now',
      ExpressionAttributeValues: {
        ':dlg': { L: newDialogue.map(d => ({ M: marshalDialogue(d) })) },
        ':now': { N: Date.now().toString() }
      }
    }));
  }
  
  return jobId;
}

async function executeLayoutCR(crId, dsl, jobId) {
  const op = dsl.ops[0];
  
  if (op.action === 'reorder') {
    // 重新排序面板
    const panelIds = op.params.order; // ['panel-3', 'panel-1', 'panel-2']
    
    // 更新每个 Panel 的 page/index
    for (let i = 0; i < panelIds.length; i++) {
      const newPage = Math.floor(i / PANELS_PER_PAGE) + 1;
      const newIndex = i % PANELS_PER_PAGE;
      
      await updatePanelPosition(panelIds[i], newPage, newIndex);
    }
  }
  
  return jobId;
}
```

**CR-DSL 示例**:

```json
{
  "scope": "panel",
  "targetId": "panel-123",
  "type": "art",
  "ops": [
    {
      "action": "inpaint",
      "params": {
        "mask": "data:image/png;base64,...",
        "instruction": "把角色的表情改为微笑"
      }
    }
  ]
}
```

---

## 3. 数据层设计

详见 [DATA_CONTRACT.md](./DATA_CONTRACT.md)

### 3.1 DynamoDB 单表模型

**设计原则**:
- 预先设计所有访问模式
- 使用复合键 (PK + SK) 实现一对多关系
- GSI 用于反向查询与任务队列扫描

### 3.2 S3 存储结构

```
qnyproj-assets-{env}/
├── novels/{novelId}/original.txt
├── characters/{charId}/
│   ├── reference-{idx}.png
│   └── portrait-{view}.png
├── panels/{jobId}/{panelId}-{mode}.png
├── edits/{crId}/{panelId}-edit-{version}.png
└── exports/{exportId}/comic.pdf
```

---

## 4. AI 适配器实现

### 4.1 QwenAdapter

```javascript
const OpenAI = require('openai');

class QwenAdapter {
  constructor(apiKey, endpoint) {
    this.client = new OpenAI({
      apiKey,
      baseURL: endpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    });
    this.maxRetries = 3;
  }
  
  async generateStoryboard(options) {
    const { text, jsonSchema, strictMode } = options;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: 'qwen-max',
          messages: [
            { role: 'system', content: STORYBOARD_SYSTEM_PROMPT },
            { role: 'user', content: text }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'storyboard',
              strict: strictMode,
              schema: jsonSchema
            }
          },
          temperature: 0.3,
          max_tokens: 8000
        });
        
        return JSON.parse(response.choices[0].message.content);
        
      } catch (error) {
        if (error.status === 429 && attempt < this.maxRetries - 1) {
          // Rate limit, 指数退避
          const backoffMs = Math.pow(2, attempt) * 1000;
          console.log(`Rate limited, retrying after ${backoffMs}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
        throw error;
      }
    }
  }
  
  async correctJson(invalidJson, errors) {
    const prompt = `The following JSON has validation errors:\n\n${JSON.stringify(invalidJson, null, 2)}\n\nErrors:\n${JSON.stringify(errors, null, 2)}\n\nPlease correct the JSON to match the schema.`;
    
    const response = await this.client.chat.completions.create({
      model: 'qwen-max',
      messages: [
        { role: 'system', content: 'You are a JSON correction assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1
    });
    
    return JSON.parse(response.choices[0].message.content);
  }
  
  async parseChangeRequest(options) {
    // 类似 generateStoryboard,但使用 CR-DSL schema
  }
  
  async rewriteDialogue(originalDialogue, instruction) {
    // 重写对白
  }
}

const STORYBOARD_SYSTEM_PROMPT = `你是一个专业的漫画分镜师。
给定一段小说文本,你需要将其转换为结构化的漫画分镜。

输出格式严格遵循 JSON Schema,包含:
- panels: 面板数组,每个面板包含:
  - page: 页码
  - index: 页内序号
  - scene: 场景描述
  - characters: 角色数组 (name, pose, expression)
  - dialogue: 对白数组 (speaker, text, bubbleType)
  - visualPrompt: 给图像生成 AI 的完整 prompt

- characters: 角色圣经数组 (name, role, appearance, personality)

注意事项:
1. 每页最多 4-6 个面板
2. 场景描述要详细,包含镜头类型 (close-up, medium, wide)
3. visualPrompt 必须是完整的英文 prompt,包含风格 (manga style)
4. 对白要简洁,符合漫画气泡的长度限制`;

module.exports = QwenAdapter;
```

### 4.2 ImagenAdapter

```javascript
const { ImageGenerationClient } = require('@google-cloud/aiplatform');
const { Storage } = require('@google-cloud/storage');

class ImagenAdapter {
  constructor(gcpCredentials, projectId, location) {
    this.credentials = JSON.parse(gcpCredentials);
    this.projectId = projectId;
    this.location = location || 'us-central1';
    
    this.client = new ImageGenerationClient({
      projectId: this.projectId,
      location: this.location,
      credentials: this.credentials
    });
    
    this.storage = new Storage({
      projectId: this.projectId,
      credentials: this.credentials
    });
  }
  
  async generate(options) {
    const {
      prompt,
      referenceImages = [],
      mode = 'preview',
      aspectRatio = '16:9',
      negativePrompt = DEFAULT_NEGATIVE_PROMPT
    } = options;
    
    // 根据 mode 调整分辨率
    const resolution = mode === 'preview' ? { width: 512, height: 288 } : { width: 1920, height: 1080 };
    
    const request = {
      parent: `projects/${this.projectId}/locations/${this.location}`,
      instances: [
        {
          prompt: prompt,
          negativePrompt: negativePrompt,
          aspectRatio: aspectRatio,
          ...resolution
        }
      ],
      parameters: {
        sampleCount: 1,
        ...(referenceImages.length > 0 && {
          referenceImages: referenceImages.map(uri => ({
            referenceImage: { gcsUri: uri }
          }))
        })
      }
    };
    
    const [response] = await this.client.predict(request);
    
    const image = response.predictions[0];
    
    return {
      buffer: Buffer.from(image.bytesBase64Encoded, 'base64'),
      mimeType: image.mimeType || 'image/png',
      safetyAttributes: image.safetyAttributes
    };
  }
  
  async edit(options) {
    const {
      baseImage,
      maskImage,
      editMode,
      instruction
    } = options;
    
    const request = {
      parent: `projects/${this.projectId}/locations/${this.location}`,
      instances: [
        {
          prompt: instruction,
          image: {
            bytesBase64Encoded: baseImage.toString('base64')
          },
          mask: {
            bytesBase64Encoded: maskImage.toString('base64')
          },
          editMode: editMode // 'inpaint' | 'outpaint' | 'product'
        }
      ]
    };
    
    const [response] = await this.client.predict(request);
    
    return {
      buffer: Buffer.from(response.predictions[0].bytesBase64Encoded, 'base64')
    };
  }
  
  async uploadToGCS(buffer, filename) {
    const bucketName = `${this.projectId}-imagen-refs`;
    const bucket = this.storage.bucket(bucketName);
    const file = bucket.file(`${filename}-${Date.now()}.png`);
    
    await file.save(buffer, {
      contentType: 'image/png'
    });
    
    return `gs://${bucketName}/${file.name}`;
  }
}

const DEFAULT_NEGATIVE_PROMPT = 'blurry, low quality, NSFW, deformed, multiple people, watermark, text';

module.exports = ImagenAdapter;
```

---

## 5. 前端架构

### 5.1 组件树

```
App.tsx
├── Header (导航栏)
│   ├── Logo
│   ├── NavMenu (首页/API文档/关于)
│   └── UserProfile (Cognito 登录状态)
│
├── Router
│   ├── HomePage
│   │   ├── NovelList (作品列表)
│   │   └── UploadModal (上传文本)
│   │
│   ├── NovelDetailPage
│   │   ├── CharacterPanel (角色管理)
│   │   │   ├── CharacterCard
│   │   │   ├── ReferenceImageUploader
│   │   │   └── PortraitGallery
│   │   │
│   │   └── StoryboardPanel (分镜编辑)
│   │       ├── PanelGrid (缩略图网格)
│   │       └── GenerateButton
│   │
│   ├── ComicEditorPage
│   │   ├── Canvas (Konva/Fabric.js)
│   │   │   ├── PanelLayer (面板图层)
│   │   │   ├── DialogueBubbleLayer (对白气泡)
│   │   │   └── MaskLayer (遮罩绘制)
│   │   │
│   │   ├── Toolbar
│   │   │   ├── BrushTool (遮罩笔刷)
│   │   │   ├── TextTool (对白编辑)
│   │   │   └── LayoutTool (面板排序)
│   │   │
│   │   └── PropertyPanel
│   │       ├── PanelProperties
│   │       └── DialogueEditor
│   │
│   ├── ExportPage
│   │   ├── FormatSelector (PDF/Webtoon/资源包)
│   │   └── DownloadButton
│   │
│   └── SwaggerDocsPage
│       └── SwaggerUI
│
└── ChangeRequestPanel (全局悬浮组件)
    ├── TextInput (自然语言输入)
    ├── DSLPreview (解析后的 DSL)
    └── ExecuteButton
```

### 5.2 状态管理

使用 React Context + useReducer:

```typescript
// contexts/NovelContext.tsx
interface NovelState {
  novels: Novel[];
  currentNovel: Novel | null;
  storyboard: Storyboard | null;
  characters: Character[];
  jobs: Job[];
  loading: boolean;
  error: string | null;
}

type NovelAction =
  | { type: 'SET_NOVELS'; payload: Novel[] }
  | { type: 'SELECT_NOVEL'; payload: string }
  | { type: 'SET_STORYBOARD'; payload: Storyboard }
  | { type: 'UPDATE_CHARACTER'; payload: Character }
  | { type: 'ADD_JOB'; payload: Job }
  | { type: 'UPDATE_JOB_PROGRESS'; payload: { jobId: string; progress: number } };

const novelReducer = (state: NovelState, action: NovelAction): NovelState => {
  switch (action.type) {
    case 'SET_NOVELS':
      return { ...state, novels: action.payload };
    
    case 'SELECT_NOVEL':
      const novel = state.novels.find(n => n.id === action.payload);
      return { ...state, currentNovel: novel || null };
    
    case 'SET_STORYBOARD':
      return { ...state, storyboard: action.payload };
    
    case 'UPDATE_CHARACTER':
      return {
        ...state,
        characters: state.characters.map(c =>
          c.id === action.payload.id ? action.payload : c
        )
      };
    
    case 'ADD_JOB':
      return { ...state, jobs: [...state.jobs, action.payload] };
    
    case 'UPDATE_JOB_PROGRESS':
      return {
        ...state,
        jobs: state.jobs.map(j =>
          j.id === action.payload.jobId
            ? { ...j, progress: action.payload.progress }
            : j
        )
      };
    
    default:
      return state;
  }
};

export const NovelProvider: React.FC = ({ children }) => {
  const [state, dispatch] = useReducer(novelReducer, initialState);
  
  return (
    <NovelContext.Provider value={{ state, dispatch }}>
      {children}
    </NovelContext.Provider>
  );
};
```

### 5.3 API 客户端使用

```typescript
// pages/NovelDetailPage.tsx
import { useEffect, useState } from 'react';
import { NovelsService, CharactersService, JobsService } from '../api/generated';
import type { Novel, Storyboard, Job } from '../api/generated';

export const NovelDetailPage: React.FC = () => {
  const { novelId } = useParams<{ novelId: string }>();
  const [novel, setNovel] = useState<Novel | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  
  useEffect(() => {
    loadNovel();
  }, [novelId]);
  
  const loadNovel = async () => {
    try {
      const data = await NovelsService.getNovel(novelId);
      setNovel(data);
      
      if (data.storyboardId) {
        const sb = await NovelsService.getStoryboard(data.storyboardId);
        setStoryboard(sb);
      }
    } catch (error) {
      console.error('Failed to load novel:', error);
    }
  };
  
  const handleAnalyze = async () => {
    setAnalyzing(true);
    
    try {
      const job = await NovelsService.analyzeNovel(novelId);
      
      // 轮询任务进度
      const intervalId = setInterval(async () => {
        const jobStatus = await JobsService.getJob(job.jobId);
        
        if (jobStatus.status === 'completed') {
          clearInterval(intervalId);
          setAnalyzing(false);
          await loadNovel(); // 重新加载
        } else if (jobStatus.status === 'failed') {
          clearInterval(intervalId);
          setAnalyzing(false);
          alert('分析失败: ' + jobStatus.error);
        }
      }, 2000);
      
    } catch (error) {
      setAnalyzing(false);
      console.error('Analyze failed:', error);
    }
  };
  
  return (
    <div>
      <h1>{novel?.title}</h1>
      <button onClick={handleAnalyze} disabled={analyzing}>
        {analyzing ? '分析中...' : '开始分析'}
      </button>
      
      {storyboard && (
        <StoryboardPanel storyboard={storyboard} />
      )}
    </div>
  );
};
```

---

## 6. 安全与性能

### 6.1 认证流程

**前端 PKCE 流程**:

1. 用户点击"登录"
2. 前端生成 `code_verifier` 与 `code_challenge`
3. 重定向到 Cognito `/oauth2/authorize` 端点
4. 用户登录后,Cognito 重定向回前端并带上 `code`
5. 前端用 `code` + `code_verifier` 换取 JWT Token
6. 存储 Token 到 localStorage (或 HttpOnly cookie)
7. 后续请求在 `Authorization: Bearer <token>` 头中携带

**Lambda 获取用户信息**:

```javascript
exports.handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  const userEmail = event.requestContext.authorizer.claims.email;
  
  // 多租户隔离: 查询时过滤 userId
  const novels = await queryNovelsByUser(userId);
  
  // ...
};
```

### 6.2 性能优化

**并发控制**:
- Lambda 预留并发: 核心函数 (Analyze/Generate) 设置 100 并发
- DynamoDB Streams: `BatchSize=10`,并发调用 Worker
- Imagen API: 客户端侧限流,避免 429 错误

**缓存策略**:
- API Gateway 缓存: GET 请求缓存 5 分钟 (开发环境关闭)
- S3 预签名 URL: 15 分钟有效期,减少重复生成
- CloudFront CDN: 静态资源 (前端) 缓存 1 小时

**冷启动优化**:
- Lambda SnapStart (Java 支持,Node.js 待支持)
- 保持 Lambda 温度: CloudWatch Events 定时 Ping
- 减少依赖大小: 使用 Webpack/esbuild 打包

### 6.3 安全措施

**最小权限原则**:

```yaml
# Lambda IAM Role 示例
Policies:
  - Statement:
      - Effect: Allow
        Action:
          - dynamodb:GetItem
          - dynamodb:PutItem
          - dynamodb:UpdateItem
          - dynamodb:Query
        Resource:
          - !GetAtt ComicDataTable.Arn
          - !Sub '${ComicDataTable.Arn}/index/*'
      
      - Effect: Allow
        Action:
          - s3:GetObject
          - s3:PutObject
        Resource:
          - !Sub '${AssetsBucket.Arn}/*'
      
      - Effect: Allow
        Action:
          - secretsmanager:GetSecretValue
        Resource:
          - !Ref QwenApiKeySecret
          - !Ref GcpServiceAccountSecret
```

**速率限制**:
- API Gateway Usage Plans: 每用户 1000 req/day
- Lambda 并发限制: 避免单用户占用所有资源
- Qwen/Gemini API: 客户端侧 Token Bucket 限流

**敏感数据**:
- API Key 存储在 AWS Secrets Manager
- Lambda 环境变量引用: `{{resolve:secretsmanager:...}}`
- 前端不暴露任何 API Key

---

## 7. 监控与告警

### 7.1 CloudWatch 指标

**Lambda**:
- `Invocations` - 调用次数
- `Errors` - 错误次数
- `Duration` - 执行时间
- `Throttles` - 节流次数
- `ConcurrentExecutions` - 并发执行数

**API Gateway**:
- `Count` - 请求总数
- `4XXError` - 客户端错误
- `5XXError` - 服务端错误
- `Latency` - 延迟 (p50/p90/p99)

**DynamoDB**:
- `ConsumedReadCapacityUnits`
- `ConsumedWriteCapacityUnits`
- `ThrottledRequests` - 节流请求 (按需模式应为 0)
- `UserErrors` - 客户端错误

### 7.2 自定义指标

```javascript
// lib/metrics.js
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

const cloudwatch = new CloudWatchClient();

async function putMetric(metricName, value, unit = 'Count') {
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: 'NovelToComics',
    MetricData: [
      {
        MetricName: metricName,
        Value: value,
        Unit: unit,
        Timestamp: new Date()
      }
    ]
  }));
}

// 使用示例
await putMetric('QwenApiSuccess', 1);
await putMetric('ImagenGenerateLatency', durationMs, 'Milliseconds');
await putMetric('PanelGenerateSuccess', 1);
```

**关键业务指标**:
- `QwenApiSuccess` / `QwenApiFailure` - Qwen 调用成功率
- `ImagenGenerateSuccess` / `ImagenGenerateFailure` - Imagen 生成成功率
- `PanelGenerateLatency` - 面板生成平均耗时
- `SchemaValidationFailure` - Schema 校验失败次数

### 7.3 告警

```yaml
# CloudWatch Alarms
Alarms:
  HighErrorRate:
    MetricName: Errors
    Statistic: Sum
    Period: 300
    EvaluationPeriods: 2
    Threshold: 10
    ComparisonOperator: GreaterThanThreshold
    AlarmActions:
      - !Ref SNSTopic
  
  HighLatency:
    MetricName: Duration
    Statistic: Average
    Period: 60
    EvaluationPeriods: 3
    Threshold: 10000  # 10 秒
    ComparisonOperator: GreaterThanThreshold
  
  DynamoDBThrottling:
    MetricName: ThrottledRequests
    Statistic: Sum
    Period: 60
    EvaluationPeriods: 1
    Threshold: 5
    ComparisonOperator: GreaterThanThreshold
```

---

## 8. 部署架构

### 8.1 完整 SAM 模板

请查看 `backend/template.yaml` 获取完整的资源定义。

关键资源包括:
- `MyApiGateway` - API Gateway (EDGE 优化)
- `ComicDataTable` - DynamoDB 表 (含 GSI1/GSI2 与 Streams)
- `AssetsBucket` - S3 Bucket (含 CORS 与生命周期策略)
- `QwenApiKeySecret` / `GcpServiceAccountSecret` - Secrets Manager
- 8 个 Lambda 函数 (Analyze/Generate/Edit/Change/Export/Jobs/Worker)

### 8.2 环境变量配置

**本地开发**: `.env.local`

```bash
AWS_REGION=us-east-1
TABLE_NAME=qnyproj-api-data
ASSETS_BUCKET=qnyproj-assets-dev
QWEN_API_KEY=sk-xxx
GCP_SA_KEY='{...}'
GCP_PROJECT_ID=my-project
```

**Lambda 环境变量** (SAM 模板):

```yaml
Environment:
  Variables:
    TABLE_NAME: !Ref ComicDataTable
    ASSETS_BUCKET: !Ref AssetsBucket
    QWEN_API_KEY: !Sub '{{resolve:secretsmanager:${QwenApiKeySecret}}}'
    GCP_SA_KEY: !Sub '{{resolve:secretsmanager:${GcpServiceAccountSecret}}}'
    GCP_PROJECT_ID: !Ref GcpProjectId
```

---

## 9. 扩展性考虑

### 9.1 水平扩展

- **Lambda**: 自动伸缩至 1000+ 并发 (可申请提升配额)
- **DynamoDB**: 按需计费模式,自动适应流量
- **S3**: 无限存储,支持数千万对象
- **API Gateway**: 10,000 req/s (可申请提升)

### 9.2 未来增强

- **实时预览**: WebSocket API 实时推送生成进度
- **多语言支持**: i18n 框架,Qwen 支持多语言输入
- **协作编辑**: CRDT 算法解决冲突,DynamoDB 乐观锁
- **风格迁移**: ControlNet 控制生成风格,更多预设风格
- **视频导出**: FFmpeg Lambda Layer 生成漫画视频
- **社区功能**: 作品分享、评论、点赞 (新增 DynamoDB 表)

---

**文档维护**: 本文档应随系统演进持续更新。每次架构变更、新增核心功能时,请同步更新。

**最后更新**: 2025-10-19

