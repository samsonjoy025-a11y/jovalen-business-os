import { createStore } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, guard, callSvc, money } from '../lib.js'

const store = createStore('ai')
const conf = loadConf()

const SUGGESTED_QUESTIONS = [
  'How much revenue did we make this month?',
  'Who owes us money?',
  'Which sales opportunities need attention?',
  'Show me our best-performing customers.',
  'Why did our expenses increase?',
  'Which customers have been inactive recently?',
  "Summarize this month's business performance.",
  'What tasks are overdue?',
]

const canFinance = (u) => u && (u.role === 'owner' || u.role === 'finance')

function daysSince(dateStr) {
  const d = new Date(dateStr).getTime()
  if (!d) return Infinity
  return Math.floor((Date.now() - d) / 86400000)
}

function overdueDays(i) {
  const due = new Date(i.dueDate).getTime()
  if (i.status === 'paid') return 0
  return Math.max(0, Math.floor((Date.now() - due) / 86400000))
}

function monthKey(dateStr) {
  return String(dateStr || '').slice(0, 7)
}

function thisMonthKey() {
  return new Date().toISOString().slice(0, 7)
}

function periodMatch(records, key) {
  if (key === 'thisMonth') return records.filter((r) => monthKey(r.createdAt || r.issueDate || r.date) === thisMonthKey())
  return records
}

function noData(answer, qs) {
  return {
    answer: `${answer}\n\nI don't have enough data to give you a more detailed answer yet. As you record more invoices, expenses, and customers in Jovalen, I'll be able to give you richer insights.`,
    citations: [],
    suggested: qs || SUGGESTED_QUESTIONS,
  }
}

const handlers = {
  'GET /api/ai/suggested': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    return ok({ questions: SUGGESTED_QUESTIONS })
  },
  'POST /api/ai/ask': async (ctx, body) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const u = userOf(ctx)
    const q = String((body && (body.question || body.q)) || '').trim()
    if (!q) return err(400, 'A question is required')
    const all = await gather(tenantOf(ctx), u)
    logAsked(tenantOf(ctx), u, q)
    return ok(ask(all, u, q))
  },
  'POST /api/ai/action': async (ctx, body) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    const action = b.action || b.id
    switch (action) {
      case 'create-followup': {
        const leadId = Number(b.leadId || 0)
        const r = await callSvc(conf, 'sales', 'GET', `/internal/leads?tid=${tid}&all=1`)
        const lead = ((r.data && r.data.leads) || []).find((l) => l.id === leadId)
        const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
        if (lead) {
          await callSvc(conf, 'tasks', 'POST', '/internal/tasks', { tid, records: [{ title: `Follow up on lead: ${lead.name}`, assigneeId: lead.ownerUserId || ctx.identity.user.id, dueDate: due, priority: 'medium', status: 'todo', createdBy: ctx.identity.user.id }] })
        }
        return ok({ done: true, message: `Follow-up task created for ${lead ? lead.name : 'the lead'} due ${due}.` })
      }
      case 'create-customer': {
        const rec = { name: b.name, company: b.company || '', email: b.email || '', phone: b.phone || '', ownerUserId: b.ownerUserId || ctx.identity.user.id, isLead: false }
        await callSvc(conf, 'crm', 'POST', '/internal/customers', { tid, records: [rec] })
        return ok({ done: true, message: `Customer "${rec.name}" was created.` })
      }
      case 'mark-task-done': {
        const r = await callSvc(conf, 'tasks', 'PATCH', `/internal/tasks/${Number(body.taskId || 0)}/status`, { tid, status: 'done' })
        if (r.status !== 200) return err(400, 'Task not found')
        return ok({ done: true, message: 'Task marked as done.' })
      }
      case 'record-payment': {
        const invoiceId = Number(body.invoiceId || 0)
        const amount = Number(body.amount || 0)
        if (!invoiceId || amount <= 0) return err(400, 'A valid invoice and amount are required')
        await callSvc(conf, 'finance', 'POST', `/api/invoices/${invoiceId}/payments`, { amount, method: body.method || 'Bank transfer' }, ctx.identity.user, ctx.identity.org)
        return ok({ done: true, message: `Payment of ${amount} recorded on invoice #${invoiceId}.` })
      }
      default:
        return err(400, 'Unknown action')
    }
  },
  'GET /internal/context': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const all = await gather(tid, { role: 'owner' })
    return ok({ questions: SUGGESTED_QUESTIONS, summary: describe(all) })
  },
}

