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

// AWS Clients
const dynamodbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamodbClient);
const s3Client = new S3Client({});
const secretsClient = new SecretsManagerClient({});

// AJV validator
const ajv = new Ajv({ allErrors: true });

// Environment variables
const TABLE_NAME = process.env.TABLE_NAME;
const ASSETS_BUCKET = process.env.ASSETS_BUCKET;
const QWEN_SECRET_ARN = process.env.QWEN_SECRET_ARN;

// Load schemas
const storyboardSchema = require('../../schemas/storyboard.json');
const validateStoryboard = ajv.compile(storyboardSchema);

// Cache for Qwen credentials
let qwenAdapterCache = null;

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
  
  qwenAdapterCache = new QwenAdapter({
    apiKey: secret.apiKey,
    endpoint: secret.endpoint
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
  
  console.log('[AnalyzeWorker] Writing storyboard to DynamoDB');
  console.log(`  - Panels: ${storyboard.panels.length}`);
  console.log(`  - Characters: ${storyboard.characters.length}`);
  console.log(`  - Scenes: ${storyboard.scenes ? storyboard.scenes.length : 0}`);
  
  // 1. Create Storyboard item
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
    GSI1SK: `STORYBOARD#${timestamp}`
  };
  
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: storyboardItem
  }));
  
  console.log(`[AnalyzeWorker] Storyboard ${storyboardId} created`);
  
  // 2. Batch write Panels (max 25 items per batch)
  const panelItems = storyboard.panels.map((panel, idx) => ({
    PK: `STORYBOARD#${storyboardId}`,
    SK: `PANEL#${String(idx).padStart(4, '0')}`,
    id: uuid(),
    storyboardId,
    novelId,
    ...panel,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp
  }));
  
  // Write panels in batches of 25
  for (let i = 0; i < panelItems.length; i += 25) {
    const batch = panelItems.slice(i, i + 25);
    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: batch.map(item => ({
          PutRequest: { Item: item }
        }))
      }
    }));
    console.log(`[AnalyzeWorker] Wrote panels ${i + 1}-${Math.min(i + 25, panelItems.length)}`);
  }
  
  // 3. Write Characters
  const characterItems = storyboard.characters.map(char => ({
    PK: `NOVEL#${novelId}`,
    SK: `CHARACTER#${char.name}`,
    id: uuid(),
    novelId,
    storyboardId,
    ...char,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
  
  for (let i = 0; i < characterItems.length; i += 25) {
    const batch = characterItems.slice(i, i + 25);
    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: batch.map(item => ({
          PutRequest: { Item: item }
        }))
      }
    }));
    console.log(`[AnalyzeWorker] Wrote characters ${i + 1}-${Math.min(i + 25, characterItems.length)}`);
  }
  
  // 4. Write Scenes (if present)
  if (storyboard.scenes && storyboard.scenes.length > 0) {
    const sceneItems = storyboard.scenes.map(scene => ({
      PK: `NOVEL#${novelId}`,
      SK: `SCENE#${scene.id}`,
      id: scene.id,
      novelId,
      storyboardId,
      ...scene,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    
    for (let i = 0; i < sceneItems.length; i += 25) {
      const batch = sceneItems.slice(i, i + 25);
      await docClient.send(new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map(item => ({
            PutRequest: { Item: item }
          }))
        }
      }));
      console.log(`[AnalyzeWorker] Wrote scenes ${i + 1}-${Math.min(i + 25, sceneItems.length)}`);
    }
  }
  
  // 5. Update Novel with storyboard reference
  await docClient.send(new UpdateCommand({
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
  }));
  
  console.log('[AnalyzeWorker] Novel updated with storyboard reference');
  
  return { storyboardId };
}

/**
 * Main handler - processes SQS messages
 */
exports.handler = async (event) => {
  console.log(`[AnalyzeWorker] Processing ${event.Records.length} messages`);
  
  for (const record of event.Records) {
    // SQS body might be double-encoded, handle both cases
    let messageBody;
    try {
      messageBody = JSON.parse(record.body);
    } catch (e) {
      // If first parse fails, body might already be an object
      messageBody = record.body;
    }
    
    const { jobId, novelId, userId } = messageBody;
    
    console.log(`[AnalyzeWorker] Starting job ${jobId} for novel ${novelId}`);
    
    try {
      // 1. Update job to running
      await updateJob(jobId, 'running', { percentage: 5, stage: 'initializing' });
      
      // 2. Fetch novel text
      await updateJob(jobId, 'running', { percentage: 10, stage: 'fetching_text' });
      const { novel, text } = await getNovelText(novelId);
      console.log(`[AnalyzeWorker] Novel text length: ${text.length} chars`);
      
      // 3. Initialize Qwen adapter
      await updateJob(jobId, 'running', { percentage: 20, stage: 'initializing_qwen' });
      const qwenAdapter = await getQwenAdapter();
      
      // 4. Generate storyboard
      await updateJob(jobId, 'running', { percentage: 30, stage: 'generating_storyboard' });
      const storyboard = await qwenAdapter.generateStoryboard({
        text,
        jsonSchema: storyboardSchema,
        strictMode: true,
        maxChunkLength: 8000
      });
      
      console.log('[AnalyzeWorker] Storyboard generated');
      console.log(`  - Panels: ${storyboard.panels.length}`);
      console.log(`  - Characters: ${storyboard.characters.length}`);
      console.log(`  - Scenes: ${storyboard.scenes ? storyboard.scenes.length : 0}`);
      
      // 5. Validate storyboard
      await updateJob(jobId, 'running', { percentage: 85, stage: 'validating' });
      const valid = validateStoryboard(storyboard);
      
      if (!valid) {
        console.warn('[AnalyzeWorker] Storyboard validation failed:', validateStoryboard.errors);
        throw new Error('Generated storyboard does not match schema');
      }
      
      console.log('[AnalyzeWorker] Storyboard validated successfully');
      
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
      
      // Re-throw to let SQS handle retry/DLQ
      throw error;
    }
  }
  
  return {
    statusCode: 200,
    body: JSON.stringify({ processed: event.Records.length })
  };
};
