/**
 * Shared helper for retrieving AI provider credentials from Secrets Manager.
 * The project stores Qwen and Gemini keys inside the same secret so that
 * deployment scripts only manage a single ARN.
 */

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({});
let cachedSecret = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getSecretArn() {
  return process.env.QWEN_SECRET_ARN || process.env.AI_SECRET_ARN;
}

async function loadSecret() {
  const arn = getSecretArn();
  if (!arn) {
    throw new Error('QWEN_SECRET_ARN environment variable not set');
  }

  const now = Date.now();
  if (cachedSecret && now - cachedAt < CACHE_TTL_MS) {
    return cachedSecret;
  }

  const response = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!response || !response.SecretString) {
    throw new Error('Secret value is empty or missing SecretString');
  }

  cachedSecret = JSON.parse(response.SecretString);
  cachedAt = now;
  return cachedSecret;
}

async function getGeminiConfig() {
  const secret = await loadSecret();
  return {
    apiKey: secret.GEMINI_API_KEY || secret.GEMINI_KEY || secret.GOOGLE_API_KEY || null,
    model: secret.GEMINI_MODEL || 'imagegeneration',
    projectId: secret.GEMINI_PROJECT_ID || secret.GCP_PROJECT_ID || null,
    location: secret.GEMINI_LOCATION || 'us-central1'
  };
}

async function getQwenConfig() {
  const secret = await loadSecret();
  return {
    apiKey: secret.apiKey || secret.QWEN_API_KEY || null,
    endpoint: secret.endpoint || secret.QWEN_ENDPOINT || null,
    model: secret.model || secret.QWEN_MODEL || null
  };
}

module.exports = {
  getGeminiConfig,
  getQwenConfig,
  loadSecret
};

