import {
  createTenant,
  list,
  get,
  insert,
  update,
  remove,
  createUser,
  notify,
  dab,
  save,
} from './store.js'
import { hashPassword, authenticate, createSession, destroySession, resolveSession } from './auth.js'
import { parseCsv, matchColumns } from './csv.js'
import { loadSampleBusiness } from './seed.js'
import { runAutomation } from './automation.js'
import { askBI, SUGGESTED_QUESTIONS } from './ai.js'

const ROLES = { owner: 5, finance: 4, sales: 3, staff: 1 }

const API = {
  json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  },
  ok(res, data) {
    return API.json(res, 200, data)
  },
  err(res, code, message) {
    return API.json(res, code, { error: message })
  },
}

function roleLevel(role) {
  return ROLES[role] || 0
}

function can(user, level) {
  return roleLevel(user.role) >= level
}

function readScope(user) {
  return can(user, 4) ? null : user.id
}

function scoped(records, userId) {
  if (userId === null) return records
  return records.filter((r) => r.ownerUserId === userId || r.assigneeId === userId || r.createdBy === userId)
}

function moneyCurrency(tenant) {
  return tenant.currency || 'NGN'
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

function monthKey(dateStr) {
  return String(dateStr || '').slice(0, 7)
}

function thisMonthKey() {
  return new Date().toISOString().slice(0, 7)
}

function activityId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function inPeriod(iso, period) {
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

function periodLabel(period) {
  return { day: 'Today', week: 'This week', month: 'This month', quarter: 'This quarter', year: 'This year' }[period] || 'This month'
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function readJson(req) {
  const body = await readBody(req)
  if (!body.length) return {}
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    return {}
  }
}

function parseHeaders(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  return token || null
}

function todayISO(invoice) {
  return { ...invoice, status: recomputeStatus(invoice) }
}

function recomputeStatus(invoice) {
  if (invoice.status === 'draft') return 'draft'
  const outstanding = (invoice.total || 0) - (invoice.paidAmount || 0)
  if (outstanding <= 0) return 'paid'
  if (invoice.paidAmount > 0) return 'partial'
  return 'sent'
}

export async function handleApi(req, res, url, method, payloadBody) {
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'api') return false

  const guarded = new Set([
    'session', 'dashboard', 'customers', 'leads', 'deals', 'products', 'invoices', 'expenses', 'tasks',
    'notifications', 'users', 'activity', 'ai', 'import', 'bootstrap', 'settings', 'export',
  ])

  let session = null
  if (guarded.has(parts[1])) {
    const token = parseHeaders(req)
    if (!token) return API.err(res, 401, 'Authentication required')
    session = resolveSession(token)
    if (!session) return API.err(res, 401, 'Invalid or expired session')
  }

  const { tenant, user } = session ? session : {}

  const scope = () => readScope(user)

  switch (parts[1]) {
    case 'auth':
      return handleAuth(req, res, parts, method, payloadBody)
    case 'session': {
      return API.ok(res, {
        user: publicUser(user),
        org: tenant && {
          id: tenant.id,
          name: tenant.name,
          industry: tenant.industry,
          location: tenant.location,
          currency: tenant.currency || 'NGN',
          size: tenant.size,
          automation: tenant.settings && tenant.settings.automation,
          departments: (tenant.settings && tenant.settings.departments) || [],
        },
      })
    }
    case 'bootstrap':
      if (parts[2] === 'seed') {
        if (!can(user, 5)) return API.err(res, 403, 'Only the owner can load the sample business')
        const existing = list(tenant, 'customers').length
        if (existing > 0) return API.err(res, 409, 'Your business already has data. Loading a sample would create duplicates.')
        loadSampleBusiness(tenant, user.id)
        return API.ok(res, { ok: true, message: 'Sample business loaded' })
      }
      break
    case 'dashboard':
      return handleDashboard(res, tenant, user, String(url.searchParams.get('period') || 'month'))
    case 'customers':
      return handleCustomers(req, res, tenant, user, parts, method, payloadBody)
    case 'leads':
      return handleLeads(req, res, tenant, user, parts, method, payloadBody)
    case 'deals':
      return handleDeals(req, res, tenant, user, parts, method, payloadBody)
    case 'products':
      return handleProducts(req, res, tenant, user, parts, method, payloadBody)
    case 'invoices':
      return handleInvoices(req, res, tenant, user, parts, method, payloadBody)
    case 'expenses':
      return handleExpenses(req, res, tenant, user, parts, method, payloadBody)
    case 'tasks':
      return handleTasks(req, res, tenant, user, parts, method, payloadBody)
    case 'notifications':
      return handleNotifications(req, res, tenant, user, parts, method, payloadBody)
    case 'users':
      return handleUsers(req, res, tenant, user, parts, method, payloadBody)
    case 'activity': {
      if (!can(user, 4)) return API.err(res, 403, 'Not permitted')
      return API.ok(res, { activity: (list(tenant, 'activity') || []).slice(0, 25) })
    }
    case 'ai': {
      if (parts[2] === 'suggested') return API.ok(res, { questions: SUGGESTED_QUESTIONS })
      if (parts[2] === 'ask') {
        if (method !== 'POST') return API.err(res, 405, 'Method not allowed')
        const body = payloadBody || {}
        if (!body.question || !body.question.trim()) return API.err(res, 400, 'A question is required')
        const result = askBI(tenant, user, body.question)
        list(tenant, 'activity').unshift({ id: activityId(), type: 'ai', action: 'asked', entityId: 0, label: String(body.question).trim().slice(0, 80), at: new Date().toISOString() })
        save()
        return API.ok(res, result)
      }
      break
    }
    case 'import': {
      const entity = parts[2] || ''
      if (!['customers', 'leads', 'products', 'expenses', 'invoices'].includes(entity)) break
      if (method !== 'POST') return API.err(res, 405, 'Method not allowed')
      if (!can(user, 3)) return API.err(res, 403, 'Not permitted')
      return handleImport(res, tenant, entity, payloadBody)
    }
    case 'export': {
      if (parts[2] === 'csv') {
        if (!can(user, 4)) return API.err(res, 403, 'Only owners and finance can export data')
        const period = String(url.searchParams.get('period') || 'month')
        const csv = buildExportCsv(tenant, period)
        return API.ok(res, { csv, filename: `jovalen-report-${period}.csv` })
      }
      break
    }
    case 'settings': {
      if (parts[2] === 'departments') {
        if (method === 'PUT') {
          if (!can(user, 5)) return API.err(res, 403, 'Only the owner can manage departments')
          const departments = Array.isArray(payloadBody.departments)
            ? payloadBody.departments.slice(0, 40).map((d) => String(d || '').trim()).filter(Boolean)
            : []
          tenant.settings = tenant.settings || {}
          tenant.settings.departments = departments
          save()
          return API.ok(res, { departments: tenant.settings.departments })
        }
        return API.ok(res, { departments: (tenant.settings && tenant.settings.departments) || [] })
      }
      if (parts[2] === 'notifications') {
        if (method === 'PUT') {
          const prefs = payloadBody.prefs && typeof payloadBody.prefs === 'object' ? payloadBody.prefs : {}
          const allowed = new Set(['invoice', 'task', 'expense', 'approval', 'pipeline', 'system'])
          const clean = {}
          for (const [key, val] of Object.entries(prefs)) {
            if (allowed.has(key) && val && typeof val === 'object') clean[key] = { inapp: val.inapp !== false }
          }
          user.notifPrefs = clean
          save()
          return API.ok(res, { prefs: user.notifPrefs })
        }
        return API.ok(res, { prefs: user.notifPrefs || {} })
      }
      if (parts[2] === 'automation') {
        if (method === 'PUT') {
          if (!can(user, 5)) return API.err(res, 403, 'Only the owner can change automation settings')
          tenant.settings = tenant.settings || {}
          tenant.settings.automation = { enabled: !!payloadBody.enabled }
          save()
          return API.ok(res, { automation: tenant.settings.automation })
        }
        return API.ok(res, { automation: (tenant.settings && tenant.settings.automation) || { enabled: true } })
      }
      break
    }
  }

  return API.err(res, 404, 'Not found')
}

function publicUser(user) {
  return user && { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt, department: user.department || '' }
}

async function handleAuth(req, res, parts, method, body) {
  const db = dab()
  if (parts[2] === 'signup' && method === 'POST') {
    const b = body || {}
    const name = String(b.name || '').trim()
    const orgName = String(b.orgName || '').trim()
    const email = String(b.email || '').trim().toLowerCase()
    const password = String(b.password || '')
    if (!name || !orgName || !email || !password) return API.err(res, 400, 'Name, business name, email and password are required')
    if (password.length < 6) return API.err(res, 400, 'Password must be at least 6 characters')
    const existing = db.tenants.some((t) => t.users.some((u) => u.email === email))
    if (existing) return API.err(res, 409, 'An account with this email already exists')

    const tenant = createTenant({
      name: orgName,
      industry: b.industry || '',
      location: b.location || '',
      currency: b.currency || 'NGN',
      size: b.size || '1-10',
    })
    const owner = createUser(tenant, { name, email, passwordHash: hashPassword(password), role: 'owner' })
    const token = createSession(owner)
    return API.ok(res, { token, user: publicUser(owner), org: { id: tenant.id, name: tenant.name, currency: tenant.currency } })
  }
  if (parts[2] === 'login' && method === 'POST') {
    const b = body || {}
    const found = authenticate(String(b.email || '').trim(), String(b.password || ''))
    if (!found) return API.err(res, 401, 'Invalid email or password')
    const token = createSession(found.user)
    return API.ok(res, { token, user: publicUser(found.user), org: { id: found.tenant.id, name: found.tenant.name, currency: found.tenant.currency } })
  }
  if (parts[2] === 'logout' && method === 'POST') {
    const token = parseHeaders(req)
    if (token) destroySession(token)
    return API.ok(res, { ok: true })
  }
  return API.err(res, 404, 'Not found')
}

function handleDashboard(res, tenant, user, period) {
  const currency = moneyCurrency(tenant)
  const currentMonth = thisMonthKey()
  const customers = list(tenant, 'customers')
  const products = list(tenant, 'products')
  const leads = scoped(list(tenant, 'leads'), readScope(user))
  const deals = scoped(list(tenant, 'deals'), readScope(user))
  const tasks = scoped(list(tenant, 'tasks'), readScope(user))

  if (!can(user, 4)) {
    const openDeals = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost')
    const openTasks = tasks.filter((t) => t.status !== 'done')
    const overdueTasks = openTasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < Date.now())
    return API.ok(res, {
      currency,
      scope: 'personal',
      metrics: {
        customers: customers.length,
        leadsOpen: leads.filter((l) => l.status !== 'converted' && l.status !== 'lost').length,
        leadsConverted: leads.filter((l) => l.status === 'converted').length,
        dealsValue: openDeals.reduce((s, d) => s + (d.amount || 0), 0),
        openTasks: openTasks.length,
        overdueTasks: overdueTasks.length,
      },
      aging: { buckets: [] },
      pipelineByStage: stageBreakdown(deals),
      recentActivity: (list(tenant, 'activity') || []).slice(0, 8),
      insights: personalInsights(tasks, leads),
    })
  }

  const invoices = list(tenant, 'invoices')
  const expenses = list(tenant, 'expenses')
  const periodInvoices = invoices.filter((i) => i.status !== 'draft' && inPeriod(i.issueDate || i.createdAt, period))
  const revenue = periodInvoices.reduce((s, i) => s + (i.paidAmount || 0), 0)
  const billed = periodInvoices.reduce((s, i) => s + i.total, 0)
  const periodExpenses = expenses.filter((e) => e.status === 'approved' && inPeriod(e.date, period))
  const expenseTotal = periodExpenses.reduce((s, e) => s + e.amount, 0)
  const outstanding = invoices
    .filter((i) => i.status !== 'paid')
    .reduce((s, i) => s + Math.max(0, (i.total || 0) - (i.paidAmount || 0)), 0)
  const openDeals = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost')
  const pipelineValue = openDeals.reduce((s, d) => s + (d.amount || 0), 0)
  const aging = agingBuckets(invoices)
  const setup = buildSetupChecklist(tenant, { customers, products, invoices })

  return API.ok(res, {
    currency,
    scope: 'business',
    period: period,
    periodLabel: periodLabel(period),
    setup,
    metrics: {
      revenue,
      billed,
      expenses: expenseTotal,
      profit: revenue - expenseTotal,
      outstanding,
      pipelineValue,
      newCustomers: customers.filter((c) => inPeriod(c.createdAt, period)).length,
      openDeals: openDeals.length,
      openTasks: tasks.filter((t) => t.status !== 'done').length,
      overdueInvoices: invoices.filter((i) => i.status !== 'paid' && i.dueDate && new Date(i.dueDate).getTime() < Date.now()).length,
    },
    aging,
    pipelineByStage: stageBreakdown(deals),
    recentActivity: (list(tenant, 'activity') || []).slice(0, 10),
    insights: businessInsights({ revenue, billed, expenseTotal, outstanding, invoices, customers, openDeals }),
  })
}

