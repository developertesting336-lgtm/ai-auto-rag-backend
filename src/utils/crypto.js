import crypto from 'crypto';

/**
 * Derives a consistent 256-bit encryption key from process.env.KEYS_HASH
 */
function getDerivedKey() {
  const rawHash = (process.env.KEYS_HASH || 'default_ai_automation_secret_key_2026').replace(/^['"]|['"]$/g, '');
  return crypto.createHash('sha256').update(rawHash).digest();
}

/**
 * Encrypts an API key or sensitive token using AES-256-GCM.
 * Output format: enc:gcm:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
export function encryptKey(plainText) {
  if (!plainText || typeof plainText !== 'string') return plainText;
  const trimmed = plainText.trim();
  if (!trimmed) return '';
  // Avoid re-encrypting already encrypted keys
  if (trimmed.startsWith('enc:gcm:')) return trimmed;

  try {
    const key = getDerivedKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(trimmed, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `enc:gcm:${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('[crypto.encryptKey] Error encrypting key:', err.message);
    return trimmed;
  }
}

/**
 * Decrypts an AES-256-GCM encrypted API key.
 * If the string does not match the enc:gcm prefix, returns it as-is for backwards compatibility.
 */
export function decryptKey(cipherText) {
  if (!cipherText || typeof cipherText !== 'string') return cipherText;
  const trimmed = cipherText.trim();
  if (!trimmed.startsWith('enc:gcm:')) {
    return trimmed;
  }

  try {
    const parts = trimmed.split(':');
    // Format: ['enc', 'gcm', ivHex, authTagHex, encryptedHex]
    if (parts.length < 5) return trimmed;
    const iv = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');
    const encryptedHex = parts[4];

    const key = getDerivedKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[crypto.decryptKey] Error decrypting key:', err.message);
    return trimmed;
  }
}

/**
 * Formats a safe visual hint for display in the UI (e.g. sk-a••••••••3b9f)
 */
export function maskApiKey(plainOrEncryptedKey) {
  if (!plainOrEncryptedKey) return '';
  const decrypted = decryptKey(plainOrEncryptedKey);
  const trimmed = decrypted.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export default {
  encryptKey,
  decryptKey,
  maskApiKey,
};
