/**
 * ELEVENLABS TOOL CALLING - KANBAN ROUTES (SECURE v2.0)
 *
 * Handles Kanban board/pipeline management tool calls from ElevenLabs AI agents.
 * SECURITY: Uses agentAuth middleware to resolve tenant from agent_id.
 * LLM NEVER chooses tenant - backend injects it from database lookup.
 */

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const agentAuth = require('../../middleware/agentAuth');

// Apply agent authentication middleware to all kanban tool routes
router.use(agentAuth);

// Valid pipeline stages
const VALID_STAGES = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'closed-won',
  'closed-lost'
];

/**
 * CREATE KANBAN CARD
 * POST /api/tools/kanban/create-card
 */
router.post('/create-card', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      title,
      customerName,
      phone,
      email,
      value,
      description,
      stage = 'new'
    } = req.body;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!title || !customerName || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['title', 'customerName', 'phone']
      });
    }

    // Validate stage
    if (!VALID_STAGES.includes(stage)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid stage',
        validStages: VALID_STAGES
      });
    }

    // Create lead/card in database
    // Map API fields to existing database columns:
    // customerName → owner_name, phone → owner_phone, email → owner_email
    // title → business_name, description → notes, stage → status
    const query = `
      INSERT INTO leads (
        tenant_id,
        business_name,
        owner_name,
        owner_phone,
        owner_email,
        notes,
        status,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING lead_id as id, business_name as title, owner_name as customer_name,
                owner_phone as phone, owner_email as email, notes as description,
                status as stage, status, created_at
    `;

    const values = [
      tenant_id,  // ✅ From middleware, NOT from LLM
      title || `Lead from ${customerName}`,
      customerName,
      phone,
      email || null,
      description || null,
      stage
    ];

    const result = await pool.query(query, values);
    const card = result.rows[0];

    console.log('[TOOL CALL] Kanban: Created card', {
      cardId: card.id,
      title: card.title,
      stage: card.stage,
      customerName: card.customer_name
    });

    res.json({
      success: true,
      message: `Lead "${card.title}" created successfully in ${card.stage} stage`,
      card: {
        id: card.id,
        title: card.title,
        customerName: card.customer_name,
        phone: card.phone,
        email: card.email,
        value: value || 0,
        description: card.description,
        stage: card.stage,
        status: card.status,
        createdAt: card.created_at
      }
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Kanban create-card:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create card',
      message: error.message
    });
  }
});

/**
 * MOVE KANBAN CARD
 * PUT /api/tools/kanban/move-card
 */
router.put('/move-card', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      cardId,
      newStage
    } = req.body;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!cardId || !newStage) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['cardId', 'newStage']
      });
    }

    // Validate stage
    if (!VALID_STAGES.includes(newStage)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid stage',
        validStages: VALID_STAGES
      });
    }

    // Get current card info
    // Map database columns: lead_id → id, status → stage
    const currentQuery = `
      SELECT status as stage FROM leads
      WHERE lead_id = $1 AND tenant_id = $2
    `;
    const currentResult = await pool.query(currentQuery, [cardId, tenant_id]);

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Card not found or access denied'
      });
    }

    const oldStage = currentResult.rows[0].stage;

    // Update stage (maps to status column)
    const updateQuery = `
      UPDATE leads
      SET status = $1, updated_at = NOW()
      WHERE lead_id = $2 AND tenant_id = $3
      RETURNING lead_id as id, business_name as title, owner_name as customer_name,
                status as stage, status
    `;

    const result = await pool.query(updateQuery, [newStage, cardId, tenant_id]);
    const card = result.rows[0];

    console.log('[TOOL CALL] Kanban: Moved card', {
      cardId: card.id,
      oldStage,
      newStage: card.stage,
      title: card.title
    });

    res.json({
      success: true,
      message: `Card moved from "${oldStage}" to "${newStage}"`,
      card: {
        id: card.id,
        title: card.title,
        oldStage,
        newStage: card.stage,
        customerName: card.customer_name,
        value: 0
      }
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Kanban move-card:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to move card',
      message: error.message
    });
  }
});

/**
 * UPDATE KANBAN CARD
 * PUT /api/tools/kanban/update-card
 */
router.put('/update-card', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      cardId,
      title,
      value,
      description
    } = req.body;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!cardId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: cardId'
      });
    }

    // Build dynamic update query
    // Map API fields to database columns: title → business_name, description → notes
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title) {
      updates.push(`business_name = $${paramCount++}`);
      values.push(title);
    }
    // value is not stored in database (no column for it yet)
    if (description !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      values.push(description);
    }

    // Always update timestamp
    updates.push(`updated_at = NOW()`);

    // Add WHERE clause parameters
    values.push(cardId);
    values.push(tenant_id);  // ✅ From middleware, NOT from LLM

    const query = `
      UPDATE leads
      SET ${updates.join(', ')}
      WHERE lead_id = $${paramCount++} AND tenant_id = $${paramCount}
      RETURNING lead_id as id, business_name as title, owner_name as customer_name,
                owner_phone as phone, owner_email as email, notes as description,
                status as stage, status
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Card not found or access denied'
      });
    }

    const card = result.rows[0];

    console.log('[TOOL CALL] Kanban: Updated card', {
      cardId: card.id,
      updates: Object.keys(req.body).filter(k => k !== 'cardId' && k !== 'tenantId')
    });

    res.json({
      success: true,
      message: 'Card updated successfully',
      card: {
        id: card.id,
        title: card.title,
        customerName: card.customer_name,
        phone: card.phone,
        email: card.email,
        value: value || 0,
        description: card.description,
        stage: card.stage,
        status: card.status
      }
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Kanban update-card:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update card',
      message: error.message
    });
  }
});

/**
 * DELETE KANBAN CARD
 * DELETE /api/tools/kanban/delete-card
 */
router.delete('/delete-card', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;
    const { cardId } = req.body;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!cardId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: cardId'
      });
    }

    // Soft delete by updating status to 'deleted'
    // Map database columns: lead_id → id, business_name → title
    const query = `
      UPDATE leads
      SET status = 'deleted', updated_at = NOW()
      WHERE lead_id = $1 AND tenant_id = $2
      RETURNING lead_id as id, business_name as title, status
    `;

    const result = await pool.query(query, [cardId, tenant_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Card not found or access denied'
      });
    }

    const card = result.rows[0];

    console.log('[TOOL CALL] Kanban: Deleted card', {
      cardId: card.id,
      title: card.title
    });

    res.json({
      success: true,
      message: `Card "${card.title}" has been deleted successfully`,
      card: {
        id: card.id,
        title: card.title,
        status: card.status
      }
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Kanban delete-card:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete card',
      message: error.message
    });
  }
});

module.exports = router;
