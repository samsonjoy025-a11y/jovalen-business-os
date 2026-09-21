import { createStore, can } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, guard, callSvc, inPeriod, periodLabel, monthKey, thisMonthKey, today } from '../lib.js'

const store = createStore('analytics')
const conf = loadConf()

const handlers = {
  'GET /api/dashboard': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const period = String(ctx.query.period || 'month')
    const all = await gather(tid)
    const currency = (all.org && all.org.currency) || 'NGN'
    const isBusiness = can(u, 4)
    return ok(isBusiness ? businessDashboard(all, period, currency) : personalDashboard(all, u, currency))
  },
  'GET /api/reports/sales': async (ctx) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const all = await gather(tid)
    const period = String(ctx.query.period || 'month')
    const rows = all.deals.filter((d) => inPeriod(d.createdAt || d.closedAt, period) || (d.closedAt && inPeriod(d.closedAt, period)))
      .map((d) => ({ id: d.id, name: d.name, customer: nameOf(all.customers, d.customerId), amount: d.amount || 0, stage: d.stage, owner: ownerName(all.users, d.ownerUserId), closeDate: d.closeDate || '' }))
    return ok({ rows, period, total: rows.reduce((s, r) => s + r.amount, 0) })
  },
  'GET /api/reports/revenue': async (ctx) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const all = await gather(tid)
    return ok(buildRevenue(all))
  },
  'GET /api/reports/invoices': async (ctx) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const all = await gather(tid)
    const rows = all.invoices.map((i) => ({
      id: i.id, invoiceNumber: i.invoiceNumber, customer: nameOf(all.customers, i.customerId),
      issueDate: i.issueDate, dueDate: i.dueDate, status: i.status, total: i.total, paid: i.paidAmount || 0,
      outstanding: Math.max(0, (i.total || 0) - (i.paidAmount || 0)),
    }))
    return ok({ rows })
  },
  'GET /api/reports/inventory': async (ctx) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const all = await gather(tid)
    const rows = all.products.map((p) => ({ id: p.id, name: p.name, sku: p.sku || '', onHand: p.onHand || 0, reorderLevel: p.reorderLevel || 0, unitPrice: p.unitPrice || 0, active: p.active !== false, low: (p.onHand || 0) <= (p.reorderLevel || 0) }))
    return ok({ rows })
  },
  'GET /api/export/csv': async (ctx) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const period = String(ctx.query.period || 'month')
    const all = await gather(tid)
    const currency = (all.org && all.org.currency) || 'NGN'
    const csv = buildExportCsv(all, period, currency)
    return ok({ csv, filename: `jovalen-report-${period}.csv` })
  },
  'GET /api/kpi': async (ctx) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const all = await gather(tid)
    return ok(kpis(all))
  },
  'GET /internal/kpis': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const all = await gather(tid)
    return ok(kpis(all))
  },
}

async function gather(tid) {
  const out = { org: null, users: [], customers: [], leads: [], deals: [], products: [], invoices: [], payments: [], expenses: [], tasks: [], activity: [] }
  try {
    const t = await callSvc(conf, 'workspace', 'GET', '/internal/tenants')
    out.org = ((t.data && t.data.tenants) || []).find((x) => x.tid === tid) || null
    const u = await callSvc(conf, 'workspace', 'GET', `/internal/users?tid=${tid}`)
    out.users = (u.data && u.data.users) || []
    const a = await callSvc(conf, 'workspace', 'GET', '/internal/activity?tid=' + tid)
    out.activity = (a.data && a.data.activity) || []
  } catch {}
  try {
    const c = await callSvc(conf, 'crm', 'GET', `/internal/customers?tid=${tid}&all=1`)
    out.customers = (c.data && c.data.customers) || []
  } catch {}
  try {
    const s = await callSvc(conf, 'sales', 'GET', `/internal/leads?tid=${tid}&all=1`)
    out.leads = (s.data && s.data.leads) || []
    const d = await callSvc(conf, 'sales', 'GET', `/internal/deals?tid=${tid}&all=1`)
    out.deals = (d.data && d.data.deals) || []
  } catch {}
  try {
    const p = await callSvc(conf, 'catalog', 'GET', `/internal/products?tid=${tid}&all=1&withstock=1`)
    out.products = (p.data && p.data.products) || []
  } catch {}
  try {
    const f = await callSvc(conf, 'finance', 'GET', `/internal/financials?tid=${tid}`)
    out.invoices = (f.data && f.data.invoices) || []
    out.payments = (f.data && f.data.payments) || []
    out.expenses = (f.data && f.data.expenses) || []
  } catch {}
  try {
    const t = await callSvc(conf, 'tasks', 'GET', `/internal/tasks?tid=${tid}&all=1`)
    out.tasks = (t.data && t.data.tasks) || []
  } catch {}
  return out
}