function buildSetupChecklist(tenant, { customers, products, invoices }) {
  const users = list(tenant, 'users')
  const activity = list(tenant, 'activity')
  const steps = [
    { key: 'profile', label: 'Complete your business profile', done: !!(tenant.industry && tenant.location) },
    { key: 'team', label: 'Invite your team', done: users.length > 1 },
    { key: 'data', label: 'Add customers', done: customers.length > 0 },
    { key: 'catalog', label: 'Add products to your catalogue', done: products.length > 0 },
    { key: 'invoice', label: 'Create your first invoice', done: invoices.length > 0 },
    { key: 'ai', label: 'Ask Jovalen AI a question', done: activity.some((a) => a.type === 'ai') },
  ]
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length }
}

function stageBreakdown(deals) {
  const stages = ['qualification', 'proposal', 'negotiation', 'won', 'lost']
  return stages.map((s) => ({
    stage: s,
    count: deals.filter((d) => d.stage === s).length,
    value: deals.filter((d) => d.stage === s).reduce((sum, d) => sum + (d.amount || 0), 0),
  }))
}

function agingBuckets(invoices) {
  const buckets = [
    { label: 'Current', from: 0, to: 0 },
    { label: '1-30 days', from: 1, to: 30 },
    { label: '31-60 days', from: 31, to: 60 },
    { label: '60+ days', from: 61, to: Infinity },
  ]
  const now = Date.now()
  return buckets.map((b) => {
    const items = invoices.filter((i) => {
      if (i.status === 'paid') return false
      const due = new Date(i.dueDate).getTime()
      if (!due) return false
      const days = Math.floor((now - due) / 86400000)
      if (days < 0 && b.label === 'Current') return true
      if (days < 0) return false
      return days >= b.from && days <= b.to
    })
    return { label: b.label, count: items.length, value: items.reduce((s, i) => s + Math.max(0, (i.total || 0) - (i.paidAmount || 0)), 0) }
  })
}

