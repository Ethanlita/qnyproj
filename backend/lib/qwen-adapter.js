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

/**
 * System prompt for storyboard generation
 */
const STORYBOARD_SYSTEM_PROMPT = `你是一个专业的漫画分镜师，擅长将小说文本转换为详细的视觉分镜脚本。

📖 **跨章节连续性规则**（如果提供了现有圣经）：

- **复用已有角色**：如果用户提供了 existingCharacters，必须在 characters 数组中包含所有现有角色（保持原有属性不变），并添加新出现的角色
- **复用已有场景**：如果用户提供了 existingScenes，必须在 scenes 数组中包含所有现有场景（保持原有属性不变），并添加新出现的场景
- **引用场景ID**：在 panel.background.sceneId 中优先使用现有场景的 id，确保重复出现的地点使用相同的场景定义
- **补全新内容**：遇到新角色或新场景时，按照正常规则创建新条目，但保持与现有风格一致
- **禁止修改**：不要修改现有角色的 appearance 或现有场景的 visualCharacteristics，保持视觉连续性

🎬 **核心任务规则**：

1. **场景描写**：详细描述每个面板的视觉画面，包括环境、氛围、人物动作
2. **背景设定**：明确场景地点（setting）、时间（timeOfDay）、天气（weather）、光照（lighting）
3. **镜头设计**：选择合适的景别（shotType）和机位（cameraAngle）强化叙事
4. **氛围营造**：定义情绪基调（mood）、音效（soundEffects）、粒子效果（particleEffects）
5. **画风控制**：指定艺术风格（artStyle）包括类型、线条、阴影、配色
6. **构图原则**：运用构图法则（composition）确定焦点、景深、视觉引导
7. **角色刻画**：准确描述姿态（pose）、表情（expression）、位置（position）
8. **对白处理**：提取对话，标注说话者、气泡类型（bubbleType）、情感（emotion）
9. **叙事功能**：明确面板的故事作用（narrativeFunction）
10. **分页规范**：每页 6 个面板，index 从 0-5
11. **场景圣经（Scene Bible）**：为重复出现的场景创建统一视觉定义，确保跨章节一致性

⚠️ **严格遵循 JSON Schema 字段名称**，完整示例如下：

{
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
        },
        {
          "timeOfDay": "night",
          "description": "街灯昏黄，店铺大多关门，偶尔路过的行人影子被拉得很长"
        }
      ],
      "weatherVariations": [
        {
          "weather": "rainy",
          "description": "雨水在石板路上形成小水洼，屋檐滴水声清脆，空气中弥漫着泥土香"
        },
        {
          "weather": "snowy",
          "description": "雪覆盖石板路，青瓦屋顶白雪皑皑，整条街道寂静无声"
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
}

📋 **枚举值约束**：

shotType: close-up, medium, wide, extreme-wide, extreme-close-up, cowboy-shot
cameraAngle: eye-level, high-angle, low-angle, birds-eye, worms-eye, dutch-angle, over-shoulder
timeOfDay: dawn, morning, noon, afternoon, dusk, evening, night, midnight
weather: clear, cloudy, rainy, snowy, foggy, stormy, windy
lighting: natural, artificial, dramatic, soft, harsh, backlit, silhouette
mood: peaceful, tense, romantic, mysterious, melancholic, joyful, dramatic, calm, chaotic, nostalgic, ominous, hopeful
expression: neutral, happy, sad, angry, surprised, determined, fearful, confused, excited, shy, disgusted, contempt, anxious, loving, jealous, proud
bubbleType: speech, thought, narration, scream, whisper, shout
position: foreground, midground, background
depthOfField: shallow, deep, normal
artStyle.genre: shonen, shoujo, seinen, josei, realistic, chibi, sketch
artStyle.shading: screentone, crosshatch, cel-shading, soft-shading, high-contrast
narrativeFunction: establishing-shot, action, reaction, dialogue, transition, dramatic-reveal, flashback, montage, emotional-beat
role: protagonist, antagonist, supporting, background
sceneType: indoor, outdoor, indoor-outdoor, natural, urban, rural, fantasy, abstract
sceneSize: cramped, small, medium, large, vast
sceneLighting.naturalLight: abundant, moderate, limited, none
sceneLighting.artificialLight: none, minimal, moderate, heavy
sceneNarrativeRole: primary-setting, secondary-setting, transitional, symbolic, flashback-location, dream-sequence`;

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
    this.logFilePath = path.join(process.cwd(), 'qwen.log');
  }
  
  /**
   * Write log to file (UTF-8 encoded to avoid console garbled text)
   * @param {string} content - Log content
   */
  log(content) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${content}\n`;
    fs.appendFileSync(this.logFilePath, logEntry, 'utf8');
  }
  
  /**
   * Clear log file
   */
  clearLog() {
    if (fs.existsSync(this.logFilePath)) {
      fs.unlinkSync(this.logFilePath);
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
    const {
      text,
      jsonSchema,
      strictMode = true,
      maxChunkLength = 8000,
      existingCharacters = [],
      existingScenes = [],
      chapterNumber
    } = options;
    
    console.log(`[QwenAdapter] Generating storyboard for text (${text.length} chars)`);
    
    if (existingCharacters.length > 0) {
      console.log(`[QwenAdapter] Using ${existingCharacters.length} existing characters`);
    }
    if (existingScenes.length > 0) {
      console.log(`[QwenAdapter] Using ${existingScenes.length} existing scenes`);
    }
    
    // 1. Split text into intelligent chunks
    const chunks = this.splitTextIntelligently(text, maxChunkLength);
    console.log(`[QwenAdapter] Split text into ${chunks.length} chunks`);
    
    // 2. Process chunks in parallel (pass bibles to first chunk only)
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
            console.log(`[QwenAdapter] Chunk ${idx + 1}/${chunks.length} succeeded`);
            return result;
          })
          .catch(err => {
            console.error(`[QwenAdapter] Chunk ${idx + 1}/${chunks.length} failed:`, err.message);
            return null;
          })
      )
    );
    
    // 3. Filter out failed responses
    const validResponses = responses.filter(r => r !== null);
    
    if (validResponses.length === 0) {
      throw new Error('All chunks failed to generate storyboard');
    }
    
    if (validResponses.length < responses.length) {
      console.warn(
        `[QwenAdapter] ${responses.length - validResponses.length}/${responses.length} chunks failed`
      );
    }
    
    // 4. Merge storyboards from all chunks
    const merged = this.mergeStoryboards(validResponses);
    console.log(
      `[QwenAdapter] Merged ${merged.panels.length} panels, ${merged.characters.length} characters, ${merged.scenes.length} scenes`
    );
    
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
    this.log('\n💬 System Prompt:');
    this.log('─'.repeat(60));
    this.log(STORYBOARD_SYSTEM_PROMPT);
    this.log('─'.repeat(60));
    this.log('\n📝 User Input:');
    this.log('─'.repeat(60));
    this.log(userMessage);
    this.log('─'.repeat(60));
    this.log('\n📋 JSON Schema:');
    this.log(JSON.stringify(schema, null, 2).substring(0, 500) + '...');
    this.log('─'.repeat(60));
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const requestPayload = {
          model: this.model,
          messages: [
            { role: 'system', content: STORYBOARD_SYSTEM_PROMPT },
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
          max_tokens: 8000
        };
        
        this.log('\n⏳ Sending request to Qwen...');
        const startTime = Date.now();
        
        const response = await this.client.chat.completions.create(requestPayload);
        
        const elapsedMs = Date.now() - startTime;
        
        // 🔍 Log response details to file
        this.log('\n📥 ===== QWEN API RESPONSE =====');
        this.log(`⏱️  Elapsed: ${elapsedMs} ms`);
        this.log(`🎯 Finish Reason: ${response.choices[0].finish_reason}`);
        this.log(`📊 Token Usage: ${JSON.stringify(response.usage, null, 2)}`);
        this.log('\n📄 Raw Response Content:');
        this.log('─'.repeat(60));
        const content = response.choices[0].message.content;
        this.log(content);
        this.log('─'.repeat(60));
        
        // Parse and validate JSON
        const parsed = JSON.parse(content);
        this.log('\n✅ Parsed JSON Structure:');
        this.log(`  - panels: ${Array.isArray(parsed.panels) ? parsed.panels.length : 'N/A'}`);
        this.log(`  - characters: ${Array.isArray(parsed.characters) ? parsed.characters.length : 'N/A'}`);
        this.log(`  - scenes: ${Array.isArray(parsed.scenes) ? parsed.scenes.length : 'N/A'}`);
        this.log('─'.repeat(60));
        
        // Also log to console for test visibility
        console.log(`✅ Qwen API call succeeded in ${elapsedMs}ms - Check qwen.log for details`);
        
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
