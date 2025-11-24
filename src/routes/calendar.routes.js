/**
 * ELEVENLABS TOOL CALLING - CALENDAR ROUTES (SECURE v2.0)
 *
 * Handles calendar/appointment management tool calls from ElevenLabs AI agents.
 * SECURITY: Uses agentAuth middleware to resolve tenant from agent_id.
 * LLM NEVER chooses tenant - backend injects it from database lookup.
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const agentAuth = require('../middleware/agentAuth');

// Apply agent authentication middleware to all calendar tool routes
// This resolves tenant_id from agent_id and injects req.tenantContext
router.use(agentAuth);

/**
 * CREATE APPOINTMENT
 * POST /api/tools/calendar/create
 */
router.post('/create', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      title,
      date,
      time,
      duration = 60,
      customerName,
      customerPhone,
      customerEmail,
      notes
    } = req.body;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!title || !date || !time || !customerName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['title', 'date', 'time', 'customerName']
      });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    // Validate time format (HH:MM)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(time)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid time format. Use HH:MM (24-hour)'
      });
    }

    // Create appointment in database
    const query = `
      INSERT INTO appointments (
        tenant_id,
        title,
        appointment_date,
        appointment_time,
        duration_minutes,
        customer_name,
        customer_phone,
        customer_email,
        notes,
        status,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *
    `;

    const values = [
      tenant_id,  // ✅ From middleware, NOT from LLM
      title,
      date,
      time,
      duration,
      customerName,
      customerPhone || null,
      customerEmail || null,
      notes || null,
      'scheduled'
    ];

    const result = await pool.query(query, values);
    const appointment = result.rows[0];

    console.log('[TOOL CALL] Calendar: Created appointment', {
      appointmentId: appointment.id,
      title,
      date,
      time,
      customerName
    });

    // Return success response
    res.json({
      success: true,
      message: `Appointment "${title}" created successfully for ${customerName} on ${date} at ${time}`,
      appointment: {
        id: appointment.id,
        title: appointment.title,
        date: appointment.appointment_date,
        time: appointment.appointment_time,
        duration: appointment.duration_minutes,
        customerName: appointment.customer_name,
        customerPhone: appointment.customer_phone,
        customerEmail: appointment.customer_email,
        notes: appointment.notes,
        status: appointment.status
      }
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Calendar create:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create appointment',
      message: error.message
    });
  }
});

/**
 * UPDATE APPOINTMENT
 * PUT /api/tools/calendar/update
 */
router.put('/update', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      appointmentId,
      title,
      date,
      time,
      duration,
      notes
    } = req.body;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!appointmentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: appointmentId'
      });
    }

    // Validate date format if provided
    if (date) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }
    }

    // Validate time format if provided
    if (time) {
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(time)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid time format. Use HH:MM (24-hour)'
        });
      }
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (date) {
      updates.push(`appointment_date = $${paramCount++}`);
      values.push(date);
    }
    if (time) {
      updates.push(`appointment_time = $${paramCount++}`);
      values.push(time);
    }
    if (duration) {
      updates.push(`duration_minutes = $${paramCount++}`);
      values.push(duration);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      values.push(notes);
    }

    // Always update timestamp
    updates.push(`updated_at = NOW()`);

    // Add WHERE clause parameters
    values.push(appointmentId);
    values.push(tenant_id);  // ✅ From middleware, NOT from LLM

    const query = `
      UPDATE appointments
      SET ${updates.join(', ')}
      WHERE id = $${paramCount++} AND tenant_id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found or access denied'
      });
    }

    const appointment = result.rows[0];

    console.log('[TOOL CALL] Calendar: Updated appointment', {
      appointmentId: appointment.id,
      updates: Object.keys(req.body).filter(k => k !== 'appointmentId' && k !== 'tenantId')
    });

    res.json({
      success: true,
      message: `Appointment updated successfully`,
      appointment: {
        id: appointment.id,
        title: appointment.title,
        date: appointment.appointment_date,
        time: appointment.appointment_time,
        duration: appointment.duration_minutes,
        customerName: appointment.customer_name,
        customerPhone: appointment.customer_phone,
        customerEmail: appointment.customer_email,
        notes: appointment.notes,
        status: appointment.status
      }
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Calendar update:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update appointment',
      message: error.message
    });
  }
});

/**
 * DELETE APPOINTMENT
 * DELETE /api/tools/calendar/delete
 */
router.delete('/delete', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;
    const { appointmentId } = req.body;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!appointmentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: appointmentId'
      });
    }

    // Soft delete by updating status to 'cancelled'
    const query = `
      UPDATE appointments
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [appointmentId, tenant_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found or access denied'
      });
    }

    const appointment = result.rows[0];

    console.log('[TOOL CALL] Calendar: Deleted appointment', {
      appointmentId: appointment.id,
      title: appointment.title
    });

    res.json({
      success: true,
      message: `Appointment "${appointment.title}" has been cancelled successfully`,
      appointment: {
        id: appointment.id,
        title: appointment.title,
        status: appointment.status
      }
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Calendar delete:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete appointment',
      message: error.message
    });
  }
});

/**
 * SEARCH APPOINTMENTS
 * GET /api/tools/calendar/search
 */
router.get('/search', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      startDate,
      endDate,
      customerName
    } = req.query;

    // Build dynamic query (NO tenantId validation - injected by middleware!)
    const conditions = ['tenant_id = $1', "status != 'cancelled'"];
    const values = [tenant_id];  // ✅ From middleware, NOT from LLM
    let paramCount = 2;

    if (startDate) {
      conditions.push(`appointment_date >= $${paramCount++}`);
      values.push(startDate);
    }

    if (endDate) {
      conditions.push(`appointment_date <= $${paramCount++}`);
      values.push(endDate);
    }

    if (customerName) {
      conditions.push(`customer_name ILIKE $${paramCount++}`);
      values.push(`%${customerName}%`);
    }

    const query = `
      SELECT
        id,
        title,
        appointment_date,
        appointment_time,
        duration_minutes,
        customer_name,
        customer_phone,
        customer_email,
        notes,
        status,
        created_at
      FROM appointments
      WHERE ${conditions.join(' AND ')}
      ORDER BY appointment_date ASC, appointment_time ASC
      LIMIT 50
    `;

    const result = await pool.query(query, values);

    console.log('[TOOL CALL] Calendar: Search appointments', {
      filters: { startDate, endDate, customerName },
      resultsFound: result.rows.length
    });

    const appointments = result.rows.map(apt => ({
      id: apt.id,
      title: apt.title,
      date: apt.appointment_date,
      time: apt.appointment_time,
      duration: apt.duration_minutes,
      customerName: apt.customer_name,
      customerPhone: apt.customer_phone,
      customerEmail: apt.customer_email,
      notes: apt.notes,
      status: apt.status,
      createdAt: apt.created_at
    }));

    res.json({
      success: true,
      message: `Found ${appointments.length} appointment(s)`,
      appointments,
      count: appointments.length
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Calendar search:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search appointments',
      message: error.message
    });
  }
});

module.exports = router;