function personalInsights(tasks, leads) {
  const out = []
  const open = tasks.filter((t) => t.status !== 'done')
  if (open.some((t) => t.dueDate && new Date(t.dueDate).getTime() < Date.now())) out.push('You have overdue tasks that need attention.')
  const needFollow = leads.filter((l) => l.status !== 'converted' && l.status !== 'lost' && l.followUpDate && new Date(l.followUpDate) < new Date(Date.now() + 3 * 86400000))
  if (needFollow.length) out.push(`${needFollow.length} lead${needFollow.length === 1 ? '' : 's'} need${needFollow.length === 1 ? 's' : ''} follow-up soon.`)
  if (out.length === 0) out.push('You are up to date with your tasks and follow-ups.')
  return out
}

function businessInsights({ revenue, billed, expenseTotal, outstanding, invoices, customers, openDeals }) {
  const out = []
  if (outstanding > 0 && invoices.some((i) => i.status !== 'paid' && i.dueDate && new Date(i.dueDate).getTime() < Date.now())) {
    out.push('Some invoices are overdue. Collecting them faster would improve cash flow.')
  }
  if (billed > 0 && revenue < billed * 0.5) out.push('More than half of this month\'s billings have not been collected yet.')
  if (openDeals.length > 0 && openDeals.some((d) => d.closeDate && new Date(d.closeDate).getTime() < Date.now() + 14 * 86400000)) {
    out.push('Deals are closing in the next 14 days. Prioritize them to keep pipeline momentum.')
  }
  if (expenseTotal > revenue && revenue > 0) out.push('Expenses are running above collected revenue this month. Review non-essential spending.')
  if (out.length === 0) out.push('Your business is performing steadily. Keep recording transactions to get deeper insights.')
  return out
}

function findCustomer(tenant, id) {
  return get(tenant, 'customers', id)
}

async function handleCustomers(req, res, tenant, user, parts, method, body) {
  if (parts.length === 2 && method === 'GET') {
    const items = list(tenant, 'customers')
    return API.ok(res, { customers: items.map(withSummary(tenant)) })
  }
  if (parts.length === 2 && method === 'POST') {
    if (!can(user, 3)) return API.err(res, 403, 'Not permitted')
    if (!body.name || !String(body.name).trim()) return API.err(res, 400, 'Customer name is required')
    const customer = insert(tenant, 'customers', { name: String(body.name).trim(), email: body.email || '', phone: body.phone || '', status: body.status || 'active', tags: body.tags || [], notes: Array.isArray(body.notes) ? body.notes : [], createdAt: new Date().toISOString() })
    return API.ok(res, { customer })
  }
  if (parts.length === 3) {
    const id = Number(parts[2])
    if (method === 'PUT') {
      if (!can(user, 3)) return API.err(res, 403, 'Not permitted')
      const customer = update(tenant, 'customers', id, {
        name: body.name ? String(body.name).trim() : undefined,
        email: body.email !== undefined ? body.email : undefined,
        phone: body.phone !== undefined ? body.phone : undefined,
        status: body.status !== undefined ? body.status : undefined,
        tags: body.tags !== undefined ? body.tags : undefined,
        notes: body.notes !== undefined ? body.notes : undefined,
      })
      if (!customer) return API.err(res, 404, 'Customer not found')
      return API.ok(res, { customer })
    }
    if (method === 'DELETE') {
      if (!can(user, 5)) return API.err(res, 403, 'Only the owner can delete customers')
      remove(tenant, 'customers', id)
      return API.ok(res, { ok: true })
    }
  }
  return API.err(res, 405, 'Method not allowed')
}

