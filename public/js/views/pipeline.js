import { api, J, money, esc, pill, fmtDate } from '../api.js'
import { openDrawer, closeOverlay, confirmDelete, toast } from '../app.js'

let deals = []
let customers = []
let users = []

const STAGES = ['qualification', 'proposal', 'negotiation', 'won', 'lost']

export function init() {
  J.actions['deal-new'] = () => dealForm(null)
  J.actions['deal-edit'] = (el) => dealForm(deals.find((d) => d.id === Number(el.dataset.id)))
  J.actions['deal-stage'] = (el) => setStage(el.dataset.id, el.dataset.stage)
  J.actions['deal-delete'] = async (el) => {
    if (!confirmDelete('Delete this deal?')) return
    await api('DELETE', `/api/deals/${el.dataset.id}`)
    toast('Deal deleted')
    window.location.reload()
  }
  J.forms['deal-form'] = async (form, ev) => {
    ev.preventDefault()
    const body = {
      name: form.name.value.trim(),
      customerId: form.customerId.value ? Number(form.customerId.value) : null,
      amount: Number(form.amount.value || 0),
      stage: form.stage.value,
      ownerUserId: form.owner.value ? Number(form.owner.value) : undefined,
      closeDate: form.closeDate.value || undefined,
    }
    const id = form.dataset.id
    const res = id ? await api('PUT', `/api/deals/${id}`, body) : await api('POST', '/api/deals', body)
    toast(id ? 'Deal updated' : 'Deal created')
    closeOverlay()
    window.location.reload()
  }
}

async function setStage(id, stage) {
  await api('PUT', `/api/deals/${id}`, { stage })
  toast(`Deal moved to ${stage}`)
  window.location.reload()
}

export async function render() {
  const res = await api('GET', '/api/deals')
  deals = res.deals
  const custRes = await api('GET', '/api/customers')
  customers = custRes.customers
  try {
    users = (await api('GET', '/api/users')).users
  } catch {
    users = []
  }

  const boards = STAGES.map((stage) => {
    const items = deals.filter((d) => d.stage === stage)
    const total = items.reduce((s, d) => s + (d.amount || 0), 0)
    return `
      <div class="card card-pad" style="min-width:250px">
        <div class="flex between mb"><strong>${stage.charAt(0).toUpperCase() + stage.slice(1)}</strong><span class="muted">${money(total, J.session.org.currency)}</span></div>
        <div class="stack">${items.map(dealCard).join('') || `<div class="empty" style="padding:18px">No deals</div>`}</div>
      </div>`
  }).join('')

  return `
  <div class="maxw">
    <div class="view-head"><h2>Sales pipeline</h2><div class="page-actions"><button class="btn btn-primary" data-action="deal-new">+ New deal</button></div></div>
    <div style="display:flex;gap:14px;overflow-x:auto;padding-bottom:8px">${boards}</div>
    <p class="hint mt">Won and lost deals are kept for reporting. Use the chevron buttons to move deals between stages.</p>
  </div>`
}

function dealCard(d) {
  const late = d.closeDate && new Date(d.closeDate).getTime() < Date.now() && d.stage !== 'won' && d.stage !== 'lost'
  return `
  <div class="card" style="background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:12px">
    <div class="flex between"><strong>${esc(d.name)}</strong><button class="btn btn-sm btn-danger" data-action="deal-delete" data-id="${d.id}">×</button></div>
    <div class="muted" style="font-size:.8rem;margin:4px 0">${esc(d.customerName || 'No customer')} · ${esc(d.owner)}</div>
    <div style="font-weight:800">${money(d.amount, J.session.org.currency)}</div>
    <div class="flex between muted" style="font-size:.78rem;margin-top:6px">
      <span>Closes ${fmtDate(d.closeDate)}${late ? ' ⚠️' : ''}</span>
      <span><button class="btn btn-sm" data-action="deal-edit" data-id="${d.id}">Edit</button></span>
    </div>
    <div class="flex" style="justify-content:flex-end;gap:4px;margin-top:8px">
      <button class="btn btn-sm" data-action="deal-stage" data-id="${d.id}" data-stage="qualification" ${d.stage === 'qualification' ? 'disabled' : ''}>‹</button>
      <button class="btn btn-sm" data-action="deal-stage" data-id="${d.id}" data-stage="proposal" ${d.stage === 'proposal' ? 'disabled' : ''}>→</button>
      <button class="btn btn-sm" data-action="deal-stage" data-id="${d.id}" data-stage="negotiation" ${d.stage === 'negotiation' ? 'disabled' : ''}>→</button>
      <button class="btn btn-sm" data-action="deal-stage" data-id="${d.id}" data-stage="won" ${d.stage === 'won' ? 'disabled' : ''}>✓ Won</button>
      <button class="btn btn-sm" data-action="deal-stage" data-id="${d.id}" data-stage="lost" ${d.stage === 'lost' ? 'disabled' : ''}>✗ Lost</button>
    </div>
  </div>`
}

function dealForm(deal) {
  const d = deal || { name: '', customerId: '', amount: 0, stage: 'qualification', ownerUserId: '', closeDate: '' }
  const customerOptions = customers.map((c) => `<option value="${c.id}" ${String(d.customerId) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
  const ownerOptions = users
    .filter((u) => u.role === 'sales' || u.role === 'owner')
    .map((u) => `<option value="${u.id}" ${String(d.ownerUserId) === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`)
    .join('')
  openDrawer(`
    <div class="dialog-head"><h3>${deal ? 'Edit deal' : 'New deal'}</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <form data-form="deal-form" data-id="${deal ? deal.id : ''}">
      <label>Deal name<input name="name" value="${esc(d.name)}" required /></label>
      <label>Customer<select name="customerId">${customerOptions || '<option value="">No customers yet</option>'}</select></label>
      <div class="grid-2">
        <label>Value<input type="number" name="amount" min="0" value="${d.amount}" /></label>
        <label>Stage<select name="stage">${STAGES.map((s) => `<option value="${s}" ${d.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      </div>
      <div class="grid-2">
        <label>Owner<select name="owner">${ownerOptions}</select></label>
        <label>Expected close<input type="date" name="closeDate" value="${d.closeDate || ''}" /></label>
      </div>
      <div class="row-actions" style="justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn" data-action="drawer-close">Cancel</button>
        <button type="submit" class="btn btn-primary">${deal ? 'Save changes' : 'Create deal'}</button>
      </div>
    </form>
  `)
}