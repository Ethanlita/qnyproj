/**
 * BibleManager - Manage character and scene bibles with DynamoDB + S3 hybrid storage
 *
 * Responsibilities:
 *  - Fetch the latest (or specific) bible for a novel
 *  - Merge new bible data with existing entries (deduplicate + preserve attributes)
 *  - Persist bible versions to DynamoDB, offloading large payloads to S3 when needed
 *  - Provide history listing utilities for API responses
 */

const { GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const DEFAULT_MAX_DYNAMO_ITEM_BYTES = 400 * 1024; // 400 KB
const DEFAULT_S3_PREFIX = 'bibles';
const DEFAULT_HISTORY_LIMIT = 20;

/**
 * Safely clone structured JSON data (objects/arrays).
 * We intentionally avoid structuredClone for wider compatibility with Node runtimes.
 */
function cloneJson(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.slice() : [value];
}

function mergeStringArrays(base = [], incoming = []) {
  const result = new Set();
  ensureArray(base).forEach(item => {
    if (typeof item === 'string' && item.trim()) {
      result.add(item);
    }
  });
  ensureArray(incoming).forEach(item => {
    if (typeof item === 'string' && item.trim()) {
      result.add(item);
    }
  });
  return Array.from(result);
}

function mergeObjectPreserve(base = {}, incoming = {}) {
  const result = { ...cloneJson(base) };
  const source = cloneJson(incoming) || {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      result[key] = mergeStringArrays(result[key], value);
    } else if (typeof value === 'object') {
      result[key] = mergeObjectPreserve(result[key] || {}, value);
    } else if (!result[key]) {
      result[key] = value;
    }
  }

  return result;
}

function mergeObjectArray(base = [], incoming = [], keyField) {
  const list = [];
  const index = new Map();

  for (const item of base || []) {
    if (!item) continue;
    const clone = cloneJson(item);
    list.push(clone);
    if (keyField && clone && clone[keyField]) {
      index.set(clone[keyField], clone);
    }
  }

  for (const item of incoming || []) {
    if (!item) continue;
    const clone = cloneJson(item);
    const key = keyField && clone ? clone[keyField] : undefined;

    if (key && index.has(key)) {
      const target = index.get(key);
      for (const [field, value] of Object.entries(clone)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          target[field] = mergeStringArrays(target[field], value);
        } else if (typeof value === 'object') {
          target[field] = mergeObjectPreserve(target[field] || {}, value);
        } else if (!target[field]) {
          target[field] = value;
        }
      }
    } else {
      list.push(clone);
      if (key) {
        index.set(key, clone);
      }
    }
  }

  return list;
}

function mergeAppearance(base = {}, incoming = {}) {
  const merged = { ...cloneJson(base) };
  const source = cloneJson(incoming) || {};

  const arrayFields = ['clothing', 'distinctiveFeatures', 'accessories'];
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    if (arrayFields.includes(key)) {
      merged[key] = mergeStringArrays(merged[key], value);
    } else if (!merged[key]) {
      merged[key] = value;
    }
  }

  return merged;
}

function buildFirstAppearance(chapterNumber) {
  if (!chapterNumber || Number.isNaN(Number(chapterNumber))) {
    return { chapter: 1 };
  }
  return { chapter: Number(chapterNumber) };
}

function parseS3Uri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('s3://')) {
    throw new Error(`Unsupported storage location: ${uri}`);
  }
  const withoutScheme = uri.slice('s3://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(`Invalid S3 URI: ${uri}`);
  }
  return {
    bucket: withoutScheme.slice(0, slashIndex),
    key: withoutScheme.slice(slashIndex + 1)
  };
}