function withSummary(tenant) {
  const invoices = list(tenant, 'invoices')
  const payments = list(tenant, 'payments')
  return function (c) {
    const customerInvoices = invoices.filter((i) => i.customerId === c.id)
    const totalInvoiced = customerInvoices.reduce((s, i) => s + (i.total || 0), 0)
    const totalPaid = customerInvoices.reduce((s, i) => s + (i.paidAmount || 0), 0)
    const lastActivity = customerInvoices.map((i) => i.issueDate || i.createdAt).concat(customerInvoices.map((i) => i.dueDate)).filter(Boolean).sort().pop() || c.createdAt
    const lastPaid = payments.filter((p) => customerInvoices.some((i) => i.id === p.invoiceId)).map((p) => p.date).sort().pop() || null
    return { ...c, balance: totalInvoiced - totalPaid, totalInvoiced, totalPaid, lastActivity: lastPaid || lastActivity }
  }
}

async function handleLeads(req, res, tenant, user, parts, method, body) {
  const scope = readScope(user)
  if (parts.length === 2 && method === 'GET') {
    const leads = scoped(list(tenant, 'leads'), scope).map((l) => ({ ...l, owner: ownerName(tenant, l.ownerUserId) }))
    return API.ok(res, { leads })
  }
  if (parts.length === 2 && method === 'POST') {
    if (!can(user, 3)) return API.err(res, 403, 'Not permitted')
    if (!body.name || !String(body.name).trim()) return API.err(res, 400, 'Lead name is required')
    const lead = insert(tenant, 'leads', {
      name: String(body.name).trim(),
      email: body.email || '',
      phone: body.phone || '',
      source: body.source || '',
      status: body.status || 'new',
      ownerUserId: body.ownerUserId || undefined,
      followUpDate: body.followUpDate || undefined,
      createdAt: new Date().toISOString(),
    })
    runAutomation(tenant)
    return API.ok(res, { lead: { ...lead, owner: ownerName(tenant, lead.ownerUserId) } })
  }
  if (parts.length === 3 || parts.length === 4) {
    const id = Number(parts[2])
    if (parts.length === 4 && parts[3] === 'convert' && method === 'POST') {
      if (!can(user, 3)) return API.err(res, 403, 'Not permitted')
      const lead = get(tenant, 'leads', id)
      if (!lead) return API.err(res, 404, 'Lead not found')
      let customer = list(tenant, 'customers').find((c) => (lead.email && c.email === lead.email) || c.name === lead.name)
      if (!customer) {
        customer = insert(tenant, 'customers', { name: lead.name, email: lead.email || '', phone: lead.phone || '', status: 'active', tags: [], createdAt: new Date().toISOString() })
      }
      const deal = insert(tenant, 'deals', {
        name: lead.name,
        customerId: customer.id,
        amount: body.amount && Number(body.amount) > 0 ? Number(body.amount) : 0,
        stage: 'qualification',
        ownerUserId: lead.ownerUserId || user.id,
        closeDate: body.closeDate || addDays(30),
        createdAt: new Date().toISOString(),
      })
      update(tenant, 'leads', id, { status: 'converted' })
      return API.ok(res, { customer, deal })
    }
    if (method === 'PUT') {
      if (!can(user, 3)) return API.err(res, 403, 'Not permitted')
      const lead = update(tenant, 'leads', id, {
        name: body.name !== undefined ? String(body.name).trim() : undefined,
        email: body.email !== undefined ? body.email : undefined,
        phone: body.phone !== undefined ? body.phone : undefined,
        source: body.source !== undefined ? body.source : undefined,
        status: body.status !== undefined ? body.status : undefined,
        ownerUserId: body.ownerUserId !== undefined ? body.ownerUserId : undefined,
        followUpDate: body.followUpDate !== undefined ? body.followUpDate : undefined,
      })
      if (!lead) return API.err(res, 404, 'Lead not found')
      runAutomation(tenant)
      return API.ok(res, { lead: { ...lead, owner: ownerName(tenant, lead.ownerUserId) } })
    }
    if (method === 'DELETE') {
      if (!can(user, 5)) return API.err(res, 403, 'Only the owner can delete leads')
      remove(tenant, 'leads', id)
      return API.ok(res, { ok: true })
    }
  }
  return API.err(res, 405, 'Method not allowed')
}

function ownerName(tenant, userId) {
  if (!userId) return 'Unassigned'
  const u = get(tenant, 'users', userId)
  return u ? u.name : 'Unknown'
}

async function handleDeals(req, res, tenant, user, parts, method, body) {
  const scope = readScope(user)
  const customers = list(tenant, 'customers')
  const decorate = (d) => ({ ...d, customerName: (customers.find((c) => c.id === d.customerId) || {}).name || '', owner: ownerName(tenant, d.ownerUserId) })
  if (parts.length === 2 && method === 'GET') {
    return API.ok(res, { deals: scoped(list(tenant, 'deals'), scope).map(decorate) })
  }
  if (parts.length === 2 && method === 'POST') {
    if (!can(user, 3)) return API.err(res, 403, 'Not permitted')
    if (!body.name || !String(body.name).trim()) return API.err(res, 400, 'Deal name is required')
    const deal = insert(tenant, 'deals', {
      name: String(body.name).trim(),
      customerId: body.customerId || null,
      amount: Number(body.amount || 0),
      stage: body.stage || 'qualification',
      ownerUserId: body.ownerUserId || user.id,
      closeDate: body.closeDate || addDays(30),
      createdAt: new Date().toISOString(),
    })
    return API.ok(res, { deal: decorate(deal) })
  }
  if (parts.length === 3) {
    const id = Number(parts[2])
    if (method === 'PUT') {
      if (!can(user, 3)) return API.err(res, 403, 'Not permitted')
      const deal = update(tenant, 'deals', id, {
        name: body.name !== undefined ? String(body.name).trim() : undefined,
        customerId: body.customerId !== undefined ? body.customerId : undefined,
        amount: body.amount !== undefined ? Number(body.amount) : undefined,
        stage: body.stage !== undefined ? body.stage : undefined,
        ownerUserId: body.ownerUserId !== undefined ? body.ownerUserId : undefined,
        closeDate: body.closeDate !== undefined ? body.closeDate : undefined,
      })
      if (!deal) return API.err(res, 404, 'Deal not found')
      return API.ok(res, { deal: decorate(deal) })
    }
    if (method === 'DELETE') {
      if (!can(user, 5)) return API.err(res, 403, 'Only the owner can delete deals')
      remove(tenant, 'deals', id)
      return API.ok(res, { ok: true })
    }
  }
  return API.err(res, 405, 'Method not allowed')
}

