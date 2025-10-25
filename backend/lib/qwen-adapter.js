/**
 * Qwen API Adapter for DashScope
 * 
 * This adapter provides OpenAI-compatible interface for Qwen models
 * via DashScope's compatibility mode.
 * 
 * Features:
 * - Text splitting for long novels (20k+ characters)
 * - Parallel processing of text chunks
 * - JSON strict mode with schema validation
 * - Automatic retry with exponential backoff
 * - JSON correction when schema validation fails
 * 
 * @module qwen-adapter
 */

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { jsonrepair } = require('jsonrepair');
const { applyPatch } = require('fast-json-patch');
const { buildSystemPrompt } = require('./schema-to-prompt');

/**
 * Custom example for storyboard (overrides auto-generated one)
 * This provides a high-quality reference for Qwen
 */
const STORYBOARD_EXAMPLE = {
  "panels": [
    {
      "page": 1,
      "index": 0,
      "scene": "夕阳西下，金色余晖洒在小镇石板路上。李明背着书包独自走在回家路上，街道两旁是低矮砖房。",
      "background": {
        "sceneId": "ancient_town_main_street",
        "setting": "古镇石板街道",
        "timeOfDay": "dusk",
        "weather": "clear",
        "lighting": "natural",
        "details": ["远处山峦", "街边灯笼", "砖墙上的爬山虎"]
      },
      "atmosphere": {
        "mood": "peaceful",
        "soundEffects": [
          {"sound": "脚步声", "style": "subtle"},
          {"sound": "风铃声", "style": "subtle"}
        ],
        "particleEffects": ["光尘飘浮", "微风吹动树叶"]
      },
      "shotType": "wide",
      "cameraAngle": "eye-level",
      "composition": {
        "focusPoint": "李明的侧影",
        "depthOfField": "deep",
        "rule": "rule-of-thirds"
      },
      "artStyle": {
        "genre": "seinen",
        "lineWeight": "medium",
        "shading": "screentone",
        "colorPalette": "warm sunset tones with golden oranges"
      },
      "characters": [
        {
          "name": "李明",
          "pose": "缓慢行走，微微低头",
          "expression": "neutral",
          "position": "midground"
        }
      ],
      "dialogue": [],
      "visualPrompt": "A quiet small town street at sunset, golden light on cobblestone pavement, teenage boy in school uniform walking alone with backpack, low brick houses on both sides, distant mountains, warm peaceful atmosphere, seinen manga style, screentone shading",
      "narrativeFunction": "establishing-shot"
    }
  ],
  "characters": [
    {
      "name": "李明",
      "role": "protagonist",
      "appearance": {
        "gender": "male",
        "age": 16,
        "hairColor": "black",
        "hairStyle": "short",
        "eyeColor": "brown",
        "height": "average",
        "build": "slim",
        "clothing": ["校服", "书包"],
        "distinctiveFeatures": ["圆框眼镜"]
      },
      "personality": ["内向", "善良", "细心"]
    }
  ],
  "scenes": [
    {
      "id": "ancient_town_main_street",
      "name": "古镇主街",
      "type": "outdoor",
      "description": "小镇中心的古老石板路，两旁是传统砖木结构低矮房屋，承载着小镇几代人的记忆。",
      "visualCharacteristics": {
        "architecture": "传统砖木结构，青瓦屋顶，木质门窗，墙面有岁月痕迹",
        "keyLandmarks": ["石拱桥", "百年老槐树", "李家茶馆"],
        "colorScheme": "暖色调为主，砖红、木褐、青灰色",
        "lighting": {
          "naturalLight": "abundant",
          "artificialLight": "moderate",
          "lightSources": ["街灯", "店铺灯光", "窗户透出的光"]
        },
        "atmosphere": "宁静中带着烟火气，时间在这里流淌得很慢",
        "soundscape": ["脚步声", "风铃", "远处狗吠", "茶馆里的谈笑"],
        "textures": ["粗糙石板路", "斑驳墙面", "光滑木门"]
      },
      "spatialLayout": {
        "size": "medium",
        "layout": "长约200米的街道，宽约6米，两侧各有店铺和民居",
        "keyAreas": [
          {"name": "石拱桥", "position": "街道中段"},
          {"name": "老槐树", "position": "街道北端"},
          {"name": "李家茶馆", "position": "街道南侧"}
        ]
      },
      "timeVariations": [
        {
          "timeOfDay": "morning",
          "description": "晨光透过薄雾，石板路泛着湿润光泽，早起的居民开始活动"
        },
        {
          "timeOfDay": "dusk",
          "description": "夕阳将街道染成金色，街灯开始点亮，炊烟袅袅升起"
        }
      ],
      "weatherVariations": [
        {
          "weather": "rainy",
          "description": "雨水在石板路上形成小水洼，屋檐滴水声清脆，空气中弥漫着泥土香"
        }
      ],
      "narrativeRole": "primary-setting",
      "firstAppearance": {
        "chapter": 1,
        "page": 1,
        "panelIndex": 0
      },
      "referenceImages": []
    }
  ],
  "totalPages": 1
};

