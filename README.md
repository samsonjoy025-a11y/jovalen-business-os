# Jovalen Business OS

**Jovalen Business OS** is an AI-powered business operating system that brings a company's customers, sales, finances, operations, employees, and business data into one connected workspace — and uses AI to turn that data into insights, recommendations, and automated actions.

This is a fully runnable, **zero-dependency** (no `npm install`) web application built as an MVP from the Jovalen Product Requirements Document (v1.1). It runs on Node.js using only built-in modules, so it works anywhere Node does, even on low-bandwidth connections.

---

## What Jovalen Business OS is

Jovalen is a single-platform OS for running a small or growing business. Instead of juggling several disconnected tools — WhatsApp for customers, Excel or Google Sheets for records, separate accounting software for money, and email for tasks — Jovalen keeps the core records of the business in one place with a single source of truth, and adds an AI layer that reads those records and answers business questions with real, cited data.

The system is multi-tenant (each business is fully isolated from every other), role-based (owner / finance / sales / staff each see and can do exactly what their role allows), and uses AI that never guesses — it grounds every answer in the actual records the user is permitted to see.

## The problem it solves

Small and medium businesses today run on a patchwork of tools that do not talk to each other. This creates:

- **Duplicate and manual data entry** — the same customer is typed into a notepad, a spreadsheet, and an invoice tool.
- **Lost information and poor visibility** — owners cannot see, in one place, how much customers owe, how much was collected, what is expiring, or who is following up on which lead.
- **Delayed decisions and missed follow-ups** — leads, invoices, and tasks slip through the cracks because there is no single reminder system.
- **Untrustworthy reporting** — numbers are scattered across apps, so "how did the month go?" takes hours to answer, and the answer is usually incomplete.
- **Operational inefficiency** — following up on money, chasing overdue invoices, and assigning work are all manual.

Jovalen replaces this fragmentation with **one connected platform**, and its AI assistant answers questions like *"How much revenue did we collect this month?"*, *"Who owes us money?"*, and *"Which expenses were not approved?"* directly from the business's own records — with citations back to the underlying data.

## Target users

The platform is designed for small and growing businesses (roughly 5–50 employees), with an emphasis on African SME workflows. The primary users are:

- **Business owners / founders** who want full visibility into revenue, expenses, customers, and team activity in one place.
- **Finance / accounting staff** who create and track invoices, record payments and expenses, and manage the approval workflow.
- **Sales teams** who manage customers, capture and follow up leads, and run a sales pipeline.
- **Operations / staff** who receive and complete tasks and submit expenses.
- **University projects & assignment reviewers** who need a complete, self-contained software system that is easy to run and demonstrates a full business-management product.

## Main features

| Area | What it includes |
|------|------------------|
| **Business Workspace** | Business profile, team members, roles & permissions, departments, notification preferences, notifications center, activity feed, guided setup checklist |
| **CRM** | Customer profiles, contact info, notes, tags, statuses, customer balances |
| **Leads & Sales Pipeline** | Lead capture, source, assignment, follow-up dates, lead → customer + deal conversion, pipeline board (qualification → proposal → negotiation → won/lost) |
| **Product Catalogue** | Products/services with pricing, SKU, unit, active/inactive — the reference data behind invoices |
| **Finance** | Invoices with line items from the catalogue, full and partial payment tracking, outstanding balances, expense recording with an approval workflow |
| **Tasks & Operations** | Tasks with assignees, due dates, priorities, status, comments, and change history |
| **Business Analytics** | Revenue, expenses, profit, outstanding invoices, invoice aging buckets, pipeline value, period filters (day/week/month/quarter/year), CSV report export |
| **Jovalen AI** | Natural-language assistant with grounded, role-scoped answers, citations to source records, and "insufficient data" handling |
| **Data Import & Automation** | CSV import for customers, leads, products, expenses and invoices with dry-run preview and duplicate detection; one-click sample data; event-based automation (lead auto-assignment + follow-up tasks, overdue-invoice alerts, overdue-task reminders) |

Roles & access control (enforced server-side, not just hidden in the UI):

- **Owner** — full access to all data and settings; manages team and automation.
- **Finance** — invoices, expenses, payments, approvals, catalogue.
- **Sales** — customers, leads, deals, tasks, and AI scoped to their own records.
- **Staff** — their own tasks, expenses, notifications, and limited AI.

## Main user journey