async function handleProducts(req, res, tenant, user, parts, method, body) {
  if (parts.length === 2 && method === 'GET') return API.ok(res, { products: list(tenant, 'products') })
  if (parts.length === 2 && method === 'POST') {
    if (!can(user, 4)) return API.err(res, 403, 'Only finance and owners can add products')
    if (!body.name || !String(body.name).trim()) return API.err(res, 400, 'Product name is required')
    const product = insert(tenant, 'products', {
      name: String(body.name).trim(),
      description: body.description || '',
      unitPrice: Number(body.unitPrice || 0),
      sku: body.sku || '',
      unit: body.unit || 'unit',
      active: body.active !== false,
    })
    return API.ok(res, { product })
  }
  if (parts.length === 3) {
    const id = Number(parts[2])
    if (method === 'PUT') {
      if (!can(user, 4)) return API.err(res, 403, 'Not permitted')
      const product = update(tenant, 'products', id, {
        name: body.name !== undefined ? String(body.name).trim() : undefined,
        description: body.description !== undefined ? body.description : undefined,
        unitPrice: body.unitPrice !== undefined ? Number(body.unitPrice) : undefined,
        sku: body.sku !== undefined ? body.sku : undefined,
        unit: body.unit !== undefined ? body.unit : undefined,
        active: body.active !== undefined ? !!body.active : undefined,
      })
      if (!product) return API.err(res, 404, 'Product not found')
      return API.ok(res, { product })
    }
    if (method === 'DELETE') {
      if (!can(user, 5)) return API.err(res, 403, 'Only the owner can delete products')
      remove(tenant, 'products', id)
      return API.ok(res, { ok: true })
    }
  }
  return API.err(res, 405, 'Method not allowed')
}

function nextInvoiceNumber(tenant) {
  const seq = tenant.invoiceSeq || 1000
  tenant.invoiceSeq = seq + 1
  return 'INV-' + (seq + 1)
}

async function handleInvoices(req, res, tenant, user, parts, method, body) {
  if (!can(user, 4)) return API.err(res, 403, 'You do not have permission to view finances')
  const customers = list(tenant, 'customers')
  const decorate = (i) => {
    const inv = todayISO(i)
    const customer = customers.find((c) => c.id === inv.customerId)
    return { ...inv, customerName: customer ? customer.name : 'Unknown', outstanding: Math.max(0, (inv.total || 0) - (inv.paidAmount || 0)) }
  }
  if (parts.length === 2 && method === 'GET') {
    let items = list(tenant, 'invoices').map(decorate)
    return API.ok(res, { invoices: items, customers })
  }
  if (parts.length === 2 && method === 'POST') {
    if (!can(user, 4)) return API.err(res, 403, 'Not permitted')
    if (!body.customerId || !Array.isArray(body.lineItems) || body.lineItems.length === 0) {
      return API.err(res, 400, 'A customer and at least one line item are required')
    }
    const customer = findCustomer(tenant, Number(body.customerId))
    if (!customer) return API.err(res, 404, 'Customer not found')
    let total = 0
    const lineItems = body.lineItems.map((li) => {
      const qty = Math.max(0, Number(li.qty || 1))
      const unitPrice = Number(li.unitPrice || 0)
      total += qty * unitPrice
      return { productId: li.productId || null, name: li.name || 'Item', qty, unitPrice, total: qty * unitPrice }
    })
    const invoice = insert(tenant, 'invoices', {
      invoiceNumber: nextInvoiceNumber(tenant),
      customerId: Number(body.customerId),
      status: 'sent',
      issueDate: today(),
      dueDate: body.dueDate || addDays(14),
      lineItems,
      total,
      paidAmount: 0,
    })
    ownersAndFinanceOf(tenant).forEach((u) => {
      if (u.id !== user.id) notify(tenant, u.id, 'invoice_created', 'New invoice', `Invoice ${invoice.invoiceNumber} for ${customer.name} was created.`, '#/invoices')
    })
    return API.ok(res, { invoice: decorate(invoice) })
  }
  if (parts.length >= 3) {
    const id = Number(parts[2])
    if (parts.length === 4 && parts[3] === 'payments' && method === 'POST') {
      const invoice = get(tenant, 'invoices', id)
      if (!invoice) return API.err(res, 404, 'Invoice not found')
      const amount = Number(body.amount || 0)
      if (amount <= 0) return API.err(res, 400, 'Payment amount must be greater than zero')
      const remaining = (invoice.total || 0) - (invoice.paidAmount || 0)
      if (amount > remaining) return API.err(res, 400, `Payment exceeds the outstanding balance of ${remaining}`)
      insert(tenant, 'payments', { invoiceId: id, amount, method: body.method || 'Bank transfer', date: body.date || today(), note: body.note || '' })
      invoice.paidAmount = (invoice.paidAmount || 0) + amount
      invoice.status = recomputeStatus(invoice)
      save()
      ownersAndFinanceOf(tenant).forEach((u) => {
        notify(tenant, u.id, 'invoice_paid', 'Payment received', `A payment of ${amount} was recorded on invoice ${invoice.invoiceNumber}.`, '#/invoices')
      })
      return API.ok(res, { invoice: decorate(invoice), payments: list(tenant, 'payments').filter((p) => p.invoiceId === id) })
    }
    if (method === 'PUT') {
      const invoice = update(tenant, 'invoices', id, {
        status: body.status !== undefined ? body.status : undefined,
        dueDate: body.dueDate !== undefined ? body.dueDate : undefined,
        customerId: body.customerId !== undefined ? Number(body.customerId) : undefined,
      })
      if (!invoice) return API.err(res, 404, 'Invoice not found')
      return API.ok(res, { invoice: decorate(invoice) })
    }
    if (method === 'DELETE') {
      if (!can(user, 5)) return API.err(res, 403, 'Only the owner can delete invoices')
      remove(tenant, 'invoices', id)
      return API.ok(res, { ok: true })
    }
  }
  return API.err(res, 405, 'Method not allowed')
}

function ownersAndFinanceOf(tenant) {
  return list(tenant, 'users').filter((u) => u.role === 'owner' || u.role === 'finance')
}

