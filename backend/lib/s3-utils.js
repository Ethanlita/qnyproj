/**
 * Lightweight S3 utility helpers used across Lambda functions.
 *
 * These helpers wrap the AWS SDK v3 clients to keep the handler code
 * focused on business logic while centralising common error handling
 * and conventions (bucket defaults, tagging, etc).
 */

const { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

let presign;
try {
  ({ getSignedUrl: presign } = require('@aws-sdk/s3-request-presigner'));
} catch (error) {
  presign = null;
}

const DEFAULT_CONTENT_TYPE = 'image/png';
const DEFAULT_EXPIRES_IN = 900; // 15 minutes

// Reuse a single client per execution context (cold start friendly)
const s3Client = new S3Client({});

/**
 * Resolve the assets bucket from the environment.
 */
function getBucket() {
  const bucket = process.env.ASSETS_BUCKET;
  if (!bucket) {
    throw new Error('ASSETS_BUCKET environment variable not set');
  }
  return bucket;
}

/**
 * Upload an image buffer to S3 under the configured assets bucket.
 *
 * @param {string} key - Object key (path within the bucket)
 * @param {Buffer|Uint8Array} body - Binary payload
 * @param {object} [options]
 * @param {string} [options.contentType]
 * @param {object} [options.metadata]
 * @param {string} [options.tagging]
 * @returns {Promise<string>} S3 URI (s3://bucket/key)
 */
async function uploadImage(key, body, options = {}) {
  if (!key) {
    throw new Error('uploadImage requires a non-empty key');
  }
  if (!body) {
    throw new Error('uploadImage requires a body buffer');
  }

  const bucket = getBucket();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: options.contentType || DEFAULT_CONTENT_TYPE,
    Metadata: options.metadata,
    Tagging: options.tagging
  });

  await s3Client.send(command);
  return `s3://${bucket}/${key}`;
}

/**
 * Generate a presigned URL for downloading an object.
 *
 * @param {string} key - Object key
 * @param {number} [expiresIn] - TTL in seconds (default 900)
 * @returns {Promise<string>} Signed HTTPS URL
 */
async function getPresignedUrl(key, expiresIn = DEFAULT_EXPIRES_IN) {
  if (!key) {
    throw new Error('getPresignedUrl requires a key');
  }
  const bucket = getBucket();
  if (presign) {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    return presign(s3Client, command, { expiresIn });
  }
  // Fallback: unsigned URL (sufficient for local dev/tests)
  const encodedKey = encodeURIComponent(key).replace(/%2F/g, '/');
  return `https://${bucket}.s3.amazonaws.com/${encodedKey}?fallback=1&expiresIn=${expiresIn}`;
}

/**
 * Copy an object within the same bucket (server-side).
 *
 * @param {string} sourceKey - Source object key
 * @param {string} destinationKey - Destination object key
 * @param {object} [options]
 * @param {string} [options.metadataDirective] - e.g. 'REPLACE'
 * @param {object} [options.metadata] - Replace metadata when directive is REPLACE
 * @returns {Promise<string>} Destination S3 URI
 */
async function copyObject(sourceKey, destinationKey, options = {}) {
  if (!sourceKey || !destinationKey) {
    throw new Error('copyObject requires both sourceKey and destinationKey');
  }

  const bucket = getBucket();
  const command = new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${sourceKey}`,
    Key: destinationKey,
    MetadataDirective: options.metadataDirective,
    Metadata: options.metadata
  });

  await s3Client.send(command);
  return `s3://${bucket}/${destinationKey}`;
}

/**
 * Delete an object from S3.
 *
 * @param {string} key - Object key to delete
 * @returns {Promise<void>}
 */
async function deleteImage(key) {
  if (!key) {
    throw new Error('deleteImage requires a key');
  }

  const bucket = getBucket();
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key
  });

  await s3Client.send(command);
}

module.exports = {
  s3Client,
  uploadImage,
  getPresignedUrl,
  copyObject,
  deleteImage
};
