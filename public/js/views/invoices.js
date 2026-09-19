import { api, J, money, esc, pill, fmtDate } from '../api.js'
import { openDrawer, closeOverlay, confirmDelete, toast } from '../app.js'

let invoices = []
let customers = []
let products = []

export function init() {
  J.actions['invoice-new'] = () => invoiceForm()
  J.actions['invoice-edit'] = (el) => invoiceForm(invoices.find((i) => i.id === Number(el.dataset.id)))
  J.actions['invoice-detail'] = (el) => invoiceDetail(invoices.find((i) => i.id === Number(el.dataset.id)))
  J.actions['invoice-pay'] = (el) => payForm(invoices.find((i) => i.id === Number(el.dataset.id)))
  J.actions['invoice-delete'] = async (el) => {
    const i = invoices.find((x) => x.id === Number(el.dataset.id))
    if (!i || !confirmDelete(`Delete invoice ${i.invoiceNumber}?`)) return
    await api('DELETE', `/api/invoices/${i.id}`)
    toast('Invoice deleted')
    window.location.reload()
  }
  J.actions['li-add'] = (el) => addLine(el.dataset.list)
  J.actions['li-remove'] = (el) => removeLine(el.dataset.list, el.dataset.index)
  J.forms['invoice-form'] = async (form, ev) => {
    ev.preventDefault()
    const lineRows = Array.from(form.querySelectorAll('tr[data-line]'))
    const lineItems = lineRows.map((r) => ({
      productId: r.querySelector('[data-product]').value ? Number(r.querySelector('[data-product]').value) : null,
      name: r.querySelector('[data-name]').value.trim(),
      qty: Number(r.querySelector('[data-qty]').value || 1),
      unitPrice: Number(r.querySelector('[data-price]').value || 0),
    }))
    if (!lineItems.length) return toast('Add at least one line item')
    const body = { customerId: Number(form.customerId.value), dueDate: form.dueDate.value || undefined, lineItems }
    const res = await api('POST', '/api/invoices', body)
    toast(`Invoice ${res.invoice.invoiceNumber} created`)
    closeOverlay()
    window.location.reload()
  }
  J.forms['pay-form'] = async (form, ev) => {
    ev.preventDefault()
    const res = await api('POST', `/api/invoices/${form.dataset.id}/payments`, {
      amount: Number(form.amount.value),
      method: form.method.value,
      date: form.date.value || undefined,
      note: form.note.value.trim(),
    })
    toast(`Payment recorded — invoice updated`)
    closeOverlay()
    window.location.reload()
  }
}

function addLine(listId) {
  const tbody = document.querySelector(`#${listId} tbody`)
  const row = document.createElement('tr')
  row.setAttribute('data-line', '')
  const options = products.map((p) => `<option value="${p.id}" data-price="${p.unitPrice}">${esc(p.name)}</option>`).join('')
  row.innerHTML = `
    <td><select data-product>${options}</select></td>
    <td><input data-name value="" placeholder="Description" /></td>
    <td><input data-qty type="number" min="1" value="1" style="width:70px" /></td>
    <td><input data-price type="number" min="0" step="any" value="0" style="width:110px" /></td>
    <td><button type="button" class="btn btn-sm btn-danger" data-action="li-remove" data-list="${listId}" data-index="${tbody.children.length}">×</button></td>`
  tbody.appendChild(row)
  row.querySelector('[data-product]').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0]
    if (opt && opt.dataset.price !== undefined) row.querySelector('[data-price]').value = opt.dataset.price
  })
  row.querySelector('[data-product]').dispatchEvent(new Event('change'))
}

function removeLine(listId, index) {
  const tbody = document.querySelector(`#${listId} tbody`)
  const row = tbody.querySelectorAll('tr[data-line]')[index]
  if (row) row.remove()
}

