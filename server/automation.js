import { list, insert, notify, dab } from './store.js'

export function runAutomation(tenant) {
  if (!tenant.settings || !tenant.settings.automation || tenant.settings.automation.enabled === false) return
  autoAssignUnassignedLeads(tenant)
  scanOverdueInvoices(tenant)
  scanOverdueTasks(tenant)
}

function salesUsers(tenant) {
  return list(tenant, 'users').filter((u) => u.role === 'sales' || u.role === 'owner')
}

function ownersAndFinance(tenant) {
  return list(tenant, 'users').filter((u) => u.role === 'owner' || u.role === 'finance')
}

function autoAssignUnassignedLeads(tenant) {
  const leads = list(tenant, 'leads').filter((l) => !l.ownerUserId && l.status !== 'lost')
  const assignees = salesUsers(tenant)
  if (leads.length === 0 || assignees.length === 0) return
  const followers = {}
  assignees.forEach((u) => {
    followers[u.id] = list(tenant, 'leads').filter((l) => l.ownerUserId === u.id).length
  })
  leads.forEach((lead) => {
    const pick = assignees.slice().sort((a, b) => followers[a.id] - followers[b.id])[0]
    lead.ownerUserId = pick.id
    followers[pick.id]++
    const followUp = lead.followUpDate || new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    insert(tenant, 'tasks', {
      title: `Follow up on lead: ${lead.name}`,
      assigneeId: pick.id,
      dueDate: followUp,
      priority: 'medium',
      status: 'todo',
      createdBy: 'automation',
    })
    notify(tenant, pick.id, 'lead_assigned', 'New lead assigned', `Lead "${lead.name}" was assigned to you. A follow-up task was created for ${followUp}.`, '#/leads')
  })
}

function scanOverdueInvoices(tenant) {
  const now = new Date().getTime()
  const invoices = list(tenant, 'invoices').filter(
    (i) => (i.status === 'sent' && new Date(i.dueDate).getTime() < now) || i.status === 'partial' || i.status === 'overdue'
  )
  invoices.forEach((inv) => {
    const due = new Date(inv.dueDate).getTime()
    const isOverdue = (inv.status === 'overdue') || (due < now)
    if (!isOverdue) return
    if (inv.overdueNotified) return
    inv.overdueNotified = true
    ownersAndFinance(tenant).forEach((u) => {
      notify(tenant, u.id, 'invoice_overdue', 'Invoice overdue', `Invoice ${inv.invoiceNumber} is past its due date.`, '#/invoices')
    })
  })
}

function scanOverdueTasks(tenant) {
  const now = new Date().getTime()
  const tasks = list(tenant, 'tasks').filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate).getTime() < now)
  tasks.forEach((t) => {
    if (t.overdueNotified) return
    t.overdueNotified = true
    const users = [t.assigneeId].filter(Boolean)
    users.forEach((uid) => {
      if (uid === 'automation') return
      notify(tenant, uid, 'task_overdue', 'Task overdue', `Task "${t.title}" is past its due date.`, '#/tasks')
    })
  })
}

export function startAutomationLoop(intervalMs) {
  setInterval(() => {
    const db = dab()
    db.tenants.forEach((tenant) => {
      try {
        runAutomation(tenant)
      } catch {
      }
    })
  }, intervalMs || 15000)
}