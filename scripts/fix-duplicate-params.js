#!/usr/bin/env node
/**
 * Fix duplicate path parameters in openapi.template.yaml
 * 
 * Problem: Path parameters are defined at both path level and operation level,
 * causing duplicate identifier errors in generated TypeScript code.
 * 
 * Solution: Remove operation-level parameter definitions when they duplicate
 * path-level parameters.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const TEMPLATE_PATH = path.join(__dirname, '..', 'openapi.template.yaml');

console.log('🔧 Fixing duplicate path parameters in openapi.template.yaml\n');

// Read the YAML file as text (to preserve CloudFormation functions)
const yamlContent = fs.readFileSync(TEMPLATE_PATH, 'utf8');

// Parse YAML
const openapi = yaml.parse(yamlContent);

let fixCount = 0;

// Iterate through all paths
for (const [pathName, pathItem] of Object.entries(openapi.paths || {})) {
  // Get path-level parameters
  const pathParams = pathItem.parameters || [];
  const pathParamNames = new Set(pathParams.map(p => p.name));
  
  if (pathParamNames.size === 0) continue;
  
  console.log(`\n📂 Checking path: ${pathName}`);
  console.log(`   Path-level params: ${Array.from(pathParamNames).join(', ')}`);
  
  // Check each operation
  const operations = ['get', 'post', 'put', 'delete', 'patch'];
  for (const method of operations) {
    const operation = pathItem[method];
    if (!operation || !operation.parameters) continue;
    
    // Find duplicate parameters
    const duplicates = operation.parameters.filter(p => 
      p.in === 'path' && pathParamNames.has(p.name)
    );
    
    if (duplicates.length > 0) {
      console.log(`   ⚠️  ${method.toUpperCase()}: Found ${duplicates.length} duplicate(s): ${duplicates.map(p => p.name).join(', ')}`);
      
      // Remove duplicates
      operation.parameters = operation.parameters.filter(p => 
        !(p.in === 'path' && pathParamNames.has(p.name))
      );
      
      // If no parameters left, remove the array
      if (operation.parameters.length === 0) {
        delete operation.parameters;
      }
      
      fixCount++;
      console.log(`   ✅ ${method.toUpperCase()}: Removed duplicate parameters`);
    }
  }
}

// Write back to file
const fixedYaml = yaml.stringify(openapi, {
  lineWidth: 0, // Don't wrap lines
  indent: 2
});

fs.writeFileSync(TEMPLATE_PATH, fixedYaml, 'utf8');

console.log(`\n✅ Fixed ${fixCount} operations with duplicate parameters`);
console.log(`📄 Updated: ${TEMPLATE_PATH}\n`);
