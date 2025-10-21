/**
 * ImagenAdapter
 *
 * Provides a thin abstraction over Google Imagen 3 / Gemini Images API.
 * In local development (or when credentials are missing) the adapter
 * falls back to deterministic placeholder imagery so that downstream
 * logic (S3 uploads, DynamoDB updates) can be exercised without
 * external dependencies.
 *
 * When `apiKey` (Gemini Images API) or `accessToken` (Vertex AI) is
 * supplied the adapter will attempt a best-effort HTTP call. Any failure
 * automatically reverts to the placeholder to keep the pipeline robust.
 */

const crypto = require('crypto');

const PLACEHOLDER_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAQCAYAAAB49x1GAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA' +
    'B3RJTUUH5AISEwEzyQxgnQAAAB1pVFh0Q29tbWVudAAAAAAAQ3JlYXRlZCB3aXRoIEdJTVBkLmUH' +
    'AAAAW0lEQVR42u3OsQ0AMAhDQay/6c860BqIgQ1LxuxMxDPZWS9P7+EAgMBAgACAgAEBAP6SBeCA' +
    'AgICAAICAAR8hAkICAkIDwn0oyIAAgIAAgIAAh4CEQQEBAQEBAQ8gD4LwFd0ZUpiYQAAAABJRU5E' +
    'rkJggg==',
  'base64'
);

class ImagenAdapter {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] - Gemini Images API key
   * @param {string} [options.projectId] - Vertex AI project (optional)
   * @param {string} [options.location='us-central1']
   * @param {string} [options.model='imagegeneration'] - Gemini model id
   * @param {Function} [options.fetch] - Custom fetch implementation
   * @param {boolean} [options.forceMock=false] - Force placeholder output
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || null;
    this.projectId = options.projectId || null;
    this.location = options.location || 'us-central1';
    this.model = options.model || 'imagegeneration';
    this.logger = options.logger || console;
    this.fetch = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.forceMock = Boolean(options.forceMock);
    this.baseUrl = options.baseUrl || 'https://generativelanguage.googleapis.com';
  }

  /**
   * Generate an image from prompt + reference data.
   *
   * @param {object} options
   * @param {string} options.prompt
   * @param {string} [options.negativePrompt]
   * @param {string[]} [options.referenceImages]
   * @param {string} [options.mode='preview'] - preview | hd
   * @param {string} [options.aspectRatio='16:9']
   * @returns {Promise<{buffer: Buffer, mimeType: string, safetyAttributes: object, requestId: string}>}
   */
  async generate(options = {}) {
    if (this.shouldMock()) {
      return this.generatePlaceholder(options);
    }

    try {
      const response = await this.requestGeminiImage(options);
      if (response) {
        return response;
      }
      this.logger.warn('[ImagenAdapter] Gemini API response empty, falling back to placeholder');
    } catch (error) {
      this.logger.error(`[ImagenAdapter] Remote generation failed (${error.message}), falling back to placeholder`);
    }

    return this.generatePlaceholder(options);
  }

  /**
   * Imagen edit (inpaint) placeholder implementation.
   */
  async edit(options = {}) {
    if (this.shouldMock()) {
      return this.generatePlaceholder(options);
    }
    // Editing is not yet implemented via HTTP fallback - return placeholder.
    this.logger?.warn?.('[ImagenAdapter] edit() falling back to placeholder (remote edit not implemented)');
    return this.generatePlaceholder(options);
  }

  /**
   * Upload to Google Cloud Storage (placeholder that returns deterministic URI).
   */
  async uploadToGCS(buffer, filename) {
    const safeName = filename || `buffer-${Date.now()}.png`;
    const digest = crypto.createHash('sha1').update(buffer || PLACEHOLDER_IMAGE).digest('hex').slice(0, 12);
    const bucket = this.projectId ? `${this.projectId}-imagen-cache` : 'local-imagen-cache';
    return `gs://${bucket}/${safeName.replace(/\s+/g, '-').toLowerCase()}-${digest}.png`;
  }

  shouldMock() {
    return this.forceMock || !this.fetch || !this.apiKey;
  }

  generatePlaceholder(options = {}) {
    const { prompt } = options;
    if (prompt) {
      this.logger?.log?.('[ImagenAdapter] Placeholder image generated for prompt:', truncate(prompt, 160));
    }
    return {
      buffer: PLACEHOLDER_IMAGE,
      mimeType: 'image/png',
      safetyAttributes: {
        categories: [],
        scores: {}
      },
      requestId: `mock-${Date.now()}`
    };
  }

  async requestGeminiImage(options = {}) {
    if (!this.fetch) {
      throw new Error('Fetch API not available in current runtime');
    }
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const { prompt, negativePrompt, aspectRatio = '16:9' } = options;
    if (!prompt) {
      throw new Error('ImagenAdapter.generate requires a prompt');
    }

    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateImages?key=${this.apiKey}`;
    const contents = [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ];

    const body = {
      contents,
      generationConfig: {
        aspectRatio,
        negativePrompt,
        outputMimeType: 'image/png'
      }
    };

    const res = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${text}`);
    }

    const payload = await res.json();
    const image = payload?.images?.[0]?.image || payload?.generatedImages?.[0];
    if (!image) {
      return null;
    }

    const base64 = image.bytesBase64Encoded || image.base64;
    if (!base64) {
      return null;
    }

    return {
      buffer: Buffer.from(base64, 'base64'),
      mimeType: image.mimeType || 'image/png',
      safetyAttributes: image.safetyAttributes || payload?.safetyInfo,
      requestId: payload?.requestId || `gemini-${Date.now()}`
    };
  }
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

module.exports = ImagenAdapter;

