import { createStore, scoped } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, guard, can, callSvc, today, addDays } from '../lib.js'

const store = createStore('sales')
const conf = loadConf()

function leadsOf(tid) {
  return store.list(tid, 'leads')
}

function dealsOf(tid) {
  return store.list(tid, 'deals')
}

const handlers = {
  'GET /api/leads': async (ctx) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const scope = can(u, 4) ? null : u.id
    const users = await usersMap(tid)
    return ok({ leads: scoped(leadsOf(tid), scope).map((l) => ({ ...l, owner: ownerName(users, l.ownerUserId) })) })
  },
  'POST /api/leads': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    if (!b.name || !String(b.name).trim()) return err(400, 'Lead name is required')
    const lead = store.insert(tid, 'leads', {
      name: String(b.name).trim(),
      email: b.email || '',
      phone: b.phone || '',
      source: b.source || '',
      status: b.status || 'new',
      ownerUserId: b.ownerUserId !== undefined ? Number(b.ownerUserId) : undefined,
      followUpDate: b.followUpDate || undefined,
      createdAt: new Date().toISOString(),
    })
    logActivity(tid, 'lead', 'created', lead.id, lead.name)
    callAutomation(tid)
    const users = await usersMap(tid)
    return ok({ lead: { ...lead, owner: ownerName(users, lead.ownerUserId) } })
  },
  'PUT /api/leads/:id': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    const lead = store.update(tid, 'leads', Number(ctx.params.id), {
      name: b.name !== undefined ? String(b.name).trim() : undefined,
      email: b.email !== undefined ? b.email : undefined,
      phone: b.phone !== undefined ? b.phone : undefined,
      source: b.source !== undefined ? b.source : undefined,
      status: b.status !== undefined ? b.status : undefined,
      ownerUserId: b.ownerUserId !== undefined ? (b.ownerUserId ? Number(b.ownerUserId) : undefined) : undefined,
      followUpDate: b.followUpDate !== undefined ? b.followUpDate : undefined,
    })
    if (!lead) return err(404, 'Lead not found')
    logActivity(tid, 'lead', 'updated', lead.id, lead.name)
    callAutomation(tid)
    const users = await usersMap(tid)
    return ok({ lead: { ...lead, owner: ownerName(users, lead.ownerUserId) } })
  },
  'DELETE /api/leads/:id': async (ctx) => {
    const blocked = guard(ctx, 5)
    if (blocked) return blocked
    store.remove(tenantOf(ctx), 'leads', Number(ctx.params.id))
    return ok({ ok: true })
  },
  'POST /api/leads/:id/convert': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    const lead = store.get(tid, 'leads', Number(ctx.params.id))
    if (!lead) return err(404, 'Lead not found')
    const existing = await findCustomer(tid, lead)
    let customer = existing
    if (!customer) {
      const r = await callSvc(conf, 'crm', 'POST', '/internal/customers', { tid, records: [{ name: lead.name, email: lead.email || '', phone: lead.phone || '', status: 'active' }] })
      customer = r.data && r.data.customers && r.data.customers[0]
    }
    if (!customer) return err(500, 'Could not create customer')
    const deal = store.insert(tid, 'deals', {
      name: lead.name,
      customerId: customer.id,
      amount: b.amount && Number(b.amount) > 0 ? Number(b.amount) : 0,
      stage: 'qualification',
      ownerUserId: (lead.ownerUserId || userOf(ctx).id),
      closeDate: b.closeDate || addDays(30),
      createdAt: new Date().toISOString(),
    })
    store.update(tid, 'leads', lead.id, { status: 'converted' })
    logActivity(tid, 'deal', 'created', deal.id, deal.name)
    return ok({ customer, deal })
  },
  'GET /api/deals': async (ctx) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const scope = can(u, 4) ? null : u.id
    const users = await usersMap(tid)
    const customers = await customersMap(tid)
    return ok({
      deals: scoped(dealsOf(tid), scope).map((d) => ({ ...d, customerName: customers[d.customerId] || '', owner: ownerName(users, d.ownerUserId) })),
    })
  },
  'POST /api/deals': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    if (!b.name || !String(b.name).trim()) return err(400, 'Deal name is required')
    const deal = store.insert(tid, 'deals', {
      name: String(b.name).trim(),
      customerId: b.customerId ? Number(b.customerId) : null,
      amount: Number(b.amount || 0),
      stage: b.stage || 'qualification',
      ownerUserId: b.ownerUserId || userOf(ctx).id,
      closeDate: b.closeDate || addDays(30),
      createdAt: new Date().toISOString(),
    })
    logActivity(tid, 'deal', 'created', deal.id, deal.name)
    const users = await usersMap(tid)
    const customers = await customersMap(tid)
    return ok({ deal: { ...deal, customerName: customers[deal.customerId] || '', owner: ownerName(users, deal.ownerUserId) } })
  },
  'PUT /api/deals/:id': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    const deal = store.update(tid, 'deals', Number(ctx.params.id), {
      name: b.name !== undefined ? String(b.name).trim() : undefined,
      customerId: b.customerId !== undefined ? (b.customerId ? Number(b.customerId) : null) : undefined,
      amount: b.amount !== undefined ? Number(b.amount) : undefined,
      stage: b.stage !== undefined ? b.stage : undefined,
      ownerUserId: b.ownerUserId !== undefined ? b.ownerUserId : undefined,
      closeDate: b.closeDate !== undefined ? b.closeDate : undefined,
    })
    if (!deal) return err(404, 'Deal not found')
    logActivity(tid, 'deal', 'updated', deal.id, deal.name, deal.stage ? `stage -> ${deal.stage}` : '')
    const users = await usersMap(tid)
    const customers = await customersMap(tid)
    return ok({ deal: { ...deal, customerName: customers[deal.customerId] || '', owner: ownerName(users, deal.ownerUserId) } })
  },
  'DELETE /api/deals/:id': async (ctx) => {
    const blocked = guard(ctx, 5)
    if (blocked) return blocked
    store.remove(tenantOf(ctx), 'deals', Number(ctx.params.id))
    return ok({ ok: true })
  },
  'GET /internal/leads': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const all = ctx.query.all === '1'
    let items = leadsOf(tid)
    if (!all) {
      const cid = Number(ctx.query.cid)
      if (cid) items = items.filter((l) => l.customerId === cid)
      else if (ctx.query.ownerUserId) items = items.filter((l) => l.ownerUserId === Number(ctx.query.ownerUserId))
    }
    return ok({ leads: items })
  },
  'POST /internal/leads': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const records = Array.isArray(body && body.records) ? body.records : []
    const created = records.map((r) => store.insert(tid, 'leads', { ...r, createdAt: r.createdAt || new Date().toISOString() }))
    return ok({ leads: created })
  },
  'PATCH /internal/leads/:id/owner': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const lead = store.update(tid, 'leads', Number(ctx.params.id), { ownerUserId: Number(body.ownerUserId) })
    if (!lead) return err(404, 'Lead not found')
    return ok({ lead })
  },
  'GET /internal/customer-history': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const cid = Number(ctx.query.cid)
    const items = dealsOf(tid).filter((d) => d.customerId === cid).map((d) => ({ at: d.createdAt, label: `Deal: ${d.name}`, status: d.stage }))
    return ok({ items })
  },
  'GET /internal/deals': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const all = ctx.query.all === '1'
    let items = dealsOf(tid)
    if (!all) {
      const cid = Number(ctx.query.cid)
      if (cid) items = items.filter((d) => d.customerId === cid)
      else if (ctx.query.ownerUserId) items = items.filter((d) => d.ownerUserId === Number(ctx.query.ownerUserId))
    }
    return ok({ deals: items })
  },
  'POST /internal/deals': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const records = Array.isArray(body && body.records) ? body.records : []
    const created = records.map((r) => store.insert(tid, 'deals', { ...r, createdAt: r.createdAt || new Date().toISOString() }))
    return ok({ deals: created })
  },
}

