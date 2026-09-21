import { createStore } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, guard, callSvc, today } from '../lib.js'

const store = createStore('import')
const conf = loadConf()

const COLUMNS = {
  customers: ['name', 'company', 'email', 'phone', 'notes'],
  leads: ['name', 'company', 'email', 'phone', 'status', 'value', 'source'],
  products: ['name', 'sku', 'unitPrice', 'reorderLevel', 'onHand'],
  invoices: ['customerEmail', 'customerName', 'issueDate', 'dueDate', 'lineItems', 'total'],
  expenses: ['title', 'category', 'amount', 'date', 'status'],
}

function detectSeparator(head) {
  if (head.includes('\t')) return '\t'
  return ','
}

function parseCsv(text) {
  const sep = detectSeparator(String(text).split(/\r?\n/)[0] || ',')
  const rows = []
  let cur = []
  let field = ''
  let inQ = false
  const push = () => {
    cur.push(field)
    field = ''
  }
  for (const ch of String(text)) {
    if (inQ) {
      if (ch === '"') inQ = false
      else if (ch === '\r') continue
      else field += ch
      continue
    }
    if (ch === '"') inQ = true
    else if (ch === sep) push()
    else if (ch === '\n' || ch === '\r') {
      push()
      if (cur.some((c) => String(c).trim() !== '')) rows.push(cur)
      cur = []
    } else field += ch
  }
  if (field !== '' || cur.length) {
    push()
    if (cur.some((c) => String(c).trim() !== '')) rows.push(cur)
  }
  return rows
}

function toRows(text) {
  const lines = parseCsv(text)
  if (!lines.length) return []
  const head = lines[0].map((h) => String(h).trim())
  return lines.slice(1).map((cells) => {
    const out = {}
    head.forEach((h, i) => (out[h] = (cells[i] || '').trim()))
    return out
  })
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '')
}

function mapColumns(header, kind) {
  const cols = COLUMNS[kind] || COLUMNS.customers
  const mapping = {}
  for (const c of cols) {
    const exact = header.find((h) => norm(h) === norm(c))
    if (exact) {
      mapping[c] = exact
      continue
    }
    if ((c === 'name' || c === 'customerName') && header.some((h) => /name/i.test(h))) mapping[c] = header.find((h) => /name/i.test(h))
    else mapping[c] = ''
  }
  return mapping
}

