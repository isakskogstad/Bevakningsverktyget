/**
 * API Key Service
 * Handles CRUD operations for API keys in Supabase
 */

const { createClient } = require('@supabase/supabase-js');
const { encrypt, decrypt, maskValue } = require('./encryption');

class ApiKeyService {
  constructor(supabaseUrl, supabaseKey) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Get all API keys (with masked values)
   */
  async getAllKeys() {
    try {
      const { data, error } = await this.supabase
        .from('api_keys')
        .select('*')
        .eq('is_active', true)
        .order('service_name', { ascending: true });

      if (error) throw error;

      // Return with masked values
      return data.map(key => ({
        id: key.id,
        keyName: key.key_name,
        serviceName: key.service_name,
        description: key.description,
        maskedValue: maskValue(key.key_name), // Mask based on key name length
        isActive: key.is_active,
        createdAt: key.created_at,
        updatedAt: key.updated_at
      }));
    } catch (error) {
      throw new Error(`Failed to fetch API keys: ${error.message}`);
    }
  }

  /**
   * Get a specific API key by name (decrypted)
   */
  async getKey(keyName) {
    try {
      const { data, error } = await this.supabase
        .from('api_keys')
        .select('*')
        .eq('key_name', keyName)
        .eq('is_active', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Key not found
        }
        throw error;
      }

      // Decrypt the value
      const decryptedValue = decrypt(data.encrypted_value, data.iv);

      return {
        keyName: data.key_name,
        value: decryptedValue,
        serviceName: data.service_name,
        description: data.description
      };
    } catch (error) {
      throw new Error(`Failed to fetch API key: ${error.message}`);
    }
  }

  /**
   * Create or update an API key
   */
  async upsertKey(keyName, value, serviceName, description) {
    try {
      // Encrypt the value
      const { encryptedValue, iv } = encrypt(value);

      // Check if key exists
      const { data: existing } = await this.supabase
        .from('api_keys')
        .select('id')
        .eq('key_name', keyName)
        .single();

      if (existing) {
        // Update existing key
        const { error } = await this.supabase
          .from('api_keys')
          .update({
            encrypted_value: encryptedValue,
            iv: iv,
            service_name: serviceName,
            description: description,
            updated_at: new Date().toISOString()
          })
          .eq('key_name', keyName);

        if (error) throw error;
      } else {
        // Insert new key
        const { error } = await this.supabase
          .from('api_keys')
          .insert({
            key_name: keyName,
            encrypted_value: encryptedValue,
            iv: iv,
            service_name: serviceName,
            description: description
          });

        if (error) throw error;
      }

      return { success: true, message: 'API key saved successfully' };
    } catch (error) {
      throw new Error(`Failed to save API key: ${error.message}`);
    }
  }

  /**
   * Delete an API key (soft delete)
   */
  async deleteKey(keyName) {
    try {
      const { error } = await this.supabase
        .from('api_keys')
        .update({ is_active: false })
        .eq('key_name', keyName);

      if (error) throw error;

      return { success: true, message: 'API key deleted successfully' };
    } catch (error) {
      throw new Error(`Failed to delete API key: ${error.message}`);
    }
  }

  /**
   * Test connection for a specific service
   */
  async testConnection(serviceName, keyName) {
    try {
      const key = await this.getKey(keyName);
      if (!key) {
        throw new Error('API key not found');
      }

      // Test based on service type
      switch (serviceName.toLowerCase()) {
        case 'twocaptcha':
          return await this.testTwoCaptcha(key.value);

        case 'anticaptcha':
          return await this.testAntiCaptcha(key.value);

        case 'twilio':
          // For Twilio, we need all three values
          return { success: true, message: 'Twilio test not implemented yet' };

        case 'supabase':
          return await this.testSupabase(key.value);

        case 'anthropic':
          return await this.testAnthropic(key.value);

        default:
          return { success: false, message: 'Unknown service type' };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // Service-specific test methods
  async testTwoCaptcha(apiKey) {
    try {
      const response = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=getbalance&json=1`);
      const data = await response.json();

      if (data.status === 1) {
        return { success: true, message: `Connected! Balance: $${data.request}` };
      } else {
        return { success: false, message: data.request || 'Invalid API key' };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async testAntiCaptcha(apiKey) {
    try {
      const response = await fetch('https://api.anti-captcha.com/getBalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey })
      });
      const data = await response.json();

      if (data.errorId === 0) {
        return { success: true, message: `Connected! Balance: $${data.balance}` };
      } else {
        return { success: false, message: data.errorDescription || 'Invalid API key' };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async testSupabase(apiKey) {
    try {
      // Try to create a client with the key
      const testUrl = await this.getKey('SUPABASE_URL');
      if (!testUrl) {
        return { success: false, message: 'SUPABASE_URL not configured' };
      }

      const testClient = createClient(testUrl.value, apiKey);
      const { error } = await testClient.from('api_keys').select('count').limit(1);

      if (error) {
        return { success: false, message: error.message };
      }

      return { success: true, message: 'Connected successfully!' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async testAnthropic(apiKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      });

      if (response.ok) {
        return { success: true, message: 'Connected successfully!' };
      } else {
        const error = await response.json();
        return { success: false, message: error.error?.message || 'Invalid API key' };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = ApiKeyService;
