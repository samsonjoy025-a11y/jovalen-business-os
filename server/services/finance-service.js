import { createStore } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, guard, can, callSvc, today, addDays } from '../lib.js'

const store = createStore('finance')
const conf = loadConf()

function invoicesOf(tid) {
  return store.list(tid, 'invoices')
}

function paymentsOf(tid) {
  return store.list(tid, 'payments')
}

function expensesOf(tid) {
  return store.list(tid, 'expenses')
}

function seqState(tid) {
  const t = store.tenant(tid)
  if (!t.invoiceSeq) t.invoiceSeq = 1000
  return t
}

function nextInvoiceNumber(tid) {
  const t = seqState(tid)
  t.invoiceSeq += 1
  store.save()
  return 'INV-' + t.invoiceSeq
}

const handlers = {
  'GET /api/invoices': async (ctx) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const customers = await customersMap(tid)
    return ok({ invoices: invoicesOf(tid).map((i) => decorate(i, customers)), customers: customersList(customers) })
  },
  'POST /api/invoices': async (ctx, body) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    if (!b.customerId || !Array.isArray(b.lineItems) || b.lineItems.length === 0) {
      return err(400, 'A customer and at least one line item are required')
    }
    const invoice = buildInvoice(tid, b)
    store.insert(tid, 'invoices', invoice)
    const customers = await customersMap(tid)
    notifyApprovers(tid, 'invoice', 'invoice_created', 'New invoice', `Invoice ${invoice.invoiceNumber} for ${customers[invoice.customerId] || 'customer'} was created.`, '#/invoices')
    logActivity(tid, 'invoice', 'created', invoice.id, invoice.invoiceNumber)
    return ok({ invoice: decorate(invoice, customers) })
  },
  'PUT /api/invoices/:id': async (ctx, body) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    const invoice = store.update(tid, 'invoices', Number(ctx.params.id), {
      status: b.status !== undefined ? b.status : undefined,
      dueDate: b.dueDate !== undefined ? b.dueDate : undefined,
      customerId: b.customerId !== undefined ? Number(b.customerId) : undefined,
      overrides: b.overrides !== undefined ? b.overrides : undefined,
    })
    if (!invoice) return err(404, 'Invoice not found')
    const customers = await customersMap(tid)
    return ok({ invoice: decorateWithPayments(tid, invoice, customers) })
  },
  'DELETE /api/invoices/:id': async (ctx) => {
    const blocked = guard(ctx, 5)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const id = Number(ctx.params.id)
    store.remove(tid, 'invoices', id)
    const i = paymentsOf(tid).findIndex((p) => p.invoiceId === id)
    if (i !== -1) {
      paymentsOf(tid).splice(i, 1)
      store.save()
    }
    return ok({ ok: true })
  },
  'POST /api/invoices/:id/payments': async (ctx, body) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const id = Number(ctx.params.id)
    const invoice = store.get(tid, 'invoices', id)
    if (!invoice) return err(404, 'Invoice not found')
    const amount = Number(body && body.amount || 0)
    if (amount <= 0) return err(400, 'Payment amount must be greater than zero')
    const remaining = (invoice.total || 0) - (invoice.paidAmount || 0)
    if (amount > remaining) return err(400, `Payment exceeds the outstanding balance of ${remaining}`)
    store.insert(tid, 'payments', { invoiceId: id, amount, method: (body && body.method) || 'Bank transfer', date: (body && body.date) || today(), note: (body && body.note) || '' })
    invoice.paidAmount = (invoice.paidAmount || 0) + amount
    invoice.status = recomputeStatus(invoice)
    store.save()
    const customers = await customersMap(tid)
    notifyApprovers(tid, 'invoice', 'invoice_paid', 'Payment received', `A payment of ${amount} was recorded on invoice ${invoice.invoiceNumber}.`, '#/invoices')
    logActivity(tid, 'payment', 'created', id, invoice.invoiceNumber, `paid ${amount}`)
    return ok({ invoice: decorate(invoice, customers), payments: paymentsOf(tid).filter((p) => p.invoiceId === id) })
  },
  'GET /api/expenses': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const isFin = can(u, 4)
    const list = isFin || u.role === 'sales' ? expensesOf(tid) : expensesOf(tid).filter((e) => e.submittedBy === u.id)
    return ok({ expenses: list, canApprove: isFin })
  },
  'POST /api/expenses': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    if (!b.title || !String(b.title).trim()) return err(400, 'Expense title is required')
    const amount = Number(b.amount || 0)
    if (amount <= 0) return err(400, 'Expense amount must be greater than zero')
    const u = userOf(ctx)
    const expense = store.insert(tid, 'expenses', {
      title: String(b.title).trim(),
      category: b.category || 'Other',
      amount,
      date: b.date || today(),
      status: 'pending',
      submittedBy: u.id,
      submittedByName: u.name,
      approvedBy: '',
      note: b.note || '',
      createdAt: new Date().toISOString(),
    })
    notifyApprovers(tid, 'expense', 'expense_submitted', 'Expense awaiting approval', `Expense "${expense.title}" (${amount}) was submitted by ${u.name}.`, '#/approvals', u.id)
    logActivity(tid, 'expense', 'created', expense.id, expense.title)
    return ok({ expense })
  },
  'POST /api/expenses/:id/approve': async (ctx, body) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const expense = store.get(tid, 'expenses', Number(ctx.params.id))
    if (!expense) return err(404, 'Expense not found')
    const u = userOf(ctx)
    const approved = !!(body && body.approved === true)
    expense.status = approved ? 'approved' : 'rejected'
    expense.approvedBy = u.id
    expense.approvedByName = u.name
    store.save()
    notifyUser(tid, expense.submittedBy, 'expense_' + (approved ? 'approved' : 'rejected'), approved ? 'Expense approved' : 'Expense rejected', `Your expense "${expense.title}" was ${approved ? 'approved' : 'rejected'} by ${u.name}.`, '#/expenses')
    return ok({ expense })
  },
  'DELETE /api/expenses/:id': async (ctx) => {
    const blocked = guard(ctx, 5)
    if (blocked) return blocked
    store.remove(tenantOf(ctx), 'expenses', Number(ctx.params.id))
    return ok({ ok: true })
  },
  'GET /internal/customer-summary': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const out = {}
    for (const inv of invoicesOf(tid)) {
      if (!out[inv.customerId]) out[inv.customerId] = { totalInvoiced: 0, totalPaid: 0, lastActivity: '', lastPaid: null }
      out[inv.customerId].totalInvoiced += inv.total || 0
      out[inv.customerId].totalPaid += inv.paidAmount || 0
      const d = inv.issueDate || inv.createdAt
      if (!out[inv.customerId].lastActivity || d > out[inv.customerId].lastActivity) out[inv.customerId].lastActivity = d
    }
    for (const p of paymentsOf(tid)) {
      const inv = invoicesOf(tid).find((i) => i.id === p.invoiceId)
      if (!inv || !out[inv.customerId]) continue
      if (!out[inv.customerId].lastPaid || p.date > out[inv.customerId].lastPaid) out[inv.customerId].lastPaid = p.date
    }
    for (const k of Object.keys(out)) {
      const c = out[k]
      c.balance = c.totalInvoiced - c.totalPaid
      c.balance = Math.max(0, c.balance)
    }
    return ok({ customers: out })
  },
  'GET /internal/customer-history': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const cid = Number(ctx.query.cid)
    const customers = await customersMap(tid)
    const items = []
    for (const inv of invoicesOf(tid).filter((i) => i.customerId === cid)) {
      items.push({ at: inv.issueDate || inv.createdAt, label: `Invoice: ${inv.invoiceNumber} (${customers[inv.customerId] || ''})`, status: recomputeStatus(inv), amount: inv.total })
      for (const p of paymentsOf(tid).filter((x) => x.invoiceId === inv.id)) {
        items.push({ at: p.date, label: `Payment on ${inv.invoiceNumber}`, status: 'paid', amount: p.amount })
      }
    }
    return ok({ items })
  },
  'GET /internal/financials': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const customers = await customersMap(tid)
    return ok({ invoices: invoicesOf(tid).map((inv) => decorate(inv, customers)), payments: paymentsOf(tid), expenses: expensesOf(tid) })
  },
  'POST /internal/invoices': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const records = Array.isArray(body && body.records) ? body.records : []
    const customers = await customersByIdentity(tid)
    const created = records.map((r) => {
      let customerId = Number(r.customerId || r.customer)
      if (!customerId && (r.customerEmail || r.customerName)) {
        const key = String((r.customerEmail || r.customerName || '')).trim().toLowerCase()
        customerId = customers[key] || 0
      }
      const base = buildInvoice(tid, { ...r, customerId })
      const invoice = store.insert(tid, 'invoices', base)
      if ((r.paidAmount || 0) > 0) {
        store.insert(tid, 'payments', { invoiceId: invoice.id, amount: Number(r.paidAmount), method: 'CSV import', date: r.issueDate || today(), note: '' })
      }
      return invoice
    })
    return ok({ invoices: created })
  },
  'POST /internal/expenses': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const records = Array.isArray(body && body.records) ? body.records : []
    const created = records.map((r) => store.insert(tid, 'expenses', { ...r, createdAt: r.createdAt || new Date().toISOString() }))
    return ok({ expenses: created })
  },
  'POST /internal/payment-webhook': async (ctx, body) => {
    const b = body || {}
    const tid = String(b.tid || '')
    if (!tid) return err(400, 'Missing tenant')
    const ref = String(b.reference || b.invoiceNumber || '')
    const amount = Number(b.amount || 0)
    const inv = invoicesOf(tid).find((i) => i.invoiceNumber && String(i.invoiceNumber).toLowerCase() === ref.toLowerCase())
    if (!inv) return err(404, `Invoice ${ref || 'unknown'} not found`)
    if (amount <= 0) return err(400, 'Invalid webhook amount')
    const remaining = (inv.total || 0) - (inv.paidAmount || 0)
    if (amount > remaining) return err(400, 'Webhook payment exceeds the outstanding balance')
    store.insert(tid, 'payments', { invoiceId: inv.id, amount, method: String(b.provider || 'Payment gateway'), date: b.date || today(), note: String(b.note || 'Online payment') })
    inv.paidAmount = (inv.paidAmount || 0) + amount
    inv.status = recomputeStatus(inv)
    store.save()
    const customers = await customersMap(tid)
    notifyApprovers(tid, 'invoice', 'invoice_paid', 'Payment received', `An online payment of ${amount} was recorded against invoice ${inv.invoiceNumber}.`, '#/invoices')
    logActivity(tid, 'payment', 'created', inv.id, inv.invoiceNumber, `online payment ${amount}`)
    return ok({ invoice: decorate(inv, customers) })
  },
}