async function handleExpenses(req, res, tenant, user, parts, method, body) {
  if (parts.length === 2 && method === 'GET') {
    if (!can(user, 4) && user.role !== 'sales') {
      const mine = list(tenant, 'expenses').filter((e) => e.submittedBy === user.id)
      return API.ok(res, { expenses: mine, canApprove: false })
    }
    return API.ok(res, { expenses: list(tenant, 'expenses'), canApprove: can(user, 4) })
  }
  if (parts.length === 2 && method === 'POST') {
    if (!body.title || !String(body.title).trim()) return API.err(res, 400, 'Expense title is required')
    const amount = Number(body.amount || 0)
    if (amount <= 0) return API.err(res, 400, 'Expense amount must be greater than zero')
    const expense = insert(tenant, 'expenses', {
      title: String(body.title).trim(),
      category: body.category || 'Other',
      amount,
      date: body.date || today(),
      status: 'pending',
      submittedBy: user.id,
      submittedByName: user.name,
      approvedBy: '',
      note: body.note || '',
      createdAt: new Date().toISOString(),
    })
    ownersAndFinanceOf(tenant).forEach((u) => {
      if (u.id !== user.id) notify(tenant, u.id, 'expense_submitted', 'Expense awaiting approval', `Expense "${expense.title}" (${amount}) was submitted by ${user.name}.`, '#/approvals')
    })
    return API.ok(res, { expense })
  }
  if (parts.length === 4 && parts[3] === 'approve' && method === 'POST') {
    if (!can(user, 4)) return API.err(res, 403, 'Only finance and owners can approve expenses')
    const expense = get(tenant, 'expenses', Number(parts[2]))
    if (!expense) return API.err(res, 404, 'Expense not found')
    const approved = body.approved === true
    expense.status = approved ? 'approved' : 'rejected'
    expense.approvedBy = user.id
    expense.approvedByName = user.name
    save()
    const submitter = get(tenant, 'users', expense.submittedBy)
    if (submitter) notify(tenant, submitter.id, 'expense_' + (approved ? 'approved' : 'rejected'), approved ? 'Expense approved' : 'Expense rejected', `Your expense "${expense.title}" was ${approved ? 'approved' : 'rejected'} by ${user.name}.`, '#/expenses')
    return API.ok(res, { expense })
  }
  if (parts.length === 3 && method === 'DELETE') {
    if (!can(user, 5)) return API.err(res, 403, 'Only the owner can delete expenses')
    remove(tenant, 'expenses', Number(parts[2]))
    return API.ok(res, { ok: true })
  }
  return API.err(res, 405, 'Method not allowed')
}

async function handleTasks(req, res, tenant, user, parts, method, body) {
  const scope = readScope(user)
  const users = list(tenant, 'users')
  const names = {}
  users.forEach((u) => (names[u.id] = u.name))
  const decorate = (t) => ({
    ...t,
    assigneeName: names[t.assigneeId] || 'Unassigned',
    createdByName: names[t.createdBy] || 'Automation',
    history: (t.history || []).map((h) => ({ ...h, byName: h.byName || names[h.by] || 'Automation' })),
    comments: t.comments || [],
  })

  if (parts.length === 2 && method === 'GET') {
    return API.ok(res, { tasks: scoped(list(tenant, 'tasks'), scope).map(decorate), users: can(user, 4) ? users : users.filter((u) => u.id === user.id) })
  }
  if (parts.length === 2 && method === 'POST') {
    if (!body.title || !String(body.title).trim()) return API.err(res, 400, 'Task title is required')
    const assigneeId = body.assigneeId !== undefined && body.assigneeId !== '' ? Number(body.assigneeId) : scope
    if (assigneeId && !can(user, 4) && assigneeId !== user.id) return API.err(res, 403, 'Staff can only assign tasks to themselves')
    const task = insert(tenant, 'tasks', {
      title: String(body.title).trim(),
      description: body.description || '',
      assigneeId,
      dueDate: body.dueDate || undefined,
      priority: body.priority || 'medium',
      status: body.status || 'todo',
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      history: [{ at: new Date().toISOString(), by: user.id, byName: user.name, action: 'created' }],
    })
    if (assigneeId && assigneeId !== user.id) {
      notify(tenant, assigneeId, 'task_assigned', 'Task assigned', `Task "${task.title}" was assigned to you by ${user.name}.`, '#/tasks')
    }
    return API.ok(res, { task: decorate(task) })
  }
  if (parts.length === 4 && parts[3] === 'comments') {
    if (method !== 'POST') return API.err(res, 405, 'Method not allowed')
    const task = get(tenant, 'tasks', Number(parts[2]))
    if (!task) return API.err(res, 404, 'Task not found')
    if (!body.text || !String(body.text).trim()) return API.err(res, 400, 'Comment text is required')
    task.comments = task.comments || []
    task.comments.push({ id: activityId(), authorId: user.id, authorName: user.name, text: String(body.text).trim(), at: new Date().toISOString() })
    task.history = task.history || []
    task.history.push({ at: new Date().toISOString(), by: user.id, byName: user.name, action: 'commented' })
    save()
    return API.ok(res, { task: decorate(task) })
  }
  if (parts.length === 3) {
    const id = Number(parts[2])
    const task = get(tenant, 'tasks', id)
    if (!task) return API.err(res, 404, 'Task not found')
    if (method === 'PUT') {
      if (!can(user, 4) && task.assigneeId !== user.id && task.createdBy !== user.id) return API.err(res, 403, 'Not permitted')
      const changes = []
      if (body.status !== undefined && body.status !== task.status && String(body.status).trim()) changes.push(`status set to ${body.status}`)
      if (body.title !== undefined && body.title !== task.title && String(body.title).trim()) changes.push(`renamed to "${String(body.title).trim()}"`)
      if (body.priority !== undefined && body.priority !== task.priority) changes.push(`priority set to ${body.priority}`)
      if (body.dueDate !== undefined && body.dueDate !== (task.dueDate || '')) changes.push(body.dueDate ? `due date set to ${body.dueDate}` : 'due date cleared')
      if (body.assigneeId !== undefined && Number(body.assigneeId) !== task.assigneeId) changes.push(`assigned to ${names[Number(body.assigneeId)] || 'Unassigned'}`)
      const updated = update(tenant, 'tasks', id, {
        title: body.title !== undefined ? String(body.title).trim() : undefined,
        description: body.description !== undefined ? body.description : undefined,
        dueDate: body.dueDate !== undefined ? body.dueDate : undefined,
        priority: body.priority !== undefined ? body.priority : undefined,
        status: body.status !== undefined ? body.status : undefined,
        assigneeId: body.assigneeId !== undefined ? Number(body.assigneeId) : undefined,
      })
      if (!updated) return API.err(res, 404, 'Task not found')
      task.history = task.history || []
      if (changes.length) task.history.push({ at: new Date().toISOString(), by: user.id, byName: user.name, action: 'updated', detail: changes.join(', ') })
      if (updated.status === 'done' && updated.assigneeId) {
        const assignee = get(tenant, 'users', updated.assigneeId)
        if (assignee && assignee.id !== user.id) notify(tenant, assignee.id, 'task_completed', 'Task completed', `Task "${updated.title}" was marked complete.`, '#/tasks')
      }
      save()
      return API.ok(res, { task: decorate(updated) })
    }
    if (method === 'DELETE') {
      if (!can(user, 5) && task.assigneeId !== user.id && task.createdBy !== user.id) return API.err(res, 403, 'Not permitted')
      remove(tenant, 'tasks', id)
      return API.ok(res, { ok: true })
    }
  }
  return API.err(res, 405, 'Method not allowed')
}