export async function render() {
  const res = await api('GET', '/api/invoices')
  invoices = res.invoices
  customers = res.customers
  const prodRes = await api('GET', '/api/products')
  products = prodRes.products

  const filter = window.location.hash.split('?')[1] && window.location.hash.split('?')[1].replace('filter=', '')
  const shown = filter && filter !== 'all' ? invoices.filter((i) => i.status === filter) : invoices

  const statusFilter = `<select id="status-filter" onchange="location.hash='/invoices?filter='+this.value">
    <option value="all">All statuses</option>
    ${['sent', 'partial', 'overdue', 'paid', 'draft'].map((s) => `<option value="${s}" ${filter === s ? 'selected' : ''}>${s}</option>`).join('')}
  </select>`

  const rows = shown
    .slice()
    .sort((a, b) => new Date(b.issueDate || 0) - new Date(a.issueDate || 0))
    .map((i) => {
      const late = (i.status === 'sent' || i.status === 'partial' || i.status === 'overdue') && new Date(i.dueDate).getTime() < Date.now()
      return `<tr>
        <td><strong>${esc(i.invoiceNumber)}</strong><br><span class="muted" style="font-size:.78rem">${esc(i.customerName)}</span></td>
        <td class="muted">${fmtDate(i.issueDate)}</td>
        <td class="muted">${fmtDate(i.dueDate)}${late ? ' ⚠️' : ''}</td>
        <td>${money(i.total, J.session.org.currency)}</td>
        <td>${i.outstanding > 0 ? `<span style="color:var(--danger);font-weight:700">${money(i.outstanding, J.session.org.currency)}</span>` : '—'}</td>
        <td>${pill(i.status)}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm" data-action="invoice-detail" data-id="${i.id}">View</button>
          <button class="btn btn-sm btn-primary" data-action="invoice-pay" data-id="${i.id}" ${i.status === 'paid' ? 'disabled' : ''}>Payment</button>
          <button class="btn btn-sm btn-danger" data-action="invoice-delete" data-id="${i.id}">Del</button>
        </div></td>
      </tr>`
    })
    .join('')

  const totals = invoices.reduce(
    (t, i) => {
      t.total += i.total
      t.outstanding += i.outstanding
      return t
    },
    { total: 0, outstanding: 0 }
  )

  return `
  <div class="maxw">
    <div class="view-head"><h2>Invoices</h2><div class="page-actions">${statusFilter}<button class="btn btn-primary" data-action="invoice-new">+ New invoice</button></div></div>
    <div class="stat-grid">
      <div class="stat"><div class="stat-label">Total invoiced</div><div class="stat-value">${money(totals.total, J.session.org.currency)}</div></div>
      <div class="stat red"><div class="stat-label">Outstanding</div><div class="stat-value">${money(totals.outstanding, J.session.org.currency)}</div></div>
      <div class="stat indigo"><div class="stat-label">Invoices</div><div class="stat-value">${invoices.length}</div><div class="stat-sub">${invoices.filter((i) => i.status === 'overdue').length} overdue</div></div>
    </div>
    <div class="card">
      ${
        invoices.length
          ? `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Issue date</th><th>Due date</th><th>Total</th><th>Outstanding</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
          : `<div class="empty"><div class="big">🧾</div>No invoices yet. Create one to start tracking who owes the business money.<br><button class="btn btn-primary mt" data-action="invoice-new">Create invoice</button></div>`
      }
    </div>
  </div>`
}

function invoiceForm() {
  const lineListId = 'li-tbody-' + Date.now()
  const customerOptions = customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
  const productOptions = products.map((p) => `<option value="${p.id}" data-price="${p.unitPrice}">${esc(p.name)}</option>`).join('')
  openDrawer(`
    <div class="dialog-head"><h3>New invoice</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <form data-form="invoice-form">
      <label>Customer<select name="customerId">${customerOptions}</select></label>
      <label>Due date<input type="date" name="dueDate" /></label>
      <div class="card-title">Line items</div>
      <div class="table-wrap"><table id="${lineListId}">
        <thead><tr><th>Product</th><th>Description</th><th>Qty</th><th>Unit price</th><th></th></tr></thead>
        <tbody></tbody>
      </table></div>
      <button type="button" class="btn btn-sm" data-action="li-add" data-list="${lineListId}">+ Add line item</button>
      <div class="row-actions" style="justify-content:flex-end;margin-top:12px">
        <button type="button" class="btn" data-action="drawer-close">Cancel</button>
        <button type="submit" class="btn btn-primary">Create invoice</button>
      </div>
    </form>
  `)
  requestAnimationFrame(() => document.querySelector(`[data-list="${lineListId}"]`).click())
}

function invoiceDetail(invoice) {
  if (!invoice) return
  const cust = customers.find((c) => c.id === invoice.customerId)
  const lineRows = (invoice.lineItems || [])
    .map((l) => `<tr><td>${esc(l.name)}</td><td>${l.qty}</td><td>${money(l.unitPrice, J.session.org.currency)}</td><td>${money(l.total, J.session.org.currency)}</td></tr>`)
    .join('')
  openDrawer(`
    <div class="dialog-head"><h3>${esc(invoice.invoiceNumber)}</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <div class="card card-pad" style="margin-bottom:14px">
      <div class="flex between"><strong>${esc(cust ? cust.name : 'Unknown')}</strong>${pill(invoice.status)}</div>
      <div class="muted" style="font-size:.85rem;margin-top:6px">Issued ${fmtDate(invoice.issueDate)} · Due ${fmtDate(invoice.dueDate)}</div>
      <div style="font-size:1.3rem;font-weight:800;margin-top:10px">${money(invoice.total, J.session.org.currency)}</div>
      <div class="muted">Paid ${money(invoice.paidAmount, J.session.org.currency)} · Outstanding <span style="color:var(--danger)">${money(invoice.outstanding, J.session.org.currency)}</span></div>
    </div>
    <div class="card"><div class="card-pad">
      <div class="card-title">Line items</div>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${lineRows}</tbody></table></div>
    </div></div>
    <button class="btn btn-primary btn-block mt" data-action="invoice-pay" data-id="${invoice.id}" ${invoice.status === 'paid' ? 'disabled' : ''}>Record payment</button>
  `)
}

function payForm(invoice) {
  if (!invoice) return
  const remaining = invoice.outstanding
  openDrawer(`
    <div class="dialog-head"><h3>Record payment — ${esc(invoice.invoiceNumber)}</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <form data-form="pay-form" data-id="${invoice.id}">
      <p class="hint">Outstanding balance: <strong>${money(remaining, J.session.org.currency)}</strong>. Part payments are supported and update the invoice status automatically.</p>
      <div class="grid-2">
        <label>Amount<input type="number" name="amount" min="0.01" step="any" max="${remaining}" required /></label>
        <label>Date<input type="date" name="date" /></label>
      </div>
      <label>Method<select name="method">
        <option>Bank transfer</option><option>Cash</option><option>Mobile money</option><option>Card</option><option>Cheque</option>
      </select></label>
      <label>Note<input name="note" placeholder="Optional reference" /></label>
      <div class="row-actions" style="justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn" data-action="drawer-close">Cancel</button>
        <button type="submit" class="btn btn-primary">Record payment</button>
      </div>
    </form>
  `)
}