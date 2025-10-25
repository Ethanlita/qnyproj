const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BibleManager = require('../../lib/bible-manager');
const { successResponse, errorResponse } = require('../../lib/response');
const { getUserId } = require('../../lib/auth');
const { getPresignedUrl } = require('../../lib/s3-utils');

const dynamodbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamodbClient);
const s3Client = new S3Client({});

const CHARACTER_RESOURCE_PATHS = new Set([
  '/novels/{id}/bible/characters/{characterName}',
  '/novels/{novelId}/bible/characters/{characterName}'
]);
const SCENE_RESOURCE_PATHS = new Set([
  '/novels/{id}/bible/scenes/{sceneId}',
  '/novels/{novelId}/bible/scenes/{sceneId}'
]);
const UPLOAD_RESOURCE_PATHS = new Set([
  '/novels/{id}/bible/uploads',
  '/novels/{novelId}/bible/uploads'
]);

const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const UPLOAD_URL_TTL_SECONDS = 900;

function resolveBucket() {
  const bucket = process.env.BIBLES_BUCKET || process.env.ASSETS_BUCKET;
  if (!bucket) {
    throw new Error('BIBLES_BUCKET or ASSETS_BUCKET environment variable not set');
  }
  return bucket;
}

function buildManager() {
  const tableName = process.env.BIBLES_TABLE_NAME;
  if (!tableName) {
    throw new Error('BIBLES_TABLE_NAME environment variable not set');
  }
  return new BibleManager(docClient, s3Client, tableName, resolveBucket());
}

function parseVersionParam(query) {
  if (!query?.version) {
    return null;
  }
  const parsed = Number(query.version);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Invalid version parameter');
  }
  return parsed;
}

function parseLimitParam(query) {
  if (!query?.limit) {
    return null;
  }
  const parsed = Number(query.limit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Invalid limit parameter');
  }
  return Math.min(parsed, 100);
}

