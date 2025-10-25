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
const { v4: uuid } = require('uuid');

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

function normaliseStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item.trim() : item))
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
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

function s3UriToKey(uri) {
  try {
    const { key } = parseS3Uri(uri);
    return key;
  } catch (error) {
    return null;
  }
}

function normaliseReferenceImageEntry(entry, defaults = {}) {
  if (!entry) {
    return null;
  }

  const now = defaults.uploadedAt || new Date().toISOString();

  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith('s3://')) {
      return {
        id: uuid(),
        s3Key: s3UriToKey(trimmed),
        source: defaults.source || 'auto',
        label: defaults.label || null,
        uploadedAt: now,
        uploadedBy: defaults.uploadedBy || null
      };
    }
    return {
      id: uuid(),
      url: trimmed,
      source: defaults.source || 'external',
      label: defaults.label || null,
      uploadedAt: now,
      uploadedBy: defaults.uploadedBy || null
    };
  }

  if (typeof entry === 'object') {
    const clone = cloneJson(entry);
    clone.id = clone.id || uuid();
    clone.source = clone.source || defaults.source || 'user';
    clone.uploadedAt = clone.uploadedAt || now;
    clone.uploadedBy = clone.uploadedBy || defaults.uploadedBy || null;

    if (!clone.s3Key && typeof clone.url === 'string' && clone.url.startsWith('s3://')) {
      clone.s3Key = s3UriToKey(clone.url);
      delete clone.url;
    }

    if (!clone.s3Key && !clone.url) {
      return null;
    }

    return clone;
  }

  return null;
}

function normaliseReferenceImages(list = [], defaults = {}) {
  return (list || [])
    .map((entry) => normaliseReferenceImageEntry(entry, defaults))
    .filter(Boolean);
}

function mergeReferenceImages(base = [], incoming = [], defaults = {}) {
  const result = [];
  const index = new Map();

  for (const entry of normaliseReferenceImages(base)) {
    const key = entry.s3Key ? `s3:${entry.s3Key}` : entry.url ? `url:${entry.url}` : entry.id;
    const clone = cloneJson(entry);
    index.set(key, clone);
    result.push(clone);
  }

  for (const entry of normaliseReferenceImages(incoming, defaults)) {
    const key = entry.s3Key ? `s3:${entry.s3Key}` : entry.url ? `url:${entry.url}` : entry.id;
    if (index.has(key)) {
      const target = index.get(key);
      Object.assign(target, entry);
    } else {
      const clone = cloneJson(entry);
      index.set(key, clone);
      result.push(clone);
    }
  }

  return result;
}

function applyCharacterPatch(character, patch = {}, options = {}) {
  const next = cloneJson(character) || {};

  if (Object.prototype.hasOwnProperty.call(patch, 'role') && patch.role) {
    next.role = patch.role;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'appearance')) {
    next.appearance = patch.appearance ? cloneJson(patch.appearance) : {};
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'personality')) {
    next.personality = normaliseStringList(patch.personality);
  }

  if (Array.isArray(patch.referenceImages)) {
    next.referenceImages = normaliseReferenceImages(patch.referenceImages, {
      uploadedBy: options.updatedBy || null
    });
  }

  const timestamp = new Date().toISOString();
  next.updatedAt = timestamp;
  next.updatedBy = options.updatedBy || 'system';

  return next;
}

function applyScenePatch(scene, patch = {}, options = {}) {
  const next = cloneJson(scene) || {};

  if (Object.prototype.hasOwnProperty.call(patch, 'name') && patch.name) {
    next.name = patch.name;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
    next.description = patch.description;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'visualCharacteristics')) {
    next.visualCharacteristics = patch.visualCharacteristics
      ? cloneJson(patch.visualCharacteristics)
      : {};
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'spatialLayout')) {
    next.spatialLayout = patch.spatialLayout ? cloneJson(patch.spatialLayout) : {};
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'timeVariations')) {
    next.timeVariations = patch.timeVariations ? cloneJson(patch.timeVariations) : [];
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'weatherVariations')) {
    next.weatherVariations = patch.weatherVariations ? cloneJson(patch.weatherVariations) : [];
  }
  if (Array.isArray(patch.referenceImages)) {
    next.referenceImages = normaliseReferenceImages(patch.referenceImages, {
      uploadedBy: options.updatedBy || null
    });
  }

  const timestamp = new Date().toISOString();
  next.updatedAt = timestamp;
  next.updatedBy = options.updatedBy || 'system';

  return next;
}

