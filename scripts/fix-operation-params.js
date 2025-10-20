#!/usr/bin/env node
/**
 * 为 OpenAPI 操作级别的路径参数添加示例值
 * Dredd 要求每个操作（GET, POST等）内的 parameters 也必须有 example
 * 
 * 使用方法: node scripts/fix-operation-params.js
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const openapiPath = path.join(__dirname, '..', 'openapi.yaml');
let content = fs.readFileSync(openapiPath, 'utf8');

// 路径参数到示例值的映射
const paramExamples = {
  'id': 'test-123',
  'novelId': 'test-novel-123',
  'charId': 'test-char-123',
  'configId': 'test-config-123',
  'panelId': 'test-panel-123',
  'storyboardId': 'test-storyboard-123',
  'jobId': 'test-job-123',
  'exportId': 'test-export-123'
};

// 解析 YAML
const doc = yaml.parse(content);

let count = 0;

// 遍历所有路径
for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
  // 遍历所有操作
  for (const [method, operation] of Object.entries(pathItem)) {
    if (['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(method)) {
      if (operation.parameters && Array.isArray(operation.parameters)) {
        // 检查每个参数
        for (const param of operation.parameters) {
          if (param.in === 'path' && !param.example) {
            // 添加 example
            const example = paramExamples[param.name] || `test-${param.name}`;
            param.example = example;
            count++;
            console.log(`  ✅ 添加示例: ${method.toUpperCase()} ${pathKey} - ${param.name}: ${example}`);
          }
        }
      }
    }
  }
}

// 写回文件
const updatedContent = yaml.stringify(doc);
fs.writeFileSync(openapiPath, updatedContent, 'utf8');

console.log(`\n✅ 共为 ${count} 个操作级参数添加示例值\n`);
console.log('📝 下一步: npm run test:contract:prod');