function businessDashboard(all, period, currency) {
  const periodInvoices = all.invoices.filter((i) => i.status !== 'draft' && inPeriod(i.issueDate || i.createdAt, period))
  const revenue = periodInvoices.reduce((s, i) => s + (i.paidAmount || 0), 0)
  const billed = periodInvoices.reduce((s, i) => s + i.total, 0)
  const periodExpenses = all.expenses.filter((e) => e.status === 'approved' && inPeriod(e.date, period))
  const expenseTotal = periodExpenses.reduce((s, e) => s + e.amount, 0)
  const outstanding = all.invoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + Math.max(0, (i.total || 0) - (i.paidAmount || 0)), 0)
  const openDeals = all.deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost')
  const pipelineValue = openDeals.reduce((s, d) => s + (d.amount || 0), 0)
  const customers = all.customers
  return {
    currency,
    scope: 'business',
    period,
    periodLabel: periodLabel(period),
    setup: buildSetupChecklist(all),
    metrics: {
      revenue, billed, expenses: expenseTotal, profit: revenue - expenseTotal, outstanding, pipelineValue,
      newCustomers: customers.filter((c) => inPeriod(c.createdAt, period)).length,
      openDeals: openDeals.length,
      openTasks: all.tasks.filter((t) => t.status !== 'done').length,
      overdueInvoices: all.invoices.filter((i) => i.status !== 'paid' && i.dueDate && new Date(i.dueDate).getTime() < Date.now()).length,
    },
    aging: agingBuckets(all.invoices),
    pipelineByStage: stageBreakdown(all.deals),
    recentActivity: all.activity.slice(0, 10),
    insights: businessInsights({ revenue, billed, expenseTotal, outstanding, invoices: all.invoices, customers, openDeals }),
  }
}

function personalDashboard(all, u, currency) {
  const deals = all.deals.filter((d) => d.ownerUserId === u.id)
  const leads = all.leads.filter((l) => l.ownerUserId === u.id)
  const tasks = all.tasks.filter((t) => t.assigneeId === u.id || t.createdBy === u.id)
  const openDeals = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost')
  const openTasks = tasks.filter((t) => t.status !== 'done')
  const overdueTasks = openTasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < Date.now())
  return {
    currency,
    scope: 'personal',
    metrics: {
      customers: all.customers.length,
      leadsOpen: leads.filter((l) => l.status !== 'converted' && l.status !== 'lost').length,
      leadsConverted: leads.filter((l) => l.status === 'converted').length,
      dealsValue: openDeals.reduce((s, d) => s + (d.amount || 0), 0),
      openTasks: openTasks.length,
      overdueTasks: overdueTasks.length,
    },
    aging: { buckets: [] },
    pipelineByStage: [],
    recentActivity: all.activity.slice(0, 8),
    insights: personalInsights(tasks, leads),
  }
}

