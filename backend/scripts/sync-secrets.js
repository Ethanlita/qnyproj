#!/usr/bin/env node

/**
 * Sync .env variables to AWS Secrets Manager
 * Usage: node scripts/sync-secrets.js [--stack-name qnyproj-api]
 */

const { SecretsManagerClient, CreateSecretCommand, UpdateSecretCommand, DescribeSecretCommand } = require('@aws-sdk/client-secrets-manager');
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const stackNameIndex = args.indexOf('--stack-name');
const STACK_NAME = stackNameIndex !== -1 ? args[stackNameIndex + 1] : 'qnyproj-api';

const ENV_FILE = path.join(__dirname, '../.env');
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const client = new SecretsManagerClient({ region: AWS_REGION });
const cfnClient = new CloudFormationClient({ region: AWS_REGION });

/**
 * Parse .env file into key-value pairs
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`.env file not found at ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const vars = {};

  content.split('\n').forEach(line => {
    line = line.trim();
    
    // Skip comments and empty lines
    if (!line || line.startsWith('#')) return;
    
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2];
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      vars[key] = value;
    }
  });

  return vars;
}

/**
 * Get secret name from CloudFormation stack
 */
async function getSecretName() {
  try {
    const response = await cfnClient.send(new DescribeStacksCommand({
      StackName: STACK_NAME
    }));

    const stack = response.Stacks[0];
    
    // Try to find QwenApiKeySecret resource
    const secretResource = stack.Outputs?.find(o => o.OutputKey === 'QwenSecretArn' || o.OutputKey === 'QwenApiKeySecretArn');
    
    if (secretResource) {
      // Extract secret name from ARN
      const arn = secretResource.OutputValue;
      const secretName = arn.split(':').pop().split('-').slice(0, -1).join('-'); // Remove version suffix
      return secretName;
    }

    // Fallback: use the same naming convention as template.yaml
    return `${STACK_NAME}-qwen-api-key`;
  } catch (error) {
    console.warn(`⚠️  Could not get secret from stack: ${error.message}`);
    // Use the consistent naming convention
    return `${STACK_NAME}-qwen-api-key`;
  }
}

/**
 * Check if secret exists
 */
async function secretExists(secretName) {
  try {
    await client.send(new DescribeSecretCommand({ SecretId: secretName }));
    return true;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return false;
    }
    throw error;
  }
}

/**
 * Create or update secret
 */
async function syncSecret(secretName, secretValue) {
  const exists = await secretExists(secretName);

  if (exists) {
    console.log(`📝 Updating secret: ${secretName}`);
    await client.send(new UpdateSecretCommand({
      SecretId: secretName,
      SecretString: secretValue
    }));
    console.log(`✅ Secret updated successfully`);
  } else {
    console.log(`🆕 Creating secret: ${secretName}`);
    await client.send(new CreateSecretCommand({
      Name: secretName,
      SecretString: secretValue,
      Description: 'Environment variables for qnyproj backend',
      Tags: [
        { Key: 'Application', Value: 'qnyproj-api' },
        { Key: 'ManagedBy', Value: 'sync-secrets-script' }
      ]
    }));
    console.log(`✅ Secret created successfully`);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('========================================');
  console.log('🔐 Syncing .env to AWS Secrets Manager');
  console.log('========================================');
  console.log('');
  console.log(`📂 Reading: ${ENV_FILE}`);
  console.log(`🌍 Region: ${AWS_REGION}`);
  console.log(`📦 Stack: ${STACK_NAME}`);
  console.log('');

  // Parse .env file
  const envVars = parseEnvFile(ENV_FILE);
  const varCount = Object.keys(envVars).length;
  
  if (varCount === 0) {
    console.log('⚠️  No variables found in .env file');
    return;
  }

  console.log(`📋 Found ${varCount} variables:`);
  Object.keys(envVars).forEach(key => {
    const value = envVars[key];
    const masked = value.length > 10 ? `${value.substring(0, 10)}...` : '***';
    console.log(`   - ${key}: ${masked}`);
  });
  console.log('');

  // Get secret name
  const secretName = await getSecretName();
  console.log(`🎯 Target secret: ${secretName}`);
  console.log('');

  // Prepare secret value as JSON
  const secretValue = JSON.stringify(envVars, null, 2);

  // Sync to Secrets Manager
  await syncSecret(secretName, secretValue);

  console.log('');
  console.log('========================================');
  console.log('✅ Sync completed successfully!');
  console.log('========================================');
  console.log('');
  console.log('💡 To use in Lambda:');
  console.log('   1. Ensure QWEN_SECRET_ARN env var is set');
  console.log('   2. Use getSecretValue() to retrieve');
  console.log('');
}

// Run
main().catch(error => {
  console.error('');
  console.error('❌ Error:', error.message);
  console.error('');
  process.exit(1);
});
