import { api, J, money, esc, pill, fmtDate } from '../api.js'
import { toast } from '../app.js'

let expenses = []

export function init() {
  J.actions['expense-approve'] = async (el) => await decide(el.dataset.id, true)
  J.actions['expense-reject'] = async (el) => await decide(el.dataset.id, false)
}

async function decide(id, approved) {
  try {
    const res = await api('POST', `/api/expenses/${id}/approve`, { approved })
    toast(approved ? 'Expense approved' : 'Expense rejected')
    window.location.reload()
  } catch (e) {
    toast(e.message)
  }
}

export async function render() {
  const isFin = J.session.user.role === 'owner' || J.session.user.role === 'finance'
  if (!isFin) {
    return `<div class="maxw"><div class="card card-pad">This view is for the owner and finance roles.</div></div>`
  }
  const res = await api('GET', '/api/expenses')
  expenses = res.expenses

  const pending = expenses.filter((e) => e.status === 'pending')
  const decided = expenses.filter((e) => e.status !== 'pending')
  const totalPending = pending.reduce((s, e) => s + e.amount, 0)

  const pendingRows = pending
    .map((e) => {
      return `
      <div class="card card-pad" style="margin-bottom:10px">
        <div class="flex between wrap">
          <div>
            <strong>${esc(e.title)}</strong>
            <div class="muted" style="font-size:.85rem">${esc(e.category)} · ${fmtDate(e.date)} · submitted by ${esc(e.submittedByName || e.submittedBy || '')}</div>
            <div class="muted" style="font-size:.85rem">${esc(e.note || '')}</div>
          </div>
          <div class="flex">
            <strong style="font-size:1.1rem">${money(e.amount, J.session.org.currency)}</strong>
            <button class="btn btn-sm btn-primary" data-action="expense-approve" data-id="${e.id}">Approve</button>
            <button class="btn btn-sm btn-danger" data-action="expense-reject" data-id="${e.id}">Reject</button>
          </div>
        </div>
      </div>`
    })
    .join('')

  const historyRows = decided
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .map((e) => {
      return `<tr>
        <td><strong>${esc(e.title)}</strong><br><span class="muted" style="font-size:.78rem">${esc(e.submittedByName || e.submittedBy || '')}</span></td>
        <td>${money(e.amount, J.session.org.currency)}</td>
        <td class="muted">${fmtDate(e.date)}</td>
        <td>${pill(e.status)}</td>
        <td class="muted">${esc(e.approvedByName || '—')}</td>
      </tr>`
    })
    .join('')

  return `
  <div class="maxw stack">
    <div class="view-head"><h2>Expense approvals</h2></div>
    <div class="stat-grid">
      <div class="stat amber"><div class="stat-label">Awaiting decision</div><div class="stat-value">${pending.length}</div></div>
      <div class="stat red"><div class="stat-label">Pending value</div><div class="stat-value">${money(totalPending, J.session.org.currency)}</div></div>
    </div>
    <div>
      <h3 class="card-title">To review (${pending.length})</h3>
      ${pending.length ? pendingRows : `<div class="empty"><div class="big">🎉</div>All caught up — no expenses waiting for approval.</div>`}
    </div>
    <div class="card">
      <div class="card-pad"><h3 class="card-title">Decision history</h3></div>
      ${decided.length ? `<div class="table-wrap"><table><thead><tr><th>Expense</th><th>Amount</th><th>Date</th><th>Status</th><th>Reviewed by</th></tr></thead><tbody>${historyRows}</tbody></table></div>` : `<div class="empty">No decisions yet.</div>`}
    </div>
  </div>`
}