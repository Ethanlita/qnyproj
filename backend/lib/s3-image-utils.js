/**
 * S3 utility functions for image handling
 */
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Parse S3 URI to bucket and key
 * @param {string} s3Uri - URI in format s3://bucket/key
 * @returns {{bucket: string, key: string}}
 */
function parseS3Uri(s3Uri) {
  if (!s3Uri || !s3Uri.startsWith('s3://')) {
    throw new Error(`Invalid S3 URI: ${s3Uri}`);
  }
  
  const parts = s3Uri.slice(5).split('/');
  const bucket = parts[0];
  const key = parts.slice(1).join('/');
  
  return { bucket, key };
}

/**
 * Download image from S3 and convert to base64
 * @param {string} s3Uri - S3 URI (s3://bucket/key)
 * @returns {Promise<string>} Base64-encoded image data
 */
async function s3ImageToBase64(s3Uri) {
  const { bucket, key } = parseS3Uri(s3Uri);
  
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);
  
  // Stream to buffer
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  
  return buffer.toString('base64');
}

/**
 * Download multiple S3 images and convert to base64 (parallel)
 * @param {string[]} s3Uris - Array of S3 URIs
 * @returns {Promise<string[]>} Array of base64-encoded images
 */
async function s3ImagesToBase64(s3Uris) {
  if (!s3Uris || s3Uris.length === 0) {
    return [];
  }
  
  return Promise.all(s3Uris.map(uri => s3ImageToBase64(uri)));
}

/**
 * Upload buffer to S3
 * @param {Buffer} buffer - Image buffer
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {Object} [metadata] - Optional metadata
 * @returns {Promise<string>} S3 URI
 */
async function uploadToS3(buffer, bucket, key, metadata = {}) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: metadata.contentType || 'image/png',
    Metadata: metadata
  });
  
  await s3Client.send(command);
  return `s3://${bucket}/${key}`;
}

/**
 * Get presigned URL for S3 object (for temporary public access)
 * @param {string} s3Uri - S3 URI
 * @param {number} [expiresIn=3600] - Expiration in seconds (default 1 hour)
 * @returns {Promise<string>} Presigned URL
 */
async function getPresignedUrl(s3Uri, expiresIn = 3600) {
  const { bucket, key } = parseS3Uri(s3Uri);
  
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return await getSignedUrl(s3Client, command, { expiresIn });
}

module.exports = {
  parseS3Uri,
  s3ImageToBase64,
  s3ImagesToBase64,
  uploadToS3,
  getPresignedUrl,
  s3Client
};
