import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const OUT_DIR = path.join(__dirname, 'services', 'data')

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'))
  } catch {
    return fallback
  }
}

function write(name, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2))
}

function newStore() {
  return { seqByKind: {}, tenants: {} }
}

function initTenant(store, tid) {
  if (!store.tenants[tid]) store.tenants[tid] = {}
  return store.tenants[tid]
}

const db = read('db.json', { tenants: [], seq: 0 })

const auth = newStore()
auth.tenants._sessions = { sessions: [] }
const sessions = read('sessions.json', {})
for (const [token, meta] of Object.entries(sessions)) {
  auth.tenants._sessions.sessions.push({
    token,
    userId: meta.userId,
    tenantId: meta.tenantId,
    createdAt: meta.createdAt,
  })
}

const workspace = newStore()
const crm = newStore()
const sales = newStore()
const catalog = newStore()
const finance = newStore()
const tasks = newStore()
const documents = newStore()

for (const tenant of db.tenants || []) {
  const tid = tenant.id
  const wt = initTenant(workspace, tid)
  const ct = initTenant(crm, tid)
  const st = initTenant(sales, tid)
  const cat = initTenant(catalog, tid)
  const ft = initTenant(finance, tid)
  const tt = initTenant(tasks, tid)
  const dt = initTenant(documents, tid)

  wt.meta = {
    createdAt: tenant.createdAt || new Date().toISOString(),
    name: tenant.name || '',
    industry: tenant.industry || '',
    location: tenant.location || '',
    currency: tenant.currency || 'NGN',
    size: tenant.size || '1-10',
    settings: {
      automation: (tenant.settings && tenant.settings.automation) || { enabled: true },
      departments: (tenant.settings && tenant.settings.departments) || [],
    },
    integrations: (tenant.settings && tenant.settings.integrations) || {},
  }
  wt.users = tenant.users || []
  wt.activity = tenant.activity || []
  wt.notifications = tenant.notifications || []

  ct.customers = tenant.customers || []
  ct.customerNotes = tenant.customerNotes || []
  ct.tickets = tenant.tickets || []
  ct.ticketMessages = tenant.ticketMessages || []

  st.leads = tenant.leads || []
  st.deals = tenant.deals || []

  cat.products = tenant.products || []
  cat.stock = tenant.stock || []

  ft.invoices = tenant.invoices || []
  ft.payments = tenant.payments || []
  ft.expenses = tenant.expenses || []

  tt.tasks = tenant.tasks || []
  tt.projects = tenant.projects || []

  dt.folders = tenant.folders || []
  dt.documents = tenant.documents || []
}

function seedSeq(store, kind) {
  let max = 0
  for (const t of Object.values(store.tenants)) {
    for (const r of t[kind] || []) {
      const id = Number(r.id)
      if (id > max) max = id
    }
  }
  if (max > 0) store.seqByKind[kind] = max
}

for (const store of [workspace, crm, sales, catalog, finance, tasks, documents]) {
  for (const t of Object.values(store.tenants)) {
    for (const kind of Object.keys(t)) {
      if (Array.isArray(t[kind])) seedSeq(store, kind)
    }
  }
}

write('auth.json', auth)
write('workspace.json', workspace)
write('crm.json', crm)
write('sales.json', sales)
write('catalog.json', catalog)
write('finance.json', finance)
write('tasks.json', tasks)
write('documents.json', documents)

console.log('Migration complete.')
console.log('  tenants:', (db.tenants || []).map((t) => t.id).join(', ') || '(none)')
console.log('  users:', db.tenants.reduce((s, t) => s + (t.users || []).length, 0))
console.log('  sessions: ' + Object.keys(sessions).length)
console.log('Stores written to', OUT_DIR)