class BibleManager {
  /**
   * @param {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} dynamoClient
   * @param {import('@aws-sdk/client-s3').S3Client} s3Client
   * @param {string} tableName
   * @param {string} bucketName
   * @param {object} [options]
   * @param {number} [options.maxDynamoItemBytes]
   * @param {string} [options.s3Prefix]
   * @param {string} [options.latestVersionIndexName]
   */
  constructor(dynamoClient, s3Client, tableName, bucketName, options = {}) {
    if (!dynamoClient || typeof dynamoClient.send !== 'function') {
      throw new Error('BibleManager requires a DynamoDBDocumentClient instance');
    }
    if (!s3Client || typeof s3Client.send !== 'function') {
      throw new Error('BibleManager requires an S3Client instance');
    }
    if (!tableName) {
      throw new Error('BibleManager requires tableName');
    }
    if (!bucketName) {
      throw new Error('BibleManager requires bucketName');
    }

    this.dynamoClient = dynamoClient;
    this.s3Client = s3Client;
    this.tableName = tableName;
    this.bucketName = bucketName;
    this.maxDynamoItemBytes = options.maxDynamoItemBytes || DEFAULT_MAX_DYNAMO_ITEM_BYTES;
    this.s3Prefix = options.s3Prefix || DEFAULT_S3_PREFIX;
    this.latestVersionIndexName = options.latestVersionIndexName || 'LatestVersionIndex';
  }

