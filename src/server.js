/**
 * INBOUNDAI365 TOOLS API
 *
 * Standalone microservice for ElevenLabs tool calling.
 * Handles webhook calls from AI agents for calendar, kanban, database, communication, and document operations.
 *
 * Architecture: Multi-tenant with agent-based authentication
 * Security: Agent ID → Tenant ID resolution (server-side only)
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS for all origins (ElevenLabs webhooks)
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined')); // HTTP request logging

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'inboundai365-tools-api',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/calendar', require('./routes/calendar.routes'));
app.use('/api/kanban', require('./routes/kanban.routes'));
app.use('/api/database', require('./routes/database.routes'));
app.use('/api/communication', require('./routes/communication.routes'));
app.use('/api/document', require('./routes/document.routes'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🚀 INBOUNDAI365 TOOLS API');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔒 Security: Agent-based authentication enabled`);
  console.log('');
  console.log('📋 Available Routes:');
  console.log('   - /api/calendar/*');
  console.log('   - /api/kanban/*');
  console.log('   - /api/database/*');
  console.log('   - /api/communication/*');
  console.log('   - /api/document/*');
  console.log('');
  console.log('✅ Ready to receive ElevenLabs webhook calls');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
});

module.exports = app;
