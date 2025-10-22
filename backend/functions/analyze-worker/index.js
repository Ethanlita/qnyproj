/**
 * AnalyzeWorkerFunction - SQS Worker for async novel analysis
 * 
 * 从 SQS Queue 接收消息并执行实际的小说分析任务。
 * 这个 Worker 函数处理长时间运行的 Qwen API 调用和数据库写入。
 * 
 * @module AnalyzeWorkerFunction
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const Ajv = require('ajv');
const { v4: uuid } = require('uuid');

const QwenAdapter = require('../../lib/qwen-adapter');
const BibleManager = require('../../lib/bible-manager');

// AWS Clients
const dynamodbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamodbClient);
const s3Client = new S3Client({});
const secretsClient = new SecretsManagerClient({});

// AJV validator - 宽容模式，只验证结构，不验证类型严格性
const ajv = new Ajv({ 
  allErrors: true,
  strict: false,           // 不使用严格模式
  coerceTypes: true,       // 自动类型转换（如 "18" -> 18）
  useDefaults: true,       // 使用默认值
  removeAdditional: false  // 保留额外的字段
});

// Environment variables
const TABLE_NAME = process.env.TABLE_NAME;
const ASSETS_BUCKET = process.env.ASSETS_BUCKET;
const QWEN_SECRET_ARN = process.env.QWEN_SECRET_ARN;
const BIBLES_TABLE_NAME = process.env.BIBLES_TABLE_NAME;
const BIBLES_BUCKET = process.env.BIBLES_BUCKET || ASSETS_BUCKET;

// Load schemas
const storyboardSchema = require('../../schemas/storyboard.json');
const validateStoryboard = ajv.compile(storyboardSchema);

// Cache for Qwen credentials
let qwenAdapterCache = null;
function getBibleManager() {
  if (!BIBLES_TABLE_NAME) {
    throw new Error('BIBLES_TABLE_NAME environment variable not set');
  }
  if (!BIBLES_BUCKET) {
    throw new Error('BIBLES_BUCKET or ASSETS_BUCKET environment variable not set');
  }
  console.log('[AnalyzeWorker] BibleManager initialized');
  return new BibleManager(docClient, s3Client, BIBLES_TABLE_NAME, BIBLES_BUCKET);
}


/**
 * Get Qwen API credentials from Secrets Manager
 */
async function getQwenAdapter() {
  if (qwenAdapterCache) {
    return qwenAdapterCache;
  }
  
  if (!QWEN_SECRET_ARN) {
    throw new Error('QWEN_SECRET_ARN environment variable not set');
  }
  
  console.log('[AnalyzeWorker] Fetching Qwen credentials from Secrets Manager');
  
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: QWEN_SECRET_ARN })
  );
  
  const secret = JSON.parse(response.SecretString);
  
  // Support both naming conventions: apiKey/endpoint (old) and QWEN_API_KEY/QWEN_ENDPOINT (new)
  const apiKey = secret.apiKey || secret.QWEN_API_KEY;
  const endpoint = secret.endpoint || secret.QWEN_ENDPOINT;
  const model = secret.model || secret.QWEN_MODEL;
  
  if (!apiKey) {
    console.error('[AnalyzeWorker] Secret contents:', Object.keys(secret));
    throw new Error('API key not found in secret (checked apiKey and QWEN_API_KEY)');
  }
  
  qwenAdapterCache = new QwenAdapter({
    apiKey,
    endpoint,
    model
  });
  
  console.log('[AnalyzeWorker] Qwen adapter initialized');
  return qwenAdapterCache;
}

/**
 * Get novel text from DynamoDB or S3
 */
async function getNovelText(novelId) {
  console.log(`[AnalyzeWorker] Fetching novel ${novelId} from DynamoDB`);
  
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `NOVEL#${novelId}`,
        SK: `NOVEL#${novelId}`
      }
    })
  );
  
  if (!result.Item) {
    throw new Error(`Novel ${novelId} not found`);
  }
  
  const novel = result.Item;
  
  // If text is in S3, fetch it
  if (novel.originalTextS3) {
    console.log(`[AnalyzeWorker] Fetching text from S3: ${novel.originalTextS3}`);
    
    const s3Response = await s3Client.send(
      new GetObjectCommand({
        Bucket: ASSETS_BUCKET,
        Key: novel.originalTextS3.replace(`s3://${ASSETS_BUCKET}/`, '')
      })
    );
    
    const text = await s3Response.Body.transformToString('utf-8');
    return { novel, text };
  }
  
  // Otherwise use text from DynamoDB
  return { novel, text: novel.originalText };
}

