/**
 * API Key Retrieval Utility
 * Use this in your main application to fetch API keys from Supabase
 *
 * Usage:
 *   const { getApiKey, getAllApiKeys } = require('./admin-verktyg/02-api-nycklar/get-api-keys');
 *   const twoCaptchaKey = await getApiKey('TWOCAPTCHA_API_KEY');
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

/**
 * Decrypt a value using AES-256-CBC
 * @param {string} encryptedText - Encrypted text
 * @param {string} ivHex - Initialization vector in hex format
 * @param {string} encryptionKey - 32-character encryption key
 * @returns {string} - Decrypted plain text
 */
function decrypt(encryptedText, ivHex, encryptionKey) {
  if (!encryptedText || !ivHex) {
    throw new Error('Cannot decrypt: missing encrypted value or IV');
  }

  if (!encryptionKey || encryptionKey.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters long');
  }

  try {
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(encryptionKey),
      iv
    );

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Get a single API key by name
 * @param {string} keyName - Name of the API key (e.g., 'TWOCAPTCHA_API_KEY')
 * @param {object} options - Configuration options
 * @returns {Promise<string>} - The decrypted API key value
 */
async function getApiKey(keyName, options = {}) {
  const {
    supabaseUrl = process.env.SUPABASE_URL,
    supabaseKey = process.env.SUPABASE_SERVICE_KEY,
    encryptionKey = process.env.ENCRYPTION_KEY
  } = options;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and key are required');
  }

  if (!encryptionKey || encryptionKey.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters long');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data, error } = await supabase
      .from('api_keys')
      .select('encrypted_value, iv')
      .eq('key_name', keyName)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error(`API key '${keyName}' not found`);
      }
      throw error;
    }

    return decrypt(data.encrypted_value, data.iv, encryptionKey);
  } catch (error) {
    throw new Error(`Failed to fetch API key '${keyName}': ${error.message}`);
  }
}

/**
 * Get all API keys as an object
 * @param {object} options - Configuration options
 * @returns {Promise<object>} - Object with key names as properties and decrypted values
 */
async function getAllApiKeys(options = {}) {
  const {
    supabaseUrl = process.env.SUPABASE_URL,
    supabaseKey = process.env.SUPABASE_SERVICE_KEY,
    encryptionKey = process.env.ENCRYPTION_KEY
  } = options;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and key are required');
  }

  if (!encryptionKey || encryptionKey.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters long');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data, error } = await supabase
      .from('api_keys')
      .select('key_name, encrypted_value, iv')
      .eq('is_active', true);

    if (error) throw error;

    const keys = {};
    for (const row of data) {
      keys[row.key_name] = decrypt(row.encrypted_value, row.iv, encryptionKey);
    }

    return keys;
  } catch (error) {
    throw new Error(`Failed to fetch API keys: ${error.message}`);
  }
}

/**
 * Initialize API keys and set them as environment variables
 * Useful for applications that rely on process.env
 * @param {object} options - Configuration options
 */
async function initializeApiKeys(options = {}) {
  const keys = await getAllApiKeys(options);

  for (const [keyName, value] of Object.entries(keys)) {
    process.env[keyName] = value;
  }

  return keys;
}

module.exports = {
  getApiKey,
  getAllApiKeys,
  initializeApiKeys
};
