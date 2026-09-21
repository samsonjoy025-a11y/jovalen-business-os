import { createStore, scoped } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, guard, can, callSvc, activityId, today } from '../lib.js'

const store = createStore('tasks')
const conf = loadConf()

function tasksOf(tid) {
  return store.list(tid, 'tasks')
}

function projectsOf(tid) {
  return store.list(tid, 'projects')
}

const handlers = {
  'GET /api/tasks': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const scope = can(u, 4) ? null : u.id
    const names = await usersMap(tid, can(u, 4))
    const allUsers = await usersList(tid)
    return ok({ tasks: scoped(tasksOf(tid), scope).map((t) => decorate(t, names)), users: can(u, 4) ? allUsers : allUsers.filter((x) => x.id === u.id) })
  },
  'POST /api/tasks': async (ctx, body) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const b = body || {}
    if (!b.title || !String(b.title).trim()) return err(400, 'Task title is required')
    const scope = can(u, 4) ? null : u.id
    const assigneeId = b.assigneeId !== undefined && b.assigneeId !== '' ? Number(b.assigneeId) : scope
    if (assigneeId && !can(u, 4) && assigneeId !== u.id) return err(403, 'Staff can only assign tasks to themselves')
    const task = store.insert(tid, 'tasks', {
      title: String(b.title).trim(),
      description: b.description || '',
      assigneeId,
      projectId: b.projectId ? Number(b.projectId) : null,
      dueDate: b.dueDate || undefined,
      priority: b.priority || 'medium',
      status: b.status || 'todo',
      createdBy: u.id,
      createdAt: new Date().toISOString(),
      history: [{ at: new Date().toISOString(), by: u.id, byName: u.name, action: 'created' }],
    })
    const names = await usersMap(tid)
    if (assigneeId && assigneeId !== u.id) {
      notifyUser(tid, assigneeId, 'task', 'task_assigned', 'Task assigned', `Task "${task.title}" was assigned to you by ${u.name}.`, '#/tasks')
    }
    logActivity(tid, 'task', 'created', task.id, task.title)
    return ok({ task: decorate(task, names) })
  },
  'PUT /api/tasks/:id': async (ctx, body) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const id = Number(ctx.params.id)
    const task = store.get(tid, 'tasks', id)
    if (!task) return err(404, 'Task not found')
    if (!can(u, 4) && task.assigneeId !== u.id && task.createdBy !== u.id) return err(403, 'Not permitted')
    const b = body || {}
    const changes = []
    if (b.status !== undefined && b.status !== task.status && String(b.status).trim()) changes.push(`status set to ${b.status}`)
    if (b.title !== undefined && b.title !== task.title && String(b.title).trim()) changes.push(`renamed to "${String(b.title).trim()}"`)
    if (b.priority !== undefined && b.priority !== task.priority) changes.push(`priority set to ${b.priority}`)
    if (b.dueDate !== undefined && b.dueDate !== (task.dueDate || '')) changes.push(b.dueDate ? `due date set to ${b.dueDate}` : 'due date cleared')
    const names = await usersMap(tid)
    if (b.assigneeId !== undefined && Number(b.assigneeId) !== task.assigneeId) {
      changes.push(`assigned to ${names[Number(b.assigneeId)] || 'Unassigned'}`)
      if (Number(b.assigneeId) && Number(b.assigneeId) !== u.id) {
        notifyUser(tid, Number(b.assigneeId), 'task', 'task_assigned', 'Task assigned', `Task "${task.title}" was assigned to you by ${u.name}.`, '#/tasks')
      }
    }
    const updated = store.update(tid, 'tasks', id, {
      title: b.title !== undefined ? String(b.title).trim() : undefined,
      description: b.description !== undefined ? b.description : undefined,
      dueDate: b.dueDate !== undefined ? b.dueDate : undefined,
      priority: b.priority !== undefined ? b.priority : undefined,
      status: b.status !== undefined ? b.status : undefined,
      assigneeId: b.assigneeId !== undefined ? Number(b.assigneeId) : undefined,
      projectId: b.projectId !== undefined ? (b.projectId ? Number(b.projectId) : null) : undefined,
    })
    if (!updated) return err(404, 'Task not found')
    task.history = task.history || []
    if (changes.length) task.history.push({ at: new Date().toISOString(), by: u.id, byName: u.name, action: 'updated', detail: changes.join(', ') })
    if (updated.status === 'done' && updated.assigneeId) {
      const assignee = names[updated.assigneeId]
      if (assignee && updated.assigneeId !== u.id) notifyUser(tid, updated.assigneeId, 'task', 'task_completed', 'Task completed', `Task "${updated.title}" was marked complete.`, '#/tasks')
    }
    store.save()
    return ok({ task: decorate(updated, names) })
  },
  'DELETE /api/tasks/:id': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const id = Number(ctx.params.id)
    const task = store.get(tid, 'tasks', id)
    if (!task) return err(404, 'Task not found')
    if (!can(u, 5) && task.assigneeId !== u.id && task.createdBy !== u.id) return err(403, 'Not permitted')
    store.remove(tid, 'tasks', id)
    return ok({ ok: true })
  },
  'POST /api/tasks/:id/comments': async (ctx, body) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const task = store.get(tid, 'tasks', Number(ctx.params.id))
    if (!task) return err(404, 'Task not found')
    const text = String((body && body.text) || '').trim()
    if (!text) return err(400, 'Comment text is required')
    task.comments = task.comments || []
    task.comments.push({ id: activityId(), authorId: u.id, authorName: u.name, text, at: new Date().toISOString() })
    task.history = task.history || []
    task.history.push({ at: new Date().toISOString(), by: u.id, byName: u.name, action: 'commented' })
    store.save()
    const names = await usersMap(tid)
    return ok({ task: decorate(task, names) })
  },
  'POST /api/tasks/:id/attachments': async (ctx, body) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const task = store.get(tid, 'tasks', Number(ctx.params.id))
    if (!task) return err(404, 'Task not found')
    const b = body || {}
    const name = String(b.name || 'file').trim()
    const data = String(b.data || '')
    if (!data) return err(400, 'Attachment data is required (base64)')
    task.attachments = task.attachments || []
    task.attachments.push({ id: activityId(), name, mime: b.mime || 'application/octet-stream', size: Buffer.from(data, 'base64').length, addedBy: userOf(ctx).name, at: new Date().toISOString(), data })
    store.save()
    const names = await usersMap(tid)
    return ok({ task: decorate(task, names) })
  },
  'GET /api/tasks/:id/attachments/:aid': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const task = store.get(tid, 'tasks', Number(ctx.params.id))
    if (!task) return err(404, 'Task not found')
    const att = (task.attachments || []).find((a) => a.id === ctx.params.aid)
    if (!att) return err(404, 'Attachment not found')
    const buf = Buffer.from(att.data, 'base64')
    return { code: 200, raw: buf, type: att.mime, name: att.name }
  },
  'GET /api/projects': async (ctx) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const items = projectsOf(tid).map((p) => ({ ...p, taskCount: tasksOf(tid).filter((t) => t.projectId === p.id).length }))
    return ok({ projects: items })
  },
  'POST /api/projects': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    if (!b.name || !String(b.name).trim()) return err(400, 'Project name is required')
    const project = store.insert(tid, 'projects', {
      name: String(b.name).trim(),
      description: b.description || '',
      status: b.status || 'planning',
      ownerUserId: b.ownerUserId || userOf(ctx).id,
      dueDate: b.dueDate || '',
      createdAt: new Date().toISOString(),
    })
    return ok({ project: project })
  },
  'PUT /api/projects/:id': async (ctx, body) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    const project = store.update(tid, 'projects', Number(ctx.params.id), {
      name: b.name !== undefined ? String(b.name).trim() : undefined,
      description: b.description !== undefined ? b.description : undefined,
      status: b.status !== undefined ? b.status : undefined,
      ownerUserId: b.ownerUserId !== undefined ? b.ownerUserId : undefined,
      dueDate: b.dueDate !== undefined ? b.dueDate : undefined,
    })
    if (!project) return err(404, 'Project not found')
    return ok({ project })
  },
  'DELETE /api/projects/:id': async (ctx) => {
    const blocked = guard(ctx, 5)
    if (blocked) return blocked
    store.remove(tenantOf(ctx), 'projects', Number(ctx.params.id))
    return ok({ ok: true })
  },
  'GET /internal/tasks': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const all = ctx.query.all === '1'
    let items = tasksOf(tid)
    if (ctx.query.orderable === '1') {
      items = items.filter((t) => t.status !== 'done')
    }
    if (!all && ctx.query.assigneeId) items = items.filter((t) => t.assigneeId === Number(ctx.query.assigneeId))
    return ok({ tasks: items })
  },
  'POST /internal/tasks': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const records = Array.isArray(body && body.records) ? body.records : []
    const created = records.map((r) => store.insert(tid, 'tasks', { ...r, createdAt: r.createdAt || new Date().toISOString() }))
    return ok({ tasks: created })
  },
  'POST /internal/tasks/:id/notify-overdue': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const task = store.get(tid, 'tasks', Number(ctx.params.id))
    if (!task) return err(404, 'Task not found')
    task.overdueNotified = true
    store.save()
    return ok({ ok: true })
  },
  'PATCH /internal/tasks/:id/status': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const task = store.update(tid, 'tasks', Number(ctx.params.id), { status: String((body && body.status) || '') })
    if (!task) return err(404, 'Task not found')
    return ok({ task })
  },
  'GET /internal/customer-history': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const uid = Number(ctx.query.cid)
    const items = tasksOf(tid).filter((t) => t.assigneeId === uid || t.createdBy === uid).map((t) => ({ at: t.createdAt, label: `Task: ${t.title}`, status: t.status }))
    return ok({ items })
  },
  'GET /internal/projects': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    return ok({ projects: projectsOf(tid) })
  },
}