function buildInvoice(tid, b) {
  const customerId = Number(b.customerId)
  let total = 0
  const lineItems = b.lineItems.map((li) => {
    const qty = Math.max(0, Number(li.qty || 1))
    const unitPrice = Number(li.unitPrice || 0)
    total += qty * unitPrice
    return { productId: li.productId || null, name: li.name || 'Item', qty, unitPrice, total: qty * unitPrice }
  })
return {
      invoiceNumber: b.invoiceNumber || nextInvoiceNumber(tid),
      customerId: customerId || null,
      status: 'sent',
      issueDate: b.issueDate || today(),
      dueDate: b.dueDate || addDays(14),
      lineItems,
      total,
      paidAmount: Number(b.paidAmount || 0),
      overrides: b.overrides || {},
      createdAt: new Date().toISOString(),
    }
}

function recomputeStatus(invoice) {
  const over = invoice.overrides && invoice.overrides.status
  if (over && over !== 'sent' && over !== 'paid' && over !== 'partial') return over
  if (invoice.status === 'draft') return 'draft'
  const outstanding = (invoice.total || 0) - (invoice.paidAmount || 0)
  if (outstanding <= 0) return 'paid'
  if (invoice.paidAmount > 0) return 'partial'
  return 'sent'
}

function decorate(inv, customers) {
  const i = recomputeStatus(inv)
  return { ...inv, status: i, customerName: customers[inv.customerId] || 'Unknown', outstanding: Math.max(0, (inv.total || 0) - (inv.paidAmount || 0)) }
}

