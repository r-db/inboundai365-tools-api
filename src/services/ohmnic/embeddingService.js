/**
 * Embedding Service
 * Generates vector embeddings using OpenAI text-embedding-3-large
 * Handles batch processing and error retries
 */

const { OpenAI } = require('openai');

class EmbeddingService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.model = 'text-embedding-3-large';
    this.dimensions = 3072;
    this.maxRetries = 3;
    this.batchSize = 100; // OpenAI allows up to 2048 inputs per request
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid text input for embedding generation');
    }

    console.log(`[OHMNIC EMBEDDING] Generating embedding for text (${text.length} chars)`);

    try {
      const response = await this.retryWithBackoff(async () => {
        return await this.openai.embeddings.create({
          model: this.model,
          input: text,
          encoding_format: 'float'
        });
      });

      const embedding = response.data[0].embedding;

      console.log(`[OHMNIC EMBEDDING] Generated embedding: ${embedding.length} dimensions`);

      // Validate embedding dimensions
      if (embedding.length !== this.dimensions) {
        throw new Error(`Invalid embedding dimensions: expected ${this.dimensions}, got ${embedding.length}`);
      }

      return embedding;
    } catch (error) {
      console.error('[OHMNIC EMBEDDING] Error generating embedding:', error);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batches
   */
  async generateBatchEmbeddings(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('Invalid texts array for batch embedding generation');
    }

    console.log(`[OHMNIC EMBEDDING] Generating embeddings for ${texts.length} texts in batches`);

    const allEmbeddings = [];
    const batches = this.createBatches(texts, this.batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[OHMNIC EMBEDDING] Processing batch ${i + 1}/${batches.length} (${batch.length} texts)`);

      try {
        const response = await this.retryWithBackoff(async () => {
          return await this.openai.embeddings.create({
            model: this.model,
            input: batch,
            encoding_format: 'float'
          });
        });

        const embeddings = response.data.map(item => item.embedding);
        allEmbeddings.push(...embeddings);

        console.log(`[OHMNIC EMBEDDING] Batch ${i + 1} completed: ${embeddings.length} embeddings`);
      } catch (error) {
        console.error(`[OHMNIC EMBEDDING] Batch ${i + 1} failed:`, error);
        throw new Error(`Failed to generate embeddings for batch ${i + 1}: ${error.message}`);
      }
    }

    console.log(`[OHMNIC EMBEDDING] Total embeddings generated: ${allEmbeddings.length}`);

    return allEmbeddings;
  }

  /**
   * Create batches from array
   */
  createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Retry with exponential backoff
   */
  async retryWithBackoff(fn, retries = this.maxRetries) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || i === retries - 1) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, i) * 1000;
        console.log(`[OHMNIC EMBEDDING] Retry ${i + 1}/${retries} after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    // Retry on rate limits and temporary errors
    const retryableStatuses = [429, 500, 502, 503, 504];
    const retryableMessages = ['timeout', 'network', 'ECONNRESET', 'ETIMEDOUT'];

    if (error.status && retryableStatuses.includes(error.status)) {
      return true;
    }

    if (error.message) {
      return retryableMessages.some(msg =>
        error.message.toLowerCase().includes(msg.toLowerCase())
      );
    }

    return false;
  }

  /**
   * Validate OpenAI API key
   */
  validateApiKey() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    console.log('[OHMNIC EMBEDDING] OpenAI API key validated');
  }

  /**
   * Calculate cosine similarity between two embeddings
   * Used for testing and validation
   */
  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Format embedding for PostgreSQL pgvector
   */
  formatEmbeddingForPostgres(embedding) {
    // pgvector expects array format: [0.1, 0.2, 0.3, ...]
    return `[${embedding.join(',')}]`;
  }
}

module.exports = new EmbeddingService();