async function handleNotifications(req, res, tenant, user, parts, method) {
  const mine = list(tenant, 'notifications').filter((n) => n.userId === user.id)
  const decorate = (n) => ({ ...n, ageLabel: timeAgo(n.createdAt) })
  if (parts.length === 2 && method === 'GET') {
    return API.ok(res, { notifications: mine.slice().reverse().map(decorate), unread: mine.filter((n) => !n.read).length })
  }
  if (parts.length === 3 && parts[2] === 'read-all' && method === 'POST') {
    mine.forEach((n) => (n.read = true))
    save()
    return API.ok(res, { ok: true })
  }
  if (parts.length === 3 && parts[2] === 'unread-count') {
    return API.ok(res, { unread: mine.filter((n) => !n.read).length })
  }
  if (parts.length === 4 && parts[2] === 'item' && parts[3] && method === 'POST') {
    const n = mine.find((x) => x.id === Number(parts[3]))
    if (!n) return API.err(res, 404, 'Notification not found')
    n.read = true
    save()
    return API.ok(res, { ok: true })
  }
  return API.err(res, 405, 'Method not allowed')
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

async function handleUsers(req, res, tenant, user, parts, method, body) {
  if (!can(user, 5)) return API.err(res, 403, 'Only the owner can manage team members')
  if (parts.length === 2 && method === 'GET') return API.ok(res, { users: list(tenant, 'users').map(publicUser) })
  if (parts.length === 2 && method === 'POST') {
    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const role = body.role || 'staff'
    const password = String(body.password || '')
    if (!name || !email || !password) return API.err(res, 400, 'Name, email and a temporary password are required')
    if (!can(user, role === 'owner' ? 5 : 3)) return API.err(res, 403, `You cannot create a ${role} user`)
    if (list(tenant, 'users').some((u) => u.email === email)) return API.err(res, 409, 'A user with this email already exists in your business')
    const member = createUser(tenant, { name, email, passwordHash: hashPassword(password), role, department: String(body.department || '').trim() })
    return API.ok(res, { user: publicUser(member) })
  }
  if (parts.length === 3 && method === 'PUT') {
    const member = get(tenant, 'users', Number(parts[2]))
    if (!member) return API.err(res, 404, 'User not found')
    if (body.department !== undefined) {
      member.department = String(body.department || '').trim()
      save()
    }
    if (body.role !== undefined && member.id !== user.id) {
      if (!ROLES[body.role]) return API.err(res, 400, 'Invalid role')
      if (body.role !== 'owner' && list(tenant, 'users').filter((u) => u.role === 'owner').length === 1 && member.role === 'owner') {
        return API.err(res, 400, 'Your business must keep at least one owner')
      }
      member.role = body.role
      save()
      notify(tenant, member.id, 'role_changed', 'Role updated', `Your role was changed to ${body.role} by ${user.name}.`, '#/')
    }
    return API.ok(res, { user: publicUser(member) })
  }
  if (parts.length === 3 && method === 'DELETE') {
    const member = get(tenant, 'users', Number(parts[2]))
    if (!member) return API.err(res, 404, 'User not found')
    if (member.id === user.id) return API.err(res, 400, 'You cannot remove yourself')
    if (member.role === 'owner' && list(tenant, 'users').filter((u) => u.role === 'owner').length === 1) {
      return API.err(res, 400, 'Your business must keep at least one owner')
    }
    remove(tenant, 'users', member.id)
    return API.ok(res, { ok: true })
  }
  return API.err(res, 405, 'Method not allowed')
}

function cell(row, idx) {
  return idx === undefined ? '' : String(row[idx] || '').trim()
}

function csvLine(values) {
  return values
    .map((v) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    })
    .join(',')
}

function buildExportCsv(tenant, period) {
  const currency = moneyCurrency(tenant)
  const customers = list(tenant, 'customers')
  const nameFor = (customerId) => (customers.find((c) => c.id === customerId) || {}).name || 'Unknown'
  const lines = [csvLine(['Type', 'Reference', 'Name', 'Status', 'Issue/Date', 'Due', 'Total', 'Paid', 'Outstanding', 'Currency'])]
  list(tenant, 'invoices')
    .filter((i) => inPeriod(i.issueDate || i.createdAt, period))
    .forEach((i) => {
      const out = Math.max(0, (i.total || 0) - (i.paidAmount || 0))
      lines.push(csvLine(['Invoice', i.invoiceNumber, nameFor(i.customerId), i.status, i.issueDate || '', i.dueDate || '', i.total || 0, i.paidAmount || 0, out, currency]))
    })
  list(tenant, 'expenses')
    .filter((e) => e.status === 'approved' && inPeriod(e.date, period))
    .forEach((e) => {
      lines.push(csvLine(['Expense', '', e.title, e.status, e.date || '', '', e.amount || 0, e.amount || 0, 0, currency]))
    })
  return lines.join('\n')
}

