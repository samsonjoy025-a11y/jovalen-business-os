# Jovalen Business OS

**Jovalen Business OS** is an AI-powered business operating system that brings a company's customers, sales, finances, operations, employees, and business data into one connected workspace — and uses AI to turn that data into insights, recommendations, and automated actions.

This is a fully runnable, **zero-dependency** (no `npm install`) web application built as an MVP from the Jovalen Product Requirements Document (v1.1). It runs on Node.js using only built-in modules.

---

## What Jovalen Business OS is

Jovalen is a single-platform OS for running a small or growing business. Instead of juggling several disconnected tools — WhatsApp for customers, Excel or Google Sheets for records, separate accounting software for money, and email for tasks — Jovalen keeps the core records of the business in one place with a single source of truth, and adds an AI layer that reads those records and answers business questions with real, cited data.

The system is **multi-tenant** (each business is fully isolated from every other) and **role-based** (owner / finance / sales / staff each see and can do exactly what their role allows), and its AI never guesses — it grounds every answer in the actual records the user is permitted to see.

## Architecture

Jovalen is built as a system of small, independent Node.js processes that communicate locally. An API gateway is the single entry point for the browser and external webhooks; it authenticates each request and routes it to the right service.

| Component | Port | Responsibility |
|-----------|------|----------------|
| **Gateway** | 3000 | Serves the SPA, authenticates API calls, routes to services, handles webhooks. Single public entry point. |
| auth-service | 3101 | Signup, login, logout, session tokens (30-day TTL), internal token verification. |
| workspace-service | 3102 | Business profile, settings, users & roles, departments, notifications, activity feed, integrations. |
| crm-service | 3103 | Customers, notes, tickets, customer history. |
| sales-service | 3104 | Leads, deals, sales pipeline, lead conversion. |
| catalog-service | 3105 | Products, inventory/stock levels, purchase orders. |
| finance-service | 3106 | Invoices, payments, expenses, approvals, aging. |
| tasks-service | 3107 | Tasks, projects, comments, attachments, change history. |
| analytics-service | 3108 | Dashboard, reports, KPIs, CSV export. Aggregates across services. |
| ai-service | 3109 | Jovalen AI: intent matching, role-scoped answers with citations. |
| automation-service | 3110 | Lead auto-assignment, follow-up tasks, overdue-invoice/task alerts. |
| import-service | 3111 | CSV import (dry-run + commit) for customers/leads/products/invoices/expenses; sample-data seeder. |
| documents-service | 3112 | Document & folder library with file storage. |

The launcher (`server/start.js`) spawns every service and the gateway and keeps them running together. Each service persists its own data to a JSON store under `server/services/data/` (auto-created and git-ignored).

## Main features

| Area | What it includes |
|------|------------------|
| **Business Workspace** | Business profile, team members, roles & permissions, departments, notification preferences, notifications center, activity feed, guided setup checklist |
| **CRM** | Customer profiles, contact info, notes, tags, statuses, customer balances |
| **Leads & Sales Pipeline** | Lead capture, source, assignment, follow-up dates, lead → customer + deal conversion, pipeline board (qualification → proposal → negotiation → won/lost) |
| **Product Catalogue** | Products/services with pricing, SKU, unit, stock levels, active/inactive — the reference data behind invoices |
| **Finance** | Invoices with line items from the catalogue, full and partial payment tracking, outstanding balances, expense recording with an approval workflow, invoice aging |
| **Tasks & Operations** | Tasks with assignees, due dates, priorities, status, comments, change history; projects |
| **Business Analytics** | Revenue, expenses, profit, outstanding invoices, invoice aging buckets, pipeline value, period filters (day/week/month/quarter/year), CSV report export |
| **Jovalen AI** | Natural-language assistant with grounded, role-scoped answers, citations to source records, and "insufficient data" handling |
| **Data Import & Automation** | CSV import for customers, leads, products, expenses and invoices with dry-run preview and duplicate detection; one-click sample data; event-based automation |
| **Integrations & Webhooks** | Provider credentials management (payment, WhatsApp, accounting, sheets, email, calendar) and an authenticated webhook endpoint (`POST /api/webhooks/:provider`) — e.g. payment gateways report payments against invoices automatically. |

Roles & access control are enforced server-side, not just hidden in the UI:

- **Owner** — full access to all data and settings; manages team, automation, and integrations.
- **Finance** — invoices, expenses, payments, approvals, catalogue.
- **Sales** — customers, leads, deals, tasks, and AI scoped to their own records.
- **Staff** — their own tasks, expenses, notifications, and limited AI.

## Technologies used

| Layer | Technology |
|-------|------------|
| Runtime | **Node.js 18+** (built-in `http`, `fs`, `crypto`) — zero npm dependencies |
| Data | **JSON file persistence** — one store per service under `server/services/data/`, with in-memory cache and atomic writes |
| Auth | **scrypt password hashing** (Node `crypto`) + opaque session tokens (30-day TTL) |
| API | **REST JSON API** (`/api/*`) with server-side role-based access control, routed through a single gateway |
| Front-end | **Vanilla JavaScript ES modules** (no build step), HTML5, CSS3 |
| AI | **Rule-based business-intelligence engine** with intent matching, role scoping, citations, and "insufficient data" handling |

Design decisions:

- **No build step, no native modules, no `npm install`** — the project runs anywhere Node runs, which suits low-connectivity markets and simplifies running the assignment.
- **Every option squares with the PRD** (v1.1): roles §6, notifications §10, automation §11, analytics §12, AI §13, import §16, integrations §17, documents, projects, and inventory included as completed modules.
- **AI is a query engine, not a chat wrapper** — it answers from authorized records, cites them, and scopes by role. A hosted LLM can later be plugged in behind the same `/api/ai/ask` contract.

## How to run the project locally

### Requirements

- **Node.js 18 or newer** (built and tested on Node 24).
- A web browser (Chrome, Edge, Firefox, etc.).
- No `npm install` is required — the app uses only Node's built-in modules.

### Start everything

```bash
npm start
# or directly: node server/start.js
```

Then open your browser at:

```
http://localhost:3000
```

### Migrating data from the legacy monolith

If you have data from the earlier single-server version (`server/data/db.json` + `server/data/sessions.json`), run the migration first:

```bash
npm run migrate
```

The launcher also detects legacy data automatically on boot and migrates it before starting the services.

### First run

1. Open `http://localhost:3000` — you will see the login/signup page.
2. Click **Create account**, fill in your name, business name, email, and a password (at least 6 characters), and submit.
3. On the dashboard you can either:
   - **Seed demo data** (adds realistic demo customers, leads, deals, invoices, expenses, and tasks so every module is explorable immediately), or
   - start fresh and follow the **Getting started** checklist.
4. To test roles, go to **Team & Settings**, add a colleague with a Sales, Finance, or Staff role, log out, and log back in with that account.

### Using a different HTTP port

Set `PORT` before starting — the gateway and every service share the shift:

```powershell
$env:PORT = 4000
npm start
```

### Project structure

```
jovalen-app/
├── public/                  # Browser app (static files, no build)
│   ├── index.html           # Login / signup page
│   ├── app.html             # SPA shell
│   ├── css/app.css          # Styles
│   └── js/
│       ├── api.js           # HTTP client + formatting helpers
│       ├── auth.js          # Login / signup logic
│       ├── app.js           # SPA router, navigation, event delegation
│       └── views/           # One module per screen
├── server/
│   ├── start.js             # Launcher: spawns all services + gateway
│   ├── gateway.js           # API gateway: auth, routing, webhooks, static files
│   ├── core.js              # Shared runtime: HTTP server, stores, tokens, RBAC
│   ├── lib.js               # Shared libraries for services (conf, identity, calls)
│   ├── migrate.js           # Legacy data → per-service stores
│   ├── config.json          # Secrets (auto-generated if missing, git-ignored)
│   └── services/            # Independent service processes
│       ├── auth-service.js          └── automation-service.js
│       ├── workspace-service.js      └── import-service.js
│       ├── crm-service.js            └── documents-service.js
│       ├── sales-service.js
│       ├── catalog-service.js
│       ├── finance-service.js
│       ├── tasks-service.js
│       ├── analytics-service.js
│       └── ai-service.js
├── package.json             # Project metadata + start scripts
├── .gitignore               # Ignores runtime data, secrets, and logs
└── README.md                # This file
```

### Notes on data

- Each service persists its own data to `server/services/data/*.json`, created automatically on first run and **git-ignored**.
- Login sessions persist with a 30-day expiry, so users stay signed in across restarts.
- Shared secrets live in `server/config.json`, auto-generated on first boot and **git-ignored**.