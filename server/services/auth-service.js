import crypto from 'node:crypto'
import { createStore } from '../core.js'
import { loadConf, createService, ok, err, callSvc, publicUser } from '../lib.js'

const store = createStore('auth')
const conf = loadConf()
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000

function sessions() {
  return store.list('_sessions', 'sessions')
}

function findSession(token) {
  return sessions().find((s) => s.token === token) || null
}

function newSession(token) {
  const s = sessions().filter((x) => Date.now() - (x.createdAt || 0) <= SESSION_TTL)
  if (!s.find((x) => x.token === token)) {
    store.insert('_sessions', 'sessions', { token, createdAt: Date.now() })
  }
}

export function destroySession(token) {
  const all = sessions()
  const i = all.findIndex((x) => x.token === token)
  if (i !== -1) {
    all.splice(i, 1)
    store.save()
  }
}

export function issueToken(tenantId, userId) {
  const token = cryptoRandom()
  store.insert('_sessions', 'sessions', { token: token, userId, tenantId, createdAt: Date.now() })
  return token
}

function cryptoRandom() {
  return crypto.randomBytes(32).toString('hex')
}

async function verifySession(token) {
  const s = findSession(token)
  if (!s) return null
  if (Date.now() - (s.createdAt || 0) > SESSION_TTL) {
    destroySession(token)
    return null
  }
  return { userId: s.userId, tenantId: s.tenantId }
}

async function identityFor(tenantId, userId) {
  const r = await callSvc(conf, 'workspace', 'GET', `/internal/resolve?tid=${tenantId}&uid=${userId}`)
  if (r.status !== 200 || !r.data) return null
  return r.data
}

const handlers = {
  'POST /api/auth/signup': async (ctx, body) => {
    const b = body || {}
    const name = String(b.name || '').trim()
    const orgName = String(b.orgName || '').trim()
    const email = String(b.email || '').trim().toLowerCase()
    const password = String(b.password || '')
    if (!name || !orgName || !email || !password) return err(400, 'Name, business name, email and password are required')
    if (password.length < 6) return err(400, 'Password must be at least 6 characters')
    const r = await callSvc(conf, 'workspace', 'POST', '/internal/signup', {
      org: { name: orgName, industry: b.industry || '', location: b.location || '', currency: b.currency || 'NGN', size: b.size || '1-10' },
      owner: { name, email },
      password,
    })
    if (r.status !== 200) return err(409, (r.data && r.data.error) || 'An account with this email already exists')
    const { tenantId, user } = r.data
    const token = issueToken(tenantId, user.id)
    return ok({ token, user: publicUser(user), org: { id: tenantId, name: orgName, currency: b.currency || 'NGN' } })
  },
  'POST /api/auth/login': async (ctx, body) => {
    const b = body || {}
    const email = String(b.email || '').trim().toLowerCase()
    const password = String(b.password || '')
    if (!email || !password) return err(400, 'Email and password are required')
    const r = await callSvc(conf, 'workspace', 'POST', '/internal/credential', { email, password })
    if (r.status !== 200) return err(401, 'Invalid email or password')
    const { tenantId, user } = r.data
    const token = issueToken(tenantId, user.id)
    return ok({ token, user: publicUser(user), org: { id: tenantId, name: (r.data.org && r.data.org.name) || '', currency: (r.data.org && r.data.org.currency) || 'NGN' } })
  },
  'POST /api/auth/logout': async (ctx) => {
    const token = String(ctx.raw.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (token) destroySession(token)
    return ok({ ok: true })
  },
  'GET /internal/verify': async (ctx) => {
    const token = String(ctx.query.token || '')
    const s = await verifySession(token)
    if (!s) return { code: 401, data: { error: 'Invalid or expired session' } }
    return ok(s)
  },
  'POST /internal/issue': async (ctx, body) => {
    const b = body || {}
    const token = issueToken(b.tenantId, b.userId)
    return ok({ token })
  },
}

createService('auth', handlers)

export { verifySession }