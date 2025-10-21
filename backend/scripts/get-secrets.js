/**
 * Helper module to retrieve secrets from AWS Secrets Manager
 * Usage in Lambda functions:
 * 
 * const { getSecrets } = require('./scripts/get-secrets');
 * const secrets = await getSecrets();
 * console.log(secrets.QWEN_API_KEY);
 */

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

let cachedSecrets = null;
let cacheTimestamp = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get all secrets from Secrets Manager
 * @param {string} secretArn - ARN of the secret (from env var QWEN_SECRET_ARN)
 * @returns {Promise<Object>} - Parsed secret values
 */
async function getSecrets(secretArn = process.env.QWEN_SECRET_ARN) {
  // Return cached secrets if still valid
  if (cachedSecrets && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return cachedSecrets;
  }

  if (!secretArn) {
    throw new Error('QWEN_SECRET_ARN environment variable is not set');
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1'
  });

  try {
    const response = await client.send(new GetSecretValueCommand({
      SecretId: secretArn
    }));

    const secrets = JSON.parse(response.SecretString);
    
    // Cache the secrets
    cachedSecrets = secrets;
    cacheTimestamp = Date.now();

    return secrets;
  } catch (error) {
    console.error('Failed to retrieve secrets:', error);
    throw new Error(`Failed to retrieve secrets: ${error.message}`);
  }
}

/**
 * Get a specific secret value
 * @param {string} key - Secret key name
 * @param {string} secretArn - ARN of the secret
 * @returns {Promise<string>} - Secret value
 */
async function getSecret(key, secretArn = process.env.QWEN_SECRET_ARN) {
  const secrets = await getSecrets(secretArn);
  
  if (!(key in secrets)) {
    throw new Error(`Secret key '${key}' not found`);
  }

  return secrets[key];
}

/**
 * Clear the cache (useful for testing)
 */
function clearCache() {
  cachedSecrets = null;
  cacheTimestamp = null;
}

module.exports = {
  getSecrets,
  getSecret,
  clearCache
};