async function usersMap(tid) {
  try {
    const r = await callSvc(conf, 'workspace', 'GET', `/internal/users?tid=${tid}`)
    const map = {}
    ;(r.data && r.data.users || []).forEach((u) => (map[u.id] = u.name))
    return map
  } catch {
    return {}
  }
}

async function customersMap(tid) {
  try {
    const r = await callSvc(conf, 'crm', 'GET', `/internal/customers?tid=${tid}`)
    const map = {}
    ;(r.data && r.data.customers || []).forEach((c) => (map[c.id] = c.name))
    return map
  } catch {
    return {}
  }
}

async function findCustomer(tid, lead) {
  try {
    const r = await callSvc(conf, 'crm', 'GET', `/internal/customers?tid=${tid}`)
    const list = (r.data && r.data.customers) || []
    return list.find((c) => (lead.email && c.email === lead.email) || c.name === lead.name) || null
  } catch {
    return null
  }
}

function ownerName(users, userId) {
  if (!userId) return 'Unassigned'
  return users[userId] || 'Unknown'
}

function logActivity(tid, type, action, entityId, label, detail) {
  callSvc(conf, 'workspace', 'POST', '/internal/activity', { tid, type, action, entityId, label, detail }).catch(() => {})
}

function callAutomation(tid) {
  callSvc(conf, 'automation', 'POST', '/internal/run', { tid }).catch(() => {})
}

createService('sales', handlers)
