/**
 * AnalyzeWorker Lambda Function - Unit Tests
 * 
 * 测试 SQS Worker 的核心逻辑:
 * - 消息解析
 * - 幂等性处理
 * - DynamoDB 状态更新
 * - 错误处理
 */

const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

jest.mock('../../lib/bible-manager');
const BibleManager = require('../../lib/bible-manager');

// Mock DynamoDB
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock QwenAdapter
jest.mock('../../lib/qwen-adapter', () => {
  return jest.fn().mockImplementation(() => ({
    generateStoryboard: jest.fn().mockResolvedValue({
      panels: [{ page: 1, index: 0, scene: 'Test scene' }],
      characters: [{ name: 'Test Character', role: 'protagonist' }],
      scenes: [{ id: 'test-scene', name: 'Test Scene' }],
      totalPages: 1
    })
  }));
});

const { lambdaHandler } = require('./index');

describe('AnalyzeWorker Lambda', () => {
  let bibleManagerMocks;

  beforeEach(() => {
    ddbMock.reset();
    process.env.TABLE_NAME = 'test-table';
    process.env.ASSETS_BUCKET = 'test-assets-bucket';
    process.env.BIBLES_TABLE_NAME = 'test-bibles-table';
    process.env.BIBLES_BUCKET = 'test-bibles-bucket';
    
    bibleManagerMocks = {
      getBible: jest.fn().mockResolvedValue({
        exists: false,
        novelId: 'test-novel',
        version: 0,
        characters: [],
        scenes: [],
        metadata: {
          totalCharacters: 0,
          totalScenes: 0,
          storageLocation: null
        }
      }),
      saveBible: jest.fn().mockResolvedValue({
        version: 1,
        metadata: {
          totalCharacters: 0,
          totalScenes: 0,
          storageLocation: null
        },
        characters: [],
        scenes: []
      }),
      listHistory: jest.fn()
    };
    
    BibleManager.mockImplementation(() => bibleManagerMocks);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Message Processing', () => {
    it('should process valid SQS message', async () => {
      // Setup mocks
      ddbMock.on(GetCommand).resolves({
        Item: {
          jobId: 'test-job-1',
          status: 'queued',
          novelId: 'test-novel',
          userId: 'test-user'
        }
      });

      ddbMock.on(UpdateCommand).resolves({});

      const event = {
        Records: [
          {
            messageId: 'msg-1',
            body: JSON.stringify({
              jobId: 'test-job-1',
              novelId: 'test-novel',
              chapterId: 'chapter-1',
              chapterNumber: 1,
              text: 'Test novel text for processing.'
            })
          }
        ]
      };

      const result = await lambdaHandler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      
      // Verify DynamoDB calls
      const getCalls = ddbMock.commandCalls(GetCommand);
      expect(getCalls).toHaveLength(1);
      expect(getCalls[0].args[0].input.Key).toEqual({
        PK: 'JOB#test-job-1',
        SK: 'JOB#test-job-1'
      });

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      
      expect(bibleManagerMocks.getBible).toHaveBeenCalledWith('test-novel');
      expect(bibleManagerMocks.saveBible).toHaveBeenCalledWith(
        'test-novel',
        expect.any(Array),
        expect.any(Array),
        1
      );
    });

    it('should handle malformed message body', async () => {
      const event = {
        Records: [
          {
            messageId: 'msg-bad',
            body: 'not valid json'
          }
        ]
      };

      const result = await lambdaHandler(event);

      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-bad');
    });

    it('should handle missing required fields', async () => {
      const event = {
        Records: [
          {
            messageId: 'msg-incomplete',
            body: JSON.stringify({
              jobId: 'test-job',
              // Missing novelId, text, etc.
            })
          }
        ]
      };

      const result = await lambdaHandler(event);

      expect(result.batchItemFailures).toHaveLength(1);
    });
  });

  describe('Idempotency', () => {
    it('should skip already running job', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          jobId: 'test-job-2',
          status: 'running', // Already running
          novelId: 'test-novel',
          userId: 'test-user'
        }
      });

      const event = {
        Records: [
          {
            messageId: 'msg-2',
            body: JSON.stringify({
              jobId: 'test-job-2',
              novelId: 'test-novel',
              text: 'Test text'
            })
          }
        ]
      };

      const result = await lambdaHandler(event);

      // Should succeed (not return as failure)
      expect(result.batchItemFailures).toHaveLength(0);

      // Should NOT call UpdateCommand (skip processing)
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(0);
    });

    it('should skip already completed job', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          jobId: 'test-job-3',
          status: 'completed',
          novelId: 'test-novel',
          userId: 'test-user'
        }
      });

      const event = {
        Records: [
          {
            messageId: 'msg-3',
            body: JSON.stringify({
              jobId: 'test-job-3',
              novelId: 'test-novel',
              text: 'Test text'
            })
          }
        ]
      };

      const result = await lambdaHandler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(0);
    });

    it('should skip failed job', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          jobId: 'test-job-4',
          status: 'failed',
          novelId: 'test-novel',
          userId: 'test-user'
        }
      });

      const event = {
        Records: [
          {
            messageId: 'msg-4',
            body: JSON.stringify({
              jobId: 'test-job-4',
              novelId: 'test-novel',
              text: 'Test text'
            })
          }
        ]
      };

      const result = await lambdaHandler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(0);
    });

    it('should process job with queued status', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          jobId: 'test-job-5',
          status: 'queued', // Should process
          novelId: 'test-novel',
          userId: 'test-user'
        }
      });

      ddbMock.on(UpdateCommand).resolves({});

      const event = {
        Records: [
          {
            messageId: 'msg-5',
            body: JSON.stringify({
              jobId: 'test-job-5',
              novelId: 'test-novel',
              chapterId: 'chapter-1',
              chapterNumber: 1,
              text: 'Test text for processing'
            })
          }
        ]
      };

      const result = await lambdaHandler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      
      // Should update status to running
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle DynamoDB GetItem error', async () => {
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB connection failed'));

      const event = {
        Records: [
          {
            messageId: 'msg-error-1',
            body: JSON.stringify({
              jobId: 'test-job-6',
              novelId: 'test-novel',
              text: 'Test text'
            })
          }
        ]
      };

      const result = await lambdaHandler(event);

      // Should return as failure for retry
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-error-1');
    });

    it('should handle Qwen API error', async () => {
      const QwenAdapter = require('../../lib/qwen-adapter');
      QwenAdapter.mockImplementation(() => ({
        generateStoryboard: jest.fn().mockRejectedValue(new Error('Qwen API timeout'))
      }));

      ddbMock.on(GetCommand).resolves({
        Item: {
          jobId: 'test-job-7',
          status: 'queued',
          novelId: 'test-novel',
          userId: 'test-user'
        }
      });

      ddbMock.on(UpdateCommand).resolves({});

      const event = {
        Records: [
          {
            messageId: 'msg-error-2',
            body: JSON.stringify({
              jobId: 'test-job-7',
              novelId: 'test-novel',
              chapterId: 'chapter-1',
              chapterNumber: 1,
              text: 'Test text'
            })
          }
        ]
      };

      const result = await lambdaHandler(event);

      // Should mark as failure and update job status to failed
      expect(result.batchItemFailures).toHaveLength(1);
      
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const failedUpdate = updateCalls.find(call => 
        call.args[0].input.UpdateExpression.includes('failed')
      );
      expect(failedUpdate).toBeDefined();
    });
  });

  describe('Batch Processing', () => {
    it('should process multiple messages', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          status: 'queued',
          novelId: 'test-novel',
          userId: 'test-user'
        }
      });

      ddbMock.on(UpdateCommand).resolves({});

      const event = {
        Records: [
          {
            messageId: 'msg-batch-1',
            body: JSON.stringify({
              jobId: 'job-1',
              novelId: 'test-novel',
              text: 'Text 1'
            })
          },
          {
            messageId: 'msg-batch-2',
            body: JSON.stringify({
              jobId: 'job-2',
              novelId: 'test-novel',
              text: 'Text 2'
            })
          }
        ]
      };

      const result = await lambdaHandler(event);

      expect(result.batchItemFailures).toHaveLength(0);
    });

    it('should handle partial batch failure', async () => {
      ddbMock.on(GetCommand).callsFake((params) => {
        if (params.Key.PK === 'JOB#job-good') {
          return Promise.resolve({
            Item: {
              jobId: 'job-good',
              status: 'queued',
              novelId: 'test-novel',
              userId: 'test-user'
            }
          });
        }
        return Promise.reject(new Error('DynamoDB error'));
      });

      ddbMock.on(UpdateCommand).resolves({});

      const event = {
        Records: [
          {
            messageId: 'msg-good',
            body: JSON.stringify({
              jobId: 'job-good',
              novelId: 'test-novel',
              text: 'Text 1'
            })
          },
          {
            messageId: 'msg-bad',
            body: JSON.stringify({
              jobId: 'job-bad',
              novelId: 'test-novel',
              text: 'Text 2'
            })
          }
        ]
      };

      const result = await lambdaHandler(event);

      // Only the failed message should be returned
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-bad');
    });
  });

  describe('Status Updates', () => {
    it('should update status from queued to running', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          jobId: 'test-job-8',
          status: 'queued',
          novelId: 'test-novel',
          userId: 'test-user'
        }
      });

      ddbMock.on(UpdateCommand).resolves({});

      const event = {
        Records: [
          {
            messageId: 'msg-8',
            body: JSON.stringify({
              jobId: 'test-job-8',
              novelId: 'test-novel',
              chapterId: 'chapter-1',
              chapterNumber: 1,
              text: 'Test text'
            })
          }
        ]
      };

      await lambdaHandler(event);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      
      // First update should set status to running
      const runningUpdate = updateCalls[0];
      expect(runningUpdate.args[0].input.UpdateExpression).toContain('status = :running');
      expect(runningUpdate.args[0].input.ExpressionAttributeValues[':running']).toBe('running');
    });

    it('should update status to completed on success', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          jobId: 'test-job-9',
          status: 'queued',
          novelId: 'test-novel',
          userId: 'test-user'
        }
      });

      ddbMock.on(UpdateCommand).resolves({});

      const event = {
        Records: [
          {
            messageId: 'msg-9',
            body: JSON.stringify({
              jobId: 'test-job-9',
              novelId: 'test-novel',
              chapterId: 'chapter-1',
              chapterNumber: 1,
              text: 'Test text'
            })
          }
        ]
      };

      await lambdaHandler(event);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      
      // Last update should set status to completed
      const completedUpdate = updateCalls[updateCalls.length - 1];
      expect(completedUpdate.args[0].input.UpdateExpression).toContain('status = :completed');
    });
  });
});
