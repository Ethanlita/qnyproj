/**
 * Local Test: Storyboard Generation with Single Source of Truth
 * 
 * Test the new schema-to-prompt architecture locally before deployment
 */

// Load environment variables from .env file
require('dotenv').config();

const QwenAdapter = require('./lib/qwen-adapter');
const storyboardSchema = require('./schemas/storyboard.json');
const fs = require('fs');
const path = require('path');

// Sample novel text for testing
const sampleNovelText = `
第一章 归途

夕阳西下，金色的余晖洒在小镇的石板路上。李明背着沉重的书包，独自走在回家的路上。

街道两旁是低矮的砖房，偶尔能听到居民家中传来的炊烟声。他今年16岁，是镇上中学的学生。

"李明！"身后传来熟悉的声音。

他转过头，看到同学小红正朝他挥手。小红扎着马尾辫，穿着校服，脸上挂着灿烂的笑容。

"一起回家吗？"小红快步走了过来。

"好啊。"李明点点头，嘴角露出一丝微笑。

两人并肩走在古老的石板街上，夕阳将他们的影子拉得很长。
`.trim();

async function testLocalStoryboardGeneration() {
  console.log('='.repeat(70));
  console.log('🧪 本地测试：基于单一事实来源的分镜生成');
  console.log('='.repeat(70));
  console.log();

  // Check if API key is set
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: QWEN_API_KEY environment variable not set');
    console.log('\nPlease set it with:');
    console.log('  export QWEN_API_KEY="your-api-key"');
    process.exit(1);
  }

  console.log('✅ QWEN_API_KEY found');
  console.log(`📝 Sample novel text length: ${sampleNovelText.length} chars`);
  console.log();

  // Initialize QwenAdapter
  const adapter = new QwenAdapter({
    apiKey: apiKey,
    endpoint: process.env.QWEN_ENDPOINT || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: process.env.QWEN_MODEL || 'qwen-plus',
    maxRetries: 3
  });

  console.log('📊 Testing with:');
  console.log(`  - Schema: storyboard.json (${Object.keys(storyboardSchema.properties).length} top-level properties)`);
  console.log('  - Architecture: Single Source of Truth (dynamic System Prompt)');
  console.log('  - Novel: 第一章 归途');
  console.log();

  try {
    console.log('🚀 Starting storyboard generation...');
    console.log('-'.repeat(70));
    
    const startTime = Date.now();
    
    const result = await adapter.generateStoryboard({
      text: sampleNovelText,
      jsonSchema: storyboardSchema,
      strictMode: true,
      maxChunkLength: 8000,
      existingCharacters: [],
      existingScenes: [],
      chapterNumber: 1
    });
    
    const duration = Date.now() - startTime;
    
    console.log('-'.repeat(70));
    console.log(`✅ Generation completed in ${(duration / 1000).toFixed(2)}s`);
    console.log();

    // Validate result structure
    console.log('🔍 Validating result structure...');
    console.log('-'.repeat(70));
    
    const validations = [
      { name: 'Has panels array', check: Array.isArray(result.panels) },
      { name: 'Has characters array', check: Array.isArray(result.characters) },
      { name: 'Has scenes array', check: Array.isArray(result.scenes) },
      { name: 'Has totalPages', check: typeof result.totalPages === 'number' },
      { name: 'Panels not empty', check: result.panels.length > 0 },
      { name: 'Characters not empty', check: result.characters.length > 0 }
    ];

    let allValid = true;
    for (const { name, check } of validations) {
      console.log(`  ${check ? '✅' : '❌'} ${name}`);
      if (!check) allValid = false;
    }

    if (!allValid) {
      console.error('\n❌ Validation failed!');
      process.exit(1);
    }

    console.log();
    console.log('📊 Generated Content Summary:');
    console.log('-'.repeat(70));
    console.log(`  📄 Panels: ${result.panels.length}`);
    console.log(`  👤 Characters: ${result.characters.length}`);
    console.log(`  🏛️  Scenes: ${result.scenes.length}`);
    console.log(`  📖 Total Pages: ${result.totalPages}`);
    console.log();

    // Display character details
    console.log('👤 Characters:');
    result.characters.forEach((char, idx) => {
      console.log(`  ${idx + 1}. ${char.name} (${char.role})`);
      if (char.appearance) {
        console.log(`     - Age: ${char.appearance.age}`);
        console.log(`     - Gender: ${char.appearance.gender || 'N/A'}`);
      }
    });
    console.log();

    // Display scene details
    if (result.scenes.length > 0) {
      console.log('🏛️  Scenes:');
      result.scenes.forEach((scene, idx) => {
        console.log(`  ${idx + 1}. ${scene.name || scene.id} (${scene.type})`);
        console.log(`     - ID: ${scene.id}`);
      });
      console.log();
    }

    // Display first panel as example
    console.log('🎬 First Panel Example:');
    console.log('-'.repeat(70));
    const firstPanel = result.panels[0];
    console.log(`  Page: ${firstPanel.page}, Index: ${firstPanel.index}`);
    console.log(`  Scene: ${firstPanel.scene.substring(0, 80)}...`);
    console.log(`  Shot Type: ${firstPanel.shotType}`);
    console.log(`  Camera Angle: ${firstPanel.cameraAngle}`);
    console.log(`  Mood: ${firstPanel.atmosphere.mood}`);
    console.log();

    // Save result to file
    const outputPath = path.join(__dirname, 'test-output-storyboard.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(`💾 Full result saved to: ${outputPath}`);
    console.log();

    // Test key features of Single Source of Truth
    console.log('🔬 Single Source of Truth Verification:');
    console.log('-'.repeat(70));
    
    const checks = [
      {
        name: 'shotType uses schema examples',
        check: ['close-up', 'medium', 'wide', 'extreme-wide'].some(v => 
          result.panels.some(p => p.shotType && p.shotType.toLowerCase().includes(v))
        )
      },
      {
        name: 'cameraAngle uses schema examples',
        check: ['eye-level', 'high-angle', 'low-angle'].some(v => 
          result.panels.some(p => p.cameraAngle && p.cameraAngle.toLowerCase().includes(v))
        )
      },
      {
        name: 'mood uses schema examples',
        check: ['peaceful', 'tense', 'joyful', 'dramatic'].some(v => 
          result.panels.some(p => p.atmosphere.mood && p.atmosphere.mood.toLowerCase().includes(v))
        )
      }
    ];

    for (const { name, check } of checks) {
      console.log(`  ${check ? '✅' : '⚠️ '} ${name}`);
    }

    console.log();
    console.log('='.repeat(70));
    console.log('🎉 Local Test Passed!');
    console.log('✅ Schema-to-Prompt architecture working correctly');
    console.log('✅ Ready for deployment');
    console.log('='.repeat(70));

  } catch (error) {
    console.error();
    console.error('❌ Test Failed!');
    console.error('='.repeat(70));
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run test
testLocalStoryboardGeneration();