function createNotFoundError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
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
  async saveBible(novelId, characters = [], scenes = [], chapterNumber, options = {}) {
    if (!novelId) {
      throw new Error('novelId is required');
    }

    const existing = await this.getBible(novelId);
    const mergedCharacters = this.mergeCharacters(
      existing.characters,
      characters,
      chapterNumber,
      { updatedBy: options.updatedBy || 'system' }
    );
    const mergedScenes = this.mergeScenes(
      existing.scenes,
      scenes,
      chapterNumber,
      { updatedBy: options.updatedBy || 'system' }
    );

    return this.persistBible(
      novelId,
      existing,
      mergedCharacters,
      mergedScenes,
      { chapterNumber, updatedBy: options.updatedBy || 'system' }
    );
  }

  async saveBibleSnapshot(novelId, updates = {}, options = {}) {
    if (!novelId) {
      throw new Error('novelId is required');
    }

    const existing = await this.getBible(novelId);
    const characters = updates.characters
      ? cloneJson(updates.characters)
      : cloneJson(existing.characters);
    const scenes = updates.scenes
      ? cloneJson(updates.scenes)
      : cloneJson(existing.scenes);

    return this.persistBible(
      novelId,
      existing,
      characters,
      scenes,
      options
    );
  }

  async updateCharacter(novelId, characterName, patch = {}, options = {}) {
    if (!novelId) {
      throw new Error('novelId is required');
    }
    if (!characterName) {
      throw new Error('characterName is required');
    }

    const existing = await this.getBible(novelId);
    if (!existing.exists) {
      throw createNotFoundError('BIBLE_NOT_FOUND', 'Bible not found');
    }

    const targetKey = characterName.toLowerCase();
    const characters = cloneJson(existing.characters);
    const targetIndex = characters.findIndex(
      (item) =>
        item &&
        (item.name?.toLowerCase() === targetKey || item.id === characterName)
    );

    if (targetIndex === -1) {
      throw createNotFoundError('CHARACTER_NOT_FOUND', `Character ${characterName} not found`);
    }

    characters[targetIndex] = applyCharacterPatch(
      characters[targetIndex],
      patch,
      { updatedBy: options.updatedBy || 'system' }
    );

    return this.persistBible(
      novelId,
      existing,
      characters,
      cloneJson(existing.scenes),
      { updatedBy: options.updatedBy || 'system' }
    );
  }

  async updateScene(novelId, sceneId, patch = {}, options = {}) {
    if (!novelId) {
      throw new Error('novelId is required');
    }
    if (!sceneId) {
      throw new Error('sceneId is required');
    }

    const existing = await this.getBible(novelId);
    if (!existing.exists) {
      throw createNotFoundError('BIBLE_NOT_FOUND', 'Bible not found');
    }

    const scenes = cloneJson(existing.scenes);
    const targetIndex = scenes.findIndex((scene) => scene && scene.id === sceneId);
    if (targetIndex === -1) {
      throw createNotFoundError('SCENE_NOT_FOUND', `Scene ${sceneId} not found`);
    }

    scenes[targetIndex] = applyScenePatch(
      scenes[targetIndex],
      patch,
      { updatedBy: options.updatedBy || 'system' }
    );

    return this.persistBible(
      novelId,
      existing,
      cloneJson(existing.characters),
      scenes,
      { updatedBy: options.updatedBy || 'system' }
    );
  }

  async appendReferenceImage(novelId, entryType, identifier, image, options = {}) {
    if (!novelId) {
      throw new Error('novelId is required');
    }
    if (!entryType || !identifier) {
      throw new Error('entryType and identifier are required');
    }

    const existing = await this.getBible(novelId);
    if (!existing.exists) {
      throw createNotFoundError('BIBLE_NOT_FOUND', 'Bible not found');
    }

    const normalizedImage = normaliseReferenceImageEntry(image, {
      uploadedBy: options.updatedBy || 'system',
      source: image?.source || 'auto'
    });

    if (!normalizedImage) {
      throw new Error('Invalid reference image payload');
    }

    if (entryType === 'character') {
      const characters = cloneJson(existing.characters);
      const targetKey = identifier.toLowerCase();
      const index = characters.findIndex(
        (item) =>
          item && (item.name?.toLowerCase() === targetKey || item.id === identifier)
      );
      if (index === -1) {
        throw createNotFoundError('CHARACTER_NOT_FOUND', `Character ${identifier} not found`);
      }
      const target = characters[index];
      target.referenceImages = mergeReferenceImages(
        target.referenceImages || [],
        [normalizedImage],
        { uploadedBy: options.updatedBy || 'system' }
      );
      target.updatedAt = new Date().toISOString();
      target.updatedBy = options.updatedBy || 'system';

      return this.persistBible(
        novelId,
        existing,
        characters,
        cloneJson(existing.scenes),
        { updatedBy: options.updatedBy || 'system' }
      );
    }

    if (entryType === 'scene') {
      const scenes = cloneJson(existing.scenes);
      const index = scenes.findIndex((scene) => scene && scene.id === identifier);
      if (index === -1) {
        throw createNotFoundError('SCENE_NOT_FOUND', `Scene ${identifier} not found`);
      }
      const target = scenes[index];
      target.referenceImages = mergeReferenceImages(
        target.referenceImages || [],
        [normalizedImage],
        { uploadedBy: options.updatedBy || 'system' }
      );
      target.updatedAt = new Date().toISOString();
      target.updatedBy = options.updatedBy || 'system';

      return this.persistBible(
        novelId,
        existing,
        cloneJson(existing.characters),
        scenes,
        { updatedBy: options.updatedBy || 'system' }
      );
    }

    throw new Error(`Unsupported entryType: ${entryType}`);
  }

  async persistBible(novelId, existing, characters, scenes, options = {}) {
    const nextVersion = (existing.exists ? existing.version : 0) + 1;
    const now = new Date().toISOString();
    const createdAt = existing.metadata?.createdAt || now;
    const lastChapter = Number.isInteger(options.chapterNumber)
      ? options.chapterNumber
      : (existing.metadata?.lastChapter || 0);

    const metadata = {
      createdAt,
      updatedAt: now,
      lastChapter,
      totalCharacters: characters.length,
      totalScenes: scenes.length,
      storageLocation: null,
      updatedBy: options.updatedBy || 'system'
    };

    const serialized = JSON.stringify({
      novelId,
      version: nextVersion,
      characters,
      scenes
    });

    let dynamoCharacters = characters;
    let dynamoScenes = scenes;

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
      characters,
      scenes
    };
  }

  /**
   * Merge new characters with existing bible entries.
   * @param {Array} existing
   * @param {Array} newCharacters
   * @param {number} chapterNumber
   * @returns {Array}
   */
  mergeCharacters(existing = [], newCharacters = [], chapterNumber, options = {}) {
    const updatedBy = options.updatedBy || 'system';
    const now = new Date().toISOString();
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
          current.referenceImages = mergeReferenceImages(
            current.referenceImages,
            candidate.referenceImages,
            { uploadedBy: updatedBy }
          );
        }

        current.updatedAt = now;
        current.updatedBy = updatedBy;
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
        if (candidate.referenceImages) {
          candidate.referenceImages = normaliseReferenceImages(candidate.referenceImages, { uploadedBy: updatedBy });
        } else {
          candidate.referenceImages = [];
        }
        candidate.updatedAt = now;
        candidate.updatedBy = updatedBy;
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
  mergeScenes(existing = [], newScenes = [], chapterNumber, options = {}) {
    const updatedBy = options.updatedBy || 'system';
    const now = new Date().toISOString();
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
          current.referenceImages = mergeReferenceImages(
            current.referenceImages,
            candidate.referenceImages,
            { uploadedBy: updatedBy }
          );
        }

        current.updatedAt = now;
        current.updatedBy = updatedBy;
        map.set(key, current);
      } else {
        if (!candidate.firstAppearance) {
          candidate.firstAppearance = buildFirstAppearance(chapterNumber);
        }
        if (candidate.referenceImages) {
          candidate.referenceImages = normaliseReferenceImages(candidate.referenceImages, { uploadedBy: updatedBy });
        } else {
          candidate.referenceImages = [];
        }
        candidate.updatedAt = now;
        candidate.updatedBy = updatedBy;
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
