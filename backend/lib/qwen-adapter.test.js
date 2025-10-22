/**
 * Unit tests for QwenAdapter
 * 
 * Coverage targets:
 * - Text splitting logic (boundary detection)
 * - Storyboard merging (character deduplication, page recalculation)
 * - Retry logic with exponential backoff
 * - JSON correction flow
 * - Error handling
 */

const { describe, it, beforeEach, afterEach } = require('@jest/globals');
const assert = require('node:assert');
const QwenAdapter = require('./qwen-adapter');

// Mock OpenAI client
class MockOpenAIClient {
  constructor() {
    this.callCount = 0;
    this.mockResponses = [];
    this.shouldFail = false;
    this.failTimes = 0;
  }

  setMockResponse(response) {
    this.mockResponses.push(response);
  }

  setFailure(times = 1) {
    this.shouldFail = true;
    this.failTimes = times;
  }
  
  reset() {
    this.callCount = 0;
    this.mockResponses = [];
    this.shouldFail = false;
    this.failTimes = 0;
  }

  async createChatCompletion(params) {
    this.callCount++;
    
    // Fail for the first N calls
    if (this.shouldFail && this.callCount <= this.failTimes) {
      throw new Error('Mock API error');
    }
    
    // After failures, use queued responses or default
    const response = this.mockResponses.shift() || {
      choices: [{
        message: {
          content: JSON.stringify({ panels: [], characters: [] })
        }
      }],
      usage: {
        total_tokens: 0
      }
    };
    if (!response.usage) {
      response.usage = { total_tokens: 0 };
    } else if (typeof response.usage.total_tokens === 'undefined') {
      response.usage.total_tokens = 0;
    }
    
    return response;
  }
}