function decorateWithPayments(tid, invoice, customers) {
  const withPayments = { ...invoice, payments: paymentsOf(tid).filter((p) => p.invoiceId === invoice.id) }
  return decorate(withPayments, customers)
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

function customersList(map) {
  const list = []
  for (const [id, name] of Object.entries(map)) list.push({ id: Number(id), name })
  return list
}

async function customersByIdentity(tid) {
  try {
    const r = await callSvc(conf, 'crm', 'GET', `/internal/customers?tid=${tid}&all=1`)
    const map = {}
    ;(r.data && r.data.customers || []).forEach((c) => {
      map[String(c.email || '').trim().toLowerCase()] = c.id
      map[String(c.name || '').trim().toLowerCase()] = c.id
    })
    return map
  } catch {
    return {}
  }
}

async function notifyApprovers(tid, kind, type, title, body, link, excludeUserId) {
  try {
    const r = await callSvc(conf, 'workspace', 'GET', `/internal/users?tid=${tid}`)
    const targets = (r.data && r.data.users || []).filter((u) => (u.role === 'owner' || u.role === 'finance') && u.id !== excludeUserId)
    targets.forEach((u) => callSvc(conf, 'workspace', 'POST', '/internal/notify', { tid, userId: u.id, type, title, body, link }))
  } catch {}
}

async function notifyUser(tid, userId, type, title, body, link) {
  callSvc(conf, 'workspace', 'POST', '/internal/notify', { tid, userId, type, title, body, link }).catch(() => {})
}

function logActivity(tid, type, action, entityId, label, detail) {
  callSvc(conf, 'workspace', 'POST', '/internal/activity', { tid, type, action, entityId, label, detail }).catch(() => {})
}

createService('finance', handlers)