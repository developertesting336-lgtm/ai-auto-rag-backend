import crypto from 'crypto';

let S3Client = null;
let PutObjectCommand = null;
let DeleteObjectCommand = null;

// Dynamically import @aws-sdk/client-s3 to allow graceful handling if npm install is pending
try {
  const awsS3 = await import('@aws-sdk/client-s3');
  S3Client = awsS3.S3Client;
  PutObjectCommand = awsS3.PutObjectCommand;
  DeleteObjectCommand = awsS3.DeleteObjectCommand;
} catch (err) {
  console.warn('\x1b[33m[R2 Storage] @aws-sdk/client-s3 not loaded yet. Run "npm install" in backend directory.\x1b[0m');
}

/**
 * Returns configured S3 client for Cloudflare R2
 */
const getR2Client = () => {
  if (!S3Client) return null;

  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT } = process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) {
    return null;
  }

  return new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
};

/**
 * Upload a buffer or stream directly to Cloudflare R2
 * @param {Object} params
 * @param {Buffer} params.fileBuffer - Raw file binary
 * @param {string} params.fileName - Original file name
 * @param {string} params.mimeType - MIME type e.g. application/pdf
 * @param {string} [params.folder='policies'] - Destination folder in bucket
 * @returns {Promise<{ key: string, url: string, bucket: string, size: number }>}
 */
export const uploadFileToR2 = async ({ fileBuffer, fileName, mimeType = 'application/pdf', folder = 'policies' }) => {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME || 'chat-easy';
  const publicBaseUrl = process.env.R2_PUBLIC_URL || '';

  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uniqueId = crypto.randomBytes(6).toString('hex');
  const key = `${folder}/${Date.now()}-${uniqueId}-${cleanName}`;

  if (!client || !PutObjectCommand) {
    console.warn('[R2 Storage] R2 credentials not fully configured or S3Client missing. Returning mock storage key.');
    return {
      key,
      url: publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}/${key}` : key,
      bucket,
      size: fileBuffer.length,
    };
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
  });

  await client.send(command);

  const url = publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}/${key}` : key;

  return {
    key,
    url,
    bucket,
    size: fileBuffer.length,
  };
};

/**
 * Delete a file from Cloudflare R2
 * @param {string} key - R2 Object key
 */
export const deleteFileFromR2 = async (key) => {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME || 'chat-easy';

  if (!client || !DeleteObjectCommand || !key) return false;

  try {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    await client.send(command);
    return true;
  } catch (err) {
    console.error('[R2 Storage] Error deleting file:', err.message);
    return false;
  }
};

