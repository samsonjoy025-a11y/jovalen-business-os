import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { json, readBody, verifyToken, signToken, scoped, can, createServer, ROLES, roleLevel, fetchService, SERVICE_PORTS } from './core.js'

export { can, json }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONF_FILE = path.join(__dirname, 'config.json')

export function loadConf() {
  let conf = {}
  try {
    conf = JSON.parse(fs.readFileSync(CONF_FILE, 'utf8'))
  } catch {}
  if (!conf.secret) {
    conf.secret = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(CONF_FILE, JSON.stringify(conf, null, 2))
  }
  if (!conf.internal) {
    conf.internal = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(CONF_FILE, JSON.stringify(conf, null, 2))
  }
  return conf
}

export function localPort(name) {
  return Number(process.env.PORT || SERVICE_PORTS[name] || 3001)
}

export function identityOf(req, conf) {
  try {
    const u = req.headers['x-jovalen-user']
    const o = req.headers['x-jovalen-org']
    const sig = req.headers['x-jovalen-sig']
    if (!u || !o || !sig) return null
    const expect = signToken({ user: u, org: o }, conf.internal)
    if (expect !== sig) return null
    return {
      user: JSON.parse(Buffer.from(u, 'base64').toString('utf8')),
      org: JSON.parse(Buffer.from(o, 'base64').toString('utf8')),
    }
  } catch {
    return null
  }
}

export function identityHeaders(conf, user, org) {
  const u = Buffer.from(JSON.stringify(user || {}), 'utf8').toString('base64')
  const o = Buffer.from(JSON.stringify(org || {}), 'utf8').toString('base64')
  return {
    'x-jovalen-user': u,
    'x-jovalen-org': o,
    'x-jovalen-sig': signToken({ user: u, org: o }, conf.internal),
  }
}

export function verifyInternal(req, conf) {
  return !!identityOf(req, conf)
}

export function bearerToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null
}

export async function callSvc(conf, name, method, pathname, body, user = null, org = null) {
  return fetchService(name, pathname, {
    method,
    body,
    headers: identityHeaders(conf, user, org),
  })
}

export function makeRouter(handlers, conf) {
  return async function (req) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const method = req.method || 'GET'
    const parts = url.pathname.split('/').filter(Boolean)
    const q = Object.fromEntries(url.searchParams.entries())
    let handler = null
    let bestScore = 0
    let params = {}
    for (const key of Object.keys(handlers)) {
      const [m, p] = key.split(' ')
      if (m !== method) continue
      const kp = p.split('/').filter(Boolean)
      if (kp.length !== parts.length) continue
      let score = 0
      const pparams = {}
      let ok = true
      for (let i = 0; i < kp.length; i++) {
        if (kp[i].startsWith(':')) pparams[kp[i].slice(1)] = parts[i]
        else if (kp[i] === parts[i]) score++
        else {
          ok = false
          break
        }
      }
      if (ok && score > bestScore) {
        bestScore = score
        handler = handlers[key]
        params = pparams
      }
    }
    if (!handler) return { code: 404, data: { error: 'Route not found' } }
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : null
    const ctx = { method, parts, query: q, params, raw: req, identity: identityOf(req, conf), conf }
    try {
      return (await handler(ctx, body)) || { code: 200, data: { ok: true } }
    } catch (e) {
      return { code: 500, data: { error: e.message } }
    }
  }
}

export function writeResult(res, out) {
  if (out === undefined || out === null) return
  if (out.raw !== undefined) {
    const headers = { 'Content-Type': out.type || 'application/octet-stream', 'Content-Length': out.raw.length }
    if (out.name) headers['Content-Disposition'] = `attachment; filename="${out.name}"`
    res.writeHead(out.code || 200, headers)
    res.end(out.raw)
    return
  }
  json(res, out.code || 200, out.data !== undefined ? out.data : out)
}

export function createService(name, handlers) {
  const conf = loadConf()
  const router = makeRouter(handlers, conf)
  const server = createServer(async (req, res) => {
    const out = await router(req)
    writeResult(res, out)
  })
  server.listen(localPort(name), () => {
    console.log(`[${name}] listening :${localPort(name)}`)
  })
  return server
}

export function ok(data) {
  return { code: 200, data }
}

export function err(code, message) {
  return { code, data: { error: message } }
}

export function guard(ctx, level) {
  const user = (ctx.identity && ctx.identity.user) || null
  const org = (ctx.identity && ctx.identity.org) || null
  if (!user || !org) return { code: 401, data: { error: 'Authentication required' } }
  if (level && !can(user, level)) return { code: 403, data: { error: 'Not permitted' } }
  return null
}

export function userOf(ctx) {
  return (ctx.identity && ctx.identity.user) || null
}

export function tenantOf(ctx) {
  return (ctx.identity && ctx.identity.org && ctx.identity.org.id) || null
}

export function orgOf(ctx) {
  return (ctx.identity && ctx.identity.org) || null
}

export function fmtScoped(ctx) {
  const u = userOf(ctx)
  return { scope: can(u, 4) ? null : u.id }
}

export function publicUser(user) {
  return user && { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt, department: user.department || '' }
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function addDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

export function activityId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function inPeriod(iso, period) {
  const d = new Date(iso || Date.now())
  if (isNaN(d.getTime())) return true
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const slice = (n) => String(iso || '').slice(0, n)
  if (period === 'day') return slice(10) === new Date().toISOString().slice(0, 10)
  if (period === 'week') {
    const now = new Date()
    const nowDay = now.getDay() || 7
    const monday = new Date(now.getTime() - (nowDay - 1) * 86400000)
    const dDay = d.getDay() || 7
    const dMonday = new Date(d.getTime() - (dDay - 1) * 86400000)
    return dMonday.toISOString().slice(0, 10) === monday.toISOString().slice(0, 10)
  }
  if (period === 'quarter') {
    const q = Math.ceil(m / 3)
    const nowQ = Math.ceil((new Date().getMonth() + 1) / 3)
    return y === new Date().getFullYear() && q === nowQ
  }
  if (period === 'year') return y === new Date().getFullYear()
  return slice(7) === new Date().toISOString().slice(0, 7)
}

export function periodLabel(period) {
  return { day: 'Today', week: 'This week', month: 'This month', quarter: 'This quarter', year: 'This year' }[period] || 'This month'
}

export function moneyCurrency(org) {
  return (org && org.currency) || 'NGN'
}

export function monthKey(dateStr) {
  return String(dateStr || '').slice(0, 7)
}

export function thisMonthKey() {
  return new Date().toISOString().slice(0, 7)
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function usersOf(store, tenantId) {
  return store.list(tenantId, 'users')
}

export function ownersAndFinanceOf(store, tenantId) {
  return store.list(tenantId, 'users').filter((u) => u.role === 'owner' || u.role === 'finance')
}

export function ownerName(store, tenantId, userId) {
  if (!userId) return 'Unassigned'
  const u = store.get(tenantId, 'users', userId)
  return u ? u.name : 'Unknown'
}

export function readScope(user) {
  return can(user, 4) ? null : (user && user.id)
}

export function money(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}