/**
 * AGENT AUTHENTICATION MIDDLEWARE
 *
 * Secure multi-tenant pattern:
 * 1. Extracts agent_id from request headers (NOT from LLM!)
 * 2. Queries database to resolve tenant from agent_id
 * 3. Injects tenant context into req.tenantContext
 * 4. Enforces that LLM never chooses tenant
 *
 * CRITICAL SECURITY: This middleware prevents data leaks by ensuring
 * tenant_id comes from server-side database lookup, not from LLM output.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function agentAuth(req, res, next) {
  try {
    // 1. Extract agent ID from request headers
    const agentId = req.headers['x-elevenlabs-agent-id'] ||
                    req.headers['x-agent-id'];

    if (!agentId) {
      console.error('[agentAuth] Missing agent ID in headers');
      return res.status(401).json({
        success: false,
        error: 'Missing agent ID in headers',
        code: 'MISSING_AGENT_ID'
      });
    }

    // 2. Verify tool auth secret
    const authSecret = req.headers['x-tool-auth'];
    if (authSecret !== process.env.TOOL_AUTH_SECRET) {
      console.error('[agentAuth] Invalid tool auth secret');
      return res.status(401).json({
        success: false,
        error: 'Invalid tool authentication',
        code: 'INVALID_AUTH_SECRET'
      });
    }

    // 3. Resolve tenant from agent ID (CRITICAL - SERVER-SIDE ONLY)
    const result = await pool.query(
      `SELECT
        tenant_id,
        business_name,
        unique_tenant_identifier,
        elevenlabs_agent_id
      FROM tenants
      WHERE elevenlabs_agent_id = $1`,
      [agentId]
    );

    if (result.rows.length === 0) {
      console.error(`[agentAuth] Agent not registered: ${agentId}`);
      return res.status(403).json({
        success: false,
        error: 'Agent not registered to any tenant',
        code: 'AGENT_NOT_REGISTERED',
        agent_id: agentId
      });
    }

    const tenant = result.rows[0];

    // 4. Inject tenant context into request (NEVER from LLM!)
    req.tenantContext = {
      tenant_id: tenant.tenant_id,
      unique_identifier: tenant.unique_tenant_identifier,
      business_name: tenant.business_name,
      agent_id: agentId
    };

    console.log(`[agentAuth] ✅ Authenticated: ${tenant.business_name} (${tenant.unique_tenant_identifier})`);

    next();
  } catch (error) {
    console.error('[agentAuth] Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
}

module.exports = agentAuth;