function parseJsonBody(body) {
  if (!body) {
    return {};
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function slugifyTarget(value) {
  return encodeURIComponent(value)
    .replace(/%/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod || event.requestContext?.http?.method || 'GET';

    // Handle OPTIONS preflight request
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Max-Age': '86400'
        },
        body: ''
      };
    }

    const resource = event.resource || event.requestContext?.resourcePath || event.rawPath;
    const novelId = event.pathParameters?.novelId || event.pathParameters?.id;

    if (!novelId) {
      return errorResponse(400, 'Missing novelId path parameter');
    }

    const manager = buildManager();

    // Match both {novelId} and {id} path patterns
    const isBiblePath = resource === '/novels/{novelId}/bible' || resource === '/novels/{id}/bible';
    const isHistoryPath = resource === '/novels/{novelId}/bible/history' || resource === '/novels/{id}/bible/history';

    if (method === 'PATCH' && CHARACTER_RESOURCE_PATHS.has(resource)) {
      const userId = getUserId(event);
      if (!userId) {
        return errorResponse(401, 'Unauthorized');
      }

      const nameParam = event.pathParameters?.characterName;
      if (!nameParam) {
        return errorResponse(400, 'Missing characterName path parameter');
      }

      let payload;
      try {
        payload = parseJsonBody(event.body);
      } catch (err) {
        return errorResponse(400, err.message);
      }

      const decodedName = decodeURIComponent(nameParam);
      try {
        const updated = await manager.updateCharacter(novelId, decodedName, payload, { updatedBy: userId });
        const lookup = decodedName.toLowerCase();
        const character = updated.characters.find(
          (item) => item && item.name?.toLowerCase() === lookup
        );
        if (!character) {
          return errorResponse(404, `Character ${decodedName} not found`);
        }
        const [decorated] = await attachReferenceImageUrls([character]);
        return successResponse(decorated || character);
      } catch (error) {
        if (error.code === 'CHARACTER_NOT_FOUND' || error.code === 'BIBLE_NOT_FOUND') {
          return errorResponse(404, error.message);
        }
        throw error;
      }
    }

    if (method === 'PATCH' && SCENE_RESOURCE_PATHS.has(resource)) {
      const userId = getUserId(event);
      if (!userId) {
        return errorResponse(401, 'Unauthorized');
      }

      const sceneId = event.pathParameters?.sceneId;
      if (!sceneId) {
        return errorResponse(400, 'Missing sceneId path parameter');
      }

      let payload;
      try {
        payload = parseJsonBody(event.body);
      } catch (err) {
        return errorResponse(400, err.message);
      }

      try {
        const updated = await manager.updateScene(novelId, sceneId, payload, { updatedBy: userId });
        const scene = updated.scenes.find((item) => item && item.id === sceneId);
        if (!scene) {
          return errorResponse(404, `Scene ${sceneId} not found`);
        }
        const [decorated] = await attachReferenceImageUrls([scene]);
        return successResponse(decorated || scene);
      } catch (error) {
        if (error.code === 'SCENE_NOT_FOUND' || error.code === 'BIBLE_NOT_FOUND') {
          return errorResponse(404, error.message);
        }
        throw error;
      }
    }

    if (method === 'POST' && UPLOAD_RESOURCE_PATHS.has(resource)) {
      const userId = getUserId(event);
      if (!userId) {
        return errorResponse(401, 'Unauthorized');
      }

      let payload;
      try {
        payload = parseJsonBody(event.body);
      } catch (err) {
        return errorResponse(400, err.message);
      }

      const { filename, contentType, scope, target } = payload || {};
      if (!filename || !contentType || !scope || !target) {
        return errorResponse(400, 'filename, contentType, scope and target are required');
      }
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        return errorResponse(400, `Unsupported content type ${contentType}`);
      }

      const bucket = resolveBucket();
      const safeName = sanitizeFilename(filename);
      const targetSlug = slugifyTarget(target);
      const prefix = scope === 'scene' ? 'scenes' : 'characters';
      const key = `bibles/${novelId}/${prefix}/${targetSlug}/${Date.now()}-${safeName}`;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        Metadata: {
          'novel-id': novelId,
          scope,
          target,
          'uploaded-by': userId
        }
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
      const previewUrl = await getPresignedUrl(key, UPLOAD_URL_TTL_SECONDS);

      return successResponse({
        uploadUrl,
        fileKey: key,
        expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
        previewUrl
      });
    }

    if (method === 'GET' && isBiblePath) {
      let versionOptions = {};
      try {
        const version = parseVersionParam(event.queryStringParameters);
        if (version) {
          versionOptions = { version };
        }
      } catch (err) {
        return errorResponse(400, err.message);
      }

      const bible = Object.keys(versionOptions).length > 0
        ? await manager.getBible(novelId, versionOptions)
        : await manager.getBible(novelId);

      if (!bible.exists) {
        return errorResponse(404, 'Bible not found');
      }

      const responsePayload = await formatBibleResponse(bible);
      return successResponse(responsePayload);
    }

    if (method === 'GET' && isHistoryPath) {
      let options = {};
      try {
        const limit = parseLimitParam(event.queryStringParameters);
        if (limit) {
          options = { limit };
        }
      } catch (err) {
        return errorResponse(400, err.message);
      }

      const history = await manager.listHistory(novelId, options);
      return successResponse(history);
    }

    return errorResponse(404, 'Not found');
  } catch (error) {
    console.error('[BibleFunction] Error:', error);
    return errorResponse(500, error.message || 'Internal server error');
  }
};

async function attachReferenceImageUrls(entries = []) {
  const result = [];
  for (const entry of entries || []) {
    if (!entry) continue;
    const clone = JSON.parse(JSON.stringify(entry));
    if (Array.isArray(clone.referenceImages) && clone.referenceImages.length > 0) {
      const resolved = [];
      for (const image of clone.referenceImages) {
        if (!image) continue;
        const imageClone = { ...image };
        if (imageClone.s3Key) {
          try {
            imageClone.url = await getPresignedUrl(imageClone.s3Key);
          } catch (error) {
            console.warn('[BibleFunction] Failed to sign reference image', error);
          }
        }
        resolved.push(imageClone);
      }
      clone.referenceImages = resolved;
    }
    result.push(clone);
  }
  return result;
}

async function formatBibleResponse(bible) {
  return {
    novelId: bible.novelId,
    version: bible.version,
    metadata: bible.metadata,
    characters: await attachReferenceImageUrls(bible.characters),
    scenes: await attachReferenceImageUrls(bible.scenes)
  };
}
