import { api, J, money, esc, pill, fmtDate, relDate, avatar } from '../api.js'
import { openDrawer, closeOverlay, confirmDelete, toast } from '../app.js'

let tasks = []
let users = []

export function init() {
  J.actions['task-new'] = () => taskForm(null)
  J.actions['task-edit'] = (el) => taskForm(tasks.find((t) => t.id === Number(el.dataset.id)))
  J.actions['task-status'] = async (el) => {
    const t = tasks.find((x) => x.id === Number(el.dataset.id))
    if (!t) return
    const map = { todo: 'in_progress', in_progress: 'done', done: 'todo' }
    const next = map[t.status] || 'done'
    await api('PUT', `/api/tasks/${t.id}`, { status: next })
    toast(`Task marked ${next.replace('_', ' ')}`)
    window.location.reload()
  }
  J.actions['task-delete'] = async (el) => {
    if (!confirmDelete('Delete this task?')) return
    await api('DELETE', `/api/tasks/${el.dataset.id}`)
    toast('Task deleted')
    window.location.reload()
  }
  J.actions['task-comments'] = (el) => commentDrawer(tasks.find((t) => t.id === Number(el.dataset.id)))
  J.forms['task-form'] = async (form, ev) => {
    ev.preventDefault()
    const body = {
      title: form.title.value.trim(),
      description: form.description.value.trim(),
      dueDate: form.dueDate.value || undefined,
      priority: form.priority.value,
      status: form.status.value,
      assigneeId: form.assigneeId.value ? Number(form.assigneeId.value) : undefined,
    }
    const id = form.dataset.id
    const res = id ? await api('PUT', `/api/tasks/${id}`, body) : await api('POST', '/api/tasks', body)
    toast(id ? 'Task updated' : 'Task created')
    closeOverlay()
    window.location.reload()
  }
  J.forms['task-comment'] = async (form, ev) => {
    ev.preventDefault()
    const text = form.text.value.trim()
    if (!text) return toast('Write a comment first')
    await api('POST', `/api/tasks/${form.dataset.id}/comments`, { text })
    toast('Comment added')
    commentDrawer(tasks.find((t) => t.id === Number(form.dataset.id)))
  }
}

