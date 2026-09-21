import { createStore, can } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, guard, activityId, callSvc } from '../lib.js'

const store = createStore('crm')
const conf = loadConf()

function customers(tid) {
  return store.list(tid, 'customers')
}

function tickets(tid) {
  return store.list(tid, 'tickets')
}

const handlers = {
  'GET /api/customers': async (ctx) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const summary = await summaries(tid)
    return ok({ customers: customers(tid).map((c) => ({ ...c, ...summary[c.id] })) })
  },
  'GET /api/customers/:id': async (ctx) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const c = customers(tid).find((x) => x.id === Number(ctx.params.id))
    if (!c) return err(404, 'Customer not found')
    const summary = await summaries(tid)
    return ok({ customer: { ...c, ...summary[c.id] } })
  },
  'POST /api/customers': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    if (!b.name || !String(b.name).trim()) return err(400, 'Customer name is required')
    const customer = store.insert(tid, 'customers', {
      name: String(b.name).trim(),
      email: b.email || '',
      phone: b.phone || '',
      status: b.status || 'active',
      tags: b.tags || [],
      notes: Array.isArray(b.notes) ? b.notes : [],
      createdAt: new Date().toISOString(),
    })
    logActivity(tid, 'customer', 'created', customer.id, customer.name)
    return ok({ customer })
  },
  'PUT /api/customers/:id': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const id = Number(ctx.params.id)
    const b = body || {}
    const updated = store.update(tid, 'customers', id, {
      name: b.name !== undefined ? String(b.name).trim() : undefined,
      email: b.email !== undefined ? b.email : undefined,
      phone: b.phone !== undefined ? b.phone : undefined,
      status: b.status !== undefined ? b.status : undefined,
      tags: b.tags !== undefined ? b.tags : undefined,
      notes: b.notes !== undefined ? b.notes : undefined,
    })
    if (!updated) return err(404, 'Customer not found')
    logActivity(tid, 'customer', 'updated', updated.id, updated.name)
    return ok({ customer: updated })
  },
  'DELETE /api/customers/:id': async (ctx) => {
    const blocked = guard(ctx, 5)
    if (blocked) return blocked
    store.remove(tenantOf(ctx), 'customers', Number(ctx.params.id))
    return ok({ ok: true })
  },
  'POST /api/customers/:id/notes': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const c = customers(tid).find((x) => x.id === Number(ctx.params.id))
    if (!c) return err(404, 'Customer not found')
    const text = String((body && body.text) || '').trim()
    if (!text) return err(400, 'Note text is required')
    c.notes = c.notes || []
    c.notes.push({ id: activityId(), authorId: userOf(ctx).id, authorName: userOf(ctx).name, text, at: new Date().toISOString() })
    store.save()
    logActivity(tid, 'customer', 'updated', c.id, c.name, 'Added a note')
    return ok({ customer: c })
  },
  'GET /api/customers/:id/timeline': async (ctx) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const id = Number(ctx.params.id)
    const c = customers(tid).find((x) => x.id === id)
    if (!c) return err(404, 'Customer not found')
    const items = []
    if (c.notes) c.notes.forEach((n) => items.push({ kind: 'note', at: n.at, text: n.text, by: n.authorName }))
    const [fin, deals, tasks] = await Promise.all([
      call('finance', `/internal/customer-history?tid=${tid}&cid=${id}`),
      call('sales', `/internal/customer-history?tid=${tid}&cid=${id}`),
      call('tasks', `/internal/customer-history?tid=${tid}&cid=${id}`),
    ])
    ;(fin.data && fin.data.items || []).forEach((i) => items.push({ ...i, kind: 'invoice' }))
    ;(deals.data && deals.data.items || []).forEach((i) => items.push({ ...i, kind: 'deal' }))
    ;(tasks.data && tasks.data.items || []).forEach((i) => items.push({ ...i, kind: 'task' }))
    items.sort((a, b) => new Date(b.at) - new Date(a.at))
    return ok({ customer: c, timeline: items.slice(0, 60) })
  },
  'GET /api/tickets': async (ctx) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const items = tickets(tid).map((t) => ({ ...t, customerName: nameOfCustomer(tid, t.customerId) }))
    return ok({ tickets: items })
  },
  'POST /api/tickets': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    if (!b.subject || !String(b.subject).trim()) return err(400, 'Ticket subject is required')
    const ticket = store.insert(tid, 'tickets', {
      subject: String(b.subject).trim(),
      customerId: b.customerId ? Number(b.customerId) : null,
      priority: b.priority || 'medium',
      status: b.status || 'open',
      assigneeId: b.assigneeId ? Number(b.assigneeId) : null,
      messages: Array.isArray(b.messages) ? b.messages : [],
      createdAt: new Date().toISOString(),
      dueAt: b.dueAt || '',
    })
    logActivity(tid, 'ticket', 'created', ticket.id, ticket.subject)
    return ok({ ticket: { ...ticket, customerName: nameOfCustomer(tid, ticket.customerId) } })
  },
  'PUT /api/tickets/:id': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const id = Number(ctx.params.id)
    const b = body || {}
    const ticket = store.update(tid, 'tickets', id, {
      subject: b.subject !== undefined ? String(b.subject).trim() : undefined,
      status: b.status !== undefined ? b.status : undefined,
      priority: b.priority !== undefined ? b.priority : undefined,
      assigneeId: b.assigneeId !== undefined ? (b.assigneeId ? Number(b.assigneeId) : null) : undefined,
      customerId: b.customerId !== undefined ? Number(b.customerId) : undefined,
    })
    if (!ticket) return err(404, 'Ticket not found')
    return ok({ ticket: { ...ticket, customerName: nameOfCustomer(tid, ticket.customerId) } })
  },
  'POST /api/tickets/:id/messages': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const t = tickets(tid).find((x) => x.id === Number(ctx.params.id))
    if (!t) return err(404, 'Ticket not found')
    const text = String((body && body.text) || '').trim()
    if (!text) return err(400, 'Message text is required')
    t.messages = t.messages || []
    t.messages.push({ id: activityId(), authorId: userOf(ctx).id, authorName: userOf(ctx).name, text, at: new Date().toISOString() })
    store.save()
    return ok({ ticket: { ...t, customerName: nameOfCustomer(tid, t.customerId) } })
  },
  'GET /internal/customers': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    return ok({ customers: customers(tid) })
  },
  'GET /internal/customer-history': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const cid = Number(ctx.query.cid)
    const items = tickets(tid).filter((t) => t.customerId === cid).map((t) => ({ at: t.createdAt, label: `Ticket: ${t.subject}`, status: t.status }))
    return ok({ items })
  },
  'POST /internal/customers': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const records = Array.isArray(body && body.records) ? body.records : []
    const created = records.map((r) => store.insert(tid, 'customers', { ...r, notes: [], createdAt: new Date().toISOString() }))
    return ok({ customers: created })
  },
}

function nameOfCustomer(tid, id) {
  const c = customers(tid).find((x) => x.id === id)
  return c ? c.name : ''
}

async function summaries(tid) {
  const r = await call('finance', `/internal/customer-summary?tid=${tid}`)
  return (r.data && r.data.customers) || {}
}

async function call(name, path) {
  try {
    return await callSvc(conf, name, 'GET', path)
  } catch {
    return { data: null }
  }
}

function logActivity(tid, type, action, entityId, label, detail) {
  callSvcAsync('workspace', 'POST', '/internal/activity', { tid, type, action, entityId, label, detail })
}

function callSvcAsync(name, method, path, body) {
  callSvc(conf, name, method, path, body).catch(() => {})
}

createService('crm', handlers)