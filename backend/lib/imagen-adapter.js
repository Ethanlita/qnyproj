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
   * Generate images via Gemini REST API.
   * @param {Object} options
   * @param {string} options.prompt - Generation prompt
   * @param {string} [options.negativePrompt] - Negative prompt
   * @param {string} [options.aspectRatio='16:9'] - Aspect ratio
   * @param {string[]} [options.referenceImages] - S3 URIs or base64-encoded reference images
   * @returns {Promise<{buffer: Buffer, mimeType: string, safetyAttributes: Object}|null>}
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
   * Edit an existing image with Gemini API (image + text to image).
   * Uses Gemini's "semantic masking" - describe what to change in the prompt.
   * @param {Object} options - Editing options
   * @param {string} options.prompt - Text instruction for editing (e.g., "change only the car to red, keep everything else the same")
   * @param {Buffer|string} options.sourceImage - Original image (Buffer or base64)
   * @param {string} [options.negativePrompt] - Negative prompt for editing
   * @param {string} [options.aspectRatio='1:1'] - Aspect ratio (will match source if not specified)
   * @returns {Promise<{buffer: Buffer, mimeType: string, safetyAttributes: Object}>}
   */
  async edit(options = {}) {
    if (this.shouldMock()) {
      return this.generatePlaceholder(options);
    }

    const { prompt, sourceImage, negativePrompt, aspectRatio = '1:1', mode, size } = options;

    if (!prompt || !sourceImage) {
      throw new Error('[ImagenAdapter] edit() requires both prompt and sourceImage');
    }

    // Convert source image to base64 if it's a Buffer
    let base64Image;
    if (Buffer.isBuffer(sourceImage)) {
      base64Image = sourceImage.toString('base64');
    } else if (typeof sourceImage === 'string') {
      // Already base64 or data URI
      base64Image = sourceImage.includes('base64,') 
        ? sourceImage.split('base64,')[1] 
        : sourceImage;
    } else {
      throw new Error('[ImagenAdapter] sourceImage must be Buffer or base64 string');
    }

    this.logger?.info?.(`[ImagenAdapter] Editing image with prompt: "${truncate(prompt, 100)}"`);

    const desiredSize =
      size ||
      (mode === 'hd'
        ? { width: 1920, height: 1080 }
        : mode === 'preview'
          ? { width: 512, height: 288 }
          : null);

    const inlineImagePart = {
      inline_data: {
        mime_type: 'image/png',
        data: base64Image
      }
    };
    const decoratedPrompt = buildPromptWithDirectives(prompt, {
      aspectRatio,
      mode,
      size: desiredSize
    });
    const userParts = [{ text: decoratedPrompt }, inlineImagePart];
    if (negativePrompt) {
      userParts.push({ text: `Negative prompt: ${negativePrompt}` });
    }
    const contents = [
      {
        role: 'user',
        parts: userParts
      }
    ];

    // Call Gemini API (same as generate, but with image input)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const generationConfig = buildGenerationConfig({
      aspectRatio,
      responseModalities: ['Image']
    });
    const body = { contents };
    if (generationConfig) {
      body.generationConfig = generationConfig;
    }

    const res = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini edit API error (${res.status}): ${text}`);
    }

    const payload = await res.json();
    
    // Extract image from response
    const part = payload?.candidates?.[0]?.content?.parts?.find(p => p.inline_data);
    if (!part || !part.inline_data || !part.inline_data.data) {
      throw new Error('[ImagenAdapter] No image data in edit response');
    }

    const base64 = part.inline_data.data;
    const mimeType = part.inline_data.mime_type || 'image/png';

    this.logger?.info?.('[ImagenAdapter] Image editing successful');

    return {
      buffer: Buffer.from(base64, 'base64'),
      mimeType: mimeType,
      safetyAttributes: payload?.candidates?.[0]?.safetyRatings || {},
      requestId: `gemini-edit-${Date.now()}`
    };
  }

  /**
   * Upload image to storage (S3, not GCS).
   * Note: Gemini API doesn't require GCS upload - use base64 inline_data instead.
   * This method is kept for backward compatibility.
   * @param {Buffer} buffer - Image buffer
   * @param {string} filename - Filename for the image
   * @returns {Promise<string>} S3 URI (s3://bucket/key)
   */
  async uploadToGCS(buffer, filename) {
    // For now, we use S3 instead of GCS
    // Import s3-utils dynamically to avoid circular dependency
    const { uploadImage } = require('./s3-utils');
    
    const safeName = filename || `imagen-${Date.now()}.png`;
    const s3Key = `imagen-uploads/${safeName.replace(/\s+/g, '-').toLowerCase()}`;
    
    this.logger?.info?.(`[ImagenAdapter] Uploading to S3: ${s3Key}`);
    
    const s3Uri = await uploadImage(s3Key, buffer, {
      contentType: 'image/png',
      metadata: {
        'uploaded-by': 'imagen-adapter',
        'original-filename': filename
      }
    });
    
    this.logger?.info?.(`[ImagenAdapter] Upload successful: ${s3Uri}`);
    return s3Uri;
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

    const {
      prompt,
      negativePrompt,
      aspectRatio = '16:9',
      referenceImages = [],
      mode,
      size
    } = options;
    if (!prompt) {
      throw new Error('ImagenAdapter.generate requires a prompt');
    }

    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const desiredSize =
      size ||
      (mode === 'hd'
        ? { width: 1920, height: 1080 }
        : mode === 'preview'
          ? { width: 512, height: 288 }
          : null);
    
    // Build contents array: text prompt + reference images
    const promptText = buildPromptWithDirectives(prompt, { aspectRatio, mode, size: desiredSize });
    const contents = [
      {
        role: 'user',
        parts: [{ text: promptText }]
      }
    ];

    // Add reference images to contents (max 3 for best performance)
    if (referenceImages && referenceImages.length > 0) {
      const imageLimit = Math.min(referenceImages.length, 3); // Gemini API 最多支持 3 张参考图
      this.logger?.info?.(`[ImagenAdapter] Adding ${imageLimit} reference images to generation`);
      
      for (let i = 0; i < imageLimit; i++) {
        const refImage = referenceImages[i];
        
        // Check if it's a base64 string (with or without data URI prefix)
        if (typeof refImage === 'string' && refImage.length > 100) {
          let base64Data = refImage;
          
          // Remove data URI prefix if present
          if (refImage.includes('base64,')) {
            base64Data = refImage.split('base64,')[1];
          }
          // If it's already raw base64, use directly
          // PNG starts with iVBOR, JPEG with /9j/, GIF with R0lGOD
          else if (!refImage.startsWith('s3://') && !refImage.startsWith('http')) {
            base64Data = refImage;
          }
          
          // Only add if it looks like valid base64
          if (base64Data && base64Data.length > 100 && !base64Data.startsWith('s3://')) {
            contents[0].parts.push({
              inline_data: {
                mime_type: 'image/png',
                data: base64Data
              }
            });
            this.logger?.info?.(`[ImagenAdapter] Added reference image #${i + 1} (${base64Data.substring(0, 20)}...)`);
          }
        }
        // If it's an S3 URI, warn that it should be converted first
        else if (typeof refImage === 'string' && refImage.startsWith('s3://')) {
          this.logger?.warn?.(`[ImagenAdapter] S3 URI detected: ${refImage}. You should convert to base64 before calling generate()`);
          // Note: Caller should handle S3 → base64 conversion
        }
      }
    }

    if (negativePrompt) {
      contents[0].parts.push({
        text: `Negative prompt: ${negativePrompt}`
      });
    }

    const generationConfig = buildGenerationConfig({
      aspectRatio,
      responseModalities: ['Image']
    });
    const body = { contents };
    if (generationConfig) {
      body.generationConfig = generationConfig;
    }

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
    const candidate = payload?.candidates?.[0];
    const part = candidate?.content?.parts?.find((p) => p.inline_data);
    const inline = part?.inline_data;
    if (!inline?.data) {
      return null;
    }

    return {
      buffer: Buffer.from(inline.data, 'base64'),
      mimeType: inline.mime_type || 'image/png',
      safetyAttributes: candidate?.safetyRatings || payload?.safetyInfo,
      requestId: payload?.responseId || payload?.requestId || `gemini-${Date.now()}`
    };
  }
}