1. **Create the business account.** A new user signs up with a name, business name, email, and password. Jovalen creates the business workspace and the owner account with a secure scrypt-hashed password.
2. **Get set up quickly.** The dashboard shows a guided setup checklist: complete the business profile → add team members → add customers → add products → create the first invoice → ask Jovalen AI a question. Each step links to the right screen, and progress is tracked on the dashboard.
3. **Bring in existing data.** Instead of retyping spreadsheets, the user imports customers, leads, products, expenses, or invoices from a CSV file with a dry-run preview first — the app detects columns by header name, reports row-level problems, and skips duplicates.
4. **Run daily operations.** The team works in one place: customers and leads are managed in CRM; offers turn into invoices drawn from the product catalogue; payments and expenses are recorded with approval; tasks are assigned, commented on, and tracked with due dates.
5. **Get notified.** Automated workflows watch for unassigned leads, overdue invoices, and overdue tasks, creating in-app notifications that respect each user's notification preferences.
6. **Ask and decide with AI.** The owner asks Jovalen AI questions such as *"Who owes us money?"* or *"How much did we collect this month?"* and gets an answer with citations to the exact invoices, customer, or records it was based on — so decisions rest on the business's own data.
7. **Review performance.** The analytics dashboard shows revenue, expenses, profit, outstanding balances, aging buckets, and pipeline value for any period, and can export a CSV report for offline sharing.

## Technologies used

| Layer | Technology |
|-------|------------|
| Runtime | **Node.js 18+** (built-in `http`, `fs`, `crypto`) — zero npm dependencies |
| Data | **JSON file persistence** (`server/data/db.json`) with an in-memory cache and atomic writes; multi-tenant data layer |
| Auth | **scrypt password hashing** (Node `crypto`) + persistent session tokens (30-day TTL, stored in `server/data/sessions.json`) |
| API | **REST JSON API** (`/api/*`) with server-side role-based access control |
| Front-end | **Vanilla JavaScript ES modules** (no build step), HTML5, CSS3 |
| AI | **Rule-based business-intelligence engine** with intent matching, role scoping, citations, and "insufficient data" handling |

Design decisions:

- **No build step, no native modules, no `npm install`** — the project runs anywhere Node runs, which suits low-connectivity markets and simplifies running the assignment.
- **AI is a query engine, not a chat wrapper** — it answers from authorized records, cites them, and scopes by role (PRD §13). A hosted LLM can later be plugged in behind the same `/api/ai/ask` contract.

## How to run the project locally

### Requirements

- **Node.js 18 or newer** (built and tested on Node 24).
- A web browser (Chrome, Edge, Firefox, etc.).
- No `npm install` is required — the app uses only Node's built-in modules.

### On Windows (PowerShell)

```powershell
cd "C:\Users\HP\Documents\Jovalen Business OS\jovalen-app"
node server/index.js
```

Then open your browser at:

```
http://localhost:3000
```

### On Git Bash / macOS / Linux

```bash
cd "/c/Users/HP/Documents/Jovalen Business OS/jovalen-app"   # Git Bash path
# or: cd "C:\Users\HP\Documents\Jovalen Business OS\jovalen-app"
node server/index.js
```

Then open `http://localhost:3000`.

### Using a different port

```powershell
$env:PORT = 4000
node server/index.js
# now open http://localhost:4000
```

### First run

1. Open `http://localhost:3000` — you will see the login/signup page.
2. Click **Create account**, fill in your name, business name, email, and a password (at least 6 characters), and submit.
3. On the dashboard you can either:
   - **Load a sample business** (adds realistic demo customers, leads, deals, invoices, expenses, and tasks so every module is explorable immediately), or
   - start fresh and follow the **Getting started** checklist.
4. To test roles, go to **Team & Settings**, add a colleague with a Sales, Finance, or Staff role (a temporary password is generated), log out, and log back in with that account.

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
├── server/                  # Back-end
│   ├── index.js             # HTTP server + static files
│   ├── routes.js            # REST API with RBAC (application logic)
│   ├── store.js             # Multi-tenant JSON data layer
│   ├── auth.js              # scrypt hashing + persistent sessions
│   ├── seed.js              # Sample business loader
│   ├── ai.js                # Jovalen AI query engine
│   ├── automation.js        # Event-based workflows + scheduler
│   ├── csv.js               # CSV parser + column matching
│   └── data/                # db.json + sessions.json (created at runtime)
├── package.json             # Project metadata + start script
├── .gitignore               # Ignores runtime data and logs
└── README.md                # This file
```

### Notes on data

- Business data is stored in `server/data/db.json`, created automatically on first signup and **git-ignored**.
- Login sessions persist in `server/data/sessions.json` (30-day expiry), so users stay signed in across restarts.
- The `db.json` and `sessions.json` files are runtime data and are not included in this project folder — they are created the first time the server runs.