const { mockClient } = require('aws-sdk-client-mock');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const DATA_TABLE = 'TestDataTable';
const BIBLES_TABLE = 'TestBiblesTable';
const ASSETS_BUCKET = 'test-assets-bucket';
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:qwen';

process.env.TABLE_NAME = DATA_TABLE;
process.env.ASSETS_BUCKET = ASSETS_BUCKET;
process.env.BIBLES_TABLE_NAME = BIBLES_TABLE;
process.env.BIBLES_BUCKET = ASSETS_BUCKET;
process.env.QWEN_SECRET_ARN = SECRET_ARN;
process.env.AWS_REGION = 'us-east-1';

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const secretsMock = mockClient(SecretsManagerClient);

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const getInput = (command) => (command && command.input ? command.input : command);

jest.mock('ajv', () =>
  jest.fn().mockImplementation(() => ({
    compile: () => () => true
  }))
);

const chapterOneStoryboard = {
  panels: [{ page: 1, index: 0 }],
  characters: [
    {
      name: 'Alice',
      role: 'protagonist',
      appearance: {
        hairColor: 'black',
        hairStyle: 'short',
        clothing: ['school uniform']
      },
      personality: ['brave'],
      firstAppearance: { chapter: 1, page: 1, panelIndex: 0 }
    },
    {
      name: 'Bob',
      role: 'supporting',
      appearance: {
        hairColor: 'brown',
        hairStyle: 'messy'
      },
      personality: ['funny'],
      firstAppearance: { chapter: 1, page: 1, panelIndex: 0 }
    }
  ],
  scenes: [
    {
      id: 'town_square',
      name: 'Town Square',
      type: 'outdoor',
      description: 'Quiet town square at dawn',
      visualCharacteristics: {
        keyLandmarks: ['fountain'],
        lighting: { naturalLight: 'abundant' }
      },
      firstAppearance: { chapter: 1, page: 1, panelIndex: 0 }
    }
  ],
  totalPages: 1
};

const chapterTwoStoryboard = {
  panels: [{ page: 2, index: 0 }],
  characters: [
    {
      name: 'Alice',
      role: 'protagonist',
      appearance: {
        hairColor: 'blonde', // should be ignored, original black preserved
        hairStyle: 'long',
        clothing: ['school uniform', 'scarf']
      },
      personality: ['strategic'],
      firstAppearance: { chapter: 2, page: 1, panelIndex: 0 }
    },
    {
      name: 'Charlie',
      role: 'supporting',
      appearance: {
        hairColor: 'red'
      },
      personality: ['loyal'],
      firstAppearance: { chapter: 2, page: 1, panelIndex: 0 }
    }
  ],
  scenes: [
    {
      id: 'town_square',
      name: 'Town Square',
      type: 'outdoor',
      description: 'Same square during evening',
      visualCharacteristics: {
        keyLandmarks: ['fountain', 'market stalls'],
        lighting: { artificialLight: 'moderate' }
      },
      firstAppearance: { chapter: 1, page: 1, panelIndex: 0 }
    },
    {
      id: 'forest_edge',
      name: 'Forest Edge',
      type: 'natural',
      description: 'Dense forest entrance',
      visualCharacteristics: {
        keyLandmarks: ['ancient tree']
      },
      firstAppearance: { chapter: 2, page: 1, panelIndex: 0 }
    }
  ],
  totalPages: 1
};

const mockGenerateStoryboard = jest.fn();

jest.mock('../lib/qwen-adapter', () =>
  jest.fn().mockImplementation(() => ({
    generateStoryboard: mockGenerateStoryboard
  }))
);

const { lambdaHandler } = require('../functions/analyze-worker/index');

