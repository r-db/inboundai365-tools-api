// Vonage Service - Number Management
// Handles phone number provisioning, configuration, and management

const axios = require('axios');
const qs = require('querystring');

class VonageService {
  constructor() {
    this.apiKey = process.env.VONAGE_API_KEY;
    this.apiSecret = process.env.VONAGE_API_SECRET;
    this.baseUrl = 'https://rest.nexmo.com';
    this.webhookBaseUrl = process.env.RAILWAY_URL || process.env.BACKEND_URL || 'http://localhost:5003';
  }

  /**
   * Search for available phone numbers
   * @param {string} country - Country code (e.g., "US", "GB")
   * @param {object} options - Search options
   * @returns {Promise<Array>} Available numbers
   *
   * Valid types:
   * - landline (standard landline numbers)
   * - mobile-lvn (mobile numbers)
   * - landline-toll-free (toll-free numbers like 800, 888, etc.)
   *
   * Valid features: VOICE, SMS, MMS (comma-separated)
   *
   * Pattern matching:
   * - Pass patterns directly (e.g., "213" for Los Angeles area code)
   * - Vonage API handles country codes internally via the country parameter
   * - Example: country="US", pattern="213" finds US numbers in 213 area code
   */
  async searchNumbers(country, options = {}) {
    try {
      const params = {
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        country: country,
        size: options.size || 10
      };

      // Type parameter - use landline as default for most searches
      // Don't send type parameter if not specified to get all available types
      if (options.type) {
        params.type = options.type; // mobile-lvn, landline, landline-toll-free
      }

      // Features - SMS and VOICE are most common
      if (options.features) {
        params.features = options.features;
      } else {
        // Default to SMS and VOICE capabilities
        params.features = 'SMS,VOICE';
      }

      // Pattern for area code or specific number pattern
      if (options.pattern) {
        let pattern = options.pattern;

        // For US/Canada, Vonage expects the country code "1" to be included in the pattern
        // Only prepend if it's a 3-digit area code that doesn't already start with "1"
        if ((country === 'US' || country === 'CA') && pattern) {
          // Check if pattern is just a 3-digit area code
          if (/^\d{3}$/.test(pattern)) {
            // Prepend country code "1" for area code search
            pattern = '1' + pattern;
            console.log(`Prepending country code for area code search: ${options.pattern} -> ${pattern}`);
          }
        }

        params.pattern = pattern;
      }

      // Index parameter for pagination (Vonage supports this)
      if (options.index !== undefined) {
        params.index = options.index;
      }

      const response = await axios.get(`${this.baseUrl}/number/search`, { params });

      return {
        success: true,
        count: response.data.count,
        numbers: response.data.numbers || []
      };
    } catch (error) {
      // Better error handling for rate limits and other API errors
      if (error.response) {
        const statusCode = error.response.status;
        const errorData = error.response.data;

        // Rate limiting (429)
        if (statusCode === 429) {
          console.warn('Vonage API rate limit hit');
          throw new Error('Rate limit exceeded. Please try again in a few moments.');
        }

        // Parse error message
        const errorMsg = errorData?.['error-code-label'] || errorData?.message || error.message;
        console.error('Vonage search error:', { statusCode, errorData });
        throw new Error(`Failed to search numbers: ${errorMsg}`);
      }

      // Network or other errors
      console.error('Vonage search error:', error.message);
      throw new Error(`Failed to search numbers: ${error.message}`);
    }
  }

