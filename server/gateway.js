import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, fetchService, SERVICE_PORTS, readBody } from './core.js'
import { loadConf, identityHeaders, identityOf, callSvc, json } from './lib.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const conf = loadConf()

const ROUTE_TARGETS = [
  { prefix: '/api/auth/', service: 'auth', noAuth: true },
  { prefix: '/api/session', service: 'workspace' },
  { prefix: '/api/users', service: 'workspace' },
  { prefix: '/api/settings', service: 'workspace' },
  { prefix: '/api/notifications', service: 'workspace' },
  { prefix: '/api/activity', service: 'workspace' },
  { prefix: '/api/customers', service: 'crm' },
  { prefix: '/api/customer-history', service: 'crm' },
  { prefix: '/api/tickets', service: 'crm' },
  { prefix: '/api/leads', service: 'sales' },
  { prefix: '/api/deals', service: 'sales' },
  { prefix: '/api/products', service: 'catalog' },
  { prefix: '/api/inventory', service: 'catalog' },
  { prefix: '/api/invoices', service: 'finance' },
  { prefix: '/api/expenses', service: 'finance' },
  { prefix: '/api/tasks', service: 'tasks' },
  { prefix: '/api/projects', service: 'tasks' },
  { prefix: '/api/dashboard', service: 'analytics' },
  { prefix: '/api/reports', service: 'analytics' },
  { prefix: '/api/export', service: 'analytics' },
  { prefix: '/api/kpi', service: 'analytics' },
  { prefix: '/api/ai/', service: 'ai' },
  { prefix: '/api/automation', service: 'automation' },
  { prefix: '/api/import', service: 'import' },
  { prefix: '/api/bootstrap', service: 'import' },
  { prefix: '/api/documents', service: 'documents' },
  { prefix: '/api/folders', service: 'documents' },
]

function targetFor(pathname) {
  return ROUTE_TARGETS.find((r) => pathname.startsWith(r.prefix)) || null
}

async function resolveIdentity(token) {
  if (!token) return null
  try {
    const v = await callSvc(conf, 'auth', 'GET', `/internal/verify?token=${encodeURIComponent(token)}`)
    if (v.status !== 200 || !v.data) return null
    const { userId, tenantId } = v.data
    const r = await callSvc(conf, 'workspace', 'GET', `/internal/resolve?tid=${encodeURIComponent(tenantId)}&uid=${userId}`)
    if (r.status !== 200 || !r.data) return null
    return r.data
  } catch {
    return null
  }
}

async function forward(res, service, method, pathname, body, identity, authHeaders) {
  const extraHeaders = {}
  if (identity) {
    const h = identityHeaders(conf, identity.user, identity.org)
    Object.assign(extraHeaders, h)
  }
  if (authHeaders && authHeaders.authorization) Object.assign(extraHeaders, authHeaders)
  try {
    const r = await fetchService(service, pathname, { method, body, headers: { ...extraHeaders } })
    if (r.type && r.type.includes('application/json')) {
      json(res, r.status, r.data)
    } else {
      res.writeHead(r.status, {
        'Content-Type': r.type || 'application/octet-stream',
        'Content-Length': r.raw.length,
        ...(r.headers['content-disposition'] ? { 'Content-Disposition': r.headers['content-disposition'] } : {}),
      })
      res.end(r.raw)
    }
  } catch (e) {
    json(res, 502, { error: `Service unavailable (${service}): ${e.message}` })
  }
}

const handlers = {
  'GET /api/health': async (req, res) => {
    json(res, 200, { ok: true, services: Object.keys(SERVICE_PORTS) })
  },
  'POST /api/webhooks/:provider': async (req, res, parts) => {
    const provider = String(parts[2] || '').toLowerCase()
    const body = await readBody(req)
    const secret = String(req.headers['x-webhook-secret'] || '')
    if (!provider) return json(res, 400, { error: 'Missing webhook provider' })
    const ints = await callSvc(conf, 'workspace', 'GET', `/internal/integrations?provider=${encodeURIComponent(provider)}`)
    const integrations = (ints.data && ints.data.integrations) || []
    const match = integrations.find((x) => x.config && x.config.webhookSecret && x.config.webhookSecret === secret)
    if (!match) return json(res, 401, { error: 'Unknown provider or invalid webhook secret' })
    const tid = match.tid
    if (provider === 'payment') {
      const out = await callSvc(conf, 'finance', 'POST', '/internal/payment-webhook', {
        tid,
        provider: (body && body.provider) || 'Payment gateway',
        reference: (body && (body.reference || body.invoiceNumber || body.invoice_reference)) || '',
        amount: body && (body.amount || body.amount_paid),
        date: body && (body.paid_at || body.date),
        note: body && (body.note || body.message || 'Online payment via ' + ((body && body.channel) || 'gateway')),
      })
      return json(res, out.status, out.data)
    }
    callSvc(conf, 'workspace', 'POST', '/internal/activity', { tid, type: 'system', action: 'webhook', entityId: 0, label: `${provider} webhook received`, detail: JSON.stringify(body || {}).slice(0, 500) })
    return json(res, 200, { ok: true, received: true })
  },
}

async function handleApi(req, res, pathname, parts) {
  if (pathname === '/api/health') {
    const h = handlers['GET /api/health']
    return h(req, res)
  }
  const webhook = parts[0] === 'api' && parts[1] === 'webhooks'
  if (webhook) {
    const h = handlers['POST /api/webhooks/:provider']
    return h(req, res, parts)
  }
  const route = targetFor(pathname)
  if (!route) return json(res, 404, { error: 'Route not found' })
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const authHeaders = {}
  if (token) authHeaders.authorization = req.headers.authorization
  const identity = route.noAuth ? null : await resolveIdentity(token)
  if (!route.noAuth && !identity) return json(res, 401, { error: 'Session expired. Please log in again.' })
  const method = req.method || 'GET'
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readBody(req) : null
  return forward(res, route.service, method, pathname, body, identity, authHeaders)
}

async function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname
  if (pathname === '/app') file = '/app.html'
  const full = path.normalize(path.join(PUBLIC_DIR, file))
  if (!full.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Forbidden' })
  fs.readFile(full, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' })
    res.writeHead(200, { 'Content-Type': contentType(full) })
    res.end(data)
  })
}

function contentType(file) {
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  }
  return map[path.extname(file)] || 'application/octet-stream'
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname
  const parts = pathname.split('/').filter(Boolean)
  if (pathname.startsWith('/api/')) {
    return handleApi(req, res, pathname, parts)
  }
  return serveStatic(req, res, pathname)
})

server.listen(SERVICE_PORTS.gateway, () => {
  console.log(`[gateway] listening :${SERVICE_PORTS.gateway}`)
})