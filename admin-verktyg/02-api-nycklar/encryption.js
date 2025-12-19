/**
 * Encryption/Decryption Service
 * Uses AES-256-CBC for encrypting API keys
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be exactly 32 characters long');
}

/**
 * Encrypt a value using AES-256-CBC
 * @param {string} text - Plain text to encrypt
 * @returns {object} - Object containing encrypted text and IV
 */
function encrypt(text) {
  if (!text) {
    throw new Error('Cannot encrypt empty value');
  }

  // Generate a random initialization vector
  const iv = crypto.randomBytes(16);

  // Create cipher
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY),
    iv
  );

  // Encrypt the text
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    encryptedValue: encrypted,
    iv: iv.toString('hex')
  };
}

/**
 * Decrypt a value using AES-256-CBC
 * @param {string} encryptedText - Encrypted text
 * @param {string} ivHex - Initialization vector in hex format
 * @returns {string} - Decrypted plain text
 */
function decrypt(encryptedText, ivHex) {
  if (!encryptedText || !ivHex) {
    throw new Error('Cannot decrypt: missing encrypted value or IV');
  }

  try {
    // Convert IV from hex
    const iv = Buffer.from(ivHex, 'hex');

    // Create decipher
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY),
      iv
    );

    // Decrypt the text
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Mask a value for display (shows only last 4 characters)
 * @param {string} value - Value to mask
 * @returns {string} - Masked value
 */
function maskValue(value) {
  if (!value || value.length < 4) {
    return '****';
  }

  const visibleChars = 4;
  const masked = '*'.repeat(Math.max(0, value.length - visibleChars));
  const visible = value.slice(-visibleChars);

  return masked + visible;
}

module.exports = {
  encrypt,
  decrypt,
  maskValue
};
