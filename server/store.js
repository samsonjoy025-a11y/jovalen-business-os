import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, 'data', 'db.json')

const COLLECTIONS = ['users', 'customers', 'leads', 'deals', 'products', 'invoices', 'payments', 'expenses', 'tasks', 'notifications', 'activity']

let cache = null

function load() {
  if (cache) return cache
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    cache = JSON.parse(raw)
  } catch {
    cache = { tenants: [], seq: {} }
  }
  if (!Array.isArray(cache.tenants)) cache.tenants = []
  if (!cache.seq) cache.seq = {}
  return cache
}

export function save() {
  const db = load()
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
  fs.renameSync(tmp, DATA_FILE)
}

export function dab() {
  return load()
}

export function findTenant(tenantId) {
  return load().tenants.find((t) => t.id === tenantId) || null
}

export function findTenantByUserEmail(email) {
  for (const t of load().tenants) {
    const u = t.users.find((u) => u.email === email.toLowerCase())
    if (u) return { tenant: t, user: u }
  }
  return null
}

export function nextId(kind) {
  const db = load()
  db.seq[kind] = (db.seq[kind] || 0) + 1
  return db.seq[kind]
}

export function ensureCollection(tenant, name) {
  if (!tenant[name]) tenant[name] = []
  return tenant[name]
}

export function list(tenant, name) {
  return ensureCollection(tenant, name)
}

export function get(tenant, name, id) {
  return ensureCollection(tenant, name).find((r) => r.id === id) || null
}

export function insert(tenant, name, record) {
  const col = ensureCollection(tenant, name)
  const copy = JSON.parse(JSON.stringify(record))
  copy.id = copy.id ?? nextId(name)
  col.push(copy)
  tenant.activity = tenant.activity || []
  tenant.activity.unshift({
    id: nextId('activity'),
    type: name,
    action: 'created',
    entityId: copy.id,
    label: copy.name || copy.title || copy.email || String(copy.id),
    at: new Date().toISOString(),
  })
  save()
  return copy
}

export function update(tenant, name, id, patch) {
  const row = get(tenant, name, id)
  if (!row) return null
  Object.assign(row, JSON.parse(JSON.stringify(patch)))
  tenant.activity = tenant.activity || []
  tenant.activity.unshift({
    id: nextId('activity'),
    type: name,
    action: 'updated',
    entityId: row.id,
    label: row.name || row.title || row.email || String(row.id),
    at: new Date().toISOString(),
  })
  save()
  return row
}

export function remove(tenant, name, id) {
  const col = ensureCollection(tenant, name)
  const i = col.findIndex((r) => r.id === id)
  if (i === -1) return false
  col.splice(i, 1)
  save()
  return true
}

export function createTenant(profile) {
  const db = load()
  const tenant = {
    id: 't' + (db.tenants.length + 1),
    name: profile.name,
    industry: profile.industry || '',
    location: profile.location || '',
    currency: profile.currency || 'NGN',
    size: profile.size || '1-10',
    createdAt: new Date().toISOString(),
  }
  for (const c of COLLECTIONS) tenant[c] = []
  tenant.settings = { automation: { enabled: true } }
  db.tenants.push(tenant)
  save()
  return tenant
}

export function createUser(tenant, profile) {
  const user = {
    id: nextId('user'),
    tenantId: tenant.id,
    name: profile.name,
    email: String(profile.email || '').toLowerCase(),
    passwordHash: profile.passwordHash,
    role: profile.role || 'staff',
    department: profile.department || '',
    createdAt: new Date().toISOString(),
  }
  ensureCollection(tenant, 'users').push(user)
  tenant.activity = tenant.activity || []
  tenant.activity.unshift({ id: nextId('activity'), type: 'user', action: 'created', entityId: user.id, label: user.name, at: new Date().toISOString() })
  save()
  return user
}

export function notify(tenant, userId, type, title, body, link) {
  const target = (tenant.users || []).find((u) => u.id === userId)
  const prefs = (target && target.notifPrefs) || {}
  const pref = prefs[type] || prefs[String(type || '').split('_')[0]]
  if (pref && pref.inapp === false) return null
  const n = {
    id: nextId('notification'),
    tenantId: tenant.id,
    userId,
    type,
    title,
    body,
    link: link || '',
    read: false,
    createdAt: new Date().toISOString(),
  }
  ensureCollection(tenant, 'notifications').push(n)
  save()
  return n
}

export function resetData() {
  cache = { tenants: [], seq: {} }
  save()
}