/**
 * QwenAdapter class for interacting with Qwen API via DashScope
 */
class QwenAdapter {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.apiKey - Qwen API key
   * @param {string} [options.endpoint] - API endpoint (default: DashScope compatibility mode)
   * @param {number} [options.maxRetries=3] - Maximum retry attempts for failed requests
   * @param {string} [options.model='qwen-plus'] - Model to use (qwen-plus, qwen-max, qwen-turbo)
   */
  constructor(options) {
    const { apiKey, endpoint, maxRetries = 3, model = 'qwen-plus' } = options;
    
    if (!apiKey) {
      throw new Error('Qwen API key is required');
    }
    
    this.client = new OpenAI({
      apiKey,
      baseURL: endpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    });
    
    this.maxRetries = maxRetries;
    this.model = model;
    
    // 设置日志文件路径
    // Lambda 环境下 /var/task 是只读的，直接使用 /tmp
    const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    
    if (isLambda) {
      this.logFilePath = path.join('/tmp', 'qwen.log');
      console.log('[QwenAdapter] Lambda 环境检测到，使用 /tmp/qwen.log');
    } else {
      // 本地环境：优先使用环境变量，其次使用当前目录
      const preferredLogPath = process.env.QWEN_LOG_PATH
        ? path.resolve(process.env.QWEN_LOG_PATH)
        : path.join(process.cwd(), 'qwen.log');
      
      const fallbackLogPath = path.join('/tmp', 'qwen.log');
      this.logFilePath = preferredLogPath;
      
      // 实际尝试写文件来检测是否可写（仅检查目录权限不够）
      try {
        fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
        // 尝试写入测试内容
        fs.appendFileSync(this.logFilePath, '', 'utf8');
      } catch (err) {
        console.warn('[QwenAdapter] 路径不可写（错误: ' + err.code + '），切换到 /tmp/qwen.log');
        this.logFilePath = fallbackLogPath;
        // 确保 fallback 路径可用
        try {
          fs.mkdirSync(path.dirname(fallbackLogPath), { recursive: true });
        } catch (e) {
          // /tmp should always be writable
        }
      }
    }
  }
  
