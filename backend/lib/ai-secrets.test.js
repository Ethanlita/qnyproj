const { describe, it, expect, beforeEach } = require('@jest/globals');

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-secrets-manager', () => {
  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({
      send: mockSend
    })),
    GetSecretValueCommand: jest.fn().mockImplementation((input) => input)
  };
});

describe('ai-secrets helpers', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSend.mockReset();
    delete process.env.QWEN_SECRET_ARN;
    delete process.env.AI_SECRET_ARN;
  });

  it('throws when secret ARN is not provided', async () => {
    const { loadSecret } = require('./ai-secrets');
    await expect(loadSecret()).rejects.toThrow('QWEN_SECRET_ARN environment variable not set');
  });

  it('loads secret once and caches results for subsequent helpers', async () => {
    process.env.QWEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:12345:secret:test';
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({
        QWEN_API_KEY: 'qwen-key',
        QWEN_ENDPOINT: 'https://dashscope.test',
        QWEN_MODEL: 'qwen-plus',
        GEMINI_API_KEY: 'gemini-key',
        GEMINI_MODEL: 'imagen-4.0',
        GEMINI_PROJECT_ID: 'project-1',
        GEMINI_LOCATION: 'asia-east1'
      })
    });

    const { loadSecret, getQwenConfig, getGeminiConfig } = require('./ai-secrets');

    const secret = await loadSecret();
    expect(secret.QWEN_API_KEY).toBe('qwen-key');
    expect(mockSend).toHaveBeenCalledTimes(1);

    mockSend.mockClear();
    const qwenConfig = await getQwenConfig();
    expect(qwenConfig).toEqual({
      apiKey: 'qwen-key',
      endpoint: 'https://dashscope.test',
      model: 'qwen-plus'
    });
    expect(mockSend).not.toHaveBeenCalled();

    const geminiConfig = await getGeminiConfig();
    expect(geminiConfig).toEqual({
      apiKey: 'gemini-key',
      model: 'imagen-4.0',
      projectId: 'project-1',
      location: 'asia-east1'
    });
  });
});
