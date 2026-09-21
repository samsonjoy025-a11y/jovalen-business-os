import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const ROLES = { owner: 5, finance: 4, sales: 3, staff: 1 }

export function roleLevel(role) {
  return ROLES[role] || 0
}

export function can(user, level) {
  return roleLevel(user && user.role) >= level
}

export function scope(user) {
  return can(user, 4) ? null : user.id
}

export function scoped(records, userId) {
  if (userId === null || userId === undefined) return records
  return records.filter((r) => r.ownerUserId === userId || r.assigneeId === userId || r.createdBy === userId)
}

function base64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unbase64url(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Buffer.from(s, 'base64')
}

export function signToken(payload, secret) {
  const enc = base64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(enc).digest('hex')
  return `${enc}.${sig}`
}

export function verifyToken(token, secret) {
  const parts = String(token || '').split('.')
  if (parts.length !== 2) return null
  const sig = crypto.createHmac('sha256', secret).update(parts[0]).digest('hex')
  if (sig !== parts[1]) return null
  try {
    const payload = JSON.parse(unbase64url(parts[0]).toString('utf8'))
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export const SERVICE_PORTS = {
  auth: 3101,
  workspace: 3102,
  crm: 3103,
  sales: 3104,
  catalog: 3105,
  finance: 3106,
  tasks: 3107,
  analytics: 3108,
  ai: 3109,
  automation: 3110,
  import: 3111,
  documents: 3112,
  gateway: 3000,
}

export function serviceHost(name) {
  const port = SERVICE_PORTS[name] || 3100
  return { host: '127.0.0.1', port }
}

export async function fetchService(name, pathname, opts = {}) {
  const target = serviceHost(name)
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) }
  const body = opts.body !== undefined ? JSON.stringify(opts.body) : null
  if (body) headers['content-length'] = Buffer.byteLength(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: target.host, port: target.port, path: pathname, method: opts.method || 'GET', headers },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const ctype = String(res.headers['content-type'] || '')
          const text = buffer.toString('utf8')
          let data = null
          if (ctype.includes('application/json')) {
            try {
              data = JSON.parse(text)
            } catch {
              data = null
            }
          }
          resolve({ status: res.statusCode || 500, data, raw: buffer, type: ctype, headers: res.headers })
        })
      }
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export function signInternal(payload, secret) {
  return signToken({ ...payload, exp: Date.now() + 60000 }, secret)
}

const SCRYPT_KEYLEN = 64

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password || ''), salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':')
  if (!salt || !hash) return false
  const candidate = crypto.scryptSync(String(password || ''), salt, SCRYPT_KEYLEN).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'))
}

export function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      chunks.push(c)
      size += c.length
      if (size > 50 * 1024 * 1024) req.destroy()
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(JSON.parse(text))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

export function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

export function createServer(handler) {
  return http.createServer((req, res) => {
    handler(req, res).catch(() => {
      try {
        json(res, 500, { error: 'Internal error' })
      } catch {}
    })
  })
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'services', 'data')

export function createStore(name) {
  const file = path.join(DATA_DIR, `${name}.json`)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  let cache = null
  function load() {
    if (cache) return cache
    try {
      cache = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      cache = { seqByKind: {}, tenants: {} }
    }
    if (!cache.seqByKind) cache.seqByKind = {}
    if (!cache.tenants) cache.tenants = {}
    return cache
  }
  function save() {
    const data = load()
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, file)
  }
  function tenant(tenantId) {
    const data = load()
    if (!data.tenants[tenantId]) data.tenants[tenantId] = {}
    return data.tenants[tenantId]
  }
  function nextId(kind) {
    const data = load()
    data.seqByKind[kind] = (data.seqByKind[kind] || 0) + 1
    return data.seqByKind[kind]
  }
  function list(tenantId, kind) {
    const t = tenant(tenantId)
    if (!t[kind]) t[kind] = []
    return t[kind]
  }
  function get(tenantId, kind, id) {
    return list(tenantId, kind).find((r) => r.id === id) || null
  }
  function insert(tenantId, kind, record) {
    const copy = JSON.parse(JSON.stringify(record))
    copy.id = copy.id ?? nextId(kind)
    list(tenantId, kind).push(copy)
    appendActivity(tenantId, kind, 'created', copy)
    save()
    return copy
  }
  function update(tenantId, kind, id, patch) {
    const row = get(tenantId, kind, id)
    if (!row) return null
    Object.assign(row, JSON.parse(JSON.stringify(patch)))
    appendActivity(tenantId, kind, 'updated', row)
    save()
    return row
  }
  function remove(tenantId, kind, id) {
    const col = list(tenantId, kind)
    const i = col.findIndex((r) => r.id === id)
    if (i === -1) return false
    col.splice(i, 1)
    save()
    return true
  }
  function appendActivity(tenantId, kind, action, rec) {
    const t = tenant(tenantId)
    if (!t.activity) t.activity = []
    t.activity.unshift({
      id: nextId('activity'),
      type: kind,
      action,
      entityId: rec.id,
      label: rec.name || rec.title || rec.email || rec.invoiceNumber || rec.subject || String(rec.id),
      at: new Date().toISOString(),
    })
  }
  function ensureTenant(tenantId, profile) {
    const t = tenant(tenantId)
    if (profile && !t.profile) t.profile = profile
    save()
    return t
  }
  return { load, save, tenant, list, get, insert, update, remove, nextId, ensureTenant, reset() { cache = { seqByKind: {}, tenants: {} }; save() } }
}

export function parseHost(url, req) {
  const raw = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const parts = raw.pathname.split('/').filter(Boolean)
  const method = req.method || 'GET'
  const q = Object.fromEntries(raw.searchParams.entries())
  return { method, parts, query: q, pathname: raw.pathname }
}