  /**
   * Buy a phone number
   * @param {string} country - Country code
   * @param {string} msisdn - Phone number to buy
   * @returns {Promise<object>} Purchase result
   */
  async buyNumber(country, msisdn) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/number/buy`,
        qs.stringify({
          api_key: this.apiKey,
          api_secret: this.apiSecret,
          country: country,
          msisdn: msisdn
        }),
        {
          headers: { 'content-type': 'application/x-www-form-urlencoded' }
        }
      );

      if (response.data['error-code'] !== '200') {
        throw new Error(response.data['error-code-label'] || 'Purchase failed');
      }

      return {
        success: true,
        msisdn: msisdn,
        country: country,
        message: 'Number purchased successfully'
      };
    } catch (error) {
      console.error('Vonage buy error:', error.response?.data || error.message);
      throw new Error(`Failed to buy number: ${error.response?.data?.['error-code-label'] || error.message}`);
    }
  }

  /**
   * Configure webhooks and settings for a number
   * @param {string} country - Country code
   * @param {string} msisdn - Phone number
   * @param {object} config - Configuration options
   * @returns {Promise<object>} Update result
   */
  async configureNumber(country, msisdn, config = {}) {
    try {
      const params = {
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        country: country,
        msisdn: msisdn
      };

      // Voice webhooks
      if (config.voiceCallbackType || !config.skipVoice) {
        params.voiceCallbackType = config.voiceCallbackType || 'app';
      }

      if (config.voiceCallbackValue) {
        params.voiceCallbackValue = config.voiceCallbackValue;
      } else if (!config.skipVoice) {
        // Default to our webhook endpoint
        params.voiceCallbackValue = `${this.webhookBaseUrl}/webhooks/vonage/answer`;
      }

      // SMS webhooks
      if (config.moHttpUrl) {
        params.moHttpUrl = config.moHttpUrl;
      } else if (!config.skipSMS) {
        params.moHttpUrl = `${this.webhookBaseUrl}/webhooks/vonage/inbound-sms`;
      }

      // Event webhook
      if (config.voiceStatusCallback) {
        params.voiceStatusCallback = config.voiceStatusCallback;
      } else if (!config.skipEvents) {
        params.voiceStatusCallback = `${this.webhookBaseUrl}/webhooks/vonage/events`;
      }

      const response = await axios.post(
        `${this.baseUrl}/number/update`,
        qs.stringify(params),
        {
          headers: { 'content-type': 'application/x-www-form-urlencoded' }
        }
      );

      if (response.data['error-code'] !== '200') {
        throw new Error(response.data['error-code-label'] || 'Configuration failed');
      }

      return {
        success: true,
        msisdn: msisdn,
        config: params,
        message: 'Number configured successfully'
      };
    } catch (error) {
      console.error('Vonage config error:', error.response?.data || error.message);
      throw new Error(`Failed to configure number: ${error.response?.data?.['error-code-label'] || error.message}`);
    }
  }

  /**
   * Release (cancel) a phone number
   * @param {string} country - Country code
   * @param {string} msisdn - Phone number
   * @returns {Promise<object>} Cancellation result
   */
  async releaseNumber(country, msisdn) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/number/cancel`,
        qs.stringify({
          api_key: this.apiKey,
          api_secret: this.apiSecret,
          country: country,
          msisdn: msisdn
        }),
        {
          headers: { 'content-type': 'application/x-www-form-urlencoded' }
        }
      );

      if (response.data['error-code'] !== '200') {
        throw new Error(response.data['error-code-label'] || 'Release failed');
      }

      return {
        success: true,
        msisdn: msisdn,
        message: 'Number released successfully'
      };
    } catch (error) {
      console.error('Vonage release error:', error.response?.data || error.message);
      throw new Error(`Failed to release number: ${error.response?.data?.['error-code-label'] || error.message}`);
    }
  }

  /**
   * Get all numbers owned by the account
   * @returns {Promise<Array>} Owned numbers
   */
  async getOwnedNumbers() {
    try {
      const response = await axios.get(`${this.baseUrl}/account/numbers`, {
        params: {
          api_key: this.apiKey,
          api_secret: this.apiSecret
        }
      });

      return {
        success: true,
        count: response.data.count,
        numbers: response.data.numbers || []
      };
    } catch (error) {
      console.error('Vonage get numbers error:', error.response?.data || error.message);
      throw new Error(`Failed to get owned numbers: ${error.message}`);
    }
  }

  /**
   * Get account balance
   * @returns {Promise<object>} Account balance information
   */
  async getAccountBalance() {
    try {
      const response = await axios.get(`${this.baseUrl}/account/get-balance`, {
        params: {
          api_key: this.apiKey,
          api_secret: this.apiSecret
        }
      });

      return {
        success: true,
        value: parseFloat(response.data.value),
        autoReload: response.data.autoReload || false
      };
    } catch (error) {
      console.error('Vonage get balance error:', error.response?.data || error.message);
      throw new Error(`Failed to get account balance: ${error.message}`);
    }
  }

  /**
   * Get pricing information for a country
   * @param {string} country - Country code (e.g., "US")
   * @returns {Promise<object>} Pricing information
   */
  async getPricing(country = 'US') {
    try {
      const response = await axios.get(`${this.baseUrl}/account/get-pricing/outbound/sms`, {
        params: {
          api_key: this.apiKey,
          api_secret: this.apiSecret,
          country: country
        }
      });

      return {
        success: true,
        country: response.data.country,
        pricing: response.data.networks || []
      };
    } catch (error) {
      console.error('Vonage get pricing error:', error.response?.data || error.message);
      throw new Error(`Failed to get pricing: ${error.message}`);
    }
  }

  /**
   * Format phone number for display
   * @param {string} msisdn - Phone number in E.164 format
   * @returns {string} Formatted phone number
   */
  formatPhoneNumber(msisdn) {
    if (!msisdn) return '';

    // Remove any non-digit characters
    const cleaned = msisdn.replace(/\D/g, '');

    // Format US/CA numbers (country code 1)
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }

    // For other numbers, just add + prefix if not present
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  }

  /**
   * Configure webhooks for a number with agent-specific routing
   * @param {string} msisdn - Phone number
   * @param {string} agentId - Agent UUID (optional, for agent-specific routing)
   * @returns {Promise<object>} Configuration result
   */
  async configureNumberWebhooks(msisdn, agentId = null) {
    try {
      const country = msisdn.startsWith('1') ? 'US' : 'US'; // Default to US for now

      console.log(`[VONAGE] Configuring webhooks for ${msisdn}${agentId ? ` (agent: ${agentId})` : ''}`);

      // Build webhook URLs with agent_id query parameter if provided
      const answerUrl = agentId
        ? `${this.webhookBaseUrl}/webhooks/vonage/answer?agent_id=${agentId}`
        : `${this.webhookBaseUrl}/webhooks/vonage/answer`;

      const eventUrl = agentId
        ? `${this.webhookBaseUrl}/webhooks/vonage/events?agent_id=${agentId}`
        : `${this.webhookBaseUrl}/webhooks/vonage/events`;

      const smsUrl = agentId
        ? `${this.webhookBaseUrl}/webhooks/vonage/inbound-sms?agent_id=${agentId}`
        : `${this.webhookBaseUrl}/webhooks/vonage/inbound-sms`;

      const result = await this.configureNumber(country, msisdn, {
        voiceCallbackValue: answerUrl,
        voiceStatusCallback: eventUrl,
        moHttpUrl: smsUrl
      });

      if (result.success) {
        console.log(`[VONAGE] ✅ Webhooks configured for ${msisdn}`);
      }

      return result;
    } catch (error) {
      console.error(`[VONAGE] Failed to configure webhooks for ${msisdn}:`, error);
      throw error;
    }
  }

  /**
   * Search available numbers for onboarding selection
   * @param {string} areaCode - Optional 3-digit area code to filter by
   * @param {string} country - Country code (default: 'US')
   * @param {object} options - Additional options (limit, etc.)
   * @returns {Promise<Array>} Formatted available numbers with pricing
   */
  async searchAvailableNumbers(areaCode, country = 'US', options = {}) {
    try {
      const searchOptions = {
        features: 'SMS,VOICE',
        size: options.limit || 10
      };

      // If area code provided, add it as pattern
      if (areaCode) {
        searchOptions.pattern = areaCode;
      }

      // Use existing searchNumbers method
      const response = await this.searchNumbers(country, searchOptions);

      if (!response.success) {
        throw new Error('Number search failed');
      }

      // Format the results for frontend consumption
      return response.numbers.map(number => ({
        number: number.msisdn,
        formattedNumber: this.formatPhoneNumber(number.msisdn),
        monthlyPrice: number.cost || 'N/A',
        features: number.features || ['SMS', 'VOICE'],
        country: number.country
      }));
    } catch (error) {
      console.error('[VONAGE] Number search failed:', error);
      throw new Error(`Vonage number search failed: ${error.message}`);
    }
  }
}

module.exports = new VonageService();
