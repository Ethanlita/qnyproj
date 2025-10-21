#!/usr/bin/env node
/**
 * Local test script to reproduce Lambda Worker behavior
 * Tests Qwen API integration with full storyboard generation
 */

const QwenAdapter = require('./lib/qwen-adapter');
const Ajv = require('ajv');
const storyboardSchema = require('./schemas/storyboard.json');

// Initialize validator
const ajv = new Ajv({ allErrors: true });
const validateStoryboard = ajv.compile(storyboardSchema);

// Test novel text (same as Lambda test)
const TEST_TEXT = '从前有一个勇敢的骑士，他踏上了寻找传说中的圣杯的旅程。在森林深处，他遇到了一位神秘的老人。';

async function testStoryboardGeneration() {
  console.log('🧪 Starting Storyboard Generation Test\n');
  console.log('Test Text:', TEST_TEXT);
  console.log('Text Length:', TEST_TEXT.length, 'characters\n');
  
  try {
    // Initialize QwenAdapter (same as Lambda)
    const qwenAdapter = new QwenAdapter({
      apiKey: process.env.QWEN_API_KEY,
      endpoint: process.env.QWEN_ENDPOINT,
      model: process.env.QWEN_MODEL || 'qwen-plus'
    });
    
    console.log('✅ QwenAdapter initialized');
    console.log(`   API Key: ${process.env.QWEN_API_KEY?.substring(0, 10)}...`);
    console.log(`   Endpoint: ${process.env.QWEN_ENDPOINT}`);
    console.log(`   Model: ${process.env.QWEN_MODEL || 'qwen-plus'}\n`);
    
    // Generate storyboard
    console.log('📡 Calling Qwen API...\n');
    const startTime = Date.now();
    
    const storyboard = await qwenAdapter.generateStoryboard({
      text: TEST_TEXT,
      jsonSchema: storyboardSchema,
      strictMode: true,
      maxChunkLength: 8000
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`\n⏱️  Generation completed in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s)\n`);
    
    // Validate storyboard
    console.log('🔍 Validating storyboard against schema...\n');
    const valid = validateStoryboard(storyboard);
    
    if (!valid) {
      console.error('❌ VALIDATION FAILED\n');
      console.error('Validation Errors:');
      console.error(JSON.stringify(validateStoryboard.errors, null, 2));
      console.error('\nGenerated Storyboard Structure:');
      console.error(JSON.stringify({
        hasTitle: !!storyboard.title,
        hasSummary: !!storyboard.summary,
        panelsCount: storyboard.panels?.length,
        charactersCount: storyboard.characters?.length,
        scenesCount: storyboard.scenes?.length,
        firstPanel: storyboard.panels?.[0],
        firstCharacter: storyboard.characters?.[0],
        firstScene: storyboard.scenes?.[0]
      }, null, 2));
      console.error('\n📄 Full Generated Storyboard:');
      console.error(JSON.stringify(storyboard, null, 2));
      process.exit(1);
    }
    
    // Success
    console.log('✅ VALIDATION PASSED\n');
    console.log('Storyboard Summary:');
    console.log(`  - Title: ${storyboard.title || 'N/A'}`);
    console.log(`  - Summary: ${storyboard.summary ? storyboard.summary.substring(0, 50) + '...' : 'N/A'}`);
    console.log(`  - Panels: ${storyboard.panels?.length || 0}`);
    console.log(`  - Characters: ${storyboard.characters?.length || 0}`);
    console.log(`  - Scenes: ${storyboard.scenes?.length || 0}`);
    
    if (storyboard.panels && storyboard.panels.length > 0) {
      console.log('\n📋 First Panel:');
      console.log(JSON.stringify(storyboard.panels[0], null, 2));
    }
    
    if (storyboard.characters && storyboard.characters.length > 0) {
      console.log('\n👤 First Character:');
      console.log(JSON.stringify(storyboard.characters[0], null, 2));
    }
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED\n');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack Trace:');
      console.error(error.stack);
    }
    if (error.response) {
      console.error('\nAPI Response:');
      console.error(JSON.stringify(error.response, null, 2));
    }
    process.exit(1);
  }
}

// Check environment variables
if (!process.env.QWEN_API_KEY) {
  console.error('❌ QWEN_API_KEY environment variable is required');
  console.error('   Run: export QWEN_API_KEY=sk-your-key');
  process.exit(1);
}

if (!process.env.QWEN_ENDPOINT) {
  console.error('⚠️  QWEN_ENDPOINT not set, using default');
  process.env.QWEN_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
}

// Run test
testStoryboardGeneration();