function ask(all, u, question) {
  const q = String(question || '').toLowerCase()
  const currency = (all.org && all.org.currency) || 'NGN'
  const has = (words) => words.some((w) => q.includes(w))
  const finBlock = `As a ${u.role}, you don't have permission to view the business's financial records. Ask me about your customers, leads, or tasks instead.`

  if (has(['revenue', 'earned', 'made', 'sales amount', 'income', 'sold'])) {
    if (!canFinance(u)) return noData(finBlock)
    const invoices = periodMatch(all.invoices.filter((i) => i.status !== 'draft'), 'thisMonth')
    const revenue = invoices.reduce((s, i) => s + (i.paidAmount || 0), 0)
    const bill = invoices.reduce((s, i) => s + i.total, 0)
    const citations = invoices.slice(0, 8).map((i) => ({ type: 'invoice', id: i.id, label: `${i.invoiceNumber} · ${money(cur(invoices, currency), i.total)}` }))
    if (invoices.length === 0) return noData('You have not recorded any invoices this month.')
    return {
      answer: `You recorded ${invoices.length} invoice${invoices.length === 1 ? '' : 's'} this month totaling ${fmt(currency, bill)}, with ${fmt(currency, revenue)} received so far. Paid and partial payments are included in the received figure.`,
      citations,
      suggested: ['Who owes us money?', 'Which sales opportunities need attention?', 'Why did our expenses increase?'],
    }
  }

  if (has(['owe', 'owes', 'outstanding', 'overdue', 'debt', 'receivable', 'unpaid', 'money coming', 'balance'])) {
    if (!canFinance(u)) return noData(finBlock)
    const invoices = all.invoices
      .filter((i) => i.status === 'overdue' || i.status === 'partial' || (i.status === 'sent' && overdueDays(i) > 0))
      .map((i) => ({ ...i, outstanding: (i.total || 0) - (i.paidAmount || 0), overdue: overdueDays(i) }))
      .sort((a, b) => b.overdue - a.overdue)
    const totalOutstanding = invoices.reduce((s, i) => s + i.outstanding, 0)
    if (invoices.length === 0) return noData('There are no outstanding or overdue invoices right now.')
    const citations = invoices.slice(0, 10).map((i) => {
      const c = all.customers.find((x) => x.id === i.customerId)
      return { type: 'invoice', id: i.id, label: `${i.invoiceNumber} · ${c ? c.name : 'Unknown customer'} · ${fmt(currency, i.outstanding)}${i.overdue > 0 ? ` · ${i.overdue} day${i.overdue === 1 ? '' : 's'} overdue` : ''}` }
    })
    return {
      answer: `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} have money owing on them, totaling ${fmt(currency, totalOutstanding)}. Overview: ${invoices.filter((i) => i.overdue > 30).length} invoices over 30 days late, ${invoices.filter((i) => i.overdue > 0 && i.overdue <= 30).length} invoices within 30 days of being late, and ${invoices.filter((i) => i.overdue === 0).length} still within their payment window.`,
      citations,
      suggested: ["How much revenue did we make this month?", "Summarize this month's business performance.", 'Which customers have been inactive recently?'],
    }
  }

  if (has(['best', 'top', 'performing', 'important', 'valuable', 'highest value', 'loyal'])) {
    const customers = all.customers
    const invoices = all.invoices.filter((i) => i.status !== 'draft')
    const byCustomer = {}
    invoices.forEach((i) => {
      byCustomer[i.customerId] = (byCustomer[i.customerId] || 0) + (i.paidAmount || 0)
    })
    const ranked = customers.map((c) => ({ ...c, revenue: byCustomer[c.id] || 0 })).sort((a, b) => b.revenue - a.revenue).filter((c) => c.revenue > 0)
    if (ranked.length === 0) return noData('No customer revenue recorded yet.')
    const top = ranked.slice(0, 5)
    const citations = top.map((c) => ({ type: 'customer', id: c.id, label: `${c.name} · ${fmt(currency, c.revenue)} received` }))
    return {
      answer: `Your best-performing customers by received payments are: ${top.map((c, i) => `${i + 1}. ${c.name} (${fmt(currency, c.revenue)})`).join('; ')}. These are ranked by payments actually received, not invoiced amounts.`,
      citations,
      suggested: ['Who owes us money?', 'Which customers have been inactive recently?'],
    }
  }

  if (has(['expense', 'spend', 'cost', 'went up', 'increase', 'spending'])) {
    if (!canFinance(u)) return noData(finBlock)
    const expenses = periodMatch(all.expenses.filter((e) => e.status === 'approved'), 'thisMonth')
    const total = expenses.reduce((s, e) => s + e.amount, 0)
    const byCat = {}
    expenses.forEach((e) => {
      byCat[e.category || 'Other'] = (byCat[e.category || 'Other'] || 0) + e.amount
    })
    if (expenses.length === 0) return noData('No approved expenses recorded yet this month.')
    const prevKeyRef = new Date()
    prevKeyRef.setMonth(prevKeyRef.getMonth() - 1)
    const prevKey = prevKeyRef.toISOString().slice(0, 7)
    const prev = all.expenses.filter((e) => e.status === 'approved' && monthKey(e.date) === prevKey).reduce((s, e) => s + e.amount, 0)
    const delta = prev > 0 ? Math.round(((total - prev) / prev) * 100) : null
    const citations = expenses.slice(0, 8).map((e) => ({ type: 'expense', id: e.id, label: `${e.title} · ${fmt(currency, e.amount)}` }))
    return {
      answer: `Approved expenses this month total ${fmt(currency, total)} across ${expenses.length} record${expenses.length === 1 ? '' : 's'}. ${
        delta === null ? "I don't have last month's expenses to compare against." : delta >= 0 ? `This is up ${delta}% compared to the previous month.` : `This is down ${Math.abs(delta)}% compared to the previous month.`
      } ${expenses.length ? 'Largest categories: ' + Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${fmt(currency, v)})`).join(', ') : ''}`,
      citations,
      suggested: ['How much revenue did we make this month?', 'Who owes us money?'],
    }
  }

  if (has(['pipeline', 'opportunit', 'deals', 'won', 'closing', 'stage', 'sales this month', 'need attention'])) {
    const deals = all.deals.filter((d) => canFinance(u) || d.ownerUserId === u.id)
    const open = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost')
    const totalOpen = open.reduce((s, d) => s + (d.amount || 0), 0)
    if (deals.length === 0) return noData('No deals recorded in the pipeline yet. Create deals from your customers to start tracking opportunities.')
    const soon = open.filter((d) => new Date(d.closeDate).getTime() <= Date.now() + 14 * 86400000)
    const citations = open.slice(0, 10).map((d) => ({ type: 'deal', id: d.id, label: `${d.name} · ${d.stage} · ${fmt(currency, d.amount)}` }))
    return {
      answer: `You have ${open.length} open deal${open.length === 1 ? '' : 's'} worth ${fmt(currency, totalOpen)} across the pipeline. ${soon.length} deal${soon.length === 1 ? '' : 's'} are closing within the next 14 days and need attention. ${open.some((d) => d.stage === 'negotiation') ? 'Negotiation stage deals are your highest-value items to prioritize.' : ''}`,
      citations,
      suggested: ['How much revenue did we make this month?', 'Which customers have been inactive recently?'],
    }
  }

  if (has(['inactive', 'not purchased', 'no activity', 'churn', 'left', 'gone', 'stopped'])) {
    const customers = all.customers
    const invoices = all.invoices
    const lastPurchase = {}
    invoices.forEach((i) => {
      const d = i.issueDate || i.createdAt
      if (!lastPurchase[i.customerId] || d > lastPurchase[i.customerId]) lastPurchase[i.customerId] = d
    })
    const inactive = customers.filter((c) => {
      const days = daysSince(lastPurchase[c.id])
      return !lastPurchase[c.id] && daysSince(c.createdAt) > 60 ? true : days > 60
    })
    if (inactive.length === 0) return noData('No inactive customers detected. Everyone with recorded activity is active within the last 60 days.')
    const citations = inactive.slice(0, 8).map((c) => ({ type: 'customer', id: c.id, label: `${c.name}` }))
    return {
      answer: `${inactive.length} customer${inactive.length === 1 ? '' : 's'} hav${inactive.length === 1 ? 's' : 'e'} not purchased or had recorded activity in 60+ days. Would you like me to help you create follow-up tasks to re-engage them?`,
      citations,
      suggested: ['Which sales opportunities need attention?', 'Show me our best-performing customers.'],
    }
  }

  if (has(['task', 'to do', 'todo', 'overdue task', 'pending work'])) {
    const tasks = all.tasks.filter((t) => canFinance(u) || t.assigneeId === u.id)
    if (tasks.length === 0) return noData('You have no tasks recorded.')
    const open = tasks.filter((t) => t.status !== 'done')
    const overdue = open.filter((t) => new Date(t.dueDate).getTime() < Date.now())
    const citations = open.slice(0, 10).map((t) => ({ type: 'task', id: t.id, label: `${t.title} · ${t.priority} · ${t.status}` }))
    return {
      answer: `You have ${open.length} open task${open.length === 1 ? '' : 's'}, ${overdue.length} of which are past their due date. ${overdue.length ? 'Prioritize the overdue items first.' : 'You are on track with your current workload.'}`,
      citations,
      suggested: ["Summarize this month's business performance.", 'Who owes us money?'],
    }
  }

  if (has(['lead', 'new customer', 'prospect', 'enquiry', 'interested'])) {
    const leads = all.leads.filter((l) => canFinance(u) || l.ownerUserId === u.id)
    if (leads.length === 0) return noData('No leads recorded yet.')
    const open = leads.filter((l) => l.status !== 'converted' && l.status !== 'lost')
    const needFollow = open.filter((l) => l.followUpDate && new Date(l.followUpDate) <= new Date(Date.now() + 3 * 86400000))
    const citations = open.slice(0, 10).map((l) => ({ type: 'lead', id: l.id, label: `${l.name} · ${l.status} · source ${l.source || 'unknown'}` }))
    return {
      answer: `You have ${open.length} open lead${open.length === 1 ? '' : 's'} in your pipeline. ${needFollow.length} lead${needFollow.length === 1 ? '' : 's'} need${needFollow.length === 1 ? 's' : ''} follow-up within the next 3 days. ${leads.filter((l) => l.status === 'converted').length} leads have converted so far.`,
      citations,
      suggested: ['Which sales opportunities need attention?', 'Show me our best-performing customers.'],
    }
  }

  if (has(['summary', 'performance', 'how is the business', 'monthly', 'overview', 'health', 'overall', 'results'])) {
    if (!canFinance(u)) return noData(finBlock)
    const invoices = periodMatch(all.invoices.filter((i) => i.status !== 'draft'), 'thisMonth')
    const revenue = invoices.reduce((s, i) => s + (i.paidAmount || 0), 0)
    const expenses = periodMatch(all.expenses.filter((e) => e.status === 'approved'), 'thisMonth').reduce((s, e) => s + e.amount, 0)
    const outstanding = all.invoices.filter((i) => i.status === 'overdue' || i.status === 'partial' || i.status === 'sent').reduce((s, i) => s + (i.total - (i.paidAmount || 0)), 0)
    const openDeals = all.deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').reduce((s, d) => s + (d.amount || 0), 0)
    if (invoices.length === 0) return noData('No financial activity recorded yet this month.')
    return {
      answer: `This month so far: revenue received ${fmt(currency, revenue)}, approved expenses ${fmt(currency, expenses)}, estimated profit ${fmt(currency, revenue - expenses)}. ${fmt(currency, outstanding)} in customer payments is still outstanding, and the open pipeline is worth ${fmt(currency, openDeals)}.`,
      citations: [
        { type: 'invoice', id: null, label: `${invoices.length} invoices recorded this month` },
        { type: 'expense', id: null, label: `${all.expenses.filter((e) => e.status === 'approved').length} approved expenses recorded` },
      ].filter((c) => c.label),
      suggested: ['Who owes us money?', 'Why did our expenses increase?', 'Which sales opportunities need attention?'],
    }
  }

  if (has(['customer', 'who are', 'contact', 'clients', 'accounts'])) {
    const customers = all.customers
    if (customers.length === 0) return noData('No customers recorded yet.')
    const citations = customers.slice(0, 10).map((c) => ({ type: 'customer', id: c.id, label: c.name }))
    return {
      answer: `You have ${customers.length} customer${customers.length === 1 ? '' : 's'} on record. ${customers.filter((c) => c.status === 'active').length} are active and ${customers.filter((c) => c.status === 'inactive').length} are inactive.`,
      citations,
      suggested: ['Show me our best-performing customers.', 'Which customers have been inactive recently?'],
    }
  }

  if (has(['help', 'what can', 'how do', 'capabilities', 'feature', 'what questions'])) {
    return {
      answer: 'I can answer questions about your business in plain language, such as revenue, outstanding invoices, expenses, sales pipeline, customers, leads, tasks, and overall performance. I always base my answers on your actual records and cite the data behind them.',
      citations: [],
      suggested: SUGGESTED_QUESTIONS,
    }
  }

  return {
    answer: `I couldn't match your question to a specific insight ("${question}"). Try rephrasing it, for example: ${SUGGESTED_QUESTIONS[0]}, ${SUGGESTED_QUESTIONS[1]}, or ${SUGGESTED_QUESTIONS[2]}. I only answer from your authorized business data.`,
    citations: [],
    suggested: SUGGESTED_QUESTIONS,
  }
}

