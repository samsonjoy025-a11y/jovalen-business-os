import { api, J, esc, pill, avatar } from '../api.js'
import { openDrawer, closeOverlay, confirmDelete, toast } from '../app.js'

let users = []
let automation = { enabled: true }
let notifPrefs = {}
let departments = []
let deptValue = ''

const NOTIF_TYPES = [
  { key: 'invoice', label: 'Invoices & payments' },
  { key: 'task', label: 'Tasks & assignments' },
  { key: 'expense', label: 'Expenses & reimbursements' },
  { key: 'approval', label: 'Approvals' },
  { key: 'pipeline', label: 'Sales pipeline' },
  { key: 'system', label: 'System & account' },
]

export function init() {
  J.actions['user-new'] = () => userForm()
  J.actions['user-edit'] = (el) => userForm(users.find((u) => u.id === Number(el.dataset.id)))
  J.actions['user-delete'] = async (el) => {
    const u = users.find((x) => x.id === Number(el.dataset.id))
    if (!u || !confirmDelete(`Remove ${u.name} from the business?`)) return
    try {
      await api('DELETE', `/api/users/${u.id}`)
      toast('User removed')
      window.location.reload()
    } catch (e) {
      toast(e.message)
    }
  }
  J.forms['user-form'] = async (form, ev) => {
    ev.preventDefault()
    const id = form.dataset.id
    if (id) {
      await api('PUT', `/api/users/${id}`, { role: form.role.value, department: form.department.value || '' })
      toast('Team member updated')
    } else {
      await api('POST', '/api/users', {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        role: form.role.value,
        password: form.password.value,
        department: form.department.value.trim(),
      })
      toast('Team member added')
    }
    closeOverlay()
    window.location.reload()
  }
  J.forms['automation-form'] = async (form, ev) => {
    ev.preventDefault()
    const res = await api('PUT', '/api/settings/automation', { enabled: form.enabled.checked })
    automation = res.automation
    toast('Automation settings saved')
    window.location.reload()
  }
  J.forms['notif-form'] = async (form, ev) => {
    ev.preventDefault()
    const prefs = {}
    for (const t of NOTIF_TYPES) prefs[t.key] = { inapp: form[t.key].checked }
    await api('PUT', '/api/settings/notifications', { prefs })
    toast('Notification preferences saved')
    window.location.reload()
  }
  J.forms['dept-form'] = async (form, ev) => {
    ev.preventDefault()
    const depts = form.list.value.split('\n').map((d) => d.trim()).filter(Boolean)
    await api('PUT', '/api/settings/departments', { departments: depts })
    toast('Departments saved')
    window.location.reload()
  }
}

