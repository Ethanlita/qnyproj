#!/usr/bin/env node

/**
 * Verify System Prompt Consistency
 * 
 * 验证 System Prompt 中的示例和实际 storyboard.json schema 是否一致
 */

const storyboardSchema = require('./schemas/storyboard.json');

console.log('🔍 Verifying System Prompt Consistency\n');

// Extract example from qwen-adapter.js
const qwenAdapterCode = require('fs').readFileSync('./lib/qwen-adapter.js', 'utf8');
const exampleMatch = qwenAdapterCode.match(/⚠️ \*\*严格遵循 JSON Schema 字段名称\*\*，完整示例如下：\n\n({[\s\S]*?"totalPages": 1\n})/);

if (!exampleMatch) {
  console.error('❌ Could not find example JSON in System Prompt');
  process.exit(1);
}

let exampleJson;
try {
  exampleJson = JSON.parse(exampleMatch[1]);
  console.log('✅ System Prompt example is valid JSON');
} catch (e) {
  console.error('❌ System Prompt example is invalid JSON:', e.message);
  process.exit(1);
}

console.log('\n📊 Comparing structures:\n');

// Check top-level structure
const schemaProps = Object.keys(storyboardSchema.properties);
const exampleProps = Object.keys(exampleJson);

console.log('Top-level properties:');
console.log('  Schema:  ', schemaProps);
console.log('  Example: ', exampleProps);

const missingInExample = schemaProps.filter(p => !exampleProps.includes(p));
const extraInExample = exampleProps.filter(p => !schemaProps.includes(p));

if (missingInExample.length > 0) {
  console.log('  ⚠️  Missing in example:', missingInExample);
}
if (extraInExample.length > 0) {
  console.log('  ⚠️  Extra in example:', extraInExample);
}
if (missingInExample.length === 0 && extraInExample.length === 0) {
  console.log('  ✅ Match!');
}

console.log('');

// Check panels structure
const panelExample = exampleJson.panels[0];
const panelSchemaProps = storyboardSchema.properties.panels.items.required;

console.log('Panel required fields:');
console.log('  Schema requires:', panelSchemaProps);
const panelExampleProps = Object.keys(panelExample);
console.log('  Example has:     ', panelExampleProps);

const missingPanelFields = panelSchemaProps.filter(p => !panelExampleProps.includes(p));
if (missingPanelFields.length > 0) {
  console.log('  ❌ Missing in example:', missingPanelFields);
} else {
  console.log('  ✅ All required fields present!');
}

console.log('');

// Check character age field
const charExample = exampleJson.characters[0];
const ageSchema = storyboardSchema.properties.characters.items.properties.appearance.properties.age;

console.log('Character age field:');
console.log('  Schema:', ageSchema);
console.log('  Example age value:', charExample.appearance.age, `(type: ${typeof charExample.appearance.age})`);

if (ageSchema.type) {
  console.log('  ⚠️  Schema has explicit type constraint:', ageSchema.type);
} else if (ageSchema.oneOf) {
  console.log('  ✅ Schema allows multiple types (oneOf)');
} else {
  console.log('  ✅ Schema has no type constraint (flexible)');
}

console.log('');

// Check for conflicting instructions in prompt
const hasAgeRestriction = qwenAdapterCode.includes('必须是整数') || qwenAdapterCode.includes('禁止使用');
console.log('System Prompt instructions:');
if (hasAgeRestriction) {
  console.log('  ❌ FOUND CONFLICTING INSTRUCTIONS!');
  console.log('     Prompt contains "必须是整数" or "禁止使用" restrictions');
  console.log('     This conflicts with the flexible schema!');
} else {
  console.log('  ✅ No conflicting type restrictions found');
  console.log('     Prompt allows flexible value types');
}

console.log('');
console.log('─'.repeat(60));

// Final verdict
const hasIssues = missingInExample.length > 0 || 
                  extraInExample.length > 0 || 
                  missingPanelFields.length > 0 ||
                  hasAgeRestriction;

if (hasIssues) {
  console.log('❌ INCONSISTENCIES DETECTED!');
  console.log('   System Prompt and schema are NOT aligned.');
  console.log('   Qwen may receive conflicting instructions.');
  process.exit(1);
} else {
  console.log('✅ CONSISTENCY VERIFIED!');
  console.log('   System Prompt and schema are properly aligned.');
  console.log('   Qwen will receive consistent instructions.');
  process.exit(0);
}