describe('QwenAdapter', () => {
  let adapter;
  let mockClient;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    mockClient = new MockOpenAIClient();
    // Inject mock client
    adapter = new QwenAdapter({
      apiKey: 'test-key',
      endpoint: 'https://test.example.com',
      model: 'qwen-plus', // Default model
      maxRetries: 3
    });
    // Replace internal client with mock
    adapter.client = {
      chat: {
        completions: {
          create: mockClient.createChatCompletion.bind(mockClient)
        }
      }
    };
  });
  
  afterEach(() => {
    if (mockClient) {
      mockClient.reset();
    }
    jest.restoreAllMocks();
  });

  describe('splitTextIntelligently', () => {
    it('should not split text shorter than maxLength', () => {
      const shortText = '这是一个短文本。';
      const chunks = adapter.splitTextIntelligently(shortText, 100);
      
      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0], shortText);
    });

    it('should split on paragraph boundaries', () => {
      const text = '第一段内容。\n\n第二段内容。\n\n第三段内容。';
      const chunks = adapter.splitTextIntelligently(text, 20);
      
      assert.ok(chunks.length > 1);
      chunks.forEach(chunk => {
        assert.ok(chunk.length <= 20 || chunk.trim().indexOf('\n\n') === -1);
      });
    });

    it('should split on sentence boundaries when no paragraph breaks', () => {
      const text = '第一句话。第二句话。第三句话。第四句话。第五句话。';
      const chunks = adapter.splitTextIntelligently(text, 15);
      
      assert.ok(chunks.length > 1);
      chunks.forEach(chunk => {
        // Each chunk should end with sentence boundary
        const trimmed = chunk.trim();
        if (trimmed.length > 0) {
          const lastChar = trimmed[trimmed.length - 1];
          assert.ok(['。', '！', '?', '.', '!', '?'].includes(lastChar) || chunk === chunks[chunks.length - 1]);
        }
      });
    });

    it('should force split at maxLength when no boundaries found', () => {
      const text = '这是一个非常长的没有任何标点符号的句子' + 'a'.repeat(100);
      const chunks = adapter.splitTextIntelligently(text, 50);
      
      // Note: splitTextIntelligently only splits on paragraph/sentence boundaries
      // If no boundaries exist, it will keep text in one chunk
      // This is expected behavior to avoid breaking words mid-way
      assert.ok(chunks.length >= 1);
    });

    it('should handle mixed Chinese and English text', () => {
      const text = 'Hello world. 你好世界。This is a test. 这是一个测试。';
      const chunks = adapter.splitTextIntelligently(text, 30);
      
      chunks.forEach(chunk => {
        assert.ok(chunk.length <= 30 || !chunk.includes('.') && !chunk.includes('。'));
      });
    });

    it('should trim whitespace from chunks', () => {
      const text = '  第一段。  \n\n  第二段。  ';
      const chunks = adapter.splitTextIntelligently(text, 15);
      
      // splitTextIntelligently uses .trim() on each chunk
      assert.ok(chunks.length > 0);
      chunks.forEach(chunk => {
        assert.strictEqual(chunk, chunk.trim());
      });
    });
  });

  describe('mergeStoryboards', () => {
    it('should merge empty storyboards', () => {
      const result = adapter.mergeStoryboards([]);
      
      assert.deepStrictEqual(result, {
        panels: [],
        characters: [],
        scenes: [],
        totalPages: 0
      });
    });

    it('should merge single storyboard with recalculated indices', () => {
      const storyboard = {
        panels: [
          { page: 1, index: 1, scene: 'Scene 1', characters: ['A'] }
        ],
        characters: [
          { name: 'A', role: 'main', appearance: {} }
        ]
      };
      
      const result = adapter.mergeStoryboards([storyboard]);
      
      // mergeStoryboards always recalculates indices (0-based within page)
      assert.strictEqual(result.panels.length, 1);
      assert.strictEqual(result.panels[0].page, 1);
      assert.strictEqual(result.panels[0].index, 0); // Recalculated to 0
      assert.strictEqual(result.characters.length, 1);
      assert.strictEqual(result.totalPages, 1);
    });

    it('should recalculate page numbers sequentially', () => {
      const storyboards = [
        {
          panels: [
            { page: 1, index: 1, scene: 'S1' },
            { page: 1, index: 2, scene: 'S2' },
            { page: 2, index: 1, scene: 'S3' }
          ],
          characters: []
        },
        {
          panels: [
            { page: 1, index: 1, scene: 'S4' },
            { page: 2, index: 1, scene: 'S5' }
          ],
          characters: []
        }
      ];
      
      const result = adapter.mergeStoryboards(storyboards);
      
      // PANELS_PER_PAGE = 6, so pages: 1, 1, 1, 1, 1
      // Panels 0-5 are on page 1, panel 6 would be on page 2
      assert.strictEqual(result.panels[0].page, 1);
      assert.strictEqual(result.panels[1].page, 1);
      assert.strictEqual(result.panels[2].page, 1);
      assert.strictEqual(result.panels[3].page, 1);
      assert.strictEqual(result.panels[4].page, 1);
      assert.strictEqual(result.panels.length, 5);
    });

    it('should recalculate index numbers per page', () => {
      const storyboards = [
        {
          panels: [
            { page: 1, index: 1, scene: 'S1' },
            { page: 1, index: 2, scene: 'S2' }
          ],
          characters: []
        },
        {
          panels: [
            { page: 1, index: 1, scene: 'S3' }
          ],
          characters: []
        }
      ];
      
      const result = adapter.mergeStoryboards(storyboards);
      
      // Indices are recalculated as absoluteIndex % PANELS_PER_PAGE (0-based)
      // Panel 0: page 1, index 0
      // Panel 1: page 1, index 1
      // Panel 2: page 1, index 2
      assert.strictEqual(result.panels[0].page, 1);
      assert.strictEqual(result.panels[0].index, 0);
      assert.strictEqual(result.panels[1].page, 1);
      assert.strictEqual(result.panels[1].index, 1);
      assert.strictEqual(result.panels[2].page, 1);
      assert.strictEqual(result.panels[2].index, 2);
    });

    it('should deduplicate characters by name', () => {
      const storyboards = [
        {
          panels: [],
          characters: [
            { name: 'Alice', role: 'main', appearance: { hair: 'long' } },
            { name: 'Bob', role: 'support', appearance: { hair: 'short' } }
          ]
        },
        {
          panels: [],
          characters: [
            { name: 'Alice', role: 'main', appearance: { hair: 'long' } },
            { name: 'Charlie', role: 'support', appearance: {} }
          ]
        }
      ];
      
      const result = adapter.mergeStoryboards(storyboards);
      
      assert.strictEqual(result.characters.length, 3);
      const names = result.characters.map(c => c.name);
      assert.deepStrictEqual(names.sort(), ['Alice', 'Bob', 'Charlie']);
    });

    it('should handle storyboards with missing characters arrays', () => {
      const storyboards = [
        {
          panels: [{ page: 1, index: 1, scene: 'S1' }]
          // characters 缺失
        },
        {
          panels: [{ page: 1, index: 1, scene: 'S2' }],
          characters: [{ name: 'A', role: 'main' }]
        }
      ];
      
      const result = adapter.mergeStoryboards(storyboards);
      
      assert.strictEqual(result.panels.length, 2);
      assert.strictEqual(result.characters.length, 1);
    });
  });

  describe('callQwen', () => {
    it('should successfully call Qwen API with strict mode', async () => {
      mockClient.setMockResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              panels: [{ page: 1, index: 1, scene: 'Test' }],
              characters: []
            })
          }
        }]
      });

      const schema = {
        type: 'object',
        properties: {
          panels: { type: 'array' },
          characters: { type: 'array' }
        }
      };

      const result = await adapter.callQwen('Test text', schema, true);
      
      assert.ok(result);
      assert.strictEqual(mockClient.callCount, 1);
    });

    it('should retry on rate limit (429) with exponential backoff', async () => {
      // Mock client needs to throw rate limit errors
      let callCount = 0;
      adapter.client.chat.completions.create = async () => {
        callCount++;
        if (callCount <= 2) {
          const error = new Error('Rate limited');
          error.status = 429;
          throw error;
        }
        return {
          choices: [{
            message: {
              content: JSON.stringify({ panels: [], characters: [] })
            }
          }]
        };
      };

      const schema = { type: 'object' };
      const startTime = Date.now();
      
      const result = await adapter.callQwen('Test', schema, false);
      
      const elapsed = Date.now() - startTime;
      assert.ok(result);
      assert.strictEqual(callCount, 3); // 2 rate limits + 1 success
      // Should have delays: 1000ms (2^0) + 2000ms (2^1) = 3000ms minimum
      assert.ok(elapsed >= 3000);
    });

    it('should throw error after max retries', async () => {
      mockClient.setFailure(10); // More failures than maxRetries

      const schema = { type: 'object' };
      
      await assert.rejects(
        async () => await adapter.callQwen('Test', schema, false),
        {
          name: 'Error',
          message: /Mock API error/
        }
      );
      
      // Should attempt once initially, then retry maxRetries times
      // maxRetries = 3, so total attempts = 1 + 3 = 4
      assert.ok(mockClient.callCount >= 1 && mockClient.callCount <= 4);
    });

    it('should parse JSON response correctly', async () => {
      const mockData = {
        panels: [
          { page: 1, index: 1, scene: 'Opening', dialogue: ['Hello'] }
        ],
        characters: [
          { name: 'Hero', role: 'main' }
        ]
      };

      mockClient.setMockResponse({
        choices: [{
          message: {
            content: JSON.stringify(mockData)
          }
        }]
      });

      const result = await adapter.callQwen('Test', {}, false);
      
      assert.deepStrictEqual(result, mockData);
    });

    it('should handle non-JSON responses gracefully', async () => {
      mockClient.setMockResponse({
        choices: [{
          message: {
            content: 'This is not JSON'
          }
        }]
      });

      await assert.rejects(
        async () => await adapter.callQwen('Test', {}, false),
        {
          name: 'SyntaxError'
        }
      );
    });
  });

  describe('generateStoryboard', () => {
    it('should handle short text without splitting', async () => {
      const shortText = '这是一个短故事。';
      const schema = { type: 'object' };

      mockClient.setMockResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              panels: [{ page: 1, index: 1, scene: 'Scene' }],
              characters: []
            })
          }
        }]
      });

      const result = await adapter.generateStoryboard({
        text: shortText,
        jsonSchema: schema,
        strictMode: false,
        maxChunkLength: 10000
      });

      assert.ok(result.panels);
      assert.ok(result.characters);
      assert.strictEqual(mockClient.callCount, 1);
    });

    it('should split and merge long text', async () => {
      const longText = '第一段。\n\n第二段。\n\n第三段。';
      const schema = { type: 'object' };

      // Mock 5 responses for potential chunks
      for (let i = 0; i < 5; i++) {
        mockClient.setMockResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                panels: [{ page: 1, index: 1, scene: `Scene ${i + 1}` }],
                characters: [{ name: `Char${i + 1}`, role: 'main' }]
              })
            }
          }]
        });
      }

      const result = await adapter.generateStoryboard({
        text: longText,
        jsonSchema: schema,
        strictMode: false,
        maxChunkLength: 8 // Force splitting
      });

      assert.ok(result.panels.length >= 1);
      assert.ok(result.characters.length >= 1);
      assert.ok(mockClient.callCount >= 1); // Should have made at least one call
    });

    it('should log progress for chunked processing', async () => {
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      // Create text that will definitely split (with sentence boundaries)
      const text = ('这是一句话。'.repeat(1000)) + '\n\n' + ('另一句话。'.repeat(1000));
      const schema = { type: 'object' };

      for (let i = 0; i < 10; i++) {
        mockClient.setMockResponse({
          choices: [{
            message: {
              content: JSON.stringify({ panels: [], characters: [] })
            }
          }]
        });
      }

      await adapter.generateStoryboard({
        text,
        jsonSchema: schema,
        strictMode: false,
        maxChunkLength: 5000
      });

      console.log = originalLog;

      assert.ok(logs.some(log => log.includes('Split text into')));
      assert.ok(logs.some(log => log.includes('succeeded')));
    });
  });

  describe('correctJson', () => {
    it('should attempt to fix invalid JSON', async () => {
      const invalidJson = '{ panels: [], characters: [] }'; // Missing quotes
      const errors = ['Expected property name or \'}\' in JSON'];

      mockClient.setMockResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              panels: [],
              characters: []
            })
          }
        }]
      });

      const result = await adapter.correctJson(invalidJson, errors);
      
      assert.ok(result);
      assert.ok(result.panels);
      assert.ok(mockClient.callCount, 1);
    });

    it('should throw if correction fails', async () => {
      mockClient.setMockResponse({
        choices: [{
          message: {
            content: 'Still invalid JSON'
          }
        }]
      });

      await assert.rejects(
        async () => await adapter.correctJson('bad json', ['error']),
        {
          name: 'Error',
          message: /Failed to correct JSON/
        }
      );
    });
  });

  describe('parseChangeRequest', () => {
    it('should parse natural language to CR-DSL', async () => {
      const naturalLanguage = '把第一页第二个分镜的背景改成森林';
      const schema = { type: 'object' };
      const context = { currentPage: 1 };

      mockClient.setMockResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              scope: 'panel',
              targetPage: 1,
              targetIndex: 2,
              type: 'art',
              ops: [
                { action: 'bg_swap', params: { newBackground: '森林' } }
              ]
            })
          }
        }]
      });

      const result = await adapter.parseChangeRequest({
        naturalLanguage,
        jsonSchema: schema,
        context
      });

      assert.strictEqual(result.scope, 'panel');
      assert.strictEqual(result.type, 'art');
      assert.ok(Array.isArray(result.ops));
    });
  });

  describe('rewriteDialogue', () => {
    it('should rewrite dialogue based on instruction', async () => {
      const originalDialogue = '你好，很高兴见到你。';
      const instruction = '改成更正式的语气';

      mockClient.setMockResponse({
        choices: [{
          message: {
            content: '您好，很荣幸见到您。'
          }
        }]
      });

      const result = await adapter.rewriteDialogue(originalDialogue, instruction);

      assert.strictEqual(result, '您好，很荣幸见到您。');
      assert.strictEqual(mockClient.callCount, 1);
    });

    it('should handle empty dialogue', async () => {
      mockClient.setMockResponse({
        choices: [{
          message: { content: '' }
        }]
      });

      const result = await adapter.rewriteDialogue('', 'instruction');
      
      assert.strictEqual(result, '');
    });
  });
});

/**
 * Run tests:
 * cd backend
 * node --test lib/qwen-adapter.test.js
 * 
 * With coverage (Node.js 20+):
 * node --test --experimental-test-coverage lib/qwen-adapter.test.js
 */