export async function render() {
  users = (await api('GET', '/api/users')).users
  automation = (await api('GET', '/api/settings/automation')).automation
  notifPrefs = (await api('GET', '/api/settings/notifications')).prefs
  departments = (await api('GET', '/api/settings/departments')).departments
  deptValue = departments.join('\n')

  const rows = users
    .map((u) => {
      const self = u.id === J.session.user.id
      return `<tr>
        <td>${avatar(u.name)}</td>
        <td><strong>${esc(u.name)}</strong>${self ? ' <span class="muted">(you)</span>' : ''}<br><span class="muted" style="font-size:.78rem">${esc(u.email)}</span></td>
        <td>${pill(u.role)}</td>
        <td class="muted">${esc(u.department || '—')}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm" data-action="user-edit" data-id="${u.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-action="user-delete" data-id="${u.id}" ${self ? 'disabled' : ''}>Remove</button>
        </div></td>
      </tr>`
    })
    .join('')

  const notifRows = NOTIF_TYPES.map((t) => {
    const on = !(notifPrefs && notifPrefs[t.key] && notifPrefs[t.key].inapp === false)
    return `<label style="flex-direction:row;align-items:center;gap:10px;padding:6px 0"><input type="checkbox" name="${t.key}" style="width:auto" ${on ? 'checked' : ''} /><span>${t.label}</span></label>`
  }).join('')

  return `
  <div class="maxw stack">
    <div class="view-head"><h2>Team & settings</h2><div class="page-actions"><button class="btn btn-primary" data-action="user-new">+ Add team member</button></div></div>

    <div class="card">
      <div class="card-pad"><h3 class="card-title">Team members (${users.length})</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>Member</th><th>Role</th><th>Department</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>

    <div class="card card-pad">
      <h3 class="card-title">Departments</h3>
      <p class="hint">Group your team by department. One name per line — these appear when adding or editing team members.</p>
      <form data-form="dept-form">
        <textarea name="list" rows="4" placeholder="Sales&#10;Operations&#10;Finance">${esc(deptValue)}</textarea>
        <button class="btn btn-primary mt">Save departments</button>
      </form>
    </div>

    <div class="card card-pad">
      <h3 class="card-title">Notification preferences</h3>
      <p class="hint">Choose which notifications you receive in-app. Turn off a type to silence those alerts.</p>
      <form data-form="notif-form">
        ${notifRows}
        <button class="btn btn-primary mt">Save preferences</button>
      </form>
    </div>

    <div class="card card-pad">
      <h3 class="card-title">Automation</h3>
      <form data-form="automation-form">
        <label style="flex-direction:row;align-items:center;gap:10px;font-size:.95rem">
          <input type="checkbox" name="enabled" style="width:auto" ${automation.enabled ? 'checked' : ''} />
          <span>Enable automated workflows</span>
        </label>
        <p class="hint" style="margin-top:4px">When enabled, Jovalen automatically: assigns new unassigned leads to the sales team with a follow-up task, alerts on overdue invoices, and reminds about overdue tasks. These run continuously in the background and create notifications.</p>
        <button class="btn btn-primary mt">Save automation settings</button>
      </form>
    </div>

    <div class="card card-pad">
      <h3 class="card-title">Workspace</h3>
      <div class="flex between wrap">
        <div>
          <div class="muted">Business name</div><strong>${esc(J.session.org.name)}</strong>
        </div>
        <div>
          <div class="muted">Industry</div><strong>${esc(J.session.org.industry || '—')}</strong>
        </div>
        <div>
          <div class="muted">Location</div><strong>${esc(J.session.org.location || '—')}</strong>
        </div>
        <div>
          <div class="muted">Currency</div><strong>${esc(J.session.org.currency || '—')}</strong>
        </div>
        <div>
          <div class="muted">Employees</div><strong>${esc(J.session.org.size || '—')}</strong>
        </div>
      </div>
    </div>
  </div>`
}

function userForm(user) {
  const u = user || { name: '', email: '', role: 'staff', department: '' }
  const deptOptions = departments.map((d) => `<option value="${esc(d)}" ${u.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')
  openDrawer(`
    <div class="dialog-head"><h3>${user ? `Edit — ${esc(u.name)}` : 'Add team member'}</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <form data-form="user-form" data-id="${user ? user.id : ''}">
      ${user ? '' : `
        <label>Name<input name="name" value="${esc(u.name)}" required /></label>
        <label>Email<input type="email" name="email" required /></label>
        <label>Temporary password<input type="text" name="password" required minlength="6" value="${randPassword()}" /></label>
      `}
      <label>Role<select name="role">
        ${['owner', 'finance', 'sales', 'staff'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
      </select></label>
      <label>Department<select name="department"><option value="">— none —</option>${deptOptions}</select></label>
      <div class="row-actions" style="justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn" data-action="drawer-close">Cancel</button>
        <button type="submit" class="btn btn-primary">${user ? 'Save changes' : 'Add member'}</button>
      </div>
    </form>
    ${user ? '' : `<p class="hint">Choose a role: <strong>owner</strong> full access · <strong>finance</strong> money data · <strong>sales</strong> customers, leads & tasks · <strong>staff</strong> their tasks and expenses.</p>`}
  `)
}

function randPassword() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6)
}