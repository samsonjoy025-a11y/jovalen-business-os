import { list } from './store.js'

export const SUGGESTED_QUESTIONS = [
  'How much revenue did we make this month?',
  'Who owes us money?',
  'Which sales opportunities need attention?',
  'Show me our best-performing customers.',
  'Why did our expenses increase?',
  'Which customers have been inactive recently?',
  'Summarize this month\'s business performance.',
  'What tasks are overdue?',
]

const ROLES = { owner: 5, finance: 4, sales: 3, staff: 1 }

export function canAccessFinance(user) {
  return ROLES[user.role] >= 4
}

export function userScope(user) {
  if (user.role === 'owner' || user.role === 'finance') return null
  return user.id
}

function money(currency, n) {
  return `${currency || ''} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim()
}

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function monthKey(dateStr) {
  return String(dateStr || '').slice(0, 7)
}

function thisMonthKey() {
  return new Date().toISOString().slice(0, 7)
}

function daysBetween(dateStr) {
  const d = new Date(dateStr).getTime()
  if (!d) return Infinity
  return Math.floor((Date.now() - d) / 86400000)
}

function overdueDays(invoice) {
  const due = new Date(invoice.dueDate).getTime()
  if (invoice.status === 'paid') return 0
  return Math.max(0, Math.floor((Date.now() - due) / 86400000))
}

function collectInvoices(tenant, user) {
  return list(tenant, 'invoices')
}

function collectExpenses(tenant, user) {
  return list(tenant, 'expenses')
}

function collectDeals(tenant, user) {
  const scope = userScope(user)
  return scope ? list(tenant, 'deals').filter((d) => d.ownerUserId === scope) : list(tenant, 'deals')
}

function collectLeads(tenant, user) {
  const scope = userScope(user)
  return scope ? list(tenant, 'leads').filter((l) => l.ownerUserId === scope) : list(tenant, 'leads')
}

function collectCustomers(tenant, user) {
  return list(tenant, 'customers')
}

function collectTasks(tenant, user) {
  const scope = userScope(user)
  return scope ? list(tenant, 'tasks').filter((t) => t.assigneeId === scope) : list(tenant, 'tasks')
}

function periodMatch(records, periodKey) {
  if (periodKey === 'thisMonth') return records.filter((r) => monthKey(r.createdAt || r.issueDate) === thisMonthKey())
  return records
}

function suggest(questions) {
  return questions || SUGGESTED_QUESTIONS
}

function noData(answer, citations, qs) {
  return {
    answer: `${answer}\n\nI don't have enough data to give you a more detailed answer yet. As you record more invoices, expenses, and customers in Jovalen, I'll be able to give you richer insights.`,
    citations: citations || [],
    suggested: suggest(qs),
  }
}

export function askBI(tenant, user, question) {
  const q = String(question || '').toLowerCase()
  const currency = tenant.currency || 'NGN'
  const scope = userScope(user)
  const canFinance = canAccessFinance(user)

  const has = (words) => words.some((w) => q.includes(w))

  if (has(['revenue', 'earned', 'made', 'sales amount', 'income', 'sold'])) {
    if (!canFinance) return noData(`As a ${user.role}, you don't have permission to view the business's financial records. Ask me about your customers, leads, or tasks instead.`, [], [])
    const invoices = periodMatch(collectInvoices(tenant, user).filter((i) => i.status !== 'draft'), 'thisMonth')
    const revenue = invoices.reduce((s, i) => s + (i.paidAmount || 0), 0)
    const bill = invoices.reduce((s, i) => s + i.total, 0)
    const citations = invoices.slice(0, 8).map((i) => ({ type: 'invoice', id: i.id, label: `${i.invoiceNumber} · ${money(currency, i.total)}` }))
    if (invoices.length === 0) return noData('You have not recorded any invoices this month.', [], [])
    return {
      answer: `You recorded ${invoices.length} invoice${invoices.length === 1 ? '' : 's'} this month totaling ${money(currency, bill)}, with ${money(currency, revenue)} received so far. Paid and partial payments are included in the received figure.`,
      citations,
      suggested: suggest(['Who owes us money?', 'Which sales opportunities need attention?', 'Why did our expenses increase?']),
    }
  }

  if (has(['owe', 'owes', 'outstanding', 'overdue', 'debt', 'receivable', 'unpaid', 'money coming', 'balance'])) {
    if (!canFinance) return noData(`As a ${user.role}, you don't have permission to view the business's financial records.`, [], [])
    const invoices = list(tenant, 'invoices')
      .filter((i) => i.status === 'overdue' || i.status === 'partial' || (i.status === 'sent' && overdueDays(i) > 0))
      .map((i) => ({
        ...i,
        outstanding: (i.total || 0) - (i.paidAmount || 0),
        overdue: overdueDays(i),
      }))
      .sort((a, b) => b.overdue - a.overdue)
    const customers = list(tenant, 'customers')
    const totalOutstanding = invoices.reduce((s, i) => s + i.outstanding, 0)
    if (invoices.length === 0) return noData('There are no outstanding or overdue invoices right now.', [], [])
    const citations = invoices.slice(0, 10).map((i) => {
      const c = customers.find((x) => x.id === i.customerId)
      return { type: 'invoice', id: i.id, label: `${i.invoiceNumber} · ${c ? c.name : 'Unknown customer'} · ${money(currency, i.outstanding)}${i.overdue > 0 ? ` · ${i.overdue} day${i.overdue === 1 ? '' : 's'} overdue` : ''}` }
    })
    return {
      answer: `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} have money owing on them, totaling ${money(currency, totalOutstanding)}. Overview: ${invoices.filter((i) => i.overdue > 30).length} invoices over 30 days late, ${invoices.filter((i) => i.overdue > 0 && i.overdue <= 30).length} invoices within 30 days of being late, and ${invoices.filter((i) => i.overdue === 0).length} still within their payment window.`,
      citations,
      suggested: suggest(['How much revenue did we make this month?', 'Summarize this month\'s business performance.', 'Which customers have been inactive recently?']),
    }
  }

  if (has(['best', 'top', 'performing', 'important', 'valuable', 'highest value', 'loyal'])) {
    const customers = collectCustomers(tenant, user)
    const invoices = list(tenant, 'invoices').filter((i) => i.status !== 'draft')
    const byCustomer = {}
    invoices.forEach((i) => {
      byCustomer[i.customerId] = (byCustomer[i.customerId] || 0) + (i.paidAmount || 0)
    })
    const ranked = customers
      .map((c) => ({ ...c, revenue: byCustomer[c.id] || 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .filter((c) => c.revenue > 0)
    if (ranked.length === 0) return noData('No customer revenue recorded yet.', [], [])
    const top = ranked.slice(0, 5)
    const citations = top.map((c) => ({ type: 'customer', id: c.id, label: `${c.name} · ${money(currency, c.revenue)} received` }))
    return {
      answer: `Your best-performing customers by received payments are: ${top.map((c, i) => `${i + 1}. ${c.name} (${money(currency, c.revenue)})`).join('; ')}. These are ranked by payments actually received, not invoiced amounts.`,
      citations,
      suggested: suggest(['Who owes us money?', 'Which customers have been inactive recently?']),
    }
  }

  if (has(['expense', 'spend', 'cost', 'went up', 'increase', 'spending'])) {
    if (!canFinance) return noData(`As a ${user.role}, you don't have permission to view the business's financial records.`, [], [])
    const expenses = periodMatch(collectExpenses(tenant, user).filter((e) => e.status === 'approved'), 'thisMonth')
    const total = expenses.reduce((s, e) => s + e.amount, 0)
    const byCat = {}
    expenses.forEach((e) => {
      byCat[e.category || 'Other'] = (byCat[e.category || 'Other'] || 0) + e.amount
    })
    if (expenses.length === 0) return noData('No approved expenses recorded yet this month.', [], [])
    const ref = new Date()
    ref.setMonth(ref.getMonth() - 1)
    const prevKey = ref.toISOString().slice(0, 7)
    const prev = list(tenant, 'expenses')
      .filter((e) => e.status === 'approved' && monthKey(e.date) === prevKey)
      .reduce((s, e) => s + e.amount, 0)
    const delta = prev > 0 ? Math.round(((total - prev) / prev) * 100) : null
    const citations = expenses.slice(0, 8).map((e) => ({ type: 'expense', id: e.id, label: `${e.title} · ${money(currency, e.amount)}` }))
    return {
      answer: `Approved expenses this month total ${money(currency, total)} across ${expenses.length} record${expenses.length === 1 ? '' : 's'}. ${
        delta === null ? "I don't have last month's expenses to compare against." : delta >= 0 ? `This is up ${delta}% compared to the previous month.` : `This is down ${Math.abs(delta)}% compared to the previous month.`
      } ${expenses.length ? 'Largest categories: ' + Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${money(currency, v)})`).join(', ') : ''}`,
      citations,
      suggested: suggest(['How much revenue did we make this month?', 'Who owes us money?']),
    }
  }

  if (has(['pipeline', 'opportunit', 'deals', 'won', 'closing', 'stage', 'sales this month', 'need attention'])) {
    const deals = collectDeals(tenant, user)
    const open = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost')
    const totalOpen = open.reduce((s, d) => s + (d.amount || 0), 0)
    if (deals.length === 0) return noData('No deals recorded in the pipeline yet. Create deals from your customers to start tracking opportunities.', [], [])
    const soon = open.filter((d) => new Date(d.closeDate).getTime() <= Date.now() + 14 * 86400000)
    const citations = open.slice(0, 10).map((d) => ({ type: 'deal', id: d.id, label: `${d.name} · ${d.stage} · ${money(currency, d.amount)}` }))
    return {
      answer: `You have ${open.length} open deal${open.length === 1 ? '' : 's'} worth ${money(currency, totalOpen)} across the pipeline. ${soon.length} deal${soon.length === 1 ? '' : 's'} are closing within the next 14 days and need attention. ${open.some((d) => d.stage === 'negotiation') ? 'Negotiation stage deals are your highest-value items to prioritize.' : ''}`,
      citations,
      suggested: suggest(['How much revenue did we make this month?', 'Which customers have been inactive recently?']),
    }
  }

  if (has(['inactive', 'not purchased', 'no activity', 'churn', 'left', 'gone', 'stopped'])) {
    const customers = collectCustomers(tenant, user)
    const invoices = list(tenant, 'invoices')
    const lastPurchase = {}
    invoices.forEach((i) => {
      const d = i.issueDate || i.createdAt
      if (!lastPurchase[i.customerId] || d > lastPurchase[i.customerId]) lastPurchase[i.customerId] = d
    })
    const inactive = customers.filter((c) => {
      const days = daysBetween(lastPurchase[c.id])
      return !lastPurchase[c.id] && daysBetween(c.createdAt) > 60 ? true : days > 60
    })
    if (inactive.length === 0) return noData('No inactive customers detected. Everyone with recorded activity is active within the last 60 days.', [], [])
    const citations = inactive.slice(0, 8).map((c) => ({ type: 'customer', id: c.id, label: `${c.name}` }))
    return {
      answer: `${inactive.length} customer${inactive.length === 1 ? '' : 's'} hav${inactive.length === 1 ? 's' : 'e'} not purchased or had recorded activity in 60+ days. Would you like me to help you create follow-up tasks to re-engage them?`,
      citations,
      suggested: suggest(['Which sales opportunities need attention?', 'Show me our best-performing customers.']),
    }
  }

  if (has(['task', 'to do', 'todo', 'overdue task', 'pending work'])) {
    const tasks = collectTasks(tenant, user)
    if (tasks.length === 0) return noData('You have no tasks recorded.', [], [])
    const open = tasks.filter((t) => t.status !== 'done')
    const overdue = open.filter((t) => yearsAhead(t.dueDate) < 0)
    const citations = open.slice(0, 10).map((t) => ({ type: 'task', id: t.id, label: `${t.title} · ${t.priority} · ${t.status}` }))
    return {
      answer: `You have ${open.length} open task${open.length === 1 ? '' : 's'}, ${overdue.length} of which are past their due date. ${overdue.length ? 'Prioritize the overdue items first.' : 'You are on track with your current workload.'}`,
      citations,
      suggested: suggest(['Summarize this month\'s business performance.', 'Who owes us money?']),
    }
  }

  if (has(['lead', 'new customer', 'prospect', 'enquiry', 'enquiry', 'interested'])) {
    const leads = collectLeads(tenant, user)
    if (leads.length === 0) return noData('No leads recorded yet.', [], [])
    const open = leads.filter((l) => l.status !== 'converted' && l.status !== 'lost')
    const needFollow = open.filter((l) => l.followUpDate && new Date(l.followUpDate) <= new Date(Date.now() + 3 * 86400000))
    const citations = open.slice(0, 10).map((l) => ({ type: 'lead', id: l.id, label: `${l.name} · ${l.status} · source ${l.source || 'unknown'}` }))
    return {
      answer: `You have ${open.length} open lead${open.length === 1 ? '' : 's'} in your pipeline. ${needFollow.length} lead${needFollow.length === 1 ? '' : 's'} need${needFollow.length === 1 ? 's' : ''} follow-up within the next 3 days. ${leads.filter((l) => l.status === 'converted').length} leads have converted so far.`,
      citations,
      suggested: suggest(['Which sales opportunities need attention?', 'Show me our best-performing customers.']),
    }
  }

  if (has(['summary', 'performance', 'how is the business', 'monthly', 'overview', 'health', 'overall', 'results'])) {
    if (!canFinance) return noData(`As a ${user.role}, you don't have permission to view the full business summary. Ask me about your customers, leads, or tasks instead.`, [], [])
    const invoices = periodMatch(list(tenant, 'invoices').filter((i) => i.status !== 'draft'), 'thisMonth')
    const revenue = invoices.reduce((s, i) => s + (i.paidAmount || 0), 0)
    const expenses = periodMatch(list(tenant, 'expenses').filter((e) => e.status === 'approved'), 'thisMonth').reduce((s, e) => s + e.amount, 0)
    const outstanding = list(tenant, 'invoices')
      .filter((i) => i.status === 'overdue' || i.status === 'partial' || i.status === 'sent')
      .reduce((s, i) => s + (i.total - (i.paidAmount || 0)), 0)
    const openDeals = list(tenant, 'deals').filter((d) => d.stage !== 'won' && d.stage !== 'lost').reduce((s, d) => s + (d.amount || 0), 0)
    if (invoices.length === 0) return noData('No financial activity recorded yet this month.', [], [])
    return {
      answer: `This month so far: revenue received ${money(currency, revenue)}, approved expenses ${money(currency, expenses)}, estimated profit ${money(currency, revenue - expenses)}. ${money(currency, outstanding)} in customer payments is still outstanding, and the open pipeline is worth ${money(currency, openDeals)}.`,
      citations: [
        { type: 'invoice', id: null, label: `${invoices.length} invoices recorded this month` },
        { type: 'expense', id: null, label: `${list(tenant, 'expenses').filter((e) => e.status === 'approved').length} approved expenses recorded` },
      ].filter((c) => c.id || c.label),
      suggested: suggest(['Who owes us money?', 'Why did our expenses increase?', 'Which sales opportunities need attention?']),
    }
  }

  if (has(['customer', 'who are', 'contact', 'clients', 'accounts'])) {
    const customers = collectCustomers(tenant, user)
    if (customers.length === 0) return noData('No customers recorded yet.', [], [])
    const citations = customers.slice(0, 10).map((c) => ({ type: 'customer', id: c.id, label: c.name }))
    return {
      answer: `You have ${customers.length} customer${customers.length === 1 ? '' : 's'} on record. ${customers.filter((c) => c.status === 'active').length} are active and ${customers.filter((c) => c.status === 'inactive').length} are inactive.`,
      citations,
      suggested: suggest(['Show me our best-performing customers.', 'Which customers have been inactive recently?']),
    }
  }

  if (has(['help', 'what can', 'how do', 'capabilities', 'feature', 'what questions'])) {
    return {
      answer: 'I can answer questions about your business in plain language, such as revenue, outstanding invoices, expenses, sales pipeline, customers, leads, tasks, and overall performance. I always base my answers on your actual records and cite the data behind them.',
      citations: [],
      suggested: suggest(),
    }
  }

  return {
    answer: `I couldn't match your question to a specific insight ("${question}"). Try rephrasing it, for example: ${SUGGESTED_QUESTIONS[0]}, ${SUGGESTED_QUESTIONS[1]}, or ${SUGGESTED_QUESTIONS[2]}. I only answer from your authorized business data.`,
    citations: [],
    suggested: suggest(),
  }
}

function yearsAhead(dateStr) {
  const d = new Date(dateStr).getTime()
  if (!d) return 0
  return d - Date.now()
}