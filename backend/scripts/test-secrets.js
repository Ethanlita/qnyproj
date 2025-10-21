#!/usr/bin/env node

/**
 * Test script to verify secrets management
 * Usage: node scripts/test-secrets.js
 */

const { getSecrets, getSecret } = require('./get-secrets');

async function main() {
  console.log('========================================');
  console.log('🧪 Testing Secrets Management');
  console.log('========================================');
  console.log('');

  const secretArn = process.env.QWEN_SECRET_ARN;
  
  if (!secretArn) {
    console.error('❌ QWEN_SECRET_ARN environment variable not set');
    console.log('');
    console.log('💡 Set it manually for testing:');
    console.log('   export QWEN_SECRET_ARN=arn:aws:secretsmanager:us-east-1:296821242554:secret:qnyproj-api-env-secrets-XXXXXX');
    console.log('');
    process.exit(1);
  }

  console.log(`🔍 Reading from: ${secretArn}`);
  console.log('');

  try {
    // Test 1: Get all secrets
    console.log('1️⃣  Testing getSecrets()...');
    const secrets = await getSecrets();
    console.log('   ✅ Success! Found keys:', Object.keys(secrets).join(', '));
    console.log('');

    // Test 2: Get specific secret
    console.log('2️⃣  Testing getSecret(\'QWEN_API_KEY\')...');
    const apiKey = await getSecret('QWEN_API_KEY');
    const masked = apiKey.substring(0, 10) + '...';
    console.log(`   ✅ Success! Value: ${masked}`);
    console.log('');

    // Test 3: Display all values (masked)
    console.log('3️⃣  All secrets (masked):');
    for (const [key, value] of Object.entries(secrets)) {
      const maskedValue = value.length > 20 
        ? value.substring(0, 20) + '...' 
        : value.substring(0, 10) + '...';
      console.log(`   - ${key}: ${maskedValue}`);
    }
    console.log('');

    console.log('========================================');
    console.log('✅ All tests passed!');
    console.log('========================================');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    console.error('');
    console.log('💡 Troubleshooting:');
    console.log('   1. Ensure secret exists in Secrets Manager');
    console.log('   2. Check AWS credentials are configured');
    console.log('   3. Verify IAM permissions for secretsmanager:GetSecretValue');
    console.log('');
    process.exit(1);
  }
}

main();
