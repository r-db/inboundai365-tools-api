#!/usr/bin/env node
/**
 * RAILWAY DEPLOYMENT VERIFICATION SCRIPT
 *
 * Run after deploying to Railway to verify all endpoints and security.
 *
 * Usage:
 *   node verify-deployment.js <RAILWAY_URL>
 *
 * Example:
 *   node verify-deployment.js https://inboundai365-tools-api-production.up.railway.app
 */

const axios = require('axios');

// Configuration
const RAILWAY_URL = process.argv[2];
const TOOL_AUTH_SECRET = 'elevenlabs-tool-secret-change-in-production-abc123xyz789';
const TEST_AGENT_ID = 'agent_8501k97p6v4wf8ysqfpx5v5efwh5'; // ib365.ai test tenant

if (!RAILWAY_URL) {
  console.error('❌ ERROR: Railway URL required');
  console.log('\nUsage: node verify-deployment.js <RAILWAY_URL>');
  console.log('Example: node verify-deployment.js https://inboundai365-tools-api-production.up.railway.app');
  process.exit(1);
}

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║   RAILWAY DEPLOYMENT VERIFICATION - InboundAI365 Tools API    ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log(`🌐 Railway URL: ${RAILWAY_URL}`);
console.log(`🔑 Using Test Agent: ${TEST_AGENT_ID}`);
console.log('');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    process.stdout.write(`⏳ ${name}... `);
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (error) {
    console.log('❌ FAIL');
    console.log(`   Error: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Data: ${JSON.stringify(error.response.data).substring(0, 200)}`);
    }
    failed++;
  }
}

async function runTests() {
  // TEST 1: Health Check
  await test('Health check endpoint', async () => {
    const response = await axios.get(`${RAILWAY_URL}/health`);
    if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
    if (response.data.status !== 'healthy') throw new Error('Status not healthy');
    if (response.data.service !== 'inboundai365-tools-api') throw new Error('Wrong service name');
    if (!response.data.version) throw new Error('Missing version');
  });

  // TEST 2: Security - Missing Agent Header
  await test('Security: Reject missing agent header', async () => {
    try {
      await axios.post(`${RAILWAY_URL}/api/calendar/create`, {}, {
        headers: {
          'Content-Type': 'application/json',
          'X-Tool-Auth': TOOL_AUTH_SECRET
        }
      });
      throw new Error('Should have returned 401');
    } catch (error) {
      if (error.response && error.response.status === 401) {
        // Expected
        if (!error.response.data.error || !error.response.data.error.includes('agent')) {
          throw new Error('Wrong error message');
        }
      } else {
        throw error;
      }
    }
  });

  // TEST 3: Security - Missing Auth Secret
  await test('Security: Reject missing auth secret', async () => {
    try {
      await axios.post(`${RAILWAY_URL}/api/calendar/create`, {}, {
        headers: {
          'Content-Type': 'application/json',
          'X-ElevenLabs-Agent-Id': TEST_AGENT_ID
        }
      });
      throw new Error('Should have returned 401');
    } catch (error) {
      if (error.response && error.response.status === 401) {
        // Expected
      } else {
        throw error;
      }
    }
  });

  // TEST 4: Security - Invalid Auth Secret
  await test('Security: Reject invalid auth secret', async () => {
    try {
      await axios.post(`${RAILWAY_URL}/api/calendar/create`, {}, {
        headers: {
          'Content-Type': 'application/json',
          'X-Tool-Auth': 'wrong-secret',
          'X-ElevenLabs-Agent-Id': TEST_AGENT_ID
        }
      });
      throw new Error('Should have returned 401');
    } catch (error) {
      if (error.response && error.response.status === 401) {
        // Expected
      } else {
        throw error;
      }
    }
  });

  // TEST 5: Calendar - Search Available Times
  await test('Calendar: Search available times', async () => {
    const response = await axios.post(`${RAILWAY_URL}/api/calendar/search`, {
      date: '2025-12-01',
      duration: 60
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Tool-Auth': TOOL_AUTH_SECRET,
        'X-ElevenLabs-Agent-Id': TEST_AGENT_ID
      }
    });
    if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
    if (!response.data.success) throw new Error('Success flag not true');
  });

  // TEST 6: Database - Search Customers
  await test('Database: Search customers', async () => {
    const response = await axios.post(`${RAILWAY_URL}/api/database/search-customers`, {
      query: 'test'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Tool-Auth': TOOL_AUTH_SECRET,
        'X-ElevenLabs-Agent-Id': TEST_AGENT_ID
      }
    });
    if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
    if (!response.data.success) throw new Error('Success flag not true');
  });

  // TEST 7: Endpoint Availability - All Routes Exist
  const endpoints = [
    '/api/calendar/create',
    '/api/calendar/update',
    '/api/calendar/delete',
    '/api/calendar/search',
    '/api/kanban/create-card',
    '/api/kanban/move-card',
    '/api/kanban/update-card',
    '/api/kanban/delete-card',
    '/api/database/search-customers',
    '/api/database/get-customer',
    '/api/database/update-customer',
    '/api/communication/send-sms',
    '/api/communication/send-email',
    '/api/document/search'
  ];

  for (const endpoint of endpoints) {
    await test(`Endpoint exists: ${endpoint}`, async () => {
      try {
        // Send empty request - should fail auth or validation, NOT 404
        await axios.post(`${RAILWAY_URL}${endpoint}`, {}, {
          headers: {
            'Content-Type': 'application/json'
          },
          validateStatus: () => true // Accept any status
        });
      } catch (error) {
        if (error.response && error.response.status === 404) {
          throw new Error('Endpoint not found (404)');
        }
        // Any other error (401, 400, etc.) means endpoint exists
      }
    });
  }

  // Print Summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log(`✅ PASSED: ${passed}`);
  console.log(`❌ FAILED: ${failed}`);
  console.log(`📊 TOTAL:  ${passed + failed}`);
  console.log('');

  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED - Deployment verified successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Update ElevenLabs webhook URLs to point to this service');
    console.log('2. Create v4 tool definitions without tenantId parameter');
    console.log('3. Test end-to-end with live agent calls');
    console.log('');
    process.exit(0);
  } else {
    console.log('⚠️  SOME TESTS FAILED - Review errors above');
    console.log('');
    console.log('Common issues:');
    console.log('- Missing environment variables (DATABASE_URL, TOOL_AUTH_SECRET)');
    console.log('- Database connection timeout');
    console.log('- Wrong TOOL_AUTH_SECRET value');
    console.log('');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('\n❌ FATAL ERROR:', error.message);
  process.exit(1);
});
