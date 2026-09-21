import { createStore } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, guard, can, callSvc, today, addDays } from '../lib.js'

const store = createStore('automation')
const conf = loadConf()

function notifiedAny(tid, kind, id) {
  return store.list(tid, 'notified').some((n) => n.kind === kind && n.entityId === id)
}

function markNotified(tid, kind, id) {
  store.insert(tid, 'notified', { kind, entityId: id, at: new Date().toISOString() })
}

async function runTenant(tid) {
  const result = { tid, autoAssigned: 0, tasksCreated: 0, notifications: 0, errors: 0 }
  try {
    const org = await getOrg(tid)
    const automation = (org && org.automation) || { enabled: true }
    if (!automation.enabled) return result
    result.autoAssigned += await autoAssignLeads(tid)
    result.notifications += await scanOverdueInvoices(tid)
    result.notifications += await scanOverdueTasks(tid)
    result.tasksCreated = await scanLowStock(tid)
    return result
  } catch {
    result.errors = 1
    return result
  }
}

async function getOrg(tid) {
  const r = await callSvc(conf, 'workspace', 'GET', `/internal/tenants`)
  if (!r.data || !r.data.tenants) return null
  return r.data.tenants.find((t) => t.tid === tid) || null
}

async function autoAssignLeads(tid) {
  let created = 0
  const users = await workspaceUsers(tid)
  const assignees = users.filter((u) => u.role === 'owner' || u.role === 'sales')
  if (assignees.length === 0) return 0
  const r = await callSvc(conf, 'sales', 'GET', `/internal/leads?tid=${tid}&all=1`)
  const leads = (r.data && r.data.leads || []).filter((l) => !l.ownerUserId && l.status !== 'lost')
  if (leads.length === 0) return 0
  const load = {}
  assignees.forEach((u) => {
    load[u.id] = (r.data.leads || []).filter((l) => l.ownerUserId === u.id).length
  })
  for (const lead of leads) {
    const pick = assignees.slice().sort((a, b) => load[a.id] - load[b.id])[0]
    load[pick.id]++
    await callSvc(conf, 'sales', 'PATCH', `/internal/leads/${lead.id}/owner`, { tid, ownerUserId: pick.id })
    const followUp = lead.followUpDate || addDays(2)
    await callSvc(conf, 'tasks', 'POST', '/internal/tasks', {
      tid,
      records: [{ title: `Follow up on lead: ${lead.name}`, assigneeId: pick.id, dueDate: followUp, priority: 'medium', status: 'todo', createdBy: -1 }],
    })
    await callSvc(conf, 'workspace', 'POST', '/internal/notify', { tid, userId: pick.id, type: 'lead', title: 'New lead assigned', body: `Lead "${lead.name}" was assigned to you. A follow-up task was created for ${followUp}.`, link: '#/leads' })
    created++
  }
  return created
}

async function scanOverdueInvoices(tid) {
  let notified = 0
  const r = await callSvc(conf, 'finance', 'GET', `/internal/financials?tid=${tid}`)
  const invoices = (r.data && r.data.invoices || []).filter((i) => i.status === 'sent' || i.status === 'partial' || i.status === 'overdue')
  for (const inv of invoices) {
    const due = new Date(inv.dueDate).getTime()
    if (!due || !(inv.status === 'overdue' || due < Date.now())) continue
    if (notifiedAny(tid, 'invoice', inv.id)) continue
    markNotified(tid, 'invoice', inv.id)
    const fin = await ownersAndFinance(tid)
    for (const u of fin) {
      await callSvc(conf, 'workspace', 'POST', '/internal/notify', { tid, userId: u.id, type: 'invoice', title: 'Invoice overdue', body: `Invoice ${inv.invoiceNumber} is past its due date.`, link: '#/invoices' })
      notified++
    }
  }
  return notified
}

async function scanOverdueTasks(tid) {
  let notified = 0
  const r = await callSvc(conf, 'tasks', 'GET', `/internal/tasks?tid=${tid}&all=1`)
  const tasks = (r.data && r.data.tasks || []).filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate).getTime() < Date.now())
  for (const t of tasks) {
    if (notifiedAny(tid, 'task', t.id)) continue
    markNotified(tid, 'task', t.id)
    if (!t.assigneeId || t.assigneeId === -1) continue
    await callSvc(conf, 'workspace', 'POST', '/internal/notify', { tid, userId: t.assigneeId, type: 'task', title: 'Task overdue', body: `Task "${t.title}" is past its due date.`, link: '#/tasks' })
    notified++
  }
  return notified
}

async function scanLowStock(tid) {
  let count = 0
  const r = await callSvc(conf, 'catalog', 'GET', `/internal/products?tid=${tid}&withstock=1`)
  const products = (r.data && r.data.products || []).filter((p) => p.active !== false && p.reorderLevel > 0 && p.onHand <= p.reorderLevel)
  for (const p of products) {
    if (notifiedAny(tid, 'stock', p.id)) continue
    markNotified(tid, 'stock', p.id)
    await callSvc(conf, 'tasks', 'POST', '/internal/tasks', { tid, records: [{ title: `Restock ${p.name}`, description: `Stock is at ${p.onHand}, reorder level ${p.reorderLevel}.`, assigneeId: -1, priority: 'medium', status: 'todo', createdBy: -1 }] })
    await callSvc(conf, 'workspace', 'POST', '/internal/notify', { tid, type: 'task', title: 'Low stock', body: `${p.name} is at or below its reorder level (${p.onHand}).`, link: '#/inventory' })
    count++
  }
  return count
}

async function workspaceUsers(tid) {
  const r = await callSvc(conf, 'workspace', 'GET', `/internal/users?tid=${tid}`)
  return (r.data && r.data.users) || []
}

async function ownersAndFinance(tid) {
  const users = await workspaceUsers(tid)
  return users.filter((u) => u.role === 'owner' || u.role === 'finance')
}

function startLoop() {
  setInterval(async () => {
    try {
      const r = await callSvc(conf, 'workspace', 'GET', `/internal/tenants`)
      const tenants = (r.data && r.data.tenants) || []
      for (const t of tenants) {
        await runTenant(t.tid)
      }
    } catch {}
  }, 15000)
}

const handlers = {
  'GET /api/automation/status': async (ctx) => {
    const blocked = guard(ctx, 5)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const info = store.list(tid, 'runlog').slice(0, 20)
    return ok({ enabled: true, intervalMs: 15000, recentRuns: info })
  },
  'POST /internal/run': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const result = await runTenant(tid)
    store.list(tid, 'runlog').unshift({ ...result, at: new Date().toISOString() })
    store.save()
    return ok(result)
  },
}

createService('automation', handlers)
startLoop()