function decorate(t, names) {
  return {
    ...t,
    assigneeName: names[t.assigneeId] || 'Unassigned',
    createdByName: names[t.createdBy] || 'Automation',
    history: (t.history || []).map((h) => ({ ...h, byName: h.byName || names[h.by] || 'Automation' })),
    comments: t.comments || [],
    attachments: (t.attachments || []).map(({ data, ...rest }) => rest),
  }
}

async function usersMap(tid) {
  try {
    const r = await callSvc(conf, 'workspace', 'GET', `/internal/users?tid=${tid}`)
    const map = {}
    ;(r.data && r.data.users || []).forEach((u) => (map[u.id] = u.name))
    return map
  } catch {
    return {}
  }
}

async function usersList(tid) {
  try {
    const r = await callSvc(conf, 'workspace', 'GET', `/internal/users?tid=${tid}`)
    return (r.data && r.data.users || []).map((u) => ({ id: u.id, name: u.name, role: u.role }))
  } catch {
    return []
  }
}

function notifyUser(tid, userId, kind, type, title, body, link) {
  callSvc(conf, 'workspace', 'POST', '/internal/notify', { tid, userId, type, title, body, link }).catch(() => {})
}

function logActivity(tid, type, action, entityId, label, detail) {
  callSvc(conf, 'workspace', 'POST', '/internal/activity', { tid, type, action, entityId, label, detail }).catch(() => {})
}

createService('tasks', handlers)