  /**
   * Get bible for a novel. Defaults to the latest version.
   * @param {string} novelId
   * @param {object} [options]
   * @param {number} [options.version]
   * @returns {Promise<{exists: boolean, novelId: string, version: number, characters: Array, scenes: Array, metadata: object}>}
   */
  async getBible(novelId, options = {}) {
    const { version } = options;

    if (!novelId) {
      throw new Error('novelId is required');
    }

    let item = null;

    if (version) {
      const response = await this.dynamoClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { novelId, version: Number(version) }
        })
      );
      item = response.Item || null;
    } else {
      const response = await this.dynamoClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: this.latestVersionIndexName,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': 'GSI1PK' },
          ExpressionAttributeValues: { ':pk': `NOVEL#${novelId}` },
          Limit: 1,
          ScanIndexForward: false
        })
      );
      item = response.Items?.[0] || null;
    }

    if (!item) {
      return {
        exists: false,
        novelId,
        version: 0,
        characters: [],
        scenes: [],
        metadata: {
          createdAt: null,
          updatedAt: null,
          lastChapter: 0,
          totalCharacters: 0,
          totalScenes: 0,
          storageLocation: null
        }
      };
    }

    const metadata = item.metadata || {
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
      lastChapter: item.lastChapter || 0,
      totalCharacters: item.totalCharacters || (item.characters?.length || 0),
      totalScenes: item.totalScenes || (item.scenes?.length || 0),
      storageLocation: item.storageLocation || null
    };

    let characters = cloneJson(item.characters) || [];
    let scenes = cloneJson(item.scenes) || [];

    if (metadata.storageLocation) {
      const { bucket, key } = parseS3Uri(metadata.storageLocation);
      const s3Response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key
        })
      );

      const payload = await s3Response.Body.transformToString();
      const parsed = JSON.parse(payload);
      characters = parsed.characters || [];
      scenes = parsed.scenes || [];
    }

    return {
      exists: true,
      novelId,
      version: item.version,
      characters,
      scenes,
      metadata
    };
  }

  /**
   * Persist a new bible version (merging with existing data).
   * @param {string} novelId
   * @param {Array} characters
   * @param {Array} scenes
   * @param {number} chapterNumber
   * @returns {Promise<{version: number, metadata: object, storageLocation: string | null}>}
   */
  async saveBible(novelId, characters = [], scenes = [], chapterNumber) {
    if (!novelId) {
      throw new Error('novelId is required');
    }

    const existing = await this.getBible(novelId);
    const mergedCharacters = this.mergeCharacters(existing.characters, characters, chapterNumber);
    const mergedScenes = this.mergeScenes(existing.scenes, scenes, chapterNumber);
    const nextVersion = (existing.exists ? existing.version : 0) + 1;
    const now = new Date().toISOString();
    const createdAt = existing.metadata?.createdAt || now;
    const lastChapter = Number.isInteger(chapterNumber) ? chapterNumber : (existing.metadata?.lastChapter || 0);

    const metadata = {
      createdAt,
      updatedAt: now,
      lastChapter,
      totalCharacters: mergedCharacters.length,
      totalScenes: mergedScenes.length,
      storageLocation: null
    };

    const serialized = JSON.stringify({
      novelId,
      version: nextVersion,
      characters: mergedCharacters,
      scenes: mergedScenes
    });

    let dynamoCharacters = mergedCharacters;
    let dynamoScenes = mergedScenes;

    if (Buffer.byteLength(serialized, 'utf8') >= this.maxDynamoItemBytes) {
      const s3Key = `${this.s3Prefix}/${novelId}/v${nextVersion}.json`;
      const storageLocation = `s3://${this.bucketName}/${s3Key}`;

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
          Body: serialized,
          ContentType: 'application/json'
        })
      );

      metadata.storageLocation = storageLocation;
      dynamoCharacters = [];
      dynamoScenes = [];
    }

    const item = {
      novelId,
      version: nextVersion,
      characters: dynamoCharacters,
      scenes: dynamoScenes,
      metadata,
      createdAt,
      updatedAt: metadata.updatedAt,
      lastChapter: metadata.lastChapter,
      totalCharacters: metadata.totalCharacters,
      totalScenes: metadata.totalScenes,
      storageLocation: metadata.storageLocation,
      GSI1PK: `NOVEL#${novelId}`,
      GSI1SK: `UPDATED#${metadata.updatedAt}`
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item
      })
    );

    return {
      version: nextVersion,
      metadata,
      storageLocation: metadata.storageLocation,
      characters: mergedCharacters,
      scenes: mergedScenes
    };
  }

  /**
   * Merge new characters with existing bible entries.
   * @param {Array} existing
   * @param {Array} newCharacters
   * @param {number} chapterNumber
   * @returns {Array}
   */
  mergeCharacters(existing = [], newCharacters = [], chapterNumber) {
    const map = new Map();

    for (const character of existing || []) {
      if (!character || !character.name) continue;
      map.set(character.name, cloneJson(character));
    }

    for (const incoming of newCharacters || []) {
      if (!incoming || !incoming.name) continue;
      const key = incoming.name;
      const candidate = cloneJson(incoming);

      if (map.has(key)) {
        const current = map.get(key);

        if (!current.role && candidate.role) {
          current.role = candidate.role;
        }

        if (candidate.personality) {
          current.personality = mergeStringArrays(current.personality, candidate.personality);
        }

        if (candidate.appearance) {
          current.appearance = mergeAppearance(current.appearance, candidate.appearance);
        }

        if (!current.firstAppearance && candidate.firstAppearance) {
          current.firstAppearance = candidate.firstAppearance;
        }

        if (candidate.referenceImages) {
          current.referenceImages = mergeStringArrays(current.referenceImages, candidate.referenceImages);
        }

        map.set(key, current);
      } else {
        if (!candidate.firstAppearance) {
          candidate.firstAppearance = buildFirstAppearance(chapterNumber);
        }
        if (candidate.personality) {
          candidate.personality = mergeStringArrays([], candidate.personality);
        }
        if (candidate.appearance) {
          candidate.appearance = mergeAppearance({}, candidate.appearance);
        }
        map.set(key, candidate);
      }
    }

    return Array.from(map.values());
  }

  /**
   * Merge new scenes with existing bible entries.
   * @param {Array} existing
   * @param {Array} newScenes
   * @param {number} chapterNumber
   * @returns {Array}
   */
  mergeScenes(existing = [], newScenes = [], chapterNumber) {
    const map = new Map();

    for (const scene of existing || []) {
      if (!scene || !scene.id) continue;
      map.set(scene.id, cloneJson(scene));
    }

    for (const incoming of newScenes || []) {
      if (!incoming || !incoming.id) continue;
      const key = incoming.id;
      const candidate = cloneJson(incoming);

      if (map.has(key)) {
        const current = map.get(key);

        if (!current.name && candidate.name) {
          current.name = candidate.name;
        }
        if (!current.type && candidate.type) {
          current.type = candidate.type;
        }
        if (!current.description && candidate.description) {
          current.description = candidate.description;
        }
        if (candidate.visualCharacteristics) {
          current.visualCharacteristics = current.visualCharacteristics || {};
          for (const [vKey, vValue] of Object.entries(candidate.visualCharacteristics)) {
            if (Array.isArray(vValue)) {
              current.visualCharacteristics[vKey] = mergeStringArrays(current.visualCharacteristics[vKey], vValue);
            } else if (!current.visualCharacteristics[vKey]) {
              current.visualCharacteristics[vKey] = vValue;
            } else if (typeof vValue === 'object') {
              current.visualCharacteristics[vKey] = mergeObjectPreserve(current.visualCharacteristics[vKey], vValue);
            }
          }
        }
        if (candidate.spatialLayout) {
          current.spatialLayout = current.spatialLayout || {};
          for (const [layoutKey, layoutValue] of Object.entries(candidate.spatialLayout)) {
            if (Array.isArray(layoutValue)) {
              if (layoutKey === 'keyAreas') {
                current.spatialLayout[layoutKey] = mergeObjectArray(current.spatialLayout[layoutKey], layoutValue, 'name');
              } else {
                current.spatialLayout[layoutKey] = mergeStringArrays(current.spatialLayout[layoutKey], layoutValue);
              }
            } else if (!current.spatialLayout[layoutKey]) {
              current.spatialLayout[layoutKey] = layoutValue;
            } else if (typeof layoutValue === 'object') {
              current.spatialLayout[layoutKey] = mergeObjectPreserve(current.spatialLayout[layoutKey], layoutValue);
            }
          }
        }
        if (candidate.timeVariations) {
          current.timeVariations = mergeObjectArray(current.timeVariations, candidate.timeVariations, 'timeOfDay');
        }
        if (candidate.weatherVariations) {
          current.weatherVariations = mergeObjectArray(current.weatherVariations, candidate.weatherVariations, 'weather');
        }
        if (!current.firstAppearance && candidate.firstAppearance) {
          current.firstAppearance = candidate.firstAppearance;
        }
        if (candidate.referenceImages) {
          current.referenceImages = mergeStringArrays(current.referenceImages, candidate.referenceImages);
        }

        map.set(key, current);
      } else {
        if (!candidate.firstAppearance) {
          candidate.firstAppearance = buildFirstAppearance(chapterNumber);
        }
        map.set(key, candidate);
      }
    }

    return Array.from(map.values());
  }

  /**
   * List bible history (versions) for a novel.
   * @param {string} novelId
   * @param {object} [options]
   * @param {number} [options.limit]
   * @returns {Promise<Array<{version:number, updatedAt:string, lastChapter:number, totalCharacters:number, totalScenes:number, storageLocation:string|null}>>}
   */
  async listHistory(novelId, options = {}) {
    if (!novelId) {
      throw new Error('novelId is required');
    }

    const limit = options.limit || DEFAULT_HISTORY_LIMIT;

    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': 'novelId' },
        ExpressionAttributeValues: { ':pk': novelId },
        ScanIndexForward: false,
        Limit: limit
      })
    );

    return (response.Items || []).map(item => {
      const metadata = item.metadata || {};
      return {
        version: item.version,
        updatedAt: metadata.updatedAt || item.updatedAt || null,
        lastChapter: metadata.lastChapter || item.lastChapter || 0,
        totalCharacters: metadata.totalCharacters || item.totalCharacters || 0,
        totalScenes: metadata.totalScenes || item.totalScenes || 0,
        storageLocation: metadata.storageLocation || item.storageLocation || null
      };
    });
  }
}

module.exports = BibleManager;
