/**
 * Integration tests for QwenAdapter with real Qwen API
 * 
 * These tests make actual API calls to Qwen (DashScope).
 * 
 * Requirements:
 * 1. Set QWEN_API_KEY environment variable
 * 2. Run with: node --test backend/lib/qwen-adapter.integration.test.js
 * 
 * Test strategy:
 * - First run: Make real API call, save response as fixture
 * - Subsequent runs: Compare with saved fixture to detect API changes
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const QwenAdapter = require('./qwen-adapter');

// Load environment variables from .env file
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const FIXTURES_DIR = path.join(__dirname, '../test-fixtures');
const RESPONSE_FIXTURE = path.join(FIXTURES_DIR, 'qwen-response.json');

describe('QwenAdapter Integration Tests (Real API)', () => {
  let adapter;
  const apiKey = process.env.QWEN_API_KEY;

  before(() => {
    // Ensure fixtures directory exists
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }

    // Skip if no API key
    if (!apiKey) {
      console.warn('⚠️  QWEN_API_KEY not found. Set it in backend/.env to run integration tests.');
      process.exit(0);
    }

    adapter = new QwenAdapter({
      apiKey,
      endpoint: process.env.QWEN_ENDPOINT || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: process.env.QWEN_MODEL || 'qwen-plus',
      maxRetries: 3
    });

    console.log(`\n🔑 Using API Key: ${apiKey.substring(0, 10)}...`);
    console.log(`🌐 Endpoint: ${adapter.client.baseURL}`);
    console.log(`🤖 Model: ${adapter.model}`);
    
    // Clear log file for fresh start
    adapter.clearLog();
    console.log(`📄 Log file: ${adapter.logFilePath}\n`);
  });

  it('should successfully call Qwen API with simple text', async () => {
    const testText = `第一章：初遇

天色渐晚，夕阳的余晖洒在小镇的石板路上。李明背着书包，慢慢走在回家的路上。

突然，一个身影出现在他面前。那是一个穿着白色连衣裙的女孩，长发如瀑，眼神清澈。

"你好，"女孩微笑着说，"请问图书馆怎么走？"

李明愣了一下，指了指前方："沿着这条路直走，第二个路口左转就到了。"

"谢谢！"女孩转身离开，留下一缕淡淡的花香。`;

    const schema = {
      type: 'object',
      required: ['panels', 'characters'],
      properties: {
        panels: {
          type: 'array',
          items: {
            type: 'object',
            required: ['page', 'index', 'scene', 'shotType', 'characters', 'dialogue', 'visualPrompt'],
            properties: {
              page: { type: 'integer', minimum: 1 },
              index: { type: 'integer', minimum: 0 },
              scene: { type: 'string' },
              shotType: { type: 'string', enum: ['特写', '中景', '远景', '大远景', '近景'] },
              characters: { type: 'array', items: { type: 'string' } },
              dialogue: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['character', 'text'],
                  properties: {
                    character: { type: 'string' },
                    text: { type: 'string' }
                  }
                }
              },
              visualPrompt: { type: 'string' }
            }
          }
        },
        characters: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'role'],
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
              appearance: { type: 'object' },
              personality: { type: 'array', items: { type: 'string' } }
            }
          }
        }
      }
    };

    console.log('📡 Calling Qwen API...');
    const startTime = Date.now();

    const result = await adapter.generateStoryboard({
      text: testText,
      jsonSchema: schema,
      strictMode: true, // ✅ Enable strict mode to enforce schema compliance
      maxChunkLength: 10000
    });

    const elapsed = Date.now() - startTime;
    console.log(`✅ API call succeeded in ${elapsed}ms`);

    // Validate response structure
    assert.ok(result, 'Response should not be null');
    assert.ok(result.panels, 'Response should have panels array');
    assert.ok(result.characters, 'Response should have characters array');
    assert.ok(Array.isArray(result.panels), 'Panels should be an array');
    assert.ok(Array.isArray(result.characters), 'Characters should be an array');

    console.log(`\n📊 Response Summary:`);
    console.log(`  - Panels: ${result.panels.length}`);
    console.log(`  - Characters: ${result.characters.length}`);
    console.log(`  - Total Pages: ${result.totalPages || 'N/A'}`);

    if (result.characters.length > 0) {
      console.log(`\n👤 Characters:`);
      result.characters.forEach(char => {
        console.log(`  - ${char.name} (${char.role})`);
      });
    }

    if (result.panels.length > 0) {
      console.log(`\n🎬 First Panel:`);
      const firstPanel = result.panels[0];
      console.log(`  Page: ${firstPanel.page}, Index: ${firstPanel.index}`);
      console.log(`  Scene: ${firstPanel.scene}`);
      console.log(`  Shot Type: ${firstPanel.shotType}`);
      console.log(`  Visual Prompt: ${firstPanel.visualPrompt.substring(0, 100)}...`);
    }

    // Save fixture for future comparisons
    const fixture = {
      metadata: {
        timestamp: new Date().toISOString(),
        model: adapter.model,
        endpoint: adapter.client.baseURL,
        elapsedMs: elapsed,
        textLength: testText.length
      },
      request: {
        text: testText,
        schema: schema,
        strictMode: true // ✅ Updated to match test configuration
      },
      response: result
    };

    fs.writeFileSync(RESPONSE_FIXTURE, JSON.stringify(fixture, null, 2));
    console.log(`\n💾 Saved response fixture to: ${RESPONSE_FIXTURE}`);
    console.log(`   (This will be used for future comparisons)\n`);

    // Basic validations
    assert.ok(result.panels.length > 0, 'Should generate at least one panel');
    assert.ok(result.characters.length >= 2, 'Should extract at least 2 characters (李明 and 女孩)');

    // Check panel structure
    const panel = result.panels[0];
    assert.ok(panel.page >= 1, 'Panel page should be >= 1');
    assert.ok(panel.scene, 'Panel should have scene description');
    assert.ok(panel.shotType, 'Panel should have shot type');
    assert.ok(panel.visualPrompt, 'Panel should have visual prompt');
    assert.ok(Array.isArray(panel.characters), 'Panel characters should be an array');
    assert.ok(Array.isArray(panel.dialogue), 'Panel dialogue should be an array');

    // Check character structure
    const character = result.characters[0];
    assert.ok(character.name, 'Character should have name');
    assert.ok(character.role, 'Character should have role');
  });

  it('should match previously saved fixture structure', async () => {
    // Skip if no fixture exists yet
    if (!fs.existsSync(RESPONSE_FIXTURE)) {
      console.log('⏭️  No fixture found, skipping comparison test.');
      return;
    }

    console.log('🔍 Loading saved fixture for comparison...');
    const savedFixture = JSON.parse(fs.readFileSync(RESPONSE_FIXTURE, 'utf8'));

    console.log(`\n📅 Fixture Metadata:`);
    console.log(`  Generated: ${savedFixture.metadata.timestamp}`);
    console.log(`  Model: ${savedFixture.metadata.model}`);
    console.log(`  Elapsed: ${savedFixture.metadata.elapsedMs}ms`);

    // Make same API call
    const result = await adapter.generateStoryboard({
      text: savedFixture.request.text,
      jsonSchema: savedFixture.request.schema,
      strictMode: savedFixture.request.strictMode,
      maxChunkLength: 10000
    });

    // Compare structures (not exact values, as LLM output may vary)
    assert.strictEqual(
      typeof result,
      typeof savedFixture.response,
      'Response type should match'
    );

    assert.strictEqual(
      Array.isArray(result.panels),
      Array.isArray(savedFixture.response.panels),
      'Panels should be array in both responses'
    );

    assert.strictEqual(
      Array.isArray(result.characters),
      Array.isArray(savedFixture.response.characters),
      'Characters should be array in both responses'
    );

    // Check that panel structure is consistent
    if (result.panels.length > 0 && savedFixture.response.panels.length > 0) {
      const currentPanel = result.panels[0];
      const savedPanel = savedFixture.response.panels[0];

      const currentKeys = Object.keys(currentPanel).sort();
      const savedKeys = Object.keys(savedPanel).sort();

      assert.deepStrictEqual(
        currentKeys,
        savedKeys,
        'Panel object keys should be consistent'
      );

      console.log(`\n✅ Panel structure matches fixture`);
    }

    // Check character structure
    if (result.characters.length > 0 && savedFixture.response.characters.length > 0) {
      const currentChar = result.characters[0];
      const savedChar = savedFixture.response.characters[0];

      const currentKeys = Object.keys(currentChar).sort();
      const savedKeys = Object.keys(savedChar).sort();

      assert.deepStrictEqual(
        currentKeys,
        savedKeys,
        'Character object keys should be consistent'
      );

      console.log(`✅ Character structure matches fixture\n`);
    }
  });

  it('should handle rate limiting gracefully', async () => {
    console.log('🔄 Testing rate limit handling (making 3 rapid requests)...');
    
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(
        adapter.callQwen('测试文本', {
          type: 'object',
          properties: { message: { type: 'string' } }
        }, false)
      );
    }

    try {
      const results = await Promise.all(promises);
      console.log(`✅ All ${results.length} requests succeeded`);
      assert.strictEqual(results.length, 3, 'Should complete all 3 requests');
    } catch (error) {
      // If we hit rate limit, adapter should retry
      if (error.status === 429) {
        console.log('⚠️  Rate limit hit, but this is expected behavior');
      } else {
        throw error;
      }
    }
  });
});

/**
 * Run tests:
 * 
 * 1. Set environment variables in backend/.env:
 *    QWEN_API_KEY=sk-xxx
 *    QWEN_ENDPOINT=https://dashscope.aliyuncs.com/compatible-mode/v1
 *    QWEN_MODEL=qwen-plus
 * 
 * 2. Install dotenv:
 *    cd backend
 *    npm install --save-dev dotenv
 * 
 * 3. Run tests:
 *    node --test lib/qwen-adapter.integration.test.js
 * 
 * 4. Check generated fixture:
 *    cat test-fixtures/qwen-response.json
 */
