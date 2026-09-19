import { api, J, money, esc, pill, fmtDate } from '../api.js'
import { openDrawer, closeOverlay, confirmDelete, toast } from '../app.js'

let leads = []
let users = []

export function init() {
  J.actions['lead-new'] = () => leadForm(null)
  J.actions['lead-edit'] = (el) => leadForm(leads.find((l) => l.id === Number(el.dataset.id)))
  J.actions['lead-convert'] = (el) => convertForm(leads.find((l) => l.id === Number(el.dataset.id)))
  J.actions['lead-delete'] = async (el) => {
    const l = leads.find((x) => x.id === Number(el.dataset.id))
    if (!l || !confirmDelete(`Delete lead "${l.name}"?`)) return
    await api('DELETE', `/api/leads/${l.id}`)
    toast('Lead deleted')
    window.location.reload()
  }
  J.forms['lead-form'] = async (form, ev) => {
    ev.preventDefault()
    const body = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      source: form.source.value.trim(),
      status: form.status.value,
      followUpDate: form.followUpDate.value || undefined,
      ownerUserId: form.owner.value ? Number(form.owner.value) : undefined,
    }
    const id = form.dataset.id
    const res = id ? await api('PUT', `/api/leads/${id}`, body) : await api('POST', '/api/leads', body)
    toast(id ? 'Lead updated' : 'Lead created — unassigned leads are auto-assigned')
    closeOverlay()
    window.location.reload()
  }
  J.forms['convert-form'] = async (form, ev) => {
    ev.preventDefault()
    const res = await api('POST', `/api/leads/${form.dataset.id}/convert`, {
      amount: Number(form.amount.value || 0),
      closeDate: form.closeDate.value || undefined,
    })
    toast(`Lead converted — customer ${res.customer.name} and a new deal were created`)
    closeOverlay()
    window.location.reload()
  }
}

export async function render() {
  const res = await api('GET', '/api/leads')
  leads = res.leads
  try {
    const u = await api('GET', '/api/users')
    users = u.users
  } catch {
    users = []
  }

  const rows = leads
    .map((l) => {
      const follow = l.followUpDate
        ? `${fmtDate(l.followUpDate)}${isLate(l.followUpDate) && l.status !== 'converted' && l.status !== 'lost' ? ' ⚠️' : ''}`
        : '—'
      return `<tr>
        <td><strong>${esc(l.name)}</strong><br><span class="muted" style="font-size:.78rem">${esc(l.email || '')}</span></td>
        <td>${esc(l.source || '—')}</td>
        <td>${pill(l.status)}</td>
        <td>${esc(l.owner || 'Unassigned')}</td>
        <td>${follow}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm btn-primary" data-action="lead-convert" data-id="${l.id}" ${l.status === 'converted' || l.status === 'lost' ? 'disabled' : ''}>Convert</button>
          <button class="btn btn-sm" data-action="lead-edit" data-id="${l.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-action="lead-delete" data-id="${l.id}">Del</button>
        </div></td>
      </tr>`
    })
    .join('')

  const canAssign = J.session.user.role === 'owner' || J.session.user.role === 'finance'

  return `
  <div class="maxw">
    <div class="view-head"><h2>Leads</h2><div class="page-actions"><button class="btn btn-primary" data-action="lead-new">+ New lead</button></div></div>
    <div class="card">
      ${
        leads.length
          ? `<div class="table-wrap"><table><thead><tr><th>Lead</th><th>Source</th><th>Status</th><th>Owner</th><th>Follow-up</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
          : `<div class="empty"><div class="big">🎯</div>No leads yet. Track every enquiry so no potential customer is lost.</div>`
      }
    </div>
  </div>`
}

function isLate(dateStr) {
  return new Date(dateStr).getTime() < Date.now()
}

function leadForm(lead) {
  const l = lead || { name: '', email: '', phone: '', source: '', status: 'new', followUpDate: '', ownerUserId: '' }
  const ownerOptions = users
    .filter((u) => u.role === 'sales' || u.role === 'owner')
    .map((u) => `<option value="${u.id}" ${String(l.ownerUserId) === String(u.id) ? 'selected' : ''}>${esc(u.name)} (${u.role})</option>`)
    .join('') + `<option value="" ${!l.ownerUserId ? 'selected' : ''}>Unassigned (auto-assign)</option>`
  openDrawer(`
    <div class="dialog-head"><h3>${lead ? 'Edit lead' : 'New lead'}</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <form data-form="lead-form" data-id="${lead ? lead.id : ''}">
      <label>Name<input name="name" value="${esc(l.name)}" required /></label>
      <div class="grid-2">
        <label>Email<input type="email" name="email" value="${esc(l.email)}" /></label>
        <label>Phone<input name="phone" value="${esc(l.phone)}" /></label>
      </div>
      <div class="grid-2">
        <label>Source<input name="source" value="${esc(l.source)}" placeholder="WhatsApp, Referral, Website…" /></label>
        <label>Status<select name="status">
          ${['new', 'contacted', 'qualified', 'converted', 'lost'].map((s) => `<option value="${s}" ${l.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></label>
      </div>
      <div class="grid-2">
        <label>Owner<select name="owner">${ownerOptions}</select></label>
        <label>Follow-up date<input type="date" name="followUpDate" value="${l.followUpDate || ''}" /></label>
      </div>
      <div class="row-actions" style="justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn" data-action="drawer-close">Cancel</button>
        <button type="submit" class="btn btn-primary">${lead ? 'Save changes' : 'Add lead'}</button>
      </div>
    </form>
  `)
}

function convertForm(lead) {
  if (!lead) return
  openDrawer(`
    <div class="dialog-head"><h3>Convert "${esc(lead.name)}" to customer</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <form data-form="convert-form" data-id="${lead.id}">
      <p class="hint">Conversion creates a customer record and a new pipeline deal.</p>
      <div class="grid-2">
        <label>Deal value<input type="number" name="amount" min="0" value="0" /></label>
        <label>Expected close<input type="date" name="closeDate" /></label>
      </div>
      <div class="row-actions" style="justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn" data-action="drawer-close">Cancel</button>
        <button type="submit" class="btn btn-primary">Convert lead</button>
      </div>
    </form>
  `)
}