export async function render() {
  const res = await api('GET', '/api/tasks')
  tasks = res.tasks
  users = res.users
  const isManager = J.session.user.role === 'owner' || J.session.user.role === 'finance'

  const filter = isManager ? window.location.hash.split('?')[1] ? window.location.hash.split('?')[1].replace('filter=', '') : '' : 'mine'
  let shown = tasks
  if (filter === 'mine') shown = tasks.filter((t) => t.assigneeId === J.session.user.id)
  else if (filter === 'overdue') shown = tasks.filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate).getTime() < Date.now())
  else if (filter === 'done') shown = tasks.filter((t) => t.status === 'done')

  const filterRow = `<select onchange="location.hash='/tasks?filter='+this.value">
    ${isManager ? `<option value="">All tasks</option><option value="mine" ${filter === 'mine' ? 'selected' : ''}>Mine</option><option value="overdue" ${filter === 'overdue' ? 'selected' : ''}>Overdue</option><option value="done" ${filter === 'done' ? 'selected' : ''}>Done</option>` : `<option value="mine" selected>My tasks</option>`}
  </select>`

  const rows = shown
    .slice()
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || String(a.priority).localeCompare(String(b.priority)))
    .map((t) => {
      const overdue = t.status !== 'done' && t.dueDate && new Date(t.dueDate).getTime() < Date.now()
      const owner = J.session.user.role === 'owner' || J.session.user.role === 'finance'
      return `<tr>
        <td>${avatar(t.assigneeName)}</td>
        <td><strong>${esc(t.title)}</strong><br><span class="muted" style="font-size:.78rem">${esc(t.description || '')}</span>${(t.comments || []).length ? `<br><button class="btn btn-sm" data-action="task-comments" data-id="${t.id}" style="margin-top:4px">💬 ${t.comments.length} comment${t.comments.length === 1 ? '' : 's'}</button>` : ''}</td>
        <td>${pill(t.priority)}</td>
        <td class="muted">${t.dueDate ? `${fmtDate(t.dueDate)} ${overdue ? '<span style="color:var(--danger)">⚠️</span>' : ''}` : '—'}</td>
        <td>${pill(t.status)}</td>
        <td>${owner ? esc(t.assigneeName || 'Unassigned') : 'You'}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm" data-action="task-status" data-id="${t.id}">${t.status === 'done' ? 'Reopen' : t.status === 'in_progress' ? 'Complete' : 'Start'}</button>
          <button class="btn btn-sm" data-action="task-edit" data-id="${t.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-action="task-delete" data-id="${t.id}">Del</button>
        </div></td>
      </tr>`
    })
    .join('')

  const openCount = tasks.filter((t) => t.status !== 'done').length
  const overdueCount = tasks.filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate).getTime() < Date.now()).length

  return `
  <div class="maxw">
    <div class="view-head"><h2>Tasks</h2><div class="page-actions">${filterRow}<button class="btn btn-primary" data-action="task-new">+ New task</button></div></div>
    <div class="stat-grid">
      <div class="stat"><div class="stat-label">Open tasks</div><div class="stat-value">${openCount}</div></div>
      <div class="stat ${overdueCount ? 'red' : 'green'}"><div class="stat-label">Overdue</div><div class="stat-value">${overdueCount}</div></div>
      <div class="stat indigo"><div class="stat-label">Completed</div><div class="stat-value">${tasks.filter((t) => t.status === 'done').length}</div></div>
    </div>
    <div class="card">
      ${
        tasks.length
          ? `<div class="table-wrap"><table><thead><tr><th></th><th>Task</th><th>Priority</th><th>Due</th><th>Status</th><th>Assignee</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
          : `<div class="empty"><div class="big">📋</div>No tasks yet.<br><button class="btn btn-primary mt" data-action="task-new">Create your first task</button></div>`
      }
    </div>
  </div>`
}

function taskForm(task) {
  const t = task || { title: '', description: '', dueDate: '', priority: 'medium', status: 'todo', assigneeId: '' }
  const isManager = J.session.user.role === 'owner' || J.session.user.role === 'finance'
  const userOptions = users.map((u) => `<option value="${u.id}" ${String(t.assigneeId) === String(u.id) ? 'selected' : ''}>${esc(u.name)} (${u.role})</option>`).join('')
  const assigneeField = isManager
    ? `<label>Assignee<select name="assigneeId">${userOptions || '<option value="">—</option>'}</select></label>`
    : `<label>Assignee<input value="${esc(J.session.user.name)}" disabled /></label>`
  openDrawer(`
    <div class="dialog-head"><h3>${task ? 'Edit task' : 'New task'}</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <form data-form="task-form" data-id="${task ? task.id : ''}">
      <label>Title<input name="title" value="${esc(t.title)}" required /></label>
      <label>Description<textarea name="description" rows="3">${esc(t.description)}</textarea></label>
      <div class="grid-2">
        <label>Priority<select name="priority">${['low', 'medium', 'high'].map((p) => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label>Status<select name="status">${['todo', 'in_progress', 'done'].map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></label>
      </div>
      <div class="grid-2">
        ${assigneeField}
        <label>Due date<input type="date" name="dueDate" value="${t.dueDate || ''}" /></label>
      </div>
      <div class="row-actions" style="justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn" data-action="drawer-close">Cancel</button>
        <button type="submit" class="btn btn-primary">${task ? 'Save changes' : 'Create task'}</button>
      </div>
    </form>
  `)
}

function commentDrawer(task) {
  const comments = (task.comments || []).map((c) =>
    `<div class="comment"><strong>${esc(c.authorName)}</strong> <span class="muted">· ${fmtDate(c.at)}</span><div>${esc(c.text)}</div></div>`
  ).join('') || '<p class="hint">No comments yet.</p>'
  const history = (task.history || []).slice().reverse().map((h) =>
    `<div class="muted" style="font-size:.78rem;padding:3px 0">${esc(h.byName || 'Automation')} ${esc(h.action)}${h.detail ? ` — ${esc(h.detail)}` : ''} · ${fmtDate(h.at)}</div>`
  ).join('')
  openDrawer(`
    <div class="dialog-head"><h3>${esc(task.title)}</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <h4 class="card-title">Comments</h4>
    ${comments}
    <form data-form="task-comment" data-id="${task.id}" class="mt">
      <label>Add a comment<input name="text" placeholder="Update the team…" /></label>
    </form>
    ${history ? `<h4 class="card-title mt">History</h4>${history}` : ''}
  `)
}