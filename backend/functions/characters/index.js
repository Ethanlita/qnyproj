const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');
const { successResponse, errorResponse, corsHeaders } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { uploadImage, getPresignedUrl } = require('../../lib/s3-utils');
const { v4: uuid } = require('uuid');

let Busboy = null;
try {
  // eslint-disable-next-line global-require
  Busboy = require('busboy');
} catch (error) {
  console.warn('[CharactersFunction] busboy not installed, multipart uploads will use JSON fallback');
}

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;
const MAX_UPLOADS = 10;
const DEFAULT_CONFIG_LIMIT = 100;

// File upload validation constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Main Lambda handler
 */
exports.handler = async (event) => {
  try {
    const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
    const rawPath = event.rawPath || event.path || '';
    const path = rawPath.replace(/^\/dev/i, '');
    const userId = getUserId(event) || 'anonymous';

    console.log(`[CharactersFunction] ${method} ${rawPath} (user: ${userId})`);

    if (!TABLE_NAME) {
      throw new Error('TABLE_NAME environment variable not set');
    }

    // GET /characters/{charId}
    if (method === 'GET' && /^\/characters\/[^/]+$/.test(path)) {
      const { charId } = event.pathParameters || {};
      const character = await loadCharacter(charId);
      if (!character) {
        return errorResponse(404, `Character ${charId} not found`);
      }
      const configurations = await listConfigurations(charId);
      const enrichedConfigs = await Promise.all(
        configurations.map(async (config) => formatConfigurationResponse(config))
      );

      return successResponse({
        ...formatCharacterResponse(character),
        configurations: enrichedConfigs
      });
    }

    // PUT /characters/{charId}
    if (method === 'PUT' && /^\/characters\/[^/]+$/.test(path)) {
      const { charId } = event.pathParameters || {};
      const payload = parseJsonBody(event.body);

      const existing = await loadCharacter(charId);
      if (!existing) {
        return errorResponse(404, `Character ${charId} not found`);
      }

      const updated = await updateCharacter(existing, payload);
      return successResponse(formatCharacterResponse(updated));
    }

    // GET /characters/{charId}/configurations
    if (method === 'GET' && /^\/characters\/[^/]+\/configurations$/.test(path)) {
      const { charId } = event.pathParameters || {};
      const configs = await listConfigurations(charId, DEFAULT_CONFIG_LIMIT);
      const enriched = await Promise.all(configs.map((config) => formatConfigurationResponse(config)));
      return successResponse(enriched);
    }

    // POST /characters/{charId}/configurations
    if (method === 'POST' && /^\/characters\/[^/]+\/configurations$/.test(path)) {
      const { charId } = event.pathParameters || {};
      const character = await loadCharacter(charId);
      if (!character) {
        return errorResponse(404, `Character ${charId} not found`);
      }

      const payload = parseJsonBody(event.body);
      if (!payload.name) {
        return errorResponse(400, 'Configuration name is required');
      }

      const config = await createConfiguration(character, payload);
      return successResponse(await formatConfigurationResponse(config), 201);
    }

    // GET /characters/{charId}/configurations/{configId}
    if (
      method === 'GET' &&
      /^\/characters\/[^/]+\/configurations\/[^/]+$/.test(path) &&
      !path.includes('/refs')
    ) {
      const { charId, configId } = event.pathParameters || {};
      const config = await loadConfiguration(charId, configId);
      if (!config) {
        return errorResponse(404, `Configuration ${configId} not found`);
      }
      return successResponse(await formatConfigurationResponse(config));
    }

    // PUT /characters/{charId}/configurations/{configId}
    if (method === 'PUT' && /^\/characters\/[^/]+\/configurations\/[^/]+$/.test(path)) {
      const { charId, configId } = event.pathParameters || {};
      const payload = parseJsonBody(event.body);
      const config = await updateConfiguration(charId, configId, payload);
      return successResponse(await formatConfigurationResponse(config));
    }

    // DELETE /characters/{charId}/configurations/{configId}
    if (method === 'DELETE' && /^\/characters\/[^/]+\/configurations\/[^/]+$/.test(path)) {
      const { charId, configId } = event.pathParameters || {};
      await deleteConfiguration(charId, configId);
      return {
        statusCode: 204,
        headers: corsHeaders(),
        body: ''
      };
    }

    // POST /characters/{charId}/configurations/{configId}/refs
    if (method === 'POST' && /\/configurations\/[^/]+\/refs$/.test(path)) {
      const { charId, configId } = event.pathParameters || {};
      const config = await loadConfiguration(charId, configId);
      if (!config) {
        return errorResponse(404, `Configuration ${configId} not found`);
      }

      const { files, fields } = await parseUploads(event);
      if (files.length === 0) {
        return errorResponse(400, 'No files uploaded');
      }
      if (files.length > MAX_UPLOADS) {
        return errorResponse(400, `Too many files, maximum ${MAX_UPLOADS}`);
      }

      // ⭐ 问题 1 修复: 文件校验（在上传前验证所有文件）
      const validationErrors = validateUploadedFiles(files);
      if (validationErrors.length > 0) {
        console.error('[CharactersFunction] File validation failed:', validationErrors);
        return errorResponse(400, `File validation failed:\n${validationErrors.join('\n')}`);
      }

      const timestamp = new Date().toISOString();
      const uploaded = [];
      const uploadedKeys = []; // Track uploaded keys for rollback

      try {
        // Upload all files
        for (let idx = 0; idx < files.length; idx += 1) {
          const file = files[idx];
          const captionField = Array.isArray(fields.caption) ? fields.caption[idx] : fields.caption;
          const caption = captionField || file.filename || `Reference ${idx + 1}`;

          const key = `characters/${charId}/${configId}/refs/${Date.now()}-${idx}-${sanitizeFilename(
            file.filename || 'image.png'
          )}`;

          console.log(`[CharactersFunction] Uploading file ${idx + 1}/${files.length}: ${key}`);

          await uploadImage(key, file.buffer, {
            contentType: file.contentType || 'image/png',
            metadata: {
              'char-id': charId,
              'config-id': configId,
              caption
            },
            tagging: `Type=reference&Character=${charId}`
          });

          uploadedKeys.push(key); // Track for potential rollback
          uploaded.push({
            s3Key: key,
            caption,
            uploadedAt: timestamp
          });
        }

        // Update DynamoDB record
        const newReferences = mergeReferenceImages(config.referenceImagesS3 || [], uploaded);
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: buildConfigKey(charId, configId),
            UpdateExpression: 'SET referenceImagesS3 = :refs, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':refs': newReferences,
              ':updatedAt': new Date().toISOString()
            }
          })
        );

        console.log(`[CharactersFunction] Successfully uploaded ${uploaded.length} reference images`);

        // Generate response with presigned URLs
        const response = await Promise.all(
          uploaded.map(async (item) => ({
            ...item,
            url: await getPresignedUrl(item.s3Key)
          }))
        );

        return successResponse({ uploaded: response });
      } catch (error) {
        // ⭐ 问题 1 修复: 异常回滚机制（删除已上传的文件）
        console.error('[CharactersFunction] Upload failed, rolling back:', error);
        await rollbackUploadedFiles(uploadedKeys);
        throw error;
      }
    }

    return errorResponse(404, 'Not found');
  } catch (error) {
    console.error('[CharactersFunction] Error:', error);
    return errorResponse(500, error.message || 'Internal Server Error');
  }
};

