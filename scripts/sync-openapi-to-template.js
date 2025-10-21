#!/usr/bin/env node
/**
 * Sync OpenAPI paths from openapi.template.yaml to backend/template.yaml
 * 
 * This script updates the DefinitionBody.paths section in template.yaml
 * to match the paths defined in openapi.template.yaml
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT_DIR = path.join(__dirname, '..');
const OPENAPI_TEMPLATE_PATH = path.join(ROOT_DIR, 'openapi.template.yaml');
const SAM_TEMPLATE_PATH = path.join(ROOT_DIR, 'backend', 'template.yaml');

console.log('📝 Syncing OpenAPI paths to SAM template...\n');

// Read files
const openapiContent = fs.readFileSync(OPENAPI_TEMPLATE_PATH, 'utf8');
const samContent = fs.readFileSync(SAM_TEMPLATE_PATH, 'utf8');

// Parse YAML (handle CloudFormation intrinsic functions)
const openapiDoc = yaml.load(openapiContent, {
  schema: yaml.JSON_SCHEMA
});

const samDoc = yaml.load(samContent, {
  schema: yaml.JSON_SCHEMA
});

// Find MyApiGateway resource
if (!samDoc.Resources || !samDoc.Resources.MyApiGateway) {
  console.error('❌ MyApiGateway resource not found in template.yaml');
  process.exit(1);
}

const apiGateway = samDoc.Resources.MyApiGateway;
if (!apiGateway.Properties || !apiGateway.Properties.DefinitionBody) {
  console.error('❌ DefinitionBody not found in MyApiGateway');
  process.exit(1);
}

// Update paths
console.log('✅ Found MyApiGateway resource');
console.log('✅ Found DefinitionBody');

const oldPaths = Object.keys(apiGateway.Properties.DefinitionBody.paths || {});
const newPaths = Object.keys(openapiDoc.paths || {});

console.log(`\n📊 Path comparison:`);
console.log(`   Old paths: ${oldPaths.length}`);
console.log(`   New paths: ${newPaths.length}`);

// Replace paths
apiGateway.Properties.DefinitionBody.paths = openapiDoc.paths;

// Replace components schemas (to get Bible schemas)
if (openapiDoc.components && openapiDoc.components.schemas) {
  if (!apiGateway.Properties.DefinitionBody.components) {
    apiGateway.Properties.DefinitionBody.components = {};
  }
  apiGateway.Properties.DefinitionBody.components.schemas = openapiDoc.components.schemas;
  console.log('✅ Updated components/schemas');
}

// Show changed paths
const addedPaths = newPaths.filter(p => !oldPaths.includes(p));
const removedPaths = oldPaths.filter(p => !newPaths.includes(p));
const changedPaths = newPaths.filter(p => oldPaths.includes(p));

if (addedPaths.length > 0) {
  console.log(`\n➕ Added paths (${addedPaths.length}):`);
  addedPaths.forEach(p => console.log(`   - ${p}`));
}

if (removedPaths.length > 0) {
  console.log(`\n➖ Removed paths (${removedPaths.length}):`);
  removedPaths.forEach(p => console.log(`   - ${p}`));
}

if (changedPaths.length > 0) {
  console.log(`\n🔄 Updated paths (${changedPaths.length}):`);
  changedPaths.forEach(p => console.log(`   - ${p}`));
}

// Custom YAML dump that preserves CloudFormation functions
function dumpYamlWithCfnFunctions(obj, indent = 0) {
  const spaces = '  '.repeat(indent);
  
  if (obj === null || obj === undefined) {
    return 'null';
  }
  
  if (typeof obj === 'string') {
    // Check if needs quoting
    if (obj.includes('\n') || obj.includes(':') || obj.includes('#')) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => `\n${spaces}- ${dumpYamlWithCfnFunctions(item, indent + 1).replace(/^\n\s*/, '')}`).join('');
  }
  
  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    
    return entries.map(([key, value]) => {
      // Special handling for CloudFormation functions
      if (key === 'Fn::Sub' || key === 'Ref' || key === 'Fn::GetAtt' || key === 'Fn::Join') {
        const valueStr = typeof value === 'string' 
          ? value 
          : JSON.stringify(value);
        return `\n${spaces}${key}: ${valueStr}`;
      }
      
      const valueStr = dumpYamlWithCfnFunctions(value, indent + 1);
      if (valueStr.startsWith('\n')) {
        return `\n${spaces}${key}:${valueStr}`;
      } else {
        return `\n${spaces}${key}: ${valueStr}`;
      }
    }).join('');
  }
  
  return String(obj);
}

// Write back with proper CloudFormation syntax
const updatedYaml = yaml.dump(samDoc, {
  lineWidth: 120,
  noRefs: true,
  quotingType: '"',
  forceQuotes: false
});

fs.writeFileSync(SAM_TEMPLATE_PATH, updatedYaml, 'utf8');

console.log(`\n✅ Successfully synced paths to ${SAM_TEMPLATE_PATH}`);
console.log('\n⚠️  Note: You may need to manually verify CloudFormation intrinsic functions (Fn::Sub, etc.)');
