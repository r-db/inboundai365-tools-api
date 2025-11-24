# InboundAI365 Tools API

**Standalone microservice for ElevenLabs AI agent tool calling.**

## Overview

Secure webhook-based API for AI agents to perform operations across:
- 📅 **Calendar** - Appointment management
- 📊 **Kanban** - Pipeline/lead management
- 💾 **Database** - Customer data operations
- 📧 **Communication** - SMS/Email sending
- 📚 **Document** - Knowledge base search

## Architecture

**Security Model:** Agent-based authentication
- Tenant resolution from `X-ElevenLabs-Agent-Id` header
- Server-side tenant context (NEVER from LLM)
- Row-level data isolation per tenant

**Database:** PostgreSQL with multi-tenant row-level security

**Deployment:** Railway (auto-deploy from master branch)

## Environment Variables

```bash
DATABASE_URL=postgresql://user:password@host:port/database
TOOL_AUTH_SECRET=your-secret-here
PORT=3001
NODE_ENV=production
```

## API Endpoints

All endpoints require:
- `X-ElevenLabs-Agent-Id` header (for tenant resolution)
- `X-Tool-Auth` header (for authentication)

### Calendar Tools
- `POST /api/calendar/create` - Create appointment
- `POST /api/calendar/update` - Update appointment
- `POST /api/calendar/delete` - Delete appointment
- `POST /api/calendar/search` - Search available times

### Kanban Tools
- `POST /api/kanban/create-card` - Create lead card
- `POST /api/kanban/move-card` - Move card between stages
- `POST /api/kanban/update-card` - Update card details
- `POST /api/kanban/delete-card` - Delete card

### Database Tools
- `POST /api/database/search-customers` - Search customer records
- `POST /api/database/get-customer` - Get specific customer
- `POST /api/database/update-customer` - Update customer details

### Communication Tools
- `POST /api/communication/send-sms` - Send SMS message
- `POST /api/communication/send-email` - Send email

### Document Tools
- `POST /api/document/search` - Search knowledge base
- `POST /api/document/query-with-prompt` - AI-powered document query

## Health Check

```bash
GET /health
```

Returns service status, version, and uptime.

## Security

✅ **Server-side tenant resolution** - Agent ID → Tenant ID mapping
✅ **Row-level isolation** - All queries scoped to tenant_id
✅ **No LLM-controlled parameters** - Security context from headers only
✅ **Authentication required** - TOOL_AUTH_SECRET validation

## Version

**v2.0.0** - Secure multi-tenant architecture (November 2025)

## Documentation

See `/Users/riscentrdb/Desktop/MASTER_DOCUMENTATION/ARCHITECTURE/SECURE_MULTI_TENANT_TOOLS_ARCHITECTURE.md`