/**
 * Update job status and progress
 */
async function updateJob(jobId, status, progress = {}, errorMessage = null) {
  const timestamp = new Date().toISOString();
  
  const updateParams = {
    TableName: TABLE_NAME,
    Key: {
      PK: `JOB#${jobId}`,
      SK: `JOB#${jobId}`
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, progress = :progress',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': status,
      ':updatedAt': timestamp,
      ':progress': progress
    }
  };
  
  if (status === 'completed') {
    updateParams.UpdateExpression += ', completedAt = :completedAt';
    updateParams.ExpressionAttributeValues[':completedAt'] = timestamp;
    
    // ✅ 如果 progress 中有 storyboardId，同时更新顶层字段
    if (progress.storyboardId) {
      updateParams.UpdateExpression += ', storyboardId = :storyboardId';
      updateParams.ExpressionAttributeValues[':storyboardId'] = progress.storyboardId;
    }
  }
  
  if (status === 'failed' && errorMessage) {
    updateParams.UpdateExpression += ', errorMessage = :errorMessage';
    updateParams.ExpressionAttributeValues[':errorMessage'] = errorMessage;
  }
  
  await docClient.send(new UpdateCommand(updateParams));
  console.log(`[AnalyzeWorker] Job ${jobId} updated: ${status} (${JSON.stringify(progress)})`);
}

/**
 * Write storyboard data to DynamoDB
 */
async function writeStoryboardToDynamoDB(novelId, userId, storyboard) {
  const storyboardId = uuid();
  const timestamp = new Date().toISOString();
  const timestampNumber = Date.now();

  console.log('[AnalyzeWorker] Writing storyboard to DynamoDB');
  console.log(`  - Panels: ${storyboard.panels.length}`);
  console.log(`  - Characters: ${storyboard.characters.length}`);
  console.log(`  - Scenes: ${storyboard.scenes ? storyboard.scenes.length : 0}`);

  const storyboardItem = {
    PK: `NOVEL#${novelId}`,
    SK: `STORYBOARD#${storyboardId}`,
    id: storyboardId,
    novelId,
    userId,
    totalPanels: storyboard.panels.length,
    totalPages: storyboard.totalPages || Math.ceil(storyboard.panels.length / 6),
    totalCharacters: storyboard.characters.length,
    totalScenes: storyboard.scenes ? storyboard.scenes.length : 0,
    status: 'generated',
    createdAt: timestamp,
    updatedAt: timestamp,
    GSI1PK: `USER#${userId}`,
    GSI1SK: `STORYBOARD#${timestampNumber}`
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: storyboardItem
    })
  );

  const { items: baseCharacterItems, lookup: characterLookup } = buildCharacterItems(
    storyboard.characters || [],
    novelId,
    storyboardId,
    timestamp
  );

  const { items: panelItems, additionalCharacters } = buildPanelItems(
    storyboard.panels || [],
    storyboardId,
    novelId,
    timestamp,
    characterLookup
  );

  const allCharacterItems = mergeCharacterItems(baseCharacterItems, additionalCharacters);

  for (let i = 0; i < panelItems.length; i += 25) {
    const batch = panelItems.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((item) => ({
            PutRequest: { Item: item }
          }))
        }
      })
    );
    console.log(`[AnalyzeWorker] Wrote panels ${i + 1}-${Math.min(i + 25, panelItems.length)}`);
  }

  for (let i = 0; i < allCharacterItems.length; i += 25) {
    const batch = allCharacterItems.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((item) => ({
            PutRequest: { Item: item }
          }))
        }
      })
    );
    console.log(`[AnalyzeWorker] Wrote characters ${i + 1}-${Math.min(i + 25, allCharacterItems.length)}`);
  }

  if (storyboard.scenes && storyboard.scenes.length > 0) {
    const sceneItems = storyboard.scenes.map((scene) => ({
      PK: `NOVEL#${novelId}`,
      SK: `SCENE#${scene.id || uuid()}`,
      id: scene.id || uuid(),
      novelId,
      storyboardId,
      ...scene,
      createdAt: timestamp,
      updatedAt: timestamp
    }));

    for (let i = 0; i < sceneItems.length; i += 25) {
      const batch = sceneItems.slice(i, i + 25);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAME]: batch.map((item) => ({
              PutRequest: { Item: item }
            }))
          }
        })
      );
      console.log(`[AnalyzeWorker] Wrote scenes ${i + 1}-${Math.min(i + 25, sceneItems.length)}`);
    }
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `NOVEL#${novelId}`,
        SK: `NOVEL#${novelId}`
      },
      UpdateExpression: 'SET storyboardId = :storyboardId, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':storyboardId': storyboardId,
        ':updatedAt': timestamp
      }
    })
  );

  console.log('[AnalyzeWorker] Novel updated with storyboard reference');

  return { storyboardId };
}

