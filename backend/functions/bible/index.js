const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');

const BibleManager = require('../../lib/bible-manager');
const { successResponse, errorResponse } = require('../../lib/response');

const dynamodbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamodbClient);
const s3Client = new S3Client({});

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

exports.handler = async (event) => {
  try {
    const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
    const resource = event.resource || event.requestContext?.resourcePath || event.rawPath;
    const novelId = event.pathParameters?.novelId || event.pathParameters?.id;

    if (!novelId) {
      return errorResponse(400, 'Missing novelId path parameter');
    }

    const manager = buildManager();

    if (method === 'GET' && resource === '/novels/{novelId}/bible') {
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

      return successResponse({
        novelId: bible.novelId,
        version: bible.version,
        characters: bible.characters,
        scenes: bible.scenes,
        metadata: bible.metadata
      });
    }

    if (method === 'GET' && resource === '/novels/{novelId}/bible/history') {
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