/**
 * Load character using the global secondary index (CHAR#charId).
 */
async function loadCharacter(charId) {
  if (!charId) return null;

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `CHAR#${charId}`,
        ':sk': `CHAR#${charId}`
      },
      Limit: 1
    })
  );

  return result.Items?.[0] || null;
}

async function updateCharacter(existing, payload) {
  const updatedItem = {
    ...existing,
    name: payload.name || existing.name,
    role: payload.role || existing.role,
    baseInfo: payload.baseInfo || existing.baseInfo,
    updatedAt: new Date().toISOString()
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: updatedItem
    })
  );

  return updatedItem;
}

async function listConfigurations(charId, limit = DEFAULT_CONFIG_LIMIT) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :config)',
      ExpressionAttributeValues: {
        ':pk': `CHAR#${charId}`,
        ':config': 'CONFIG#'
      },
      Limit: limit
    })
  );
  return result.Items || [];
}

async function createConfiguration(character, payload) {
  const configId = payload.id || uuid();
  const timestamp = new Date().toISOString();

  // Check for duplicate configuration name (Medium #1 fix)
  if (payload.name) {
    const existingConfigs = await listConfigurations(character.id);
    const duplicate = existingConfigs.find(cfg => 
      cfg.name === payload.name && cfg.id !== configId
    );
    
    if (duplicate) {
      throw new Error(`Configuration with name "${payload.name}" already exists for this character`);
    }
  }

  const item = {
    PK: `CHAR#${character.id}`,
    SK: `CONFIG#${configId}`,
    id: configId,
    charId: character.id,
    novelId: character.novelId,
    name: payload.name,
    description: payload.description || '',
    tags: payload.tags || [],
    appearance: payload.appearance || {},
    referenceImagesS3: [],
    generatedPortraitsS3: [],
    isDefault: Boolean(payload.isDefault),
    createdAt: timestamp,
    updatedAt: timestamp,
    GSI1PK: `CONFIG#${configId}`,
    GSI1SK: `CONFIG#${configId}`
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item
    })
  );

  if (item.isDefault) {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: character.PK,
          SK: character.SK
        },
        UpdateExpression: 'SET defaultConfigId = :configId, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':configId': item.id,
          ':updatedAt': new Date().toISOString()
        }
      })
    );
  }

  return item;
}