function buildCharacterItems(characters, novelId, storyboardId, timestamp) {
  const lookup = new Map();
  const items = [];

  for (const char of characters) {
    const item = normaliseCharacter(char, novelId, storyboardId, timestamp);
    items.push(item);
    lookup.set(item.id, item);
    if (item.name) {
      lookup.set(item.name.toLowerCase(), item);
    }
  }

  return { items, lookup };
}

function mergeCharacterItems(baseItems, additionalItems) {
  const map = new Map();
  for (const item of baseItems) {
    map.set(item.id, item);
  }
  for (const item of additionalItems) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

function buildPanelItems(panels, storyboardId, novelId, timestamp, characterLookup) {
  const items = [];
  const additionalCharacters = [];

  panels.forEach((panel, idx) => {
    const panelId = panel.id || uuid();
    const sequence = `PANEL#${String(idx).padStart(4, '0')}`;

    const { characters = [], dialogue = [], ...rest } = panel;
    const normalisedCharacters = normalizePanelCharacters(
      characters,
      characterLookup,
      additionalCharacters,
      novelId,
      storyboardId,
      timestamp
    );

    const item = {
      PK: `STORYBOARD#${storyboardId}`,
      SK: sequence,
      id: panelId,
      storyboardId,
      novelId,
      ...rest,
      characters: normalisedCharacters,
      dialogue,
      status: panel.status || 'pending',
      imagesS3: panel.imagesS3 || {},
      createdAt: timestamp,
      updatedAt: timestamp,
      GSI1PK: `PANEL#${panelId}`,
      GSI1SK: `PANEL#${panelId}`
    };

    items.push(item);
  });

  return { items, additionalCharacters };
}

function normalizePanelCharacters(characters, lookup, additionalCharacters, novelId, storyboardId, timestamp) {
  return (characters || []).map((character) => {
    const existing =
      (character.charId && lookup.get(character.charId)) ||
      (character.name && lookup.get(character.name.toLowerCase()));

    if (existing) {
      return {
        ...character,
        charId: existing.id,
        configId: character.configId || existing.defaultConfigId || null
      };
    }

    const created = createCharacterFromPanelCharacter(character, novelId, storyboardId, timestamp);
    lookup.set(created.id, created);
    if (created.name) {
      lookup.set(created.name.toLowerCase(), created);
    }
    additionalCharacters.push(created);

    return {
      ...character,
      charId: created.id,
      configId: created.defaultConfigId || null
    };
  });
}

function normaliseCharacter(character, novelId, storyboardId, timestamp) {
  const charId = character.id || uuid();

  const baseInfo = character.baseInfo || {
    gender: character.gender,
    age: character.age,
    personality: character.personality || []
  };

  return {
    PK: `NOVEL#${novelId}`,
    SK: `CHAR#${charId}`,
    id: charId,
    novelId,
    storyboardId,
    name: character.name || `Character ${charId.slice(0, 6)}`,
    role: character.role || 'supporting',
    baseInfo,
    appearance: character.appearance || {},
    personality: character.personality || [],
    defaultConfigId: character.defaultConfigId || null,
    portraits: character.portraits || [],
    createdAt: timestamp,
    updatedAt: timestamp,
    GSI1PK: `CHAR#${charId}`,
    GSI1SK: `CHAR#${charId}`
  };
}

function createCharacterFromPanelCharacter(character, novelId, storyboardId, timestamp) {
  const charId = character.charId || uuid();
  return {
    PK: `NOVEL#${novelId}`,
    SK: `CHAR#${charId}`,
    id: charId,
    novelId,
    storyboardId,
    name: character.name || `Character ${charId.slice(0, 6)}`,
    role: character.role || 'supporting',
    baseInfo: {},
    appearance: character.appearance || {},
    personality: character.personality || [],
    defaultConfigId: null,
    portraits: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    GSI1PK: `CHAR#${charId}`,
    GSI1SK: `CHAR#${charId}`
  };
}

/**
 * Main handler - processes SQS messages
 */
exports.handler = async (event) => {
  console.log(`[AnalyzeWorker] Processing ${event.Records.length} messages`);
  const batchItemFailures = [];
  
  for (const record of event.Records) {
    // SQS body might be double-encoded, handle both cases
    let messageBody;
    try {
      messageBody = JSON.parse(record.body);
    } catch (e) {
      // If first parse fails, body might already be an object
      messageBody = record.body;
    }

    if (!messageBody || typeof messageBody !== 'object') {
      console.error(`[AnalyzeWorker] Invalid message body for ${record.messageId}`);
      batchItemFailures.push({ itemIdentifier: record.messageId });
      continue;
    }
    
    const { jobId, novelId, userId, chapterNumber: rawChapterNumber } = messageBody;

    if (!jobId || !novelId) {
      console.error(`[AnalyzeWorker] Missing required fields for message ${record.messageId}`);
      batchItemFailures.push({ itemIdentifier: record.messageId });
      continue;
    }
    
    const chapterNumber = (() => {
      if (rawChapterNumber === undefined || rawChapterNumber === null) {
        return 1;
      }
      const parsed = Number(rawChapterNumber);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return 1;
      }
      return Math.floor(parsed);
    })();
    
    console.log(`[AnalyzeWorker] Received message for job ${jobId}`);
    console.log(`[AnalyzeWorker] Target chapter: ${chapterNumber}`);
    
    try {
      // ✅ IDEMPOTENCY CHECK: Get current job status
      const existingJob = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `JOB#${jobId}`,
            SK: `JOB#${jobId}`
          }
        })
      );
      
      if (!existingJob.Item) {
        console.warn(`[AnalyzeWorker] ⚠️ Job ${jobId} not found in DynamoDB, skipping`);
        continue;
      }
      
      const currentStatus = existingJob.Item.status;
      console.log(`[AnalyzeWorker] Job ${jobId} current status: ${currentStatus}`);
      
      // ✅ Skip if already completed
      if (currentStatus === 'completed') {
        console.log(`[AnalyzeWorker] ✅ Job ${jobId} already completed (storyboardId: ${existingJob.Item.progress?.storyboardId}), skipping duplicate message`);
        continue;
      }
      
      // ✅ Skip if already running (duplicate message from visibility timeout)
      if (currentStatus === 'running') {
        console.log(`[AnalyzeWorker] 🔄 Job ${jobId} already running (stage: ${existingJob.Item.progress?.stage}), skipping duplicate message`);
        continue;
      }
      
      // ✅ Allow retry if failed
      if (currentStatus === 'failed') {
        console.log(`[AnalyzeWorker] 🔁 Job ${jobId} previously failed, retrying...`);
      }
      
      console.log(`[AnalyzeWorker] 🚀 Starting job ${jobId} for novel ${novelId}`);
      
      // ✅ Use conditional update to prevent race conditions
      try {
        const timestamp = new Date().toISOString();
        await docClient.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `JOB#${jobId}`,
            SK: `JOB#${jobId}`
          },
          UpdateExpression: 'SET #status = :running, updatedAt = :updatedAt, progress = :progress',
          ConditionExpression: '#status = :queued OR #status = :failed',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':queued': 'queued',
            ':failed': 'failed',
            ':running': 'running',
            ':updatedAt': timestamp,
            ':progress': { percentage: 5, stage: 'initializing' }
          }
        }));
        console.log(`[AnalyzeWorker] Job ${jobId} updated: running ({"percentage":5,"stage":"initializing"})`);
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
          console.log(`[AnalyzeWorker] ⚡ Job ${jobId} status changed by another process, skipping`);
          continue;
        }
        throw error;
      }
      
      // 1. Job already set to running above (with conditional check)
      
      // 2. Fetch novel text
      await updateJob(jobId, 'running', { percentage: 10, stage: 'fetching_text' });
      const { novel, text } = await getNovelText(novelId);
      let novelText = text;
      if (!novelText && messageBody.text) {
        console.warn('[AnalyzeWorker] Novel text missing from storage, falling back to message payload');
        novelText = messageBody.text;
      }
      if (!novelText) {
        throw new Error(`Novel ${novelId} text not found in storage or message`);
      }
      console.log(`[AnalyzeWorker] Novel text length: ${novelText.length} chars`);
      
      // 3. Initialize Qwen adapter
      await updateJob(jobId, 'running', { percentage: 20, stage: 'initializing_qwen' });
      const qwenAdapter = await getQwenAdapter();
      
      // 3a. Load existing bible for continuity
      await updateJob(jobId, 'running', { percentage: 25, stage: 'loading_bible' });
      const bibleManager = getBibleManager();
      const existingBible = await bibleManager.getBible(novelId);
      const existingCharacterCount = Array.isArray(existingBible.characters) ? existingBible.characters.length : 0;
      const existingSceneCount = Array.isArray(existingBible.scenes) ? existingBible.scenes.length : 0;
      console.log(`[AnalyzeWorker] Bible loaded: version ${existingBible.version} (characters: ${existingCharacterCount}, scenes: ${existingSceneCount})`);
      
      // 4. Generate storyboard
      await updateJob(jobId, 'running', { percentage: 30, stage: 'generating_storyboard' });
      const storyboard = await qwenAdapter.generateStoryboard({
        text: novelText,
        jsonSchema: storyboardSchema,
        strictMode: true,
        maxChunkLength: 8000,
        existingCharacters: existingBible.characters || [],
        existingScenes: existingBible.scenes || [],
        chapterNumber
      });
      
      console.log('[AnalyzeWorker] Storyboard generated');
      console.log(`  - Panels: ${storyboard.panels.length}`);
      console.log(`  - Characters: ${storyboard.characters.length}`);
      console.log(`  - Scenes: ${storyboard.scenes ? storyboard.scenes.length : 0}`);
      
      // 5. Validate storyboard
      await updateJob(jobId, 'running', { percentage: 85, stage: 'validating' });
      const valid = validateStoryboard(storyboard);
      
      if (!valid) {
        console.error('[AnalyzeWorker] ❌ Storyboard validation failed');
        console.error('[AnalyzeWorker] Validation errors:', JSON.stringify(validateStoryboard.errors, null, 2));
        console.error('[AnalyzeWorker] Generated storyboard structure:', JSON.stringify({
          hasTitle: !!storyboard.title,
          hasSummary: !!storyboard.summary,
          panelsCount: storyboard.panels?.length,
          charactersCount: storyboard.characters?.length,
          scenesCount: storyboard.scenes?.length,
          firstPanel: storyboard.panels?.[0],
          firstCharacter: storyboard.characters?.[0],
          firstScene: storyboard.scenes?.[0]
        }, null, 2));
        
        // Log the FULL storyboard for debugging
        console.error('[AnalyzeWorker] 📄 Full Generated Storyboard (for debugging):');
        console.error(JSON.stringify(storyboard, null, 2));
        
        throw new Error('Generated storyboard does not match schema');
      }
      
      console.log('[AnalyzeWorker] ✅ Storyboard validated successfully');
      
      // 5a. Save updated bible
      await updateJob(jobId, 'running', { percentage: 88, stage: 'saving_bible' });
      const bibleResult = await bibleManager.saveBible(
        novelId,
        storyboard.characters || [],
        storyboard.scenes || [],
        chapterNumber
      );
      const updatedMetadata = bibleResult.metadata || {};
      const totalCharacters = updatedMetadata.totalCharacters ?? (bibleResult.characters ? bibleResult.characters.length : 0);
      const totalScenes = updatedMetadata.totalScenes ?? (bibleResult.scenes ? bibleResult.scenes.length : 0);
      const storageLocation = updatedMetadata.storageLocation;

      console.log(
        `[AnalyzeWorker] Bible updated to version ${bibleResult.version} ` +
        `(characters: ${totalCharacters}, scenes: ${totalScenes}, ` +
        `storage: ${storageLocation ? 'S3' : 'DynamoDB'})`
      );
      
      // 6. Write to DynamoDB
      await updateJob(jobId, 'running', { percentage: 90, stage: 'writing_database' });
      const { storyboardId } = await writeStoryboardToDynamoDB(novelId, userId, storyboard);
      
      // 7. Mark job as completed
      await updateJob(jobId, 'completed', {
        percentage: 100,
        stage: 'completed',
        storyboardId,
        panelCount: storyboard.panels.length,
        characterCount: storyboard.characters.length,
        sceneCount: storyboard.scenes ? storyboard.scenes.length : 0
      });
      
      console.log(`[AnalyzeWorker] Job ${jobId} completed successfully`);
      
    } catch (error) {
      console.error(`[AnalyzeWorker] Job ${jobId} failed:`, error);
      
      await updateJob(jobId, 'failed', {
        percentage: 0,
        stage: 'failed'
      }, error.message);
      
      console.warn(`[AnalyzeWorker] 消息 ${jobId} 将被标记为已处理以避免队列阻塞`);
      batchItemFailures.push({ itemIdentifier: record.messageId });
      continue;
    }
  }
  
  return {
    batchItemFailures
  };
};

module.exports.lambdaHandler = exports.handler;