function cleanInteger(v) {
  const n = parseInt(String(v).replace(/[^\d]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

function cleanMoney(v) {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}

async function existingKeys(tid, kind) {
  const svc = targetService(kind)
  const routes = {
    customers: '/internal/customers',
    leads: '/internal/leads',
    products: '/internal/products',
    expenses: '/internal/expenses',
    invoices: '/internal/invoices',
  }
  try {
    const r = await callSvc(conf, svc, 'GET', `${routes[kind]}?tid=${tid}&all=1`)
    const list = (r.data && r.data[internalField(kind)]) || []
    return new Set(list.map((x) => dedupeKey(kind, x).toLowerCase()))
  } catch {
    return new Set()
  }
}

function dedupeKey(kind, rec) {
  if (kind === 'customers') return rec.email || rec.name || ''
  if (kind === 'leads') return rec.email || rec.name || ''
  if (kind === 'products') return rec.name || rec.sku || ''
  if (kind === 'invoices') return rec.invoiceNumber || ''
  if (kind === 'expenses') return `${rec.title}|${rec.date}` || ''
  return ''
}

const handlers = {
  'POST /api/import/:entity': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const b = body || {}
    const kind = String(ctx.params.entity)
    if (!COLUMNS[kind]) return err(400, `Unknown import type "${kind}"`)
    const raw = String(b.csv || '')
    if (!raw.trim()) return err(400, 'Choose a CSV file first')
    const rows = toRows(raw)
    if (!rows.length) return err(400, 'No data rows found in the CSV')
    const header = Object.keys(rows[0] || {})
    const columns = mapColumns(header, kind)
    const errors = []
    const records = []
    for (const r of rows) {
      const issues = validate(kind, r, columns)
      if (issues.length) {
        errors.push(`Row ${rows.indexOf(r) + 2}: ${issues.join('; ')}`)
        continue
      }
      records.push(build(kind, r, columns, u))
    }
    const existing = await existingKeys(tid, kind)
    const seen = new Set()
    const fresh = records.filter((rec) => {
      const key = dedupeKey(kind, rec).toLowerCase()
      if (!key) return true
      if (existing.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    const skipped = records.length - fresh.length
    if (b.dryRun === true) {
      const preview = fresh.slice(0, 8).map((r) => compact(r, kind))
      return ok({ dryRun: true, entity: kind, ready: fresh.length, errors: errors.slice(0, 25), preview })
    }
    if (!fresh.length) return ok({ imported: 0, skipped, errors })
    const svc = targetService(kind)
    if (kind === 'invoices') {
      const byCustomer = {}
      for (const r of fresh) {
        const key = (r.customerEmail || r.customerName || '').toLowerCase()
        byCustomer[key] = byCustomer[key] || { email: r.customerEmail, name: r.customerName, phone: '', items: [] }
        byCustomer[key].items.push(r)
      }
      const customerMap = await ensureCustomers(tid, Object.values(byCustomer).map((g) => ({ name: g.name, email: g.email, phone: g.phone })))
      fresh.forEach((r) => {
        const key = (r.customerEmail || r.customerName || '').toLowerCase()
        if (customerMap[key]) r.customerId = customerMap[key]
        delete r.customerEmail
      })
    }
    const res = await callSvc(conf, svc, 'POST', `/internal/${kind}`, { tid, records: fresh, columns })
    const created = (res.data && res.data[internalField(kind)]) || []
    if (res.status !== 200) errors.push('Import to the data service failed. No records were committed.')
    store.list(tid, 'imports').unshift({ entity: kind, attempted: fresh.length, imported: created.length, skipped, errors: errors.length, at: new Date().toISOString(), by: u.name })
    store.save()
    return ok({ imported: created.length, skipped, errors: errors.slice(0, 25) })
  },
  'POST /api/bootstrap/seed': async (ctx, body) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const outcome = await seed(tid, u)
    return ok(outcome)
  },
}

function compact(rec, kind) {
  if (kind === 'customers') return `${rec.name}${rec.email ? ` — ${rec.email}` : ''}`
  if (kind === 'leads') return `${rec.name}${rec.email ? ` — ${rec.email}` : ''}`
  if (kind === 'products') return `${rec.name}${rec.sku ? ` (${rec.sku})` : ''}`
  if (kind === 'invoices') return `${rec.invoiceNumber || rec.issueDate || ''} — ${rec.customerName || rec.customerEmail || 'Customer'}`
  if (kind === 'expenses') return `${rec.title} · ${rec.amount}`
  return JSON.stringify(rec)
}

function targetService(kind) {
  return { customers: 'crm', leads: 'sales', products: 'catalog', invoices: 'finance', expenses: 'finance' }[kind] || 'crm'
}

function internalField(kind) {
  return { customers: 'customers', leads: 'leads', products: 'products', invoices: 'invoices', expenses: 'expenses' }[kind] || 'customers'
}

function validate(kind, r, columns) {
  const errs = []
  const get = (f) => String(r[columns[f] || ''] || '').trim()
  if (kind === 'customers' || kind === 'leads') {
    if (!get('name')) errs.push('missing name')
  } else if (kind === 'products') {
    if (!get('name')) errs.push('missing name')
  } else if (kind === 'invoices') {
    if (!get('customerEmail') && !get('customerName')) errs.push('missing customer email or name')
    if (!get('total') && !get('lineItems')) errs.push('missing total')
  } else if (kind === 'expenses') {
    if (!get('title')) errs.push('missing title')
    if (cleanMoney(get('amount')) <= 0) errs.push('invalid amount')
  }
  return errs
}

function build(kind, r, columns, u) {
  const get = (f) => String(r[columns[f] || ''] || '').trim()
  const now = new Date().toISOString()
  if (kind === 'customers') {
    return { name: get('name'), company: get('company'), email: get('email'), phone: get('phone'), notes: get('notes'), ownerUserId: u.id, createdAt: now }
  }
  if (kind === 'leads') {
    return { name: get('name'), company: get('company'), email: get('email'), phone: get('phone'), status: get('status') || 'new', value: cleanMoney(get('value')), source: get('source') || 'import', ownerUserId: u.id, createdAt: now }
  }
  if (kind === 'products') {
    return { name: get('name'), sku: get('sku'), unitPrice: cleanMoney(get('unitPrice')), reorderLevel: cleanInteger(get('reorderLevel')), onHand: cleanInteger(get('onHand')), active: true, createdAt: now }
  }
  if (kind === 'invoices') {
    const total = cleanMoney(get('total'))
    const lineItems = get('lineItems')
      ? get('lineItems').split(';').filter(Boolean).map((li) => ({ name: li, qty: 1, unitPrice: 0, total: 0 }))
      : [{ name: 'Invoice item', qty: 1, unitPrice: total, total }]
    const lineTotal = lineItems.reduce((s, l) => s + (l.total || 0), 0)
    if (lineTotal > 0) {
      const ratio = total / lineTotal
      lineItems.forEach((l) => (l.total = Math.round(l.unitPrice * l.qty * ratio * 100) / 100))
    }
    return { customerName: get('customerName'), customerEmail: get('customerEmail'), invoiceNumber: get('invoiceNumber'), issueDate: get('issueDate') || today(), dueDate: get('dueDate') || '', lineItems, status: get('status') || 'sent', createdBy: u.id, createdAt: now }
  }
  if (kind === 'expenses') {
    return { title: get('title'), category: get('category') || 'Other', amount: cleanMoney(get('amount')), date: get('date') || today(), status: get('status') || 'approved', submittedBy: u.id, submittedByName: u.name, createdAt: now }
  }
  return {}
}

async function ensureCustomers(tid, list) {
  const need = list.filter((c) => c && c.name)
  if (!need.length) return {}
  const r = await callSvc(conf, 'crm', 'POST', '/internal/customers', { tid, records: need })
  if (r.status !== 200 || !r.data) return {}
  const out = {}
  for (const c of r.data.customers || []) out[String(c.email || c.name || '').toLowerCase()] = c.id
  return out
}

async function seed(tid, u) {
  const out = []
  const owners = [u, ...(await financeUsers(tid))].filter(Boolean)
  const owner = (i) => owners[i % owners.length]
  const products = []
  const pnames = ['Premium Consultation', 'Standard Retainer', 'Setup Fee', 'Monthly Support', 'Training Session', 'Hardware Kit', 'Software License', 'Annual Renewal']
  for (let i = 0; i < pnames.length; i++) {
    products.push({ name: pnames[i], sku: `SKU-${1000 + i}`, unitPrice: 5000 + i * 2500, reorderLevel: i % 3 === 0 ? 5 : 0, onHand: 10 + i * 2, active: true, createdAt: new Date().toISOString() })
  }
  const pr = await callSvc(conf, 'catalog', 'POST', '/internal/products', { tid, records: products })
  const productIds = (pr.data && pr.data.products || []).map((p) => p.id)
  out.push({ kind: 'products', count: productIds.length })

  const customers = []
  const cnames = ['Chidinma Obi', 'Kofi Mensah', 'Aisha Bello', 'Segun Adeyemi', 'Fatima Usman', 'Kwame Boateng', 'Ngozi Eze', 'Tunde Bakare', 'Zainab Yusuf', 'Ibrahim Musa']
  for (let i = 0; i < cnames.length; i++) {
    customers.push({ name: cnames[i], company: `${cnames[i].split(' ')[1]} Ventures`, email: `${cnames[i].split(' ')[0].toLowerCase()}@example.com`, phone: `+23480100${10000 + i}`, ownerUserId: owner(i).id, createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString() })
  }
  const cr = await callSvc(conf, 'crm', 'POST', '/internal/customers', { tid, records: customers })
  const cids = (cr.data && cr.data.customers || []).map((c) => c.id)
  out.push({ kind: 'customers', count: cids.length })

  const leads = []
  const lnames = ['New Office Fitout', 'Warehouse Management', 'POS System', 'Website Redesign', 'Staff Training', 'Cloud Migration']
  for (let i = 0; i < lnames.length; i++) {
    leads.push({ name: lnames[i], company: `Acme ${i}`, email: `lead${i}@example.com`, phone: `+23480999${i}000`, status: i % 3 === 0 ? 'new' : 'contacted', value: 20000 + i * 5000, source: 'seed', ownerUserId: owner(i).id, createdAt: new Date(Date.now() - i * 172800000).toISOString() })
  }
  const lr = await callSvc(conf, 'sales', 'POST', '/internal/leads', { tid, records: leads })
  const lout = (lr.data && lr.data.leads || [])
  out.push({ kind: 'leads', count: lout.length })

  const deals = lout.slice(0, 3).map((l, i) => ({ name: l.name, sourceLeadId: l.id, customerId: cids[i] || cids[0], amount: l.value, stage: ['proposal', 'negotiation', 'won'][i], ownerUserId: l.ownerUserId, createdAt: new Date().toISOString() }))
  const dr = await callSvc(conf, 'sales', 'POST', '/internal/deals', { tid, records: deals })
  out.push({ kind: 'deals', count: (dr.data && dr.data.deals || []).length })

  const invoices = []
  for (let i = 0; i < Math.min(6, cids.length); i++) {
    const qty = 1 + i % 3
    const total = 5000 * qty
    const issue = new Date(Date.now() - i * 1209600000).toISOString().slice(0, 10)
    invoices.push({
      customerId: cids[i],
      customerEmail: customers[i].email,
      issueDate: issue,
      dueDate: new Date(Date.parse(issue) + 14 * 86400000).toISOString().slice(0, 10),
      lineItems: [{ productId: productIds[i] || null, name: pnames[i] || 'Item', qty, unitPrice: 5000, total }],
      status: i === 0 ? 'paid' : i < 3 ? 'sent' : i === 3 ? 'overdue' : 'paid',
      paidAmount: i === 0 || i >= 4 ? total : 0,
    })
  }
  const fr = await callSvc(conf, 'finance', 'POST', '/internal/invoices', { tid, records: invoices })
  out.push({ kind: 'invoices', count: (fr.data && fr.data.invoices || []).length })

  const tasks = []
  for (let i = 0; i < 5; i++) {
    tasks.push({ title: ['Prepare proposal', 'Call prospect', 'Send quote', 'Follow up on invoice', 'Update inventory'][i], assigneeId: owner(i).id, priority: 'medium', status: i < 2 ? 'todo' : 'done', dueDate: today(), createdAt: new Date(Date.now() - i * 86400000).toISOString() })
  }
  const tr = await callSvc(conf, 'tasks', 'POST', '/internal/tasks', { tid, records: tasks })
  out.push({ kind: 'tasks', count: (tr.data && tr.data.tasks || []).length })

  return { seeded: out, message: 'Demo data was created. Refresh the page to see it.' }
}

async function financeUsers(tid) {
  const r = await callSvc(conf, 'workspace', 'GET', `/internal/users?tid=${tid}`)
  return (r.data && r.data.users || []).filter((x) => x.role === 'owner' || x.role === 'finance')
}

createService('import', handlers)