async function loadConfiguration(charId, configId) {
  if (!charId || !configId) return null;

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: buildConfigKey(charId, configId)
    })
  );
  return result.Item || null;
}

async function updateConfiguration(charId, configId, payload) {
  const existing = await loadConfiguration(charId, configId);
  if (!existing) {
    throw new Error(`Configuration ${configId} not found`);
  }

  const updated = {
    ...existing,
    name: payload.name ?? existing.name,
    description: payload.description ?? existing.description,
    tags: payload.tags ?? existing.tags,
    appearance: payload.appearance ?? existing.appearance,
    isDefault: payload.isDefault ?? existing.isDefault,
    updatedAt: new Date().toISOString()
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: updated
    })
  );

  if (updated.isDefault && updated.charId) {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `NOVEL#${updated.novelId}`,
          SK: `CHAR#${updated.charId}`
        },
        UpdateExpression: 'SET defaultConfigId = :configId, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':configId': updated.id,
          ':updatedAt': new Date().toISOString()
        }
      })
    );
  }

  return updated;
}

async function deleteConfiguration(charId, configId) {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: buildConfigKey(charId, configId)
    })
  );
}

/**
 * Merge new reference entries while deduplicating by s3Key.
 */
function mergeReferenceImages(existing, incoming) {
  const merged = [...(existing || [])];
  const index = new Map(merged.map((item) => [item.s3Key, item]));

  for (const ref of incoming) {
    if (index.has(ref.s3Key)) {
      Object.assign(index.get(ref.s3Key), ref);
    } else {
      merged.push(ref);
      index.set(ref.s3Key, ref);
    }
  }
  return merged;
}

function buildConfigKey(charId, configId) {
  return {
    PK: `CHAR#${charId}`,
    SK: `CONFIG#${configId}`
  };
}

function parseJsonBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

async function parseUploads(event) {
  const headers = lowerCaseHeaders(event.headers || {});
  const contentType = headers['content-type'] || headers['Content-Type'];

  if (contentType && contentType.includes('multipart/form-data') && Busboy) {
    return parseMultipart(event, contentType);
  }

  // Fallback: expect JSON payload { images: [{ filename, contentType, data(base64), caption? }] }
  const payload = parseJsonBody(event.body);
  const images = Array.isArray(payload.images) ? payload.images : [];
  const files = images.map((image) => ({
    fieldname: 'images',
    filename: image.filename || 'upload.png',
    contentType: image.contentType || 'image/png',
    buffer: Buffer.from(image.data || '', image.encoding || 'base64')
  }));

  return { files, fields: payload.fields || {} };
}