  /**
   * Write log to file (UTF-8 encoded to avoid console garbled text)
   * AND always output to console for CloudWatch
   * @param {string} content - Log content
   */
  log(content) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${content}`;
    
    // Always log to console for CloudWatch visibility
    console.log(logEntry);
    
    // Also try to write to file for local debugging
    try {
      fs.appendFileSync(this.logFilePath, logEntry + '\n', 'utf8');
    } catch (error) {
      // Silently ignore file write errors in Lambda environment
    }
  }
  
  /**
   * Clear log file
   */
  clearLog() {
    try {
      if (fs.existsSync(this.logFilePath)) {
        fs.unlinkSync(this.logFilePath);
      }
    } catch (error) {
      console.warn('[QwenAdapter] 无法清理日志文件，忽略。');
    }
  }
  
  /**
   * Generate storyboard from novel text
   * 
   * Handles long texts by splitting into chunks, processing in parallel,
   * and merging results. Supports continuity by accepting existing character
   * and scene bibles.
   * 
   * @param {Object} options - Generation options
   * @param {string} options.text - Novel text to convert
   * @param {Object} options.jsonSchema - JSON Schema for validation
   * @param {boolean} [options.strictMode=true] - Use JSON strict mode
   * @param {number} [options.maxChunkLength=8000] - Maximum characters per chunk
   * @param {Array} [options.existingCharacters=[]] - Existing character bible for continuity
   * @param {Array} [options.existingScenes=[]] - Existing scene bible for continuity
   * @param {number} [options.chapterNumber] - Current chapter number
   * @returns {Promise<Object>} Generated storyboard with panels and characters
   */
  async generateStoryboard(options) {
    const overallStartTime = Date.now();
    
    const {
      text,
      jsonSchema,
      strictMode = true,
      maxChunkLength = 8000,
      existingCharacters = [],
      existingScenes = [],
      chapterNumber
    } = options;
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[QwenAdapter] 🚀 Starting storyboard generation`);
    console.log(`  Text length: ${text.length} chars`);
    console.log(`  Strict mode: ${strictMode}`);
    console.log(`  Max chunk length: ${maxChunkLength}`);
    console.log(`${'='.repeat(70)}\n`);
    
    if (existingCharacters.length > 0) {
      console.log(`[QwenAdapter] Using ${existingCharacters.length} existing characters`);
    }
    if (existingScenes.length > 0) {
      console.log(`[QwenAdapter] Using ${existingScenes.length} existing scenes`);
    }
    
    // 1. Split text into intelligent chunks
    const splitStartTime = Date.now();
    const chunks = this.splitTextIntelligently(text, maxChunkLength);
    const splitDuration = Date.now() - splitStartTime;
    console.log(`[QwenAdapter] ✂️  Split text into ${chunks.length} chunks (${splitDuration}ms)`);
    
    // 2. Process chunks in parallel (pass bibles to first chunk only)
    console.log(`[QwenAdapter] 📡 Calling Qwen API for ${chunks.length} chunk(s)...`);
    const apiStartTime = Date.now();
    
    const responses = await Promise.all(
      chunks.map((chunk, idx) =>
        this.callQwen(
          chunk,
          jsonSchema,
          strictMode,
          idx === 0 ? existingCharacters : [], // Only pass to first chunk
          idx === 0 ? existingScenes : [],
          chapterNumber
        )
          .then(result => {
            console.log(`[QwenAdapter] ✅ Chunk ${idx + 1}/${chunks.length} succeeded`);
            return result;
          })
          .catch(err => {
            console.error(`[QwenAdapter] ❌ Chunk ${idx + 1}/${chunks.length} failed:`, err.message);
            return null;
          })
      )
    );
    
    const apiDuration = Date.now() - apiStartTime;
    console.log(`[QwenAdapter] ⏱️  API calls completed in ${apiDuration}ms (${(apiDuration/1000).toFixed(1)}s)`);
    
    // 3. Filter out failed responses
    const parseStartTime = Date.now();
    const validResponses = responses.filter(r => r !== null);
    
    if (validResponses.length === 0) {
      throw new Error('All chunks failed to generate storyboard');
    }
    
    if (validResponses.length < responses.length) {
      console.warn(
        `[QwenAdapter] ${responses.length - validResponses.length}/${responses.length} chunks failed`
      );
    }
    const parseDuration = Date.now() - parseStartTime;
    console.log(`[QwenAdapter] 🔍 Parsed and validated ${validResponses.length} responses (${parseDuration}ms)`);
    
    // 4. Merge storyboards from all chunks
    const mergeStartTime = Date.now();
    const merged = this.mergeStoryboards(validResponses);
    const mergeDuration = Date.now() - mergeStartTime;
    console.log(
      `[QwenAdapter] 🔗 Merged ${merged.panels.length} panels, ${merged.characters.length} characters, ${merged.scenes.length} scenes (${mergeDuration}ms)`
    );
    
    // Final summary
    const totalDuration = Date.now() - overallStartTime;
    console.log(`\n[QwenAdapter] ⏱️  TOTAL: ${totalDuration}ms (${(totalDuration/1000).toFixed(1)}s) breakdown:`);
    console.log(`  📝 Split:  ${splitDuration}ms (${(splitDuration/totalDuration*100).toFixed(1)}%)`);
    console.log(`  🌐 API:    ${apiDuration}ms (${(apiDuration/totalDuration*100).toFixed(1)}%)`);
    console.log(`  🔍 Parse:  ${parseDuration}ms (${(parseDuration/totalDuration*100).toFixed(1)}%)`);
    console.log(`  🔗 Merge:  ${mergeDuration}ms (${(mergeDuration/totalDuration*100).toFixed(1)}%)`);
    console.log(`${'='.repeat(70)}\n`);
    
    return merged;
  }
  
  /**
   * Call Qwen API with retry logic
   * 
   * @param {string} text - Text to process
   * @param {Object} schema - JSON Schema
   * @param {boolean} strictMode - Use strict JSON mode
   * @param {Array} [existingCharacters=[]] - Existing character bible
   * @param {Array} [existingScenes=[]] - Existing scene bible
   * @param {number} [chapterNumber] - Current chapter number
   * @returns {Promise<Object>} Parsed JSON response
   * @private
   */
  async callQwen(text, schema, strictMode, existingCharacters = [], existingScenes = [], chapterNumber) {
    let lastError;
    
    // Build user message with existing bibles if provided
    let userMessage = text;
    if (existingCharacters.length > 0 || existingScenes.length > 0) {
      userMessage = `章节 ${chapterNumber || '?'}：\n\n`;
      
      if (existingCharacters.length > 0) {
        userMessage += `【现有角色圣经】请在生成的 characters 数组中包含以下所有角色，并保持其 appearance 不变：\n`;
        userMessage += JSON.stringify(existingCharacters, null, 2);
        userMessage += '\n\n';
      }
      
      if (existingScenes.length > 0) {
        userMessage += `【现有场景圣经】请在生成的 scenes 数组中包含以下所有场景，并保持其 visualCharacteristics 不变。在 panel.background.sceneId 中优先使用这些场景ID：\n`;
        userMessage += JSON.stringify(existingScenes, null, 2);
        userMessage += '\n\n';
      }
      
      userMessage += `【新章节文本】\n${text}`;
    }
    
    // 🔍 Log request details to file
    this.log('\n📤 ===== QWEN API REQUEST =====');
    this.log(`🔧 Model: ${this.model}`);
    this.log(`🔒 Strict Mode: ${strictMode}`);
    this.log(`📏 Text Length: ${text.length} chars`);
    if (existingCharacters.length > 0) {
      this.log(`📖 Existing Characters: ${existingCharacters.length}`);
    }
    if (existingScenes.length > 0) {
      this.log(`🏛️  Existing Scenes: ${existingScenes.length}`);
    }
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // 🔥 Generate System Prompt dynamically from schema
        const systemPrompt = buildSystemPrompt(schema, {
          customExample: STORYBOARD_EXAMPLE
        });
        
        // 🔍 Log request details to file and CloudWatch
        this.log('\n💬 System Prompt (generated from schema):');
        this.log('─'.repeat(60));
        this.log(systemPrompt.substring(0, 500) + '... (truncated for brevity)');
        this.log('─'.repeat(60));
        this.log('\n📝 User Input:');
        this.log('─'.repeat(60));
        this.log(userMessage);
        this.log('─'.repeat(60));
        this.log('\n📋 JSON Schema:');
        this.log(JSON.stringify(schema, null, 2).substring(0, 500) + '...');
        this.log('─'.repeat(60));
        
        const requestPayload = {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'storyboard',
              strict: strictMode,
              schema: schema
            }
          },
          temperature: 0.3,
          // 默认 8000 token 容量不足以承载整章内容，这里放宽到 64k（10 倍）
          max_tokens: 64000
        };
        
        this.log('\n⏳ Sending request to Qwen...');
        const startTime = Date.now();
        
        const response = await this.client.chat.completions.create(requestPayload);
        
        const elapsedMs = Date.now() - startTime;
        
        // 🔍 Log response details (now goes to both file and CloudWatch)
        this.log('\n📥 ===== QWEN API RESPONSE =====');
        this.log(`⏱️  Elapsed: ${elapsedMs} ms`);
        const finishReason = response.choices[0].finish_reason;
        this.log(`🎯 Finish Reason: ${finishReason}`);
        this.log(`📊 Token Usage: ${JSON.stringify(response.usage, null, 2)}`);
        this.log('\n📄 Raw Response Content:');
        this.log('─'.repeat(60));
        const content = response.choices[0].message.content;
        this.log(content);
        this.log('─'.repeat(60));
        if (finishReason === 'length') {
          this.log('[QwenAdapter] ⚠️ Qwen response hit max_tokens and was truncated. Tail preview:');
          this.log(content.slice(-400));
          this.log('─'.repeat(60));
        }
        
        // Parse with repair + structural normalization
        const parsed = this.ensureStoryboardShape(this.parseJsonWithRepair(content));
        this.log('\n✅ Parsed JSON Structure:');
        this.log(`  - panels: ${Array.isArray(parsed.panels) ? parsed.panels.length : 'N/A'}`);
        this.log(`  - characters: ${Array.isArray(parsed.characters) ? parsed.characters.length : 'N/A'}`);
        this.log(`  - scenes: ${Array.isArray(parsed.scenes) ? parsed.scenes.length : 'N/A'}`);
        this.log('─'.repeat(60));
        
        // Summary for quick identification
        const totalTokens = response.usage?.total_tokens ?? 'unknown';
        console.log(`✅ [QwenAdapter] Qwen API call succeeded in ${elapsedMs}ms (${totalTokens} tokens)`);
        
        return parsed;
        
      } catch (error) {
        lastError = error;
        
        // Handle rate limiting with exponential backoff
        if (error.status === 429 && attempt < this.maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          console.log(`[QwenAdapter] Rate limited, retrying after ${backoffMs}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
        
        // Don't retry on other errors
        throw error;
      }
    }
    
    throw lastError;
  }
  
  /**
   * Split text intelligently into chunks
   * 
   * Attempts to split on natural boundaries (paragraphs, chapters)
   * rather than arbitrary character counts.
   * 
   * @param {string} text - Text to split
   * @param {number} maxLength - Maximum chunk length
   * @returns {string[]} Array of text chunks
   */
  splitTextIntelligently(text, maxLength) {
    // First try to split by double newlines (paragraphs)
    const paragraphs = text.split(/\n\n+/);
    const chunks = [];
    let currentChunk = '';
    
    for (const para of paragraphs) {
      // If a single paragraph exceeds maxLength, split it by sentences
      if (para.length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        
        // Split paragraph by sentences
        const sentences = para.match(/[^。！？.!?]+[。！？.!?]*/g) || [para];
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = sentence;
          } else {
            currentChunk += sentence;
          }
        }
        continue;
      }
      
      // If adding this paragraph exceeds maxLength, start new chunk
      if (currentChunk.length + para.length + 2 > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = para;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
    }
    
    // Add last chunk
    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [text];
  }
  
  /**
   * Merge multiple storyboards into one
   * 
   * - Concatenates panels with recalculated page/index
   * - Deduplicates characters by name
   * - Recalculates total pages
   * 
   * @param {Object[]} storyboards - Array of storyboard objects
   * @returns {Object} Merged storyboard
   */
  mergeStoryboards(storyboards) {
    const PANELS_PER_PAGE = 6;
    let mergedPanels = [];
    const charMap = new Map();
    const sceneMap = new Map();
    
    // Merge panels
    for (const sb of storyboards) {
      for (const panel of sb.panels || []) {
        const absoluteIndex = mergedPanels.length;
        mergedPanels.push({
          ...panel,
          page: Math.floor(absoluteIndex / PANELS_PER_PAGE) + 1,
          index: absoluteIndex % PANELS_PER_PAGE
        });
      }
    }
    
    // Merge characters (deduplicate by name)
    for (const sb of storyboards) {
      for (const char of sb.characters || []) {
        if (!charMap.has(char.name)) {
          charMap.set(char.name, char);
        } else {
          // Merge appearance and personality if not already set
          const existing = charMap.get(char.name);
          if (char.appearance && !existing.appearance) {
            existing.appearance = char.appearance;
          }
          if (char.personality && !existing.personality) {
            existing.personality = char.personality;
          }
        }
      }
    }
    
    // Merge scenes (deduplicate by id)
    for (const sb of storyboards) {
      for (const scene of sb.scenes || []) {
        if (!sceneMap.has(scene.id)) {
          sceneMap.set(scene.id, scene);
        }
        // Note: Don't merge scene properties - scenes should be immutable
      }
    }
    
    return {
      panels: mergedPanels,
      characters: Array.from(charMap.values()),
      scenes: Array.from(sceneMap.values()),
      totalPages: Math.ceil(mergedPanels.length / PANELS_PER_PAGE)
    };
  }

  /**
   * Parse JSON with fallback repair for malformed symbols
   * @param {string} rawContent
   * @returns {Object}
   */
  parseJsonWithRepair(rawContent) {
    const normalizedContent = rawContent
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    try {
      return JSON.parse(normalizedContent);
    } catch (parseError) {
      this.log(`[QwenAdapter] ⚠️ JSON parse failed (${parseError.message}), attempting jsonrepair...`);
      this.log('[QwenAdapter] 🔍 Problematic snippet (tail 400 chars):');
      this.log(normalizedContent.slice(-400));
      this.log('─'.repeat(60));
      try {
        const repaired = jsonrepair(normalizedContent);
        this.log('[QwenAdapter] ✅ jsonrepair succeeded');
        return JSON.parse(repaired);
      } catch (repairError) {
        this.log(`[QwenAdapter] ❌ jsonrepair failed: ${repairError.message}`);
        throw parseError;
      }
    }
  }

  /**
   * Ensure storyboard top-level structures are arrays using fast-json-patch
   * @param {Object} storyboard
   * @returns {Object}
   */
  ensureStoryboardShape(storyboard = {}) {
    const target = typeof storyboard === 'object' && storyboard !== null ? storyboard : {};
    const patches = [];

    const ensureArray = (key) => {
      const value = target[key];
      if (!Array.isArray(value)) {
        patches.push({
          op: value === undefined ? 'add' : 'replace',
          path: `/${key}`,
          value: []
        });
      }
    };

    ensureArray('panels');
    ensureArray('characters');
    ensureArray('scenes');

    if (patches.length > 0) {
      this.log(`[QwenAdapter] 🔧 Applying ${patches.length} structural patches via fast-json-patch`);
      applyPatch(target, patches, true, false);
    }

    target.panels = (target.panels || [])
      .filter(Boolean)
      .map((panel) => ({
        ...(panel || {}),
        characters: Array.isArray(panel?.characters) ? panel.characters.filter(Boolean) : [],
        dialogue: Array.isArray(panel?.dialogue) ? panel.dialogue.filter(Boolean) : []
      }));

    target.characters = (target.characters || []).filter(Boolean);
    target.scenes = (target.scenes || []).filter(Boolean);

    if (typeof target.totalPages !== 'number') {
      const panelCount = target.panels?.length || 0;
      target.totalPages = panelCount > 0 ? Math.ceil(panelCount / 6) : 0;
    }

    return target;
  }
  
  /**
   * Correct invalid JSON using Qwen
   * 
   * When schema validation fails, ask Qwen to fix the JSON.
   * 
   * @param {Object} invalidJson - Invalid JSON object
   * @param {Array} errors - Validation errors from AJV
   * @returns {Promise<Object>} Corrected JSON
   */
  async correctJson(invalidJson, errors) {
    console.log('[QwenAdapter] Attempting to correct invalid JSON');
    
    const prompt = `以下 JSON 有校验错误，请修正使其符合 Schema。

错误列表：
${JSON.stringify(errors, null, 2)}

原始 JSON：
${JSON.stringify(invalidJson, null, 2)}

请输出修正后的完整 JSON（不要添加任何解释文字）。`;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: '你是一个 JSON 修正助手。你的任务是修正不符合 Schema 的 JSON 对象。'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 8000
      });
      
      const content = response.choices[0].message.content;
      
      // Try to extract JSON from response
      // Sometimes the model includes markdown code blocks
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || 
                        content.match(/```\n?([\s\S]*?)\n?```/) ||
                        [null, content];
      
      return JSON.parse(jsonMatch[1]);
      
    } catch (error) {
      console.error('[QwenAdapter] JSON correction failed:', error.message);
      throw new Error(`Failed to correct JSON: ${error.message}`);
    }
  }
  
  /**
   * Parse change request from natural language
   * 
   * Convert user's natural language change request to CR-DSL.
   * 
   * @param {Object} options - Parse options
   * @param {string} options.naturalLanguage - User's natural language request
   * @param {Object} options.jsonSchema - CR-DSL JSON Schema
   * @param {Object} [options.context] - Additional context (panel data, character data, etc.)
   * @returns {Promise<Object>} Parsed CR-DSL object
   */
  async parseChangeRequest(options) {
    const { naturalLanguage, jsonSchema, context = {} } = options;
    
    console.log('[QwenAdapter] Parsing change request from natural language');
    
    const systemPrompt = `你是一个漫画修改助手。

你的任务是将用户的自然语言修改请求转换为结构化的 CR-DSL（Change Request Domain Specific Language）。

CR-DSL 包含以下要素：
- scope: 修改范围（global/character/panel/page）
- targetId: 目标 ID（如果适用）
- type: 修改类型（art/dialogue/layout/style）
- ops: 操作列表，每个操作包含 action 和 params

可用的 action：
- inpaint: 局部重绘（需要遮罩区域）
- outpaint: 扩展画面
- bg_swap: 替换背景
- repose: 改变角色姿势
- regen_panel: 重新生成整个面板
- rewrite_dialogue: 重写对白
- reorder: 重新排序

请根据用户的自然语言请求，生成符合 Schema 的 CR-DSL JSON。`;
    
    const userPrompt = `自然语言请求：
${naturalLanguage}

${context.panelId ? `当前面板 ID: ${context.panelId}` : ''}
${context.charId ? `当前角色 ID: ${context.charId}` : ''}

请输出 CR-DSL JSON。`;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'change_request',
            strict: true,
            schema: jsonSchema
          }
        },
        temperature: 0.2,
        max_tokens: 2000
      });
      
      const content = response.choices[0].message.content;
      return JSON.parse(content);
      
    } catch (error) {
      console.error('[QwenAdapter] CR parsing failed:', error.message);
      throw new Error(`Failed to parse change request: ${error.message}`);
    }
  }
  
  /**
   * Rewrite dialogue based on instruction
   * 
   * @param {string} originalDialogue - Original dialogue text
   * @param {string} instruction - Rewrite instruction
   * @returns {Promise<string>} Rewritten dialogue
   */
  async rewriteDialogue(originalDialogue, instruction) {
    console.log('[QwenAdapter] Rewriting dialogue');
    
    const systemPrompt = `你是一个专业的对白编辑。

你的任务是根据用户的指示重写漫画对白，保持角色性格和语气，同时满足修改要求。

要求：
1. 保持对白简洁（漫画气泡空间有限）
2. 符合角色性格
3. 自然流畅
4. 直接输出重写后的对白，不要添加引号或解释`;
    
    const userPrompt = `原始对白：
${originalDialogue}

修改指示：
${instruction}

请输出重写后的对白。`;
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 200
      });
      
      return response.choices[0].message.content.trim();
      
    } catch (error) {
      console.error('[QwenAdapter] Dialogue rewrite failed:', error.message);
      throw new Error(`Failed to rewrite dialogue: ${error.message}`);
    }
  }
}

module.exports = QwenAdapter;
