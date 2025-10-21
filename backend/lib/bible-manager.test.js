/**
 * BibleManager unit tests
 */

const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const BibleManager = require('./bible-manager');

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

function createManager(options = {}) {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3Client = new S3Client({});
  return new BibleManager(docClient, s3Client, 'BiblesTable', 'assets-bucket', options);
}

describe('BibleManager', () => {
  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
  });

  describe('getBible', () => {
    it('returns empty structure when no bible exists', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const manager = createManager();
      const result = await manager.getBible('novel-001');

      expect(result.exists).toBe(false);
      expect(result.version).toBe(0);
      expect(result.characters).toEqual([]);
      expect(result.scenes).toEqual([]);
      expect(result.metadata.totalCharacters).toBe(0);
      expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    });

    it('returns data stored in DynamoDB', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            novelId: 'novel-002',
            version: 2,
            characters: [{ name: 'Alice', role: 'protagonist' }],
            scenes: [{ id: 'market', name: 'Marketplace' }],
            metadata: {
              updatedAt: '2025-01-01T00:00:00Z',
              lastChapter: 2,
              totalCharacters: 1,
              totalScenes: 1
            }
          }
        ]
      });

      const manager = createManager();
      const result = await manager.getBible('novel-002');

      expect(result.exists).toBe(true);
      expect(result.version).toBe(2);
      expect(result.characters).toHaveLength(1);
      expect(result.scenes).toHaveLength(1);
      expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    });

    it('loads characters and scenes from S3 when storageLocation is set', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            novelId: 'novel-003',
            version: 3,
            characters: [],
            scenes: [],
            metadata: {
              storageLocation: 's3://assets-bucket/bibles/novel-003/v3.json'
            }
          }
        ]
      });

      const bodyPayload = JSON.stringify({
        characters: [{ name: 'Eve', role: 'antagonist' }],
        scenes: [{ id: 'castle', name: 'Castle Hall' }]
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: jest.fn().mockResolvedValue(bodyPayload)
        }
      });

      const manager = createManager();
      const result = await manager.getBible('novel-003');

      expect(result.exists).toBe(true);
      expect(result.characters).toHaveLength(1);
      expect(result.scenes).toHaveLength(1);
      expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(1);
    });
  });

  describe('saveBible', () => {
    it('stores small bible payload directly in DynamoDB', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});

      const manager = createManager();
      const result = await manager.saveBible(
        'novel-010',
        [
          {
            name: 'Hero',
            role: 'protagonist',
            appearance: { hairColor: 'black' },
            personality: ['brave']
          }
        ],
        [
          {
            id: 'village_square',
            name: 'Village Square',
            type: 'outdoor',
            description: 'Sunlit village square',
            visualCharacteristics: {
              keyLandmarks: ['fountain']
            }
          }
        ],
        1
      );

      expect(result.version).toBe(1);
      expect(result.metadata.storageLocation).toBe(null);
      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls).toHaveLength(1);

      const savedItem = putCalls[0].args[0].input.Item;
      expect(savedItem.characters).toHaveLength(1);
      expect(savedItem.metadata.storageLocation).toBe(null);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });

    it('uploads large bible to S3 when payload exceeds limit', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});
      s3Mock.on(PutObjectCommand).resolves({});

      const manager = createManager({ maxDynamoItemBytes: 128 });
      const largeDescription = 'a'.repeat(256);

      const result = await manager.saveBible(
        'novel-011',
        [
          {
            name: 'Scholar',
            role: 'supporting',
            description: largeDescription
          }
        ],
        [
          {
            id: 'library',
            name: 'Grand Library',
            type: 'indoor',
            description: largeDescription
          }
        ],
        2
      );

      expect(result.metadata.storageLocation).toMatch(/^s3:\/\/assets-bucket\//);
      expect(result.characters).toHaveLength(1);
      const putCalls = ddbMock.commandCalls(PutCommand);
      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls).toHaveLength(1);
      expect(putCalls).toHaveLength(1);

      const savedItem = putCalls[0].args[0].input.Item;
      expect(savedItem.characters).toEqual([]);
      expect(savedItem.metadata.storageLocation).toMatch(/^s3:\/\/assets-bucket\//);
    });
  });

  describe('merge helpers', () => {
    it('mergeCharacters preserves original appearance and merges personality', () => {
      const manager = createManager();
      const merged = manager.mergeCharacters(
        [
          {
            name: 'Alicia',
            role: 'protagonist',
            appearance: { hairColor: 'blonde', eyeColor: 'green' },
            personality: ['brave'],
            firstAppearance: { chapter: 1 }
          }
        ],
        [
          {
            name: 'Alicia',
            role: 'protagonist',
            appearance: { hairStyle: 'long', hairColor: 'red' },
            personality: ['strategic']
          }
        ],
        2
      );

      expect(merged).toHaveLength(1);
      const character = merged[0];
      expect(character.appearance.hairColor).toBe('blonde'); // original preserved
      expect(character.appearance.hairStyle).toBe('long');
      expect(character.personality).toEqual(expect.arrayContaining(['brave', 'strategic']));
      expect(character.firstAppearance.chapter).toBe(1);
    });

    it('mergeScenes preserves existing visual traits and adds new details', () => {
      const manager = createManager();
      const merged = manager.mergeScenes(
        [
          {
            id: 'town_square',
            name: 'Town Square',
            type: 'outdoor',
            visualCharacteristics: {
              keyLandmarks: ['fountain'],
              lighting: { naturalLight: 'abundant' }
            },
            spatialLayout: {
              layout: 'open plaza',
              keyAreas: [{ name: 'statue', position: 'center' }]
            },
            timeVariations: [{ timeOfDay: 'morning', description: 'Warm light' }]
          }
        ],
        [
          {
            id: 'town_square',
            name: 'Town Square',
            visualCharacteristics: {
              keyLandmarks: ['clock tower'],
              lighting: { artificialLight: 'moderate' }
            },
            spatialLayout: {
              keyAreas: [{ name: 'market stalls', position: 'east side' }]
            },
            timeVariations: [{ timeOfDay: 'evening', description: 'Lantern glow' }],
            weatherVariations: [{ weather: 'rainy', description: 'Wet cobblestones' }]
          }
        ],
        3
      );

      expect(merged).toHaveLength(1);
      const scene = merged[0];
      expect(scene.visualCharacteristics.keyLandmarks).toEqual(
        expect.arrayContaining(['fountain', 'clock tower'])
      );
      expect(scene.visualCharacteristics.lighting.naturalLight).toBe('abundant');
      expect(scene.visualCharacteristics.lighting.artificialLight).toBe('moderate');
      expect(scene.spatialLayout.keyAreas).toHaveLength(2);
      expect(scene.timeVariations).toHaveLength(2);
      expect(scene.weatherVariations).toHaveLength(1);
    });
  });

  describe('listHistory', () => {
    it('returns simplified version metadata sorted by latest first', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            novelId: 'novel-020',
            version: 2,
            metadata: {
              updatedAt: '2025-01-02T00:00:00Z',
              lastChapter: 2,
              totalCharacters: 4,
              totalScenes: 3
            }
          },
          {
            novelId: 'novel-020',
            version: 1,
            metadata: {
              updatedAt: '2025-01-01T00:00:00Z',
              lastChapter: 1,
              totalCharacters: 2,
              totalScenes: 1
            }
          }
        ]
      });

      const manager = createManager();
      const history = await manager.listHistory('novel-020', { limit: 5 });

      expect(history).toHaveLength(2);
      expect(history[0].version).toBe(2);
      expect(history[0].updatedAt).toBe('2025-01-02T00:00:00Z');
    });
  });
});