function buildSetupChecklist(all) {
  const org = all.org || {}
  const steps = [
    { key: 'profile', label: 'Complete your business profile', done: !!(org.industry && org.location) },
    { key: 'team', label: 'Invite your team', done: all.users.length > 1 },
    { key: 'data', label: 'Add customers', done: all.customers.length > 0 },
    { key: 'catalog', label: 'Add products to your catalogue', done: all.products.length > 0 },
    { key: 'invoice', label: 'Create your first invoice', done: all.invoices.length > 0 },
    { key: 'ai', label: 'Ask Jovalen AI a question', done: all.activity.some((a) => a.type === 'ai') },
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
  if (leads.filter((l) => l.status !== 'converted' && l.status !== 'lost').length <= 1 && out.length === 1) out.push('Growing your pipeline is the fastest way to win new business.')
  return out
}

function businessInsights({ revenue, billed, expenseTotal, outstanding, invoices, customers, openDeals }) {
  const out = []
  if (outstanding > 0 && invoices.some((i) => i.status !== 'paid' && i.dueDate && new Date(i.dueDate).getTime() < Date.now())) {
    out.push('Some invoices are overdue. Collecting them faster would improve cash flow.')
  }
  if (billed > 0 && revenue < billed * 0.5) out.push("More than half of this month's billings have not been collected yet.")
  if (openDeals.length > 0 && openDeals.some((d) => d.closeDate && new Date(d.closeDate).getTime() < Date.now() + 14 * 86400000)) {
    out.push('Deals are closing in the next 14 days. Prioritize them to keep pipeline momentum.')
  }
  if (expenseTotal > revenue && revenue > 0) out.push('Expenses are running above collected revenue this month. Review non-essential spending.')
  if (customers.length === 0) out.push('Add your customers to start tracking who buys from you.')
  if (out.length === 0) out.push('Your business is performing steadily. Keep recording transactions to get deeper insights.')
  return out
}

function buildExportCsv(all, period, currency) {
  const customers = all.customers
  const nameFor = (customerId) => (customers.find((c) => c.id === customerId) || {}).name || 'Unknown'
  const csvLine = (values) => values.map((v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')
  const lines = [csvLine(['Type', 'Reference', 'Name', 'Status', 'Issue/Date', 'Due', 'Total', 'Paid', 'Outstanding', 'Currency'])]
  all.invoices.filter((i) => inPeriod(i.issueDate || i.createdAt, period)).forEach((i) => {
    const out = Math.max(0, (i.total || 0) - (i.paidAmount || 0))
    lines.push(csvLine(['Invoice', i.invoiceNumber, nameFor(i.customerId), i.status, i.issueDate || '', i.dueDate || '', i.total || 0, i.paidAmount || 0, out, currency]))
  })
  all.expenses.filter((e) => e.status === 'approved' && inPeriod(e.date, period)).forEach((e) => {
    lines.push(csvLine(['Expense', '', e.title, e.status, e.date || '', '', e.amount || 0, e.amount || 0, 0, currency]))
  })
  return lines.join('\n')
}

function buildRevenue(all) {
  const paidByMonth = {}
  const invoicedByMonth = {}
  for (const p of all.payments) {
    const k = monthKey(p.date || p.createdAt)
    paidByMonth[k] = (paidByMonth[k] || 0) + (p.amount || 0)
  }
  for (const i of all.invoices) {
    const k = monthKey(i.issueDate || i.createdAt)
    invoicedByMonth[k] = (invoicedByMonth[k] || 0) + (i.total || 0)
  }
  const months = [...new Set([...Object.keys(paidByMonth), ...Object.keys(invoicedByMonth)])].sort().slice(-12)
  return {
    series: months.map((m) => ({ month: m, invoiced: invoicedByMonth[m] || 0, paid: paidByMonth[m] || 0 })),
    totals: { invoiced: Object.values(invoicedByMonth).reduce((a, b) => a + b, 0), paid: Object.values(paidByMonth).reduce((a, b) => a + b, 0) },
  }
}

function kpis(all) {
  const openLeads = all.leads.filter((l) => l.status !== 'lost' && l.status !== 'converted')
  const pipeline = all.deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').reduce((s, d) => s + (d.amount || 0), 0)
  const won = all.deals.filter((d) => d.stage === 'won').reduce((s, d) => s + (d.amount || 0), 0)
  const revenue = all.payments.reduce((s, p) => s + (p.amount || 0), 0)
  const invoiced = all.invoices.reduce((s, i) => s + (i.total || 0), 0)
  const outstanding = all.invoices.reduce((s, i) => s + Math.max(0, (i.total || 0) - (i.paidAmount || 0)), 0)
  const overdue = all.invoices.filter((i) => i.status === 'overdue' || (i.status !== 'paid' && i.dueDate && new Date(i.dueDate).getTime() < Date.now())).length
  return {
    customers: all.customers.length, openLeads: openLeads.length, pipeline, won, revenue, invoiced, outstanding, overdue,
    pendingTasks: all.tasks.filter((t) => t.status !== 'done').length, products: all.products.length,
  }
}

function ownerName(users, id) {
  const hit = users.find((x) => x.id === Number(id))
  return hit ? hit.name : 'Unassigned'
}

function nameOf(list, id) {
  const hit = list.find((x) => x.id === Number(id))
  return hit ? hit.name : ''
}

createService('analytics', handlers)