function buildPromptWithDirectives(prompt, options = {}) {
  const lines = [prompt];
  const directives = [];
  if (options.aspectRatio) {
    directives.push(`Aspect Ratio: ${options.aspectRatio}`);
  }
  if (options.size && options.size.width && options.size.height) {
    directives.push(`Target Size: ${options.size.width}x${options.size.height}`);
  }
  if (options.mode === 'hd') {
    directives.push('Render at HD quality (~1920x1080)');
  } else if (options.mode === 'preview') {
    directives.push('Render at preview quality (~512x288)');
  }
  if (directives.length > 0) {
    lines.push('', directives.join(' | '));
  }
  return lines.join('\n');
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function buildGenerationConfig(options = {}) {
  const config = {};
  const { responseModalities, aspectRatio } = options;

  if (Array.isArray(responseModalities) && responseModalities.length > 0) {
    config.responseModalities = responseModalities.map((item) => {
      if (typeof item !== 'string') {
        return item;
      }
      const normalized = item.trim().toLowerCase();
      if (normalized === 'image') {
        return 'Image';
      }
      if (normalized === 'text') {
        return 'Text';
      }
      return item;
    });
  }

  const normalizedAspectRatio = normalizeAspectRatio(aspectRatio);
  if (normalizedAspectRatio) {
    config.imageConfig = {
      aspectRatio: normalizedAspectRatio
    };
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function normalizeAspectRatio(value) {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return value.toFixed(2);
  }
  if (typeof value === 'object' && value.width && value.height) {
    const width = Number(value.width);
    const height = Number(value.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return `${width}:${height}`;
    }
  }
  return undefined;
}

module.exports = ImagenAdapter;