async function handleImport(res, tenant, entity, body) {
  const raw = (body && body.csv) || ''
  if (!String(raw).trim()) {
    return API.err(res, 400, 'No CSV content provided. Send the CSV as text in the "csv" field.')
  }
  const rows = parseCsv(raw)
  if (rows.length === 0) return API.err(res, 400, 'The CSV was empty or could not be parsed')
  const kind = entity.endsWith('s') ? entity.slice(0, -1) : entity
  const headers = rows[0]
  const map = matchColumns(headers, kind)
  const dryRun = body.dryRun === true
  const errors = []
  const records = []

  const normalizeStatus = (rawStatus, fallback) => {
    const s = String(rawStatus || '').trim().toLowerCase()
    if (!s) return fallback
    const statusMap = {
      active: 'active', inactive: 'inactive', new: 'new', contacted: 'contacted', qualified: 'qualified',
      converted: 'converted', lost: 'lost', draft: 'draft', sent: 'sent', paid: 'paid', partial: 'partial',
      overdue: 'overdue', pending: 'pending', approved: 'approved', rejected: 'rejected', todo: 'todo',
      in_progress: 'in_progress', 'in progress': 'in_progress', done: 'done',
    }
    return statusMap[s] || fallback
  }

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const text = (field) => cell(r, map[field])
    const num = (field, fallback) => {
      const n = Number(String(cell(r, map[field]) || '').replace(/[^\d.-]/g, ''))
      return isNaN(n) ? fallback : n
    }

    if (kind === 'customer') {
      const name = text('name').trim()
      if (!name) {
        errors.push(`Row ${i + 1}: missing customer name`)
        continue
      }
      const existing = list(tenant, 'customers').some((c) => c.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        errors.push(`Row ${i + 1}: duplicate customer "${name}" skipped`)
        continue
      }
      records.push({
        name,
        email: text('email'),
        phone: text('phone'),
        status: normalizeStatus(text('status'), 'active'),
        tags: text('tags') ? [text('tags')] : [],
        createdAt: new Date().toISOString(),
      })
    } else if (kind === 'lead') {
      const name = text('name').trim()
      if (!name) {
        errors.push(`Row ${i + 1}: missing lead name`)
        continue
      }
      const duplicate = list(tenant, 'leads').some((l) => (l.email && l.email.toLowerCase() === text('email').toLowerCase()) || l.name.toLowerCase() === name.toLowerCase())
      if (duplicate && text('email')) {
        errors.push(`Row ${i + 1}: duplicate lead "${name}" skipped`)
        continue
      }
      records.push({
        name,
        email: text('email'),
        phone: text('phone'),
        source: text('source'),
        status: normalizeStatus(text('status'), 'new'),
        followUpDate: text('followUpDate'),
        createdAt: new Date().toISOString(),
      })
    } else if (kind === 'product') {
      const name = text('name').trim()
      if (!name) {
        errors.push(`Row ${i + 1}: missing product name`)
        continue
      }
      const existing = list(tenant, 'products').some((p) => p.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        errors.push(`Row ${i + 1}: duplicate product "${name}" skipped`)
        continue
      }
      records.push({
        name,
        description: text('description'),
        sku: text('sku'),
        unitPrice: num('unitPrice', 0),
        unit: text('unit') || 'unit',
        active: normalizeStatus(text('active'), 'active') === 'active',
      })
    } else if (kind === 'expense') {
      const title = text('name').trim()
      if (!title) {
        errors.push(`Row ${i + 1}: missing expense title`)
        continue
      }
      records.push({
        title,
        category: text('category') || 'Other',
        amount: num('amount', 0),
        date: text('date') || today(),
        status: normalizeStatus(text('status'), 'pending'),
        submittedBy: tenant.users && tenant.users[0] ? tenant.users[0].id : null,
        submittedByName: tenant.users && tenant.users[0] ? tenant.users[0].name : '',
        note: text('note'),
        createdAt: new Date().toISOString(),
      })
    } else if (kind === 'invoice') {
      const customerName = text('customer').trim()
      if (!customerName) {
        errors.push(`Row ${i + 1}: missing customer name`)
        continue
      }
      const customer = list(tenant, 'customers').find((c) => c.name.toLowerCase() === customerName.toLowerCase() || (customerName.includes('@') && c.email === customerName))
      if (!customer) {
        errors.push(`Row ${i + 1}: no customer found for "${customerName}" — add the customer first`)
        continue
      }
      const qty = Math.max(1, num('qty', 1))
      const unitPrice = num('unitPrice', 0) || num('amount', 0)
      const total = qty * unitPrice
      records.push({
        invoiceNumber: text('invoiceNumber') || undefined,
        customerId: customer.id,
        status: normalizeStatus(text('status'), 'sent'),
        issueDate: text('issueDate') || today(),
        dueDate: text('dueDate') || addDays(14),
        lineItems: [{ productId: null, name: text('product') || customerName, qty, unitPrice, total }],
        total,
        paidAmount: Math.min(total, num('paidAmount', 0)),
        createdAt: new Date().toISOString(),
        _preview: `${customerName} — ${total}`,
      })
    }
  }

  if (dryRun) {
    return API.ok(res, {
      dryRun: true,
      entity,
      ready: records.length,
      errors: errors.slice(0, 50),
      total: records.length + errors.length,
      preview: records.slice(0, 20).map((rec) => rec._preview || rec.email || rec.invoiceNumber || rec.name || rec.title || rec.sku || ''),
    })
  }

  const created = records.map((rec) => (kind === 'invoice' ? insertInvoiceRecord(tenant, rec) : insert(tenant, entity, rec)))
  return API.ok(res, {
    entity,
    imported: created.length,
    skipped: errors.length,
    errors: errors.slice(0, 50),
    total: created.length + errors.length,
  })
}

function insertInvoiceRecord(tenant, rec) {
  const { invoiceNumber, ...rest } = rec
  const invoice = insert(tenant, 'invoices', { ...rest, invoiceNumber: invoiceNumber || nextInvoiceNumber(tenant) })
  if (invoice.paidAmount > 0) {
    insert(tenant, 'payments', { invoiceId: invoice.id, amount: invoice.paidAmount, method: 'CSV import', date: invoice.issueDate, note: '' })
  }
  return invoice
}

export { API, ownersAndFinanceOf }