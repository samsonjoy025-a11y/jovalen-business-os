import { createStore, hashPassword, verifyPassword, can } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, publicUser, today } from '../lib.js'

const store = createStore('workspace')
const conf = loadConf()

function meta(tid) {
  const t = store.tenant(tid)
  if (!t.meta) {
    t.meta = { createdAt: new Date().toISOString(), settings: { automation: { enabled: true }, departments: [] } }
    store.save()
  }
  return t.meta
}

function orgOf(tid) {
  const m = meta(tid)
  return {
    id: tid,
    name: m.name || '',
    industry: m.industry || '',
    location: m.location || '',
    currency: m.currency || 'NGN',
    size: m.size || '1-10',
    automation: m.settings && m.settings.automation,
    departments: (m.settings && m.settings.departments) || [],
  }
}

function usersOf(tid) {
  return store.list(tid, 'users')
}

function userById(tid, uid) {
  return usersOf(tid).find((u) => u.id === uid) || null
}

function activity(tid, type, action, entityId, label, detail = '') {
  store.list(tid, 'activity').unshift({ id: activityId(), type, action, entityId, label, detail, at: new Date().toISOString() })
  store.save()
}

function notifyUser(tid, userId, type, title, body, link) {
  const target = userById(tid, userId)
  if (!target) return null
  const prefs = target.notifPrefs || {}
  const pref = prefs[type] || prefs[String(type || '').split('_')[0]]
  if (pref && pref.inapp === false) return null
  const n = store.insert(tid, 'notifications', { tenantId: tid, userId, type, title, body, link: link || '', read: false, createdAt: new Date().toISOString() })
  return n
}

function activityId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

