import { api, J, money, esc, pill, avatar, fmtDate } from '../api.js'
import { openDrawer, closeOverlay, dialog, confirmDelete, toast } from '../app.js'

let customers = []

export function init() {
  J.actions['customer-new'] = () => customerForm(null)
  J.actions['customer-edit'] = (el) => customerForm(customers.find((c) => c.id === Number(el.dataset.id)))
  J.actions['customer-delete'] = async (el) => {
    const c = customers.find((x) => x.id === Number(el.dataset.id))
    if (!c || !confirmDelete(`Delete customer "${c.name}"? This does not delete their invoices.`)) return
    await api('DELETE', `/api/customers/${c.id}`)
    toast('Customer deleted')
    await refresh()
  }
  J.forms['customer-form'] = async (form, ev) => {
    ev.preventDefault()
    const body = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      status: form.status.value,
      tags: form.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    }
    const notes = form.notes.value.split('\n').map((n) => n.trim()).filter(Boolean)
    if (notes.length) body.notes = notes
    const id = form.dataset.id
    const res = id ? await api('PUT', `/api/customers/${id}`, body) : await api('POST', '/api/customers', body)
    toast(id ? 'Customer updated' : 'Customer added')
    closeOverlay()
    window.location.reload()
  }
}

async function refresh() {
  const res = await api('GET', '/api/customers')
  customers = res.customers
}

export async function render() {
  await refresh()
  const isFin = J.session.user.role === 'owner' || J.session.user.role === 'finance'
  const rows = customers
    .map((c) => {
      const spent = money(c.totalPaid, J.session.org.currency)
      const balance = c.balance > 0 ? `<span style="color:var(--danger);font-weight:700">${money(c.balance, J.session.org.currency)}</span>` : '—'
      return `<tr>
        <td>${avatar(c.name)}</td>
        <td><strong>${esc(c.name)}</strong><br><span class="muted" style="font-size:.78rem">${esc(c.email || '')}</span></td>
        <td>${esc(c.phone || '—')}</td>
        <td>${pill(c.status)}</td>
        <td>${esc((c.tags || []).join(', ')) || '—'}</td>
        <td>${(c.notes || []).length ? `<span class="muted" style="font-size:.78rem">💭 ${c.notes.length} note${c.notes.length === 1 ? '' : 's'}</span>` : '—'}</td>
        <td class="muted">${spent}</td>
        <td>${balance}</td>
        <td class="muted">${fmtDate(c.lastActivity)}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm" data-action="customer-edit" data-id="${c.id}">Edit</button>
          ${isFin ? `<a class="btn btn-sm btn-primary" href="#/invoices">Invoice</a>` : ''}
          <button class="btn btn-sm btn-danger" data-action="customer-delete" data-id="${c.id}">Del</button>
        </div></td>
      </tr>`
    })
    .join('')

  return `
  <div class="maxw">
    ${header(`Customers`, `<input class="search" placeholder="Search customers…" id="customer-search" /><button class="btn btn-primary" data-action="customer-new">+ Add customer</button>`)}
    <div class="card">
      ${tableRows(rows)}
    </div>
  </div>`
}

function header(title, actions) {
  return `<div class="view-head"><h2>${esc(title)}</h2><div class="page-actions">${actions}</div></div>`
}

function tableRows(rows) {
  if (!customers.length) return `<div class="empty"><div class="big">👥</div>No customers yet.<br><button class="btn btn-primary mt" data-action="customer-new">Add your first customer</button></div>`
  return `
  <div class="table-wrap"><table>
    <thead><tr><th></th><th>Customer</th><th>Phone</th><th>Status</th><th>Tags</th><th>Notes</th><th>Received</th><th>Balance</th><th>Last activity</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`
}

function customerForm(customer) {
  const c = customer || { name: '', email: '', phone: '', status: 'active', tags: [], notes: [] }
  const notesValue = esc((c.notes || []).join('\n'))
  openDrawer(`
    <div class="dialog-head"><h3>${customer ? 'Edit customer' : 'Add customer'}</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <form data-form="customer-form" data-id="${customer ? customer.id : ''}">
      <label>Name<input name="name" value="${esc(c.name)}" required /></label>
      <label>Email<input type="email" name="email" value="${esc(c.email)}" /></label>
      <label>Phone<input name="phone" value="${esc(c.phone)}" /></label>
      <div class="grid-2">
        <label>Status<select name="status"><option value="active" ${c.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${c.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label>
        <label>Tags<input name="tags" value="${esc((c.tags || []).join(', '))}" placeholder="e.g. wholesale, vip" /></label>
      </div>
      <label>Notes<textarea name="notes" rows="3" placeholder="Preferences, important context, next steps…">${notesValue}</textarea></label>
      <div class="row-actions" style="justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn" data-action="drawer-close">Cancel</button>
        <button type="submit" class="btn btn-primary">${customer ? 'Save changes' : 'Add customer'}</button>
      </div>
    </form>
    <p class="hint">Put each note on its own line.</p>
  `)
  return customer
}