function fmt(currency, n) {
  return `${currency || ''} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim()
}

function describe(all) {
  return `Business summary: ${all.customers.length} customers, ${all.leads.length} leads, ${all.deals.length} deals (worth ${fmt((all.org && all.org.currency) || 'NGN', all.deals.reduce((s, d) => s + (d.value || d.amount || 0), 0))}), ${all.invoices.length} invoices, ${all.expenses.length} expenses, ${all.tasks.length} tasks.`
}

function logAsked(tid, u, q) {
  callSvc(conf, 'workspace', 'POST', '/internal/activity', { tid, type: 'ai', action: 'asked', entityId: 0, label: String(q).trim().slice(0, 80) }).catch(() => {})
}

async function gather(tid, u) {
  const out = { org: null, customers: [], leads: [], deals: [], invoices: [], payments: [], expenses: [], products: [], tasks: [] }
  try {
    const r = await callSvc(conf, 'workspace', 'GET', `/internal/tenants`)
    const ts = (r.data && r.data.tenants) || []
    out.org = ts.find((t) => t.tid === tid) || null
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
    const f = await callSvc(conf, 'finance', 'GET', `/internal/financials?tid=${tid}`)
    out.invoices = (f.data && f.data.invoices) || []
    out.payments = (f.data && f.data.payments) || []
    out.expenses = (f.data && f.data.expenses) || []
  } catch {}
  try {
    const p = await callSvc(conf, 'catalog', 'GET', `/internal/products?tid=${tid}&all=1&withstock=1`)
    out.products = (p.data && p.data.products) || []
  } catch {}
  try {
    const t = await callSvc(conf, 'tasks', 'GET', `/internal/tasks?tid=${tid}&all=1`)
    out.tasks = (t.data && t.data.tasks) || []
  } catch {}
  return out
}

createService('ai', handlers)