/**
 * DOCUMENT SEARCH TOOL ROUTES (SECURE v2.0)
 *
 * ElevenLabs-compatible webhook endpoints for knowledge base search.
 * Allows AI agents to search uploaded documents during conversations.
 *
 * SECURITY: Uses agentAuth middleware to resolve tenant from agent_id.
 * LLM NEVER chooses tenant - backend injects it from database lookup.
 */

const express = require('express');
const router = express.Router();
const vectorSearch = require('../../services/ohmnic/vectorSearch');
const llmPromptBuilder = require('../../services/ohmnic/llmPromptBuilder');
const agentAuth = require('../../middleware/agentAuth');

/**
 * POST /api/tools/document/search
 *
 * Search knowledge base documents using semantic vector search.
 * Returns relevant excerpts with context for AI agents to use in responses.
 *
 * Headers:
 * - X-Tool-Auth: Authentication secret
 * - X-Tenant-Id: Tenant UUID for data isolation
 *
 * Body:
 * {
 *   "query": "What are the return policies?",
 *   "max_results": 5,
 *   "document_type": "pdf" (optional)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "results": [
 *     {
 *       "document_id": "uuid",
 *       "filename": "policies.pdf",
 *       "excerpt": "Returns accepted within 30 days...",
 *       "relevance_score": 0.92,
 *       "source": "policies.pdf (chunk 12)"
 *     }
 *   ]
 * }
 */
router.post('/search', agentAuth, async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id: tenantId } = req.tenantContext;

    const { query, max_results = 5, document_type } = req.body;

    // Validate query
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required and must be a non-empty string'
      });
    }

    console.log('[DOCUMENT SEARCH TOOL] Processing search:', {
      query: query.substring(0, 50),
      tenant_id: tenantId,
      max_results,
      document_type
    });

    // Perform semantic vector search
    const searchResults = await vectorSearch.search(query, tenantId, {
      topK: Math.min(max_results, 10), // Cap at 10 results max
      similarityThreshold: 0.5 // Only return reasonably relevant results
    });

    // Filter by document type if specified
    let filteredResults = searchResults.results;
    if (document_type) {
      filteredResults = searchResults.results.filter(
        r => r.source.fileType === document_type
      );
    }

    // Format results for AI agent consumption
    const formattedResults = filteredResults.map(result => ({
      document_id: result.documentId,
      filename: result.source.filename,
      excerpt: truncateText(result.text, 200), // Keep excerpts concise
      full_chunk: result.text, // Full text for context
      relevance_score: result.similarity,
      source: `${result.source.filename} (chunk ${result.chunkIndex})`,
      metadata: {
        file_type: result.source.fileType,
        upload_date: result.source.uploadDate,
        tags: result.source.tags || []
      }
    }));

    console.log('[DOCUMENT SEARCH TOOL] Returning', formattedResults.length, 'results');

    return res.json({
      success: true,
      query,
      results: formattedResults,
      count: formattedResults.length,
      response_time_ms: searchResults.responseTimeMs
    });

  } catch (error) {
    console.error('[DOCUMENT SEARCH TOOL] Search error:', error);

    // Return graceful error that AI can handle
    return res.status(500).json({
      success: false,
      error: 'Search temporarily unavailable',
      message: 'I apologize, but I am having trouble accessing the knowledge base right now. Please try asking your question in a different way, or I can connect you with a team member.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/tools/document/query-with-prompt
 *
 * Enhanced search that returns formatted prompt for LLM use.
 * Includes context, attribution, and ready-to-use prompt text.
 *
 * Body:
 * {
 *   "query": "How much does the enterprise plan cost?",
 *   "agent_type": "voice" | "chat",
 *   "max_results": 3
 * }
 */
router.post('/query-with-prompt', agentAuth, async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id: tenantId } = req.tenantContext;

    const { query, agent_type = 'voice', max_results = 3 } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required'
      });
    }

    console.log('[DOCUMENT SEARCH TOOL] Query with prompt:', {
      query: query.substring(0, 50),
      tenant_id: tenantId,
      agent_type
    });

    // Perform semantic search
    const searchResults = await vectorSearch.search(query, tenantId, {
      topK: max_results,
      similarityThreshold: 0.5
    });

    // Build LLM prompt with results
    const promptData = await llmPromptBuilder.buildPromptWithAttribution({
      searchResults: searchResults.results,
      agentType: agent_type,
      agentName: 'Knowledge Assistant',
      userQuery: query
    });

    return res.json({
      success: true,
      query,
      results: searchResults.results,
      count: searchResults.count,
      prompt: promptData,
      response_time_ms: searchResults.responseTimeMs
    });

  } catch (error) {
    console.error('[DOCUMENT SEARCH TOOL] Query with prompt error:', error);
    return res.status(500).json({
      success: false,
      error: 'Query failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/tools/document/health
 *
 * Health check for document search service
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'document-search-tool',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    capabilities: {
      semantic_search: true,
      document_types: ['pdf', 'docx', 'txt', 'md', 'csv'],
      max_results: 10,
      embedding_model: 'text-embedding-3-large'
    }
  });
});

/**
 * Helper: Truncate text to specified length
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }

  // Try to truncate at word boundary
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + '...';
  }

  return truncated + '...';
}

module.exports = router;
