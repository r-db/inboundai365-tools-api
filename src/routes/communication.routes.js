/**
 * ELEVENLABS TOOL CALLING - COMMUNICATION ROUTES (SECURE v2.0)
 *
 * Handles SMS and Email communication tool calls from ElevenLabs AI agents.
 * SECURITY: Uses agentAuth middleware to resolve tenant from agent_id.
 * LLM NEVER chooses tenant - backend injects it from database lookup.
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const agentAuth = require('../middleware/agentAuth');
const vonageService = require('../services/vonage-service');

// Apply agent authentication middleware to all communication tool routes
router.use(agentAuth);

/**
 * SEND SMS
 * POST /api/tools/communication/send-sms
 */
router.post('/send-sms', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      to,
      message,
      customerId
    } = req.body;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!to || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['to', 'message']
      });
    }

    // Validate phone number format (basic validation)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(to.replace(/[\s()-]/g, ''))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format',
        hint: 'Use E.164 format (e.g., +1234567890)'
      });
    }

    // Get tenant's Vonage configuration
    const tenantQuery = `
      SELECT vonage_api_key, vonage_api_secret, vonage_number
      FROM tenants
      WHERE tenant_id = $1
    `;
    const tenantResult = await pool.query(tenantQuery, [tenant_id]);

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found'
      });
    }

    const tenant = tenantResult.rows[0];

    // Check if Vonage is configured for this tenant
    if (!tenant.vonage_api_key || !tenant.vonage_api_secret || !tenant.vonage_number) {
      return res.status(400).json({
        success: false,
        error: 'SMS not configured for this tenant',
        message: 'Vonage API credentials are not set up'
      });
    }

    // Send SMS via Vonage
    try {
      const smsResult = await vonageService.sendSMS({
        apiKey: tenant.vonage_api_key,
        apiSecret: tenant.vonage_api_secret,
        from: tenant.vonage_number,
        to: to,
        text: message
      });

      // Log the communication in database
      const logQuery = `
        INSERT INTO communication_logs (
          tenant_id,
          customer_id,
          type,
          direction,
          to_number,
          from_number,
          message,
          status,
          external_id,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING id
      `;

      const logResult = await pool.query(logQuery, [
        tenant_id,  // ✅ From middleware, NOT from LLM
        customerId || null,
        'sms',
        'outbound',
        to,
        tenant.vonage_number,
        message,
        'sent',
        smsResult.messageId || null
      ]);

      console.log('[TOOL CALL] Communication: Sent SMS', {
        to,
        messageLength: message.length,
        logId: logResult.rows[0].id
      });

      res.json({
        success: true,
        message: `SMS sent successfully to ${to}`,
        sms: {
          id: logResult.rows[0].id,
          to,
          message,
          status: 'sent',
          messageId: smsResult.messageId
        }
      });

    } catch (smsError) {
      console.error('[TOOL CALL ERROR] Vonage SMS failed:', smsError);

      // Log failed attempt
      await pool.query(`
        INSERT INTO communication_logs (
          tenant_id,
          customer_id,
          type,
          direction,
          to_number,
          from_number,
          message,
          status,
          error_message,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `, [
        tenant_id,  // ✅ From middleware, NOT from LLM
        customerId || null,
        'sms',
        'outbound',
        to,
        tenant.vonage_number,
        message,
        'failed',
        smsError.message
      ]);

      throw new Error(`Failed to send SMS: ${smsError.message}`);
    }

  } catch (error) {
    console.error('[TOOL CALL ERROR] Communication send-sms:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send SMS',
      message: error.message
    });
  }
});

/**
 * SEND EMAIL
 * POST /api/tools/communication/send-email
 */
router.post('/send-email', async (req, res) => {
  try {
    // ✅ SECURE: Tenant ID comes from middleware, NOT from LLM!
    const { tenant_id } = req.tenantContext;

    const {
      to,
      subject,
      body,
      customerId
    } = req.body;

    // Validate required fields (NO tenantId - injected by middleware!)
    if (!to || !subject || !body) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['to', 'subject', 'body']
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email address format'
      });
    }

    // Get tenant's email configuration
    const tenantQuery = `
      SELECT email_from_address, email_from_name, smtp_configured
      FROM tenants
      WHERE tenant_id = $1
    `;
    const tenantResult = await pool.query(tenantQuery, [tenant_id]);

    if (tenantResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found'
      });
    }

    const tenant = tenantResult.rows[0];

    // Check if email is configured for this tenant
    if (!tenant.smtp_configured) {
      return res.status(400).json({
        success: false,
        error: 'Email not configured for this tenant',
        message: 'SMTP settings are not set up'
      });
    }

    // NOTE: In production, you would integrate with your email service (SendGrid, Mailgun, etc.)
    // For now, we'll log the email and return success
    // TODO: Implement actual email sending service

    // Log the email in database
    const logQuery = `
      INSERT INTO communication_logs (
        tenant_id,
        customer_id,
        type,
        direction,
        to_email,
        from_email,
        subject,
        message,
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING id
    `;

    const logResult = await pool.query(logQuery, [
      tenant_id,  // ✅ From middleware, NOT from LLM
      customerId || null,
      'email',
      'outbound',
      to,
      tenant.email_from_address || 'noreply@inboundai365.com',
      subject,
      body,
      'sent' // In production, would be 'queued' until actually sent
    ]);

    console.log('[TOOL CALL] Communication: Email logged (not sent - pending integration)', {
      to,
      subject,
      logId: logResult.rows[0].id
    });

    res.json({
      success: true,
      message: `Email queued successfully to ${to}`,
      email: {
        id: logResult.rows[0].id,
        to,
        subject,
        body,
        status: 'queued',
        note: 'Email service integration pending - email logged but not sent'
      }
    });

  } catch (error) {
    console.error('[TOOL CALL ERROR] Communication send-email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send email',
      message: error.message
    });
  }
});

module.exports = router;