describe('AnalyzeWorker + BibleManager integration', () => {
  let dataTable;
  let biblesTable;
  let s3Objects;

  const dataKey = (pk, sk) => `${pk}|${sk}`;
  const bibleKey = (novelId, version) => `${novelId}|${version}`;

  beforeEach(async () => {
    mockGenerateStoryboard.mockReset();
    ddbMock.reset();
    s3Mock.reset();
    secretsMock.reset();

    dataTable = new Map();
    biblesTable = new Map();
    s3Objects = new Map();

    // Initial job + novel entries
    dataTable.set(
      dataKey('JOB#job-1', 'JOB#job-1'),
      {
        PK: 'JOB#job-1',
        SK: 'JOB#job-1',
        status: 'queued',
        novelId: 'novel-1',
        userId: 'user-1',
        progress: {}
      }
    );
    dataTable.set(
      dataKey('NOVEL#novel-1', 'NOVEL#novel-1'),
      {
        PK: 'NOVEL#novel-1',
        SK: 'NOVEL#novel-1',
        id: 'novel-1',
        title: 'Test Novel',
        originalText: 'Chapter one text content.',
        userId: 'user-1'
      }
    );

    ddbMock.on(GetCommand).callsFake(async (command) => {
      const { TableName, Key } = getInput(command);
      if (TableName === DATA_TABLE) {
        return { Item: clone(dataTable.get(dataKey(Key.PK, Key.SK))) };
      }
      if (TableName === BIBLES_TABLE) {
        return { Item: clone(biblesTable.get(bibleKey(Key.novelId, Key.version))) };
      }
      return {};
    });

    ddbMock.on(PutCommand).callsFake(async (command) => {
      const { TableName, Item } = getInput(command);
      if (TableName === BIBLES_TABLE) {
        biblesTable.set(bibleKey(Item.novelId, Item.version), clone(Item));
      } else if (TableName === DATA_TABLE) {
        dataTable.set(dataKey(Item.PK, Item.SK), clone(Item));
      }
      return {};
    });

    ddbMock.on(QueryCommand).callsFake(async (command) => {
      const { TableName, IndexName, ExpressionAttributeValues, Limit } = getInput(command);
      if (TableName === BIBLES_TABLE) {
        if (IndexName === 'LatestVersionIndex') {
          const gsiPk = ExpressionAttributeValues[':pk'];
          const items = Array.from(biblesTable.values())
            .filter((item) => item.GSI1PK === gsiPk)
            .sort((a, b) => (a.GSI1SK > b.GSI1SK ? -1 : 1));
          return { Items: clone(items.slice(0, Limit || items.length)) };
        }
        const novelId = ExpressionAttributeValues[':pk'];
        const items = Array.from(biblesTable.values())
          .filter((item) => item.novelId === novelId)
          .sort((a, b) => b.version - a.version);
        return { Items: clone(items.slice(0, Limit || items.length)) };
      }
      return { Items: [] };
    });

    ddbMock.on(UpdateCommand).callsFake(async (command) => {
      const { TableName, Key, ExpressionAttributeValues, ConditionExpression } = getInput(command);
      if (TableName !== DATA_TABLE) {
        return {};
      }
      const itemKey = dataKey(Key.PK, Key.SK);
      const current = dataTable.get(itemKey);
      if (!current) {
        throw new Error(`Item ${itemKey} not found`);
      }
      if (ConditionExpression) {
        const allowed =
          (ConditionExpression.includes(':queued') && current.status === 'queued') ||
          (ConditionExpression.includes(':failed') && current.status === 'failed');
        if (!allowed) {
          const error = new Error('ConditionalCheckFailedException');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
      }
      if (ExpressionAttributeValues[':running']) {
        current.status = 'running';
      }
      if (ExpressionAttributeValues[':status']) {
        current.status = ExpressionAttributeValues[':status'];
      }
      if (ExpressionAttributeValues[':completed']) {
        current.status = 'completed';
      }
      if (ExpressionAttributeValues[':failed']) {
        current.status = 'failed';
      }
      if (ExpressionAttributeValues[':progress']) {
        current.progress = clone(ExpressionAttributeValues[':progress']);
      }
      if (ExpressionAttributeValues[':updatedAt']) {
        current.updatedAt = ExpressionAttributeValues[':updatedAt'];
      }
      if (ExpressionAttributeValues[':completedAt']) {
        current.completedAt = ExpressionAttributeValues[':completedAt'];
      }
      if (ExpressionAttributeValues[':storyboardId']) {
        current.storyboardId = ExpressionAttributeValues[':storyboardId'];
      }
      if (ExpressionAttributeValues[':errorMessage']) {
        current.errorMessage = ExpressionAttributeValues[':errorMessage'];
      }
      dataTable.set(itemKey, current);
      return {};
    });

    ddbMock.on(BatchWriteCommand).callsFake(async () => ({}));

    s3Mock.on(PutObjectCommand).callsFake(async (command) => {
      const { Key, Body } = getInput(command);
      s3Objects.set(Key, Body);
      return {};
    });

    secretsMock.on(GetSecretValueCommand).callsFake(async () => ({
      SecretString: JSON.stringify({
        QWEN_API_KEY: 'test-key',
        QWEN_ENDPOINT: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        QWEN_MODEL: 'qwen-plus'
      })
    }));

  });

  afterEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    secretsMock.reset();
  });

  it('processes multiple chapters and persists bible continuity', async () => {
    mockGenerateStoryboard.mockImplementation(async ({ chapterNumber }) => {
      if (chapterNumber === 1) {
        return clone(chapterOneStoryboard);
      }
      if (chapterNumber === 2) {
        return clone(chapterTwoStoryboard);
      }
      throw new Error(`Unexpected chapter number ${chapterNumber}`);
    });

    const chapterOneEvent = {
      Records: [
        {
          messageId: 'msg-1',
          body: JSON.stringify({
            jobId: 'job-1',
            novelId: 'novel-1',
            userId: 'user-1',
            chapterNumber: 1
          })
        }
      ]
    };

    const responseOne = await lambdaHandler(chapterOneEvent);
    expect(responseOne.statusCode).toBe(200);

    const bibleV1 = biblesTable.get(bibleKey('novel-1', 1));
    expect(bibleV1).toBeDefined();
    expect(bibleV1.characters).toHaveLength(2);
    expect(bibleV1.scenes).toHaveLength(1);
    expect(mockGenerateStoryboard).toHaveBeenCalledTimes(1);

    // Prepare second job (chapter 2) and remove text from Dynamo to exercise fallback
    dataTable.set(
      dataKey('JOB#job-2', 'JOB#job-2'),
      {
        PK: 'JOB#job-2',
        SK: 'JOB#job-2',
        status: 'queued',
        novelId: 'novel-1',
        userId: 'user-1',
        progress: {}
      }
    );
    const novelRecord = dataTable.get(dataKey('NOVEL#novel-1', 'NOVEL#novel-1'));
    delete novelRecord.originalText;
    dataTable.set(dataKey('NOVEL#novel-1', 'NOVEL#novel-1'), novelRecord);

    const chapterTwoEvent = {
      Records: [
        {
          messageId: 'msg-2',
          body: JSON.stringify({
            jobId: 'job-2',
            novelId: 'novel-1',
            userId: 'user-1',
            chapterNumber: 2,
            text: 'Chapter two text from queue.'
          })
        }
      ]
    };

    const responseTwo = await lambdaHandler(chapterTwoEvent);
    expect(responseTwo.statusCode).toBe(200);

    const bibleV2 = biblesTable.get(bibleKey('novel-1', 2));
    expect(bibleV2).toBeDefined();
    expect(bibleV2.version).toBe(2);
    expect(bibleV2.metadata.totalCharacters).toBe(3);
    expect(bibleV2.metadata.totalScenes).toBe(2);
    expect(bibleV2.characters).toHaveLength(3);
    expect(bibleV2.scenes).toHaveLength(2);

    const alice = bibleV2.characters.find((c) => c.name === 'Alice');
    expect(alice.appearance.hairColor).toBe('black'); // preserved from chapter 1
    expect(alice.appearance.clothing).toEqual(expect.arrayContaining(['school uniform', 'scarf']));

    const forest = bibleV2.scenes.find((s) => s.id === 'forest_edge');
    expect(forest).toBeDefined();
    expect(forest.firstAppearance.chapter).toBe(2);

    expect(mockGenerateStoryboard).toHaveBeenCalledTimes(2);
    expect(s3Objects.size).toBe(0);
  });
});
