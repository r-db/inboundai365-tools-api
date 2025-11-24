/**
 * ELEVENLABS TOOL CALLING - DATABASE ROUTES (SECURE v2.0)
 *
 * Handles customer database operations tool calls from ElevenLabs AI agents.
 * SECURITY: Uses agentAuth middleware to resolve tenant from agent_id.
 * LLM NEVER chooses tenant - backend injects it from database lookup.
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const agentAuth = require('../middleware/agentAuth');

// Apply agent authentication middleware to all database tool routes
router.use(agentAuth);

/**
 * SEARCH CUSTOMERS
 * GET /api/tools/database/search-customers
 */
router.get('/search-customers', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      query,
      limit = 10
    } = req.query;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: query'
      });
    }

    // Validate limit
    const maxLimit = Math.min(parseInt(limit) || 10, 50);

    // Search across multiple fields using ILIKE for case-insensitive search
    // Map database columns: lead_id → id, owner_name → name, owner_phone → phone,
    // owner_email → email, status → stage, notes → description
    const searchQuery = `
      SELECT
        lead_id as id,
        owner_name as customer_name,
        owner_phone as phone,
        owner_email as email,
        status as stage,
        status,
        notes as description,
        created_at,
        updated_at
      FROM leads
      WHERE tenant_id = $1
        AND status != 'deleted'
        AND (
          owner_name ILIKE $2 OR
          owner_phone ILIKE $2 OR
          owner_email ILIKE $2 OR
          notes ILIKE $2
        )
      ORDER BY updated_at DESC
      LIMIT $3
    `;

    const searchPattern = `%${query}%`;
    const result = await pool.query(searchQuery, [tenant_id, searchPattern, maxLimit]);

    console.log('[TOOL CALL] Database: Search customers', {
      query,
      resultsFound: result.rows.length
    });

    const customers = result.rows.map(customer => ({
      id: customer.id,
      name: customer.customer_name,
      phone: customer.phone,
      email: customer.email,
      value: 0,
      stage: customer.stage,
      status: customer.status,
      description: customer.description,
      createdAt: customer.created_at,
      updatedAt: customer.updated_at
    }));

    res.json({
      success: true,
      message: `Found ${customers.length} customer(s) matching "${query}"`,
      customers,
      count: customers.length
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Database search-customers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search customers',
      message: error.message
    });
  }
});

/**
 * GET CUSTOMER DETAILS
 * GET /api/tools/database/get-customer
 */
router.get('/get-customer', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      customerId
    } = req.query;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: customerId'
      });
    }

    // Get customer details with associated appointments
    // Map database columns: lead_id → id, owner_name → customer_name, etc.
    const customerQuery = `
      SELECT
        lead_id as id,
        owner_name as customer_name,
        owner_phone as phone,
        owner_email as email,
        status as stage,
        status,
        notes as description,
        created_at,
        updated_at
      FROM leads
      WHERE lead_id = $1 AND tenant_id = $2 AND status != 'deleted'
    `;

    const customerResult = await pool.query(customerQuery, [customerId, tenant_id]);

    if (customerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found or access denied'
      });
    }

    const customer = customerResult.rows[0];

    // Get associated appointments
    const appointmentsQuery = `
      SELECT
        id,
        title,
        appointment_date,
        appointment_time,
        duration_minutes,
        status,
        notes
      FROM appointments
      WHERE tenant_id = $1
        AND (customer_phone = $2 OR customer_email = $3)
        AND status != 'cancelled'
      ORDER BY appointment_date DESC, appointment_time DESC
      LIMIT 10
    `;

    const appointmentsResult = await pool.query(appointmentsQuery, [
      tenant_id,
      customer.phone,
      customer.email || ''
    ]);

    console.log('[TOOL CALL] Database: Get customer details', {
      customerId,
      name: customer.customer_name,
      appointmentsCount: appointmentsResult.rows.length
    });

    const customerDetails = {
      id: customer.id,
      name: customer.customer_name,
      phone: customer.phone,
      email: customer.email,
      value: 0,
      stage: customer.stage,
      status: customer.status,
      description: customer.description,
      createdAt: customer.created_at,
      updatedAt: customer.updated_at,
      appointments: appointmentsResult.rows.map(apt => ({
        id: apt.id,
        title: apt.title,
        date: apt.appointment_date,
        time: apt.appointment_time,
        duration: apt.duration_minutes,
        status: apt.status,
        notes: apt.notes
      }))
    };

    res.json({
      success: true,
      message: `Customer details for ${customer.customer_name}`,
      customer: customerDetails
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Database get-customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get customer details',
      message: error.message
    });
  }
});

/**
 * UPDATE CUSTOMER
 * PUT /api/tools/database/update-customer
 */
router.put('/update-customer', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      customerId,
      name,
      phone,
      email,
      notes
    } = req.body;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: customerId'
      });
    }

    // Build dynamic update query
    // Map API fields to database columns: name → owner_name, phone → owner_phone,
    // email → owner_email, notes → notes (description)
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`owner_name = $${paramCount++}`);
      values.push(name);
    }
    if (phone) {
      updates.push(`owner_phone = $${paramCount++}`);
      values.push(phone);
    }
    if (email !== undefined) {
      updates.push(`owner_email = $${paramCount++}`);
      values.push(email);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      values.push(notes);
    }

    // Always update timestamp
    updates.push(`updated_at = NOW()`);

    // Add WHERE clause parameters
    values.push(customerId);
    values.push(tenant_id);  // ✅ From middleware, NOT from LLM

    const query = `
      UPDATE leads
      SET ${updates.join(', ')}
      WHERE lead_id = $${paramCount++} AND tenant_id = $${paramCount}
      RETURNING lead_id as id, owner_name as customer_name, owner_phone as phone,
                owner_email as email, status as stage, status, notes as description,
                updated_at
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found or access denied'
      });
    }

    const customer = result.rows[0];

    console.log('[TOOL CALL] Database: Updated customer', {
      customerId: customer.id,
      updates: Object.keys(req.body).filter(k => k !== 'customerId' && k !== 'tenantId')
    });

    res.json({
      success: true,
      message: `Customer ${customer.customer_name} updated successfully`,
      customer: {
        id: customer.id,
        name: customer.customer_name,
        phone: customer.phone,
        email: customer.email,
        value: 0,
        stage: customer.stage,
        status: customer.status,
        description: customer.description,
        updatedAt: customer.updated_at
      }
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Database update-customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer',
      message: error.message
    });
  }
});

module.exports = router;