const handlers = {
  'GET /api/session': async (ctx) => {
    const u = userOf(ctx)
    const tid = tenantOf(ctx)
    if (!u || !tid) return err(401, 'Authentication required')
    return ok({ user: publicUser(u), org: orgOf(tid) })
  },
  'GET /api/users': async (ctx) => {
    const blocked = guardOwner(ctx)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    return ok({ users: usersOf(tid).map(publicUser) })
  },
  'POST /api/users': async (ctx, body) => {
    const blocked = guardOwner(ctx)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    const name = String(b.name || '').trim()
    const email = String(b.email || '').trim().toLowerCase()
    const role = b.role || 'staff'
    const password = String(b.password || '')
    if (!name || !email || !password) return err(400, 'Name, email and a temporary password are required')
    if (!can(userOf(ctx), role === 'owner' ? 5 : 3)) return err(403, `You cannot create a ${role} user`)
    if (usersOf(tid).some((u) => u.email === email)) return err(409, 'A user with this email already exists in your business')
    const member = store.insert(tid, 'users', {
      tenantId: tid,
      name,
      email,
      passwordHash: hashPassword(password),
      role,
      department: String(b.department || '').trim(),
      createdAt: new Date().toISOString(),
    })
    activity(tid, 'user', 'created', member.id, member.name)
    return ok({ user: publicUser(member) })
  },
  'PUT /api/users/:id': async (ctx, body) => {
    const blocked = guardOwner(ctx)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const id = Number(ctx.params.id)
    const member = userById(tid, id)
    if (!member) return err(404, 'User not found')
    const b = body || {}
    if (b.department !== undefined) member.department = String(b.department || '').trim()
    if (b.role !== undefined && member.id !== userOf(ctx).id) {
      if (!['owner', 'finance', 'sales', 'staff'].includes(b.role)) return err(400, 'Invalid role')
      if (b.role !== 'owner' && usersOf(tid).filter((u) => u.role === 'owner').length === 1 && member.role === 'owner') {
        return err(400, 'Your business must keep at least one owner')
      }
      member.role = b.role
      notifyUser(tid, member.id, 'role_changed', 'Role updated', `Your role was changed to ${b.role} by ${userOf(ctx).name}.`, '#/')
      activity(tid, 'user', 'updated', member.id, member.name, `role -> ${b.role}`)
    }
    store.save()
    return ok({ user: publicUser(member) })
  },
  'DELETE /api/users/:id': async (ctx) => {
    const blocked = guardOwner(ctx)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const id = Number(ctx.params.id)
    const member = userById(tid, id)
    if (!member) return err(404, 'User not found')
    if (member.id === userOf(ctx).id) return err(400, 'You cannot remove yourself')
    if (member.role === 'owner' && usersOf(tid).filter((u) => u.role === 'owner').length === 1) {
      return err(400, 'Your business must keep at least one owner')
    }
    store.remove(tid, 'users', id)
    return ok({ ok: true })
  },
  'GET /api/settings/departments': async (ctx) => {
    const tid = tenantOf(ctx)
    return ok({ departments: meta(tid).settings.departments })
  },
  'PUT /api/settings/departments': async (ctx, body) => {
    const blocked = guardOwner(ctx)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const departments = Array.isArray(body && body.departments)
      ? body.departments.slice(0, 40).map((d) => String(d || '').trim()).filter(Boolean)
      : []
    meta(tid).settings.departments = departments
    store.save()
    return ok({ departments })
  },
  'GET /api/settings/notifications': async (ctx) => {
    const tid = tenantOf(ctx)
    const u = userById(tid, userOf(ctx).id)
    return ok({ prefs: (u && u.notifPrefs) || {} })
  },
  'PUT /api/settings/notifications': async (ctx, body) => {
    const tid = tenantOf(ctx)
    const u = userById(tid, userOf(ctx).id)
    const prefs = body && body.prefs && typeof body.prefs === 'object' ? body.prefs : {}
    const allowed = new Set(['invoice', 'task', 'expense', 'approval', 'pipeline', 'system'])
    const clean = {}
    for (const [key, val] of Object.entries(prefs)) {
      if (allowed.has(key) && val && typeof val === 'object') clean[key] = { inapp: val.inapp !== false }
    }
    u.notifPrefs = clean
    store.save()
    return ok({ prefs: u.notifPrefs })
  },
  'GET /api/settings/integrations': async (ctx) => {
    const tid = tenantOf(ctx)
    return ok({ integrations: integrationsOf(tid) })
  },
  'PUT /api/settings/integrations': async (ctx, body) => {
    const blocked = guardOwner(ctx)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    const allowed = new Set(['payment', 'whatsapp', 'accounting', 'sheets', 'email', 'calendar'])
    const clean = {}
    for (const [key, val] of Object.entries(b)) {
      if (!allowed.has(key) || !val || typeof val !== 'object') continue
      clean[key] = sanitizeIntegration(key, val)
    }
    const current = integrationsOf(tid)
    Object.assign(current, JSON.parse(JSON.stringify(clean)))
    store.list(tid, 'settings').push({ kind: 'integrations', at: new Date().toISOString(), by: userOf(ctx).id })
    store.save()
    return ok({ integrations: current })
  },
  'GET /api/settings/automation': async (ctx) => {
    const tid = tenantOf(ctx)
    return ok({ automation: meta(tid).settings.automation || { enabled: true } })
  },
  'PUT /api/settings/automation': async (ctx, body) => {
    const blocked = guardOwner(ctx)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    meta(tid).settings.automation = { enabled: !!(body && body.enabled) }
    store.save()
    return ok({ automation: meta(tid).settings.automation })
  },
  'GET /api/notifications': async (ctx) => {
    const tid = tenantOf(ctx)
    const uid = userOf(ctx).id
    const mine = store.list(tid, 'notifications').filter((n) => n.userId === uid)
    return ok({ notifications: mine.slice().reverse().map(decorate), unread: mine.filter((n) => !n.read).length })
  },
  'POST /api/notifications/read-all': async (ctx) => {
    const tid = tenantOf(ctx)
    store.list(tid, 'notifications').forEach((n) => {
      if (n.userId === userOf(ctx).id) n.read = true
    })
    store.save()
    return ok({ ok: true })
  },
  'GET /api/notifications/unread-count': async (ctx) => {
    const tid = tenantOf(ctx)
    const unread = store.list(tid, 'notifications').filter((n) => n.userId === userOf(ctx).id && !n.read).length
    return ok({ unread })
  },
  'POST /api/notifications/item/:id': async (ctx) => {
    const tid = tenantOf(ctx)
    const n = store.list(tid, 'notifications').find((x) => x.id === Number(ctx.params.id) && x.userId === userOf(ctx).id)
    if (!n) return err(404, 'Notification not found')
    n.read = true
    store.save()
    return ok({ ok: true })
  },
  'GET /api/activity': async (ctx) => {
    if (!can(userOf(ctx), 4)) return err(403, 'Not permitted')
    return ok({ activity: store.list(tenantOf(ctx), 'activity').slice(0, 25) })
  },
  'POST /internal/signup': async (ctx, body) => {
    const b = body || {}
    const orgName = String((b.org && b.org.name) || '').trim()
    const ownerName = String((b.owner && b.owner.name) || '').trim()
    const email = String((b.owner && b.owner.email) || '').trim().toLowerCase()
    if (!orgName || !ownerName || !email) return err(400, 'Business name, owner name and email are required')
    const existing = Object.keys(store.load().tenants).some((tid) => usersOf(tid).some((u) => u.email === email))
    if (existing) return { code: 409, data: { error: 'An account with this email already exists' } }
    const maxN = Object.keys(store.load().tenants).reduce((m, k) => {
      const n = Number(String(k).replace(/^t/, ''))
      return isNaN(n) ? m : Math.max(m, n)
    }, 0)
    const tid = 't' + (maxN + 1)
    meta(tid)
    const m = meta(tid)
    Object.assign(m, { name: orgName, industry: (b.org && b.org.industry) || '', location: (b.org && b.org.location) || '', currency: (b.org && b.org.currency) || 'NGN', size: (b.org && b.org.size) || '1-10' })
    const user = store.insert(tid, 'users', {
      tenantId: tid,
      name: ownerName,
      email,
      passwordHash: hashPassword(b.password || ''),
      role: 'owner',
      department: '',
      createdAt: new Date().toISOString(),
    })
    activity(tid, 'user', 'created', user.id, user.name)
    return ok({ tenantId: tid, user })
  },
  'POST /internal/credential': async (ctx, body) => {
    const b = body || {}
    const email = String(b.email || '').trim().toLowerCase()
    const password = String(b.password || '')
    for (const tid of Object.keys(store.load().tenants)) {
      const u = usersOf(tid).find((x) => x.email === email)
      if (u && verifyPassword(password, u.passwordHash)) return ok({ tenantId: tid, user: u, org: orgOf(tid) })
    }
    return err(401, 'Invalid email or password')
  },
  'GET /internal/resolve': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const uid = Number(ctx.query.uid)
    const u = userById(tid, uid)
    if (!u) return err(404, 'User not found')
    return ok({ user: u, org: orgOf(tid) })
  },
  'GET /internal/tenants': async () => {
    const list = Object.keys(store.load().tenants).map((tid) => ({ tid, ...orgOf(tid) }))
    return ok({ tenants: list })
  },
  'GET /internal/integrations': async (ctx) => {
    const provider = String(ctx.query.provider || '')
    const out = []
    for (const tid of Object.keys(store.load().tenants)) {
      const t = store.tenant(tid)
      const ints = (t.meta && t.meta.integrations) || {}
      for (const [kind, config] of Object.entries(ints)) {
        if (provider && kind !== provider) continue
        if (!config || !config.enabled) continue
        out.push({ tid, kind, config })
      }
    }
    return ok({ integrations: out })
  },
  'GET /internal/users': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    return ok({ users: usersOf(tid) })
  },
  'POST /internal/notify': async (ctx, body) => {
    const b = body || {}
    notifyUser(String(b.tid || ''), Number(b.userId), String(b.type || 'system'), String(b.title || ''), String(b.body || ''), String(b.link || ''))
    return ok({ ok: true })
  },
  'POST /internal/activity': async (ctx, body) => {
    const b = body || {}
    activity(String(b.tid || ''), String(b.type || ''), String(b.action || 'created'), Number(b.entityId || 0), String(b.label || ''), String(b.detail || ''))
    return ok({ ok: true })
  },
}

