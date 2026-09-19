import { api, J, money, esc, pill, fmtDate } from '../api.js'
import { openDrawer, closeOverlay, toast } from '../app.js'

let expenses = []
let canApprove = false
let isOwnerOrFinance = false

export function init() {
  J.actions['expense-new'] = () => expenseForm()
  J.forms['expense-form'] = async (form, ev) => {
    ev.preventDefault()
    const body = {
      title: form.title.value.trim(),
      category: form.category.value,
      amount: Number(form.amount.value),
      date: form.date.value || undefined,
      note: form.note.value.trim(),
    }
    const res = await api('POST', '/api/expenses', body)
    toast('Expense submitted for approval')
    closeOverlay()
    window.location.reload()
  }
}

export async function render() {
  isOwnerOrFinance = J.session.user.role === 'owner' || J.session.user.role === 'finance'
  const res = await api('GET', '/api/expenses')
  expenses = res.expenses
  canApprove = res.canApprove

  const filter = window.location.hash.split('?')[1] && window.location.hash.split('?')[1].replace('filter=', '')
  const shown = filter && filter !== 'all' ? expenses.filter((e) => e.status === filter) : expenses

  const statusFilter = `<select id="exp-filter" onchange="location.hash='/expenses?filter='+this.value">
    <option value="all">All</option>
    ${['pending', 'approved', 'rejected'].map((s) => `<option value="${s}" ${filter === s ? 'selected' : ''}>${s}</option>`).join('')}
  </select>`

  const rows = shown
    .slice()
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .map((e) => {
      const submitter = J.session.user.role === 'staff' || J.session.user.role === 'sales' ? '' : `<br><span class="muted" style="font-size:.78rem">${esc(e.submittedByName || e.submittedBy || '')}</span>`
      return `<tr>
        <td><strong>${esc(e.title)}</strong>${submitter}</td>
        <td class="muted">${esc(e.category || 'Other')}</td>
        <td>${money(e.amount, J.session.org.currency)}</td>
        <td class="muted">${fmtDate(e.date)}</td>
        <td>${pill(e.status)}</td>
        <td class="muted">${esc(e.approvedByName || '—')}</td>
      </tr>`
    })
    .join('')

  return `
  <div class="maxw">
    <div class="view-head"><h2>Expenses</h2><div class="page-actions">${statusFilter}<button class="btn btn-primary" data-action="expense-new">+ Submit expense</button></div></div>
    <div class="card">
      ${
        expenses.length
          ? `<div class="table-wrap"><table><thead><tr><th>Expense</th><th>Category</th><th>Amount</th><th>Date</th><th>Status</th><th>Approved by</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : `<div class="empty"><div class="big">💸</div>No expenses recorded yet.</div>`
      }
    </div>
    ${canApprove ? `<p class="hint mt"><a href="#/approvals">Review pending expenses →</a></p>` : ''}
  </div>`
}

function expenseForm() {
  openDrawer(`
    <div class="dialog-head"><h3>Submit expense</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <form data-form="expense-form">
      <label>Title<input name="title" placeholder="e.g. Fuel for deliveries" required /></label>
      <div class="grid-2">
        <label>Category<select name="category">
          ${['Rent', 'Utilities', 'Marketing', 'Transport', 'Supplies', 'Salaries', 'Operations', 'Other'].map((c) => `<option>${c}</option>`).join('')}
        </select></label>
        <label>Amount<input type="number" name="amount" min="0.01" step="any" required /></label>
      </div>
      <label>Date<input type="date" name="date" /></label>
      <label>Note<input name="note" placeholder="Optional" /></label>
      <div class="row-actions" style="justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn" data-action="drawer-close">Cancel</button>
        <button type="submit" class="btn btn-primary">Submit for approval</button>
      </div>
    </form>
    <p class="hint">Submitted expenses go into the approval queue for the owner or finance team.</p>
  `)
}