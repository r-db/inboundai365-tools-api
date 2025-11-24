/**
 * Database Configuration
 * PostgreSQL connection pool for tools API
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum pool connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on('connect', () => {
  console.log('[DATABASE] Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('[DATABASE] Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;