function decorate(n) {
  return { ...n, ageLabel: timeAgo(n.createdAt) }
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function integrationsOf(tid) {
  const m = meta(tid)
  if (!m.integrations) m.integrations = {}
  return m.integrations
}

function sanitizeIntegration(kind, val) {
  const out = { enabled: !!val.enabled }
  const safe = ['enabled', 'provider', 'account', 'businessPhone', 'apiKeyLast4', 'webhookSecret', 'syncMode', 'lastSyncAt', 'label', 'baseUrl', 'useWaMeLink', 'notificationTemplate']
  for (const key of Object.keys(val)) {
    if (safe.includes(key) && typeof val[key] === 'string' || key === 'enabled') out[key] = val[key]
  }
  return out
}

function sanitizeAccount(acc) {
  const out = { enabled: !!acc.enabled }
  if (acc.provider) out.provider = String(acc.provider).slice(0, 80)
  if (acc.account) out.account = String(acc.account).slice(0, 120)
  if (acc.webhookSecret) out.webhookSecret = String(acc.webhookSecret).slice(0, 200)
  return out
}

function guardOwner(ctx) {
  const u = userOf(ctx)
  const tid = tenantOf(ctx)
  if (!u || !tid) return err(401, 'Authentication required')
  if (!can(u, 5)) return err(403, 'Only the owner can manage team members')
  return null
}

createService('workspace', handlers)