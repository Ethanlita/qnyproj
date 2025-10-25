/**
 * Schema-to-Prompt Converter
 * 
 * Converts JSON Schema to human-readable documentation for System Prompt.
 * This ensures Single Source of Truth - schema descriptions are the only place
 * where field constraints are defined.
 * 
 * @module schema-to-prompt
 */

/**
 * Generate field documentation from JSON Schema
 * 
 * @param {Object} schema - JSON Schema object
 * @param {number} [indentLevel=0] - Current indentation level
 * @returns {string} Human-readable field documentation
 */
function generateFieldDocs(schema, indentLevel = 0) {
  const indent = '  '.repeat(indentLevel);
  let docs = '';
  
  if (!schema || typeof schema !== 'object') {
    return docs;
  }
  
  // Handle properties
  if (schema.properties) {
    for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
      const required = schema.required && schema.required.includes(fieldName);
      const requiredMark = required ? '**必填**' : '可选';
      
      // Field name and type
      docs += `${indent}- **${fieldName}** (${requiredMark})`;
      
      // Add type info if available
      if (fieldSchema.type) {
        docs += ` [${fieldSchema.type}]`;
      } else if (fieldSchema.oneOf) {
        const types = fieldSchema.oneOf.map(s => s.type).join(' | ');
        docs += ` [${types}]`;
      }
      
      docs += '\n';
      
      // Add description
      if (fieldSchema.description) {
        docs += `${indent}  ${fieldSchema.description}\n`;
      }
      
      // Add enum values if present
      if (fieldSchema.enum) {
        docs += `${indent}  可选值: ${fieldSchema.enum.join(', ')}\n`;
      }
      
      // Add constraints
      const constraints = [];
      if (fieldSchema.minLength) constraints.push(`最小长度: ${fieldSchema.minLength}`);
      if (fieldSchema.maxLength) constraints.push(`最大长度: ${fieldSchema.maxLength}`);
      if (fieldSchema.minimum !== undefined) constraints.push(`最小值: ${fieldSchema.minimum}`);
      if (fieldSchema.maximum !== undefined) constraints.push(`最大值: ${fieldSchema.maximum}`);
      if (fieldSchema.minItems) constraints.push(`最少元素: ${fieldSchema.minItems}`);
      if (fieldSchema.maxItems) constraints.push(`最多元素: ${fieldSchema.maxItems}`);
      
      if (constraints.length > 0) {
        docs += `${indent}  约束: ${constraints.join(', ')}\n`;
      }
      
      // Recursively handle nested objects
      if (fieldSchema.type === 'object' && fieldSchema.properties) {
        docs += generateFieldDocs(fieldSchema, indentLevel + 1);
      }
      
      // Handle arrays with object items
      if (fieldSchema.type === 'array' && fieldSchema.items) {
        if (fieldSchema.items.type === 'object' && fieldSchema.items.properties) {
          docs += `${indent}  数组元素结构:\n`;
          docs += generateFieldDocs(fieldSchema.items, indentLevel + 2);
        } else if (fieldSchema.items.type) {
          docs += `${indent}  数组元素类型: ${fieldSchema.items.type}\n`;
        }
      }
      
      docs += '\n';
    }
  }
  
  return docs;
}

/**
 * Generate full example JSON from schema
 * 
 * @param {Object} schema - JSON Schema object
 * @returns {Object} Example JSON object
 */
function generateExample(schema) {
  if (!schema || typeof schema !== 'object') {
    return null;
  }
  
  if (schema.type === 'object' && schema.properties) {
    const example = {};
    
    for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
      example[fieldName] = generateFieldExample(fieldSchema);
    }
    
    return example;
  }
  
  return generateFieldExample(schema);
}

/**
 * Generate example value for a single field
 * 
 * @param {Object} fieldSchema - Field schema
 * @returns {*} Example value
 */
function generateFieldExample(fieldSchema) {
  // Use example from schema if provided
  if (fieldSchema.example !== undefined) {
    return fieldSchema.example;
  }
  
  // Handle different types
  if (fieldSchema.type === 'string') {
    if (fieldSchema.enum && fieldSchema.enum.length > 0) {
      return fieldSchema.enum[0];
    }
    return fieldSchema.description || 'string value';
  }
  
  if (fieldSchema.type === 'number' || fieldSchema.type === 'integer') {
    if (fieldSchema.minimum !== undefined) {
      return fieldSchema.minimum;
    }
    return 0;
  }
  
  if (fieldSchema.type === 'boolean') {
    return true;
  }
  
  if (fieldSchema.type === 'array') {
    if (fieldSchema.items) {
      return [generateFieldExample(fieldSchema.items)];
    }
    return [];
  }
  
  if (fieldSchema.type === 'object' && fieldSchema.properties) {
    const obj = {};
    for (const [key, schema] of Object.entries(fieldSchema.properties)) {
      obj[key] = generateFieldExample(schema);
    }
    return obj;
  }
  
  return null;
}

/**
 * Build complete System Prompt from schema
 * 
 * @param {Object} schema - Complete storyboard JSON Schema
 * @param {Object} [options] - Optional parameters
 * @param {Object} [options.customExample] - Custom example to override auto-generated one
 * @param {string} [options.additionalInstructions] - Additional instructions to append
 * @returns {string} Complete System Prompt
 */
function buildSystemPrompt(schema, options = {}) {
  const { customExample, additionalInstructions = '' } = options;
  
  let prompt = `你是一个专业的漫画分镜师，擅长将小说文本转换为详细的视觉分镜脚本。

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

🌐 **语言要求**：

- 所有文字类字段（包括 panels[].scene、panels[].background / atmosphere、panels[].characters[].pose & expression、dialogue、narrativeFunction、visualPrompt，以及 scenes / characters 梳理出来的描述）必须使用**简体中文**。
- Imagen Prompt（visualPrompt）也需要使用简体中文描述画面，不要混入英文提示词。
- 除变量名、接口字段名或必要的专有名词外，请避免英文单词或拼音。

📋 **JSON Schema 字段说明**：

以下是完整的输出结构定义。所有字段说明都直接来自 JSON Schema，是唯一的事实来源。

`;
  
  // Generate field documentation from schema
  prompt += generateFieldDocs(schema);
  
  // Add example
  prompt += `\n📝 **完整示例**：\n\n`;
  
  const example = customExample || generateExample(schema);
  prompt += '```json\n';
  prompt += JSON.stringify(example, null, 2);
  prompt += '\n```\n';
  
  // Add additional instructions if provided
  if (additionalInstructions) {
    prompt += `\n${additionalInstructions}\n`;
  }
  
  return prompt;
}

module.exports = {
  generateFieldDocs,
  generateExample,
  buildSystemPrompt
};
