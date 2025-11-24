/**
 * Vector Search Service
 * Performs semantic search using pgvector cosine similarity
 * Returns top-k most relevant document chunks
 */

const pool = require('../../config/database');
const embeddingService = require('./embeddingService');

class VectorSearch {
  constructor() {
    this.defaultTopK = 5;
    this.similarityThreshold = 0.1; // Minimum cosine similarity to include (lowered for testing)
  }

  /**
   * Semantic search for relevant document chunks
   */
  async search(query, tenantId, options = {}) {
    const {
      topK = this.defaultTopK,
      similarityThreshold = this.similarityThreshold,
      documentIds = null // Optional: filter by specific documents
    } = options;

    console.log(`[OHMNIC SEARCH] Searching for: "${query}" (tenant: ${tenantId}, topK: ${topK})`);

    const startTime = Date.now();

    try {
      // Generate embedding for query
      const queryEmbedding = await embeddingService.generateEmbedding(query);

      // Perform vector similarity search
      const results = await this.vectorSimilaritySearch(
        queryEmbedding,
        tenantId,
        topK,
        similarityThreshold,
        documentIds
      );

      const responseTime = Date.now() - startTime;

      console.log(`[OHMNIC SEARCH] Found ${results.length} results in ${responseTime}ms`);

      // Log query for analytics
      await this.logQuery(query, tenantId, results.length, responseTime);

      return {
        results,
        query,
        count: results.length,
        responseTimeMs: responseTime
      };
    } catch (error) {
      console.error('[OHMNIC SEARCH] Search error:', error);
      throw new Error(`Semantic search failed: ${error.message}`);
    }
  }

  /**
   * Perform vector similarity search using pgvector
   */
  async vectorSimilaritySearch(queryEmbedding, tenantId, topK, threshold, documentIds) {
    // Convert embedding to pgvector format
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Build query with optional document filter
    let sql = `
      SELECT
        c.id,
        c.document_id,
        c.chunk_index,
        c.chunk_text,
        c.token_count,
        c.metadata,
        d.filename,
        d.file_type,
        d.upload_date,
        d.tags,
        -- Cosine similarity (1 - cosine distance)
        1 - (c.embedding <=> $1::vector) AS similarity
      FROM ohmnic_document_chunks c
      JOIN ohmnic_documents d ON c.document_id = d.id
      WHERE c.tenant_id = $2
        AND c.embedding IS NOT NULL
    `;

    const params = [embeddingStr, tenantId];

    // Add document filter if specified
    if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
      sql += ` AND c.document_id = ANY($${params.length + 1})`;
      params.push(documentIds);
    }

    // Order by similarity and apply threshold and limit
    sql += `
        AND (1 - (c.embedding <=> $1::vector)) >= $${params.length + 1}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $${params.length + 2}
    `;

    params.push(threshold, topK);

    console.log('[OHMNIC SEARCH] Executing vector search query...');

    const result = await pool.query(sql, params);

    return result.rows.map(row => ({
      chunkId: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      text: row.chunk_text,
      tokenCount: row.token_count,
      metadata: row.metadata,
      source: {
        filename: row.filename,
        fileType: row.file_type,
        uploadDate: row.upload_date,
        tags: row.tags
      },
      similarity: parseFloat(row.similarity.toFixed(4))
    }));
  }

  /**
   * Log query for analytics
   */
  async logQuery(queryText, tenantId, resultsCount, responseTimeMs, agentType = null, conversationId = null) {
    try {
      await pool.query(`
        INSERT INTO ohmnic_query_log (
          tenant_id,
          query_text,
          results_count,
          response_time_ms,
          agent_type,
          conversation_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [tenantId, queryText, resultsCount, responseTimeMs, agentType, conversationId]);

      console.log('[OHMNIC SEARCH] Query logged');
    } catch (error) {
      // Non-critical error, don't fail the search
      console.error('[OHMNIC SEARCH] Failed to log query:', error);
    }
  }

  /**
   * Get query analytics for a tenant
   */
  async getQueryAnalytics(tenantId, options = {}) {
    const {
      limit = 100,
      startDate = null,
      endDate = null,
      agentType = null
    } = options;

    let sql = `
      SELECT
        query_text,
        results_count,
        response_time_ms,
        agent_type,
        created_at
      FROM ohmnic_query_log
      WHERE tenant_id = $1
    `;

    const params = [tenantId];

    if (startDate) {
      params.push(startDate);
      sql += ` AND created_at >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      sql += ` AND created_at <= $${params.length}`;
    }

    if (agentType) {
      params.push(agentType);
      sql += ` AND agent_type = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(sql, params);

    return result.rows;
  }

  /**
   * Get aggregated query statistics
   */
  async getQueryStatistics(tenantId, options = {}) {
    const {
      startDate = null,
      endDate = null
    } = options;

    let sql = `
      SELECT
        COUNT(*) as total_queries,
        AVG(results_count) as avg_results,
        AVG(response_time_ms) as avg_response_time_ms,
        MAX(response_time_ms) as max_response_time_ms,
        MIN(response_time_ms) as min_response_time_ms,
        COUNT(DISTINCT DATE(created_at)) as days_active
      FROM ohmnic_query_log
      WHERE tenant_id = $1
    `;

    const params = [tenantId];

    if (startDate) {
      params.push(startDate);
      sql += ` AND created_at >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      sql += ` AND created_at <= $${params.length}`;
    }

    const result = await pool.query(sql, params);

    return result.rows[0];
  }

  /**
   * Find similar chunks to a given chunk (for recommendations)
   */
  async findSimilarChunks(chunkId, topK = 5) {
    console.log(`[OHMNIC SEARCH] Finding similar chunks to: ${chunkId}`);

    // Get the chunk's embedding
    const chunkResult = await pool.query(
      'SELECT embedding, tenant_id FROM ohmnic_document_chunks WHERE id = $1',
      [chunkId]
    );

    if (chunkResult.rows.length === 0) {
      throw new Error(`Chunk not found: ${chunkId}`);
    }

    const { embedding, tenant_id } = chunkResult.rows[0];

    if (!embedding) {
      throw new Error('Chunk has no embedding');
    }

    // Search for similar chunks (excluding the original)
    const result = await pool.query(`
      SELECT
        id,
        document_id,
        chunk_index,
        chunk_text,
        1 - (embedding <=> $1::vector) AS similarity
      FROM ohmnic_document_chunks
      WHERE tenant_id = $2
        AND id != $3
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $4
    `, [embedding, tenant_id, chunkId, topK]);

    return result.rows.map(row => ({
      chunkId: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      text: row.chunk_text,
      similarity: parseFloat(row.similarity.toFixed(4))
    }));
  }
}

module.exports = new VectorSearch();
