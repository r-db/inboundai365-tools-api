# Railway Deployment Guide - InboundAI365 Tools API

**Repository:** https://github.com/r-db/inboundai365-tools-api
**Service Type:** Backend API (Node.js/Express)
**Required Environment:** Production with auto-deploy from `master` branch

---

## Step 1: Create New Service in Railway

1. **Go to Railway Dashboard:** https://railway.app/dashboard
2. **Select Workspace:** "CognitivePatient0's Projects"
3. **Click:** "New Project" → "Deploy from GitHub repo"
4. **Select Repository:** `r-db/inboundai365-tools-api`
5. **Service Name:** `inboundai365-tools-api`

---

## Step 2: Configure Environment Variables

In the Railway service settings, add these **EXACT** environment variables:

```bash
# Database Connection (SHARED with backend)
DATABASE_URL=postgresql://neondb_owner:npg_5pWEIQxuLkM6@ep-lively-hat-admrjexy-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require

# Tool Authentication Secret (SHARED with backend)
TOOL_AUTH_SECRET=elevenlabs-tool-secret-change-in-production-abc123xyz789

# Server Configuration
PORT=3001
NODE_ENV=production
```

⚠️ **CRITICAL:** Use the EXACT same `DATABASE_URL` and `TOOL_AUTH_SECRET` as the backend service!

---

## Step 3: Configure Build & Deploy Settings

Railway should auto-detect from `railway.json`:

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "numReplicas": 2,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

**Start Command:** `npm start` (runs `node src/server.js`)

**Health Check Path:** `/health`

---

## Step 4: Deploy and Verify

### 4.1 Trigger First Deployment
Railway will auto-deploy after you add environment variables. Monitor the build logs.

### 4.2 Wait for Build (2-3 minutes)
Expected logs:
```
[nixpacks] Installing dependencies via npm install
[nixpacks] Build successful
[deploy] Starting service...
🚀 INBOUNDAI365 TOOLS API
📡 Server running on port 3001
```

### 4.3 Get Deployment URL
Railway will assign a public URL like:
```
https://inboundai365-tools-api-production.up.railway.app
```

**Copy this URL - you'll need it for ElevenLabs webhooks!**

---

## Step 5: Test Deployment

### 5.1 Test Health Check
```bash
curl https://YOUR-RAILWAY-URL.railway.app/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "inboundai365-tools-api",
  "version": "2.0.0",
  "timestamp": "2025-11-24T...",
  "uptime": 123.456
}
```

### 5.2 Test Calendar Endpoint (requires agent headers)
```bash
curl -X POST https://YOUR-RAILWAY-URL.railway.app/api/calendar/search \
  -H "Content-Type: application/json" \
  -H "X-Tool-Auth: elevenlabs-tool-secret-change-in-production-abc123xyz789" \
  -H "X-ElevenLabs-Agent-Id: agent_8501k97p6v4wf8ysqfpx5v5efwh5" \
  -d '{"date": "2025-12-01", "duration": 60}'
```

**Expected:** HTTP 200 with available time slots

### 5.3 Test Security (missing agent header)
```bash
curl -X POST https://YOUR-RAILWAY-URL.railway.app/api/calendar/create \
  -H "Content-Type: application/json" \
  -H "X-Tool-Auth: elevenlabs-tool-secret-change-in-production-abc123xyz789" \
  -d '{}'
```

**Expected:** HTTP 401 with `"error": "Missing agent ID in headers"`

---

## Step 6: Update ElevenLabs Webhooks

Once deployment is verified, update all tool webhook URLs from:

```
OLD: https://inboundai365-backend-production.up.railway.app/api/tools/calendar/create
NEW: https://YOUR-RAILWAY-URL.railway.app/api/calendar/create
```

**Tools to Update (14 total):**

### Calendar (4 endpoints)
- `/api/calendar/create`
- `/api/calendar/update`
- `/api/calendar/delete`
- `/api/calendar/search`

### Kanban (4 endpoints)
- `/api/kanban/create-card`
- `/api/kanban/move-card`
- `/api/kanban/update-card`
- `/api/kanban/delete-card`

### Database (3 endpoints)
- `/api/database/search-customers`
- `/api/database/get-customer`
- `/api/database/update-customer`

### Communication (2 endpoints)
- `/api/communication/send-sms`
- `/api/communication/send-email`

### Document (1 endpoint)
- `/api/document/search`

---

## Step 7: Enable Auto-Deploy

Railway should automatically deploy when you push to `master` branch.

**Verify:**
1. Settings → Deployments → "Watch Paths" = `**/*` (all files)
2. Settings → Deployments → "Auto Deploy" = **ENABLED**
3. Settings → Deployments → "Branch" = `master`

---

## Rollback Plan

If deployment fails:

1. **Check Logs:** Railway → Deployments → Latest → View Logs
2. **Common Issues:**
   - Missing environment variables (DATABASE_URL, TOOL_AUTH_SECRET)
   - Database connection timeout (check DATABASE_URL)
   - Port binding issues (ensure PORT=3001)
3. **Rollback:** Railway → Deployments → Previous → "Redeploy"

---

## Environment Variable Reference

| Variable | Source | Purpose |
|----------|--------|---------|
| `DATABASE_URL` | Backend Railway service | PostgreSQL connection (multi-tenant) |
| `TOOL_AUTH_SECRET` | Backend Railway service | Webhook authentication |
| `PORT` | Set to `3001` | HTTP server port |
| `NODE_ENV` | Set to `production` | Enable production optimizations |

---

## Architecture Notes

- **Shared Database:** Same PostgreSQL database as backend (tenant isolation via `tenant_id`)
- **Shared Auth Secret:** Same `TOOL_AUTH_SECRET` for webhook validation
- **Independent Deployment:** Separate Railway service for scaling and versioning
- **Agent Resolution:** Backend resolves `X-ElevenLabs-Agent-Id` → `tenant_id` (NEVER from LLM)

---

## Success Criteria

✅ **Deployment Successful When:**
1. Health check returns HTTP 200 with `"status": "healthy"`
2. All 14 tool endpoints respond (not 404)
3. Security test returns 401 when agent header missing
4. Database query succeeds with valid agent ID
5. Railway logs show "Server running on port 3001"
6. Auto-deploy triggers on git push to master

---

## Next Steps After Deployment

1. ✅ Update ElevenLabs webhook URLs (all 14 tools)
2. ✅ Test end-to-end with live agent call
3. ✅ Remove old `/api/tools/*` routes from backend (optional - can keep for transition)
4. ✅ Create v4 tool definitions without `tenantId` parameter
5. ✅ Test cross-tenant isolation with multiple agents

---

**Created:** 2025-11-24
**Maintained by:** PRAXIS
**Status:** Ready for deployment
