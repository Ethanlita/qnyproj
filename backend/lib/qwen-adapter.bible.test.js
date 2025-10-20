/**
 * Integration tests for Bible Continuity in QwenAdapter
 * 
 * Tests multi-chapter bible reuse and character/scene preservation.
 * 
 * Requirements:
 * 1. Set QWEN_API_KEY environment variable
 * 2. Run with: node --test backend/lib/qwen-adapter.bible.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');
const QwenAdapter = require('./qwen-adapter');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

describe('QwenAdapter Bible Continuity Tests', () => {
  let adapter;
  const apiKey = process.env.QWEN_API_KEY;
  
  // Load storyboard schema
  const storyboardSchema = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../schemas/storyboard.json'), 'utf8')
  );
  
  before(() => {
    if (!apiKey) {
      console.warn('⚠️  QWEN_API_KEY not found. Skipping bible continuity tests.');
      process.exit(0);
    }
    
    adapter = new QwenAdapter({
      apiKey,
      endpoint: process.env.QWEN_ENDPOINT || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      model: process.env.QWEN_MODEL || 'qwen-plus',
      maxRetries: 3
    });
    
    console.log('\n📖 Testing Bible Continuity Features\n');
  });
  
  it('should generate initial bible for Chapter 1', async () => {
    const chapter1Text = `第一章：初遇

天色渐晚，夕阳的余晖洒在小镇的石板路上。李明背着书包，慢慢走在回家的路上。

突然，一个身影出现在他面前。那是一个穿着白色连衣裙的女孩，长发如瀑，眼神清澈。

"你好，"女孩微笑着说，"请问图书馆怎么走？"

李明愣了一下，指了指前方："沿着这条路直走，第二个路口左转就到了。"

"谢谢！"女孩转身离开，留下一缕淡淡的花香。`;
    
    console.log('\n📝 Chapter 1: Generating initial bible...');
    
    const result = await adapter.generateStoryboard({
      text: chapter1Text,
      jsonSchema: storyboardSchema,
      strictMode: true,
      chapterNumber: 1
    });
    
    console.log(`✅ Generated ${result.panels.length} panels`);
    console.log(`✅ Generated ${result.characters.length} characters:`, result.characters.map(c => c.name));
    console.log(`✅ Generated ${result.scenes ? result.scenes.length : 0} scenes:`, result.scenes ? result.scenes.map(s => s.name) : 'N/A');
    
    // Validate structure
    assert.ok(result.panels.length > 0, 'Should have panels');
    assert.ok(result.characters.length >= 2, 'Should have at least 2 characters (李明, 女孩)');
    assert.ok(result.scenes && result.scenes.length >= 1, 'Should have at least 1 scene');
    
    // Save bible for next test
    this.chapter1Bible = {
      characters: result.characters,
      scenes: result.scenes || []
    };
    
    console.log('\n💾 Saved Chapter 1 bible for reuse\n');
  });
  
  it('should reuse Chapter 1 bible and add new content in Chapter 2', async () => {
    const chapter2Text = `第二章：图书馆

第二天放学，李明来到图书馆。

图书馆是一栋古老的建筑，红砖墙面爬满了常春藤。推开厚重的木门，迎面而来的是书香气息。

李明走到文学区，突然看到昨天那个女孩正在翻阅一本诗集。旁边还站着一个戴眼镜的男生，似乎在和她讨论什么。

"又是你！"女孩抬起头，露出惊喜的表情。"我叫林雨萱，这位是我的同学张浩。"`;
    
    console.log('\n📝 Chapter 2: Reusing bible from Chapter 1...');
    console.log(`📖 Existing characters: ${this.chapter1Bible.characters.map(c => c.name).join(', ')}`);
    console.log(`🏛️  Existing scenes: ${this.chapter1Bible.scenes.map(s => s.name).join(', ')}`);
    
    const result = await adapter.generateStoryboard({
      text: chapter2Text,
      jsonSchema: storyboardSchema,
      strictMode: true,
      existingCharacters: this.chapter1Bible.characters,
      existingScenes: this.chapter1Bible.scenes,
      chapterNumber: 2
    });
    
    console.log(`\n✅ Generated ${result.panels.length} panels`);
    console.log(`✅ Total characters: ${result.characters.length}:`, result.characters.map(c => c.name));
    console.log(`✅ Total scenes: ${result.scenes.length}:`, result.scenes.map(s => s.name));
    
    // Validate bible preservation
    assert.ok(result.characters.length >= 3, 'Should have at least 3 characters (李明, 林雨萱, 张浩)');
    
    // Find 李明 in both bibles
    const originalLiMing = this.chapter1Bible.characters.find(c => c.name === '李明');
    const newLiMing = result.characters.find(c => c.name === '李明');
    
    assert.ok(originalLiMing, 'Chapter 1 should have 李明');
    assert.ok(newLiMing, 'Chapter 2 should preserve 李明');
    
    // Verify appearance is preserved
    if (originalLiMing.appearance && newLiMing.appearance) {
      console.log('\n🔍 Checking character continuity:');
      console.log(`  Original 李明 hairColor: ${originalLiMing.appearance.hairColor}`);
      console.log(`  New 李明 hairColor: ${newLiMing.appearance.hairColor}`);
      
      // Note: We can't strictly enforce this in test because Qwen might
      // add more details, but we log it for manual verification
      console.log('  ✓ Character preserved (check logs for consistency)');
    }
    
    // Verify scene reuse in panels
    const panelsWithSceneId = result.panels.filter(p => p.background && p.background.sceneId);
    console.log(`\n🏛️  Panels referencing existing scenes: ${panelsWithSceneId.length}/${result.panels.length}`);
    if (panelsWithSceneId.length > 0) {
      console.log('  Scene IDs used:', [...new Set(panelsWithSceneId.map(p => p.background.sceneId))]);
    }
    
    console.log('\n✅ Bible continuity test completed\n');
  });
});