function lowerCaseHeaders(headers) {
  return Object.entries(headers || {}).reduce((acc, [key, value]) => {
    acc[key.toLowerCase()] = value;
    return acc;
  }, {});
}

function parseMultipart(event, contentType) {
  return new Promise((resolve, reject) => {
    const files = [];
    const fields = {};
    const busboy = Busboy({
      headers: {
        'content-type': contentType
      }
    });

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      const chunks = [];
      file.on('data', (data) => chunks.push(data));
      file.on('end', () => {
        files.push({
          fieldname,
          filename,
          contentType: mimetype,
          buffer: Buffer.concat(chunks)
        });
      });
    });

    busboy.on('field', (fieldname, value) => {
      if (fields[fieldname]) {
        if (!Array.isArray(fields[fieldname])) {
          fields[fieldname] = [fields[fieldname]];
        }
        fields[fieldname].push(value);
      } else {
        fields[fieldname] = value;
      }
    });

    busboy.on('error', reject);
    busboy.on('finish', () => resolve({ files, fields }));

    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : event.body;
    busboy.end(body);
  });
}

async function formatConfigurationResponse(config) {
  const referenceImages = await Promise.all(
    (config.referenceImagesS3 || []).map(async (item) => ({
      ...item,
      url: await getPresignedUrl(item.s3Key)
    }))
  );

  const generatedPortraits = await Promise.all(
    (config.generatedPortraitsS3 || []).map(async (item) => ({
      ...item,
      url: await getPresignedUrl(item.s3Key)
    }))
  );

  return {
    id: config.id,
    charId: config.charId,
    novelId: config.novelId,
    name: config.name,
    description: config.description,
    tags: config.tags || [],
    appearance: config.appearance || {},
    referenceImages,
    generatedPortraits,
    isDefault: Boolean(config.isDefault),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}

function formatCharacterResponse(character) {
  return {
    id: character.id,
    novelId: character.novelId,
    name: character.name,
    role: character.role,
    baseInfo: character.baseInfo || {},
    defaultConfigId: character.defaultConfigId || null,
    portraits: character.portraits || [],
    createdAt: character.createdAt,
    updatedAt: character.updatedAt
  };
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Validate uploaded files (type, size, extension).
 * Returns array of error messages (empty if all valid).
 */
function validateUploadedFiles(files) {
  const errors = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const fileIndex = i + 1;

    // Check content type
    if (!ALLOWED_MIME_TYPES.includes(file.contentType)) {
      errors.push(
        `File ${fileIndex} (${file.filename}): Invalid content type "${file.contentType}". ` +
        `Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
      );
    }

    // Check file size
    if (file.buffer && file.buffer.length > MAX_FILE_SIZE) {
      const sizeMB = (file.buffer.length / (1024 * 1024)).toFixed(2);
      const maxSizeMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
      errors.push(
        `File ${fileIndex} (${file.filename}): Size ${sizeMB}MB exceeds limit of ${maxSizeMB}MB`
      );
    }

    // Check file extension
    if (file.filename) {
      const ext = file.filename.toLowerCase().match(/\.[^.]+$/)?.[0];
      if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
        errors.push(
          `File ${fileIndex} (${file.filename}): Invalid extension "${ext}". ` +
          `Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}`
        );
      }
    }
  }

  return errors;
}

/**
 * Rollback: Delete uploaded files from S3 on error.
 */
async function rollbackUploadedFiles(s3Keys) {
  if (!s3Keys || s3Keys.length === 0) {
    return;
  }

  console.log(`[CharactersFunction] Rolling back ${s3Keys.length} uploaded files...`);

  const { deleteImage } = require('../../lib/s3-utils');
  const deletePromises = s3Keys.map(async (key) => {
    try {
      await deleteImage(key);
      console.log(`[CharactersFunction] Deleted: ${key}`);
    } catch (error) {
      console.error(`[CharactersFunction] Failed to delete ${key}:`, error);
      // Continue deleting other files
    }
  });

  await Promise.all(deletePromises);
  console.log('[CharactersFunction] Rollback completed');
}

