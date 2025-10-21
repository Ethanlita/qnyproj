/**
 * Contract Testing - 验证 API 契约
 * 
 * 使用 Dredd 测试框架验证 API 实现是否符合 OpenAPI 规范
 * 
 * 运行方式:
 * 1. npm install -g dredd
 * 2. node test-contract.js
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

// Configuration
const OPENAPI_SPEC = path.join(__dirname, '../openapi.yaml');
const API_ENDPOINT = process.env.API_ENDPOINT || 'https://ds0yqv9fn8.execute-api.us-east-1.amazonaws.com/dev';
const DREDD_CONFIG = path.join(__dirname, '../dredd.yml');

// Contract test configuration
const CONTRACT_TESTS = {
  '/edge-probe': {
    method: 'GET',
    expectedStatus: 200,
    expectedSchema: {
      type: 'object',
      required: ['receivedHost', 'requestContextDomain'],
      properties: {
        receivedHost: { type: 'string' },
        requestContextDomain: { type: 'string' },
        headers: { type: 'object' }
      }
    }
  },
  '/items': {
    method: 'GET',
    expectedStatus: 200,
    expectedSchema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' }
        }
      }
    }
  }
};

// Utility: Validate JSON against schema
function validateSchema(data, schema) {
  if (schema.type === 'object') {
    if (typeof data !== 'object' || data === null) {
      throw new Error(`Expected object, got ${typeof data}`);
    }
    
    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in data)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }
    }
    
    // Validate properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          validateSchema(data[key], propSchema);
        }
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      throw new Error(`Expected array, got ${typeof data}`);
    }
    
    if (schema.items && data.length > 0) {
      for (const item of data) {
        validateSchema(item, schema.items);
      }
    }
  } else if (schema.type === 'string') {
    if (typeof data !== 'string') {
      throw new Error(`Expected string, got ${typeof data}`);
    }
  } else if (schema.type === 'number') {
    if (typeof data !== 'number') {
      throw new Error(`Expected number, got ${typeof data}`);
    }
  }
}

// Test individual endpoint
async function testEndpoint(path, config) {
  console.log(`\n🧪 Testing: ${config.method} ${path}`);
  console.log('-'.repeat(60));
  
  try {
    const url = `${API_ENDPOINT}${path}`;
    const response = await fetch(url, {
      method: config.method,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    // Check status code
    console.log(`   Status: ${response.status} (expected: ${config.expectedStatus})`);
    if (response.status !== config.expectedStatus) {
      throw new Error(`Status mismatch: got ${response.status}, expected ${config.expectedStatus}`);
    }
    
    // Parse response
    const contentType = response.headers.get('content-type');
    console.log(`   Content-Type: ${contentType}`);
    
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error(`Invalid Content-Type: ${contentType}`);
    }
    
    const data = await response.json();
    
    // Validate schema
    console.log(`   Validating response schema...`);
    validateSchema(data, config.expectedSchema);
    console.log(`   ✅ Schema validation passed`);
    
    // Log sample data
    console.log(`   Sample response:`, JSON.stringify(data, null, 2).substring(0, 200) + '...');
    
    return { success: true, path, status: response.status };
  } catch (error) {
    console.error(`   ❌ Test failed: ${error.message}`);
    return { success: false, path, error: error.message };
  }
}

// Check if OpenAPI spec exists
async function checkOpenAPISpec() {
  console.log('\n🔍 Checking OpenAPI Specification');
  console.log('='.repeat(60));
  
  try {
    const spec = await fs.readFile(OPENAPI_SPEC, 'utf8');
    const specObj = require('yaml').parse(spec);
    
    console.log(`✅ OpenAPI spec found: ${OPENAPI_SPEC}`);
    console.log(`   Version: ${specObj.openapi}`);
    console.log(`   Title: ${specObj.info.title}`);
    console.log(`   API Version: ${specObj.info.version}`);
    console.log(`   Paths: ${Object.keys(specObj.paths).length}`);
    
    return { success: true, spec: specObj };
  } catch (error) {
    console.error(`❌ Failed to load OpenAPI spec: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Run Dredd (if installed)
async function runDredd() {
  console.log('\n🔧 Running Dredd Contract Tests');
  console.log('='.repeat(60));
  
  try {
    // Check if dredd is installed
    await execAsync('dredd --version');
    
    console.log(`📋 OpenAPI Spec: ${OPENAPI_SPEC}`);
    console.log(`🌐 API Endpoint: ${API_ENDPOINT}`);
    
    // Run dredd
    const { stdout, stderr } = await execAsync(
      `dredd ${OPENAPI_SPEC} ${API_ENDPOINT} --hookfiles=tests/dredd/*.js --reporter=markdown`,
      { cwd: path.join(__dirname, '..') }
    );
    
    console.log(stdout);
    if (stderr) console.error(stderr);
    
    return { success: true };
  } catch (error) {
    if (error.message.includes('command not found')) {
      console.log(`⚠️  Dredd not installed. Skipping Dredd tests.`);
      console.log(`   Install with: npm install -g dredd`);
      return { success: true, skipped: true };
    }
    
    console.error(`❌ Dredd tests failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Test CORS headers
async function testCORS() {
  console.log('\n🧪 Testing CORS Headers');
  console.log('='.repeat(60));
  
  try {
    const response = await fetch(`${API_ENDPOINT}/edge-probe`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });
    
    console.log(`   Status: ${response.status}`);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': response.headers.get('access-control-allow-origin'),
      'Access-Control-Allow-Methods': response.headers.get('access-control-allow-methods'),
      'Access-Control-Allow-Headers': response.headers.get('access-control-allow-headers')
    };
    
    console.log(`   CORS Headers:`, JSON.stringify(corsHeaders, null, 2));
    
    if (!corsHeaders['Access-Control-Allow-Origin']) {
      throw new Error('Missing Access-Control-Allow-Origin header');
    }
    
    console.log(`   ✅ CORS configured correctly`);
    return { success: true };
  } catch (error) {
    console.error(`   ❌ CORS test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Main test runner
async function runContractTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Contract Tests - API Specification Validation           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  console.log(`\n🌍 Environment:`);
  console.log(`   API Endpoint: ${API_ENDPOINT}`);
  console.log(`   OpenAPI Spec: ${OPENAPI_SPEC}`);
  
  const results = [];
  
  // Check OpenAPI spec
  const specResult = await checkOpenAPISpec();
  results.push(specResult);
  
  if (!specResult.success) {
    console.log('\n❌ Cannot proceed without valid OpenAPI spec');
    process.exit(1);
  }
  
  // Test CORS
  results.push(await testCORS());
  
  // Test individual endpoints
  for (const [path, config] of Object.entries(CONTRACT_TESTS)) {
    results.push(await testEndpoint(path, config));
  }
  
  // Run Dredd (optional)
  results.push(await runDredd());
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 CONTRACT TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  
  console.log(`✅ Passed:  ${passed}`);
  console.log(`❌ Failed:  ${failed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`📊 Total:   ${results.length}`);
  
  if (failed > 0) {
    console.log(`\n⚠️  Some tests failed. Check logs above for details.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All contract tests passed!`);
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Add more endpoints to CONTRACT_TESTS`);
    console.log(`   2. Install Dredd for full spec validation: npm install -g dredd`);
    console.log(`   3. Add authentication tests`);
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  runContractTests().catch(error => {
    console.error(`\n💥 Fatal error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
}

module.exports = {
  testEndpoint,
  checkOpenAPISpec,
  testCORS,
  runDredd
};
