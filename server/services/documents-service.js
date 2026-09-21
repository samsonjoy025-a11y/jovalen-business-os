import { createStore } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, guard, activityId, today } from '../lib.js'

const store = createStore('documents')
const conf = loadConf()

function docsOf(tid) {
  return store.list(tid, 'documents')
}

function foldersOf(tid) {
  return store.list(tid, 'folders')
}

const handlers = {
  'GET /api/folders': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const folders = foldersOf(tid).map((f) => ({ ...f, count: docsOf(tid).filter((d) => d.folder === f.name).length }))
    return ok({ folders })
  },
  'POST /api/folders': async (ctx, body) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const name = String((body && body.name) || '').trim()
    if (!name) return err(400, 'Folder name is required')
    if (foldersOf(tid).some((f) => f.name === name)) return err(409, 'Folder already exists')
    const folder = store.insert(tid, 'folders', { name, createdAt: new Date().toISOString() })
    return ok({ folder })
  },
  'DELETE /api/folders/:name': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    store.remove(tid, 'folders', Number(ctx.params.name))
    return ok({ ok: true })
  },
  'GET /api/documents': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const q = String(ctx.query.q || '').trim().toLowerCase()
    const docs = docsOf(tid).map(decorate)
    const filtered = q ? docs.filter((d) => d.name.toLowerCase().includes(q) || (d.notes || '').toLowerCase().includes(q) || (d.folder || '').toLowerCase().includes(q)) : docs
    return ok({ documents: filtered })
  },
  'POST /api/documents/upload': async (ctx, body) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const b = body || {}
    const name = String(b.name || '').trim()
    if (!name) return err(400, 'Document name is required')
    const data0 = String(b.data || '')
    if (!data0) return err(400, 'Document content is required (base64)')
    const raw = Buffer.from(data0, 'base64')
    const mime = b.mime || 'application/octet-stream'
    const doc = store.insert(tid, 'documents', {
      name,
      mime,
      size: raw.length,
      folder: b.folder || '',
      tags: Array.isArray(b.tags) ? b.tags.slice(0, 8) : [],
      shared: !!(b.shared === true),
      ownerUserId: u.id,
      uploadedBy: u.name,
      createdAt: new Date().toISOString(),
      data: data0,
    })
    return ok({ document: decorate(doc) })
  },
  'POST /api/documents/uploadraw': async (ctx, body) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const u = userOf(ctx)
    const b = body || {}
    const name = String(b.name || 'untitled').trim() || 'untitled'
    const bin = b.data !== undefined ? Buffer.from(b.data, 'base64') : Buffer.from(String(b.text || ''), 'utf8')
    const doc = store.insert(tid, 'documents', {
      name,
      mime: b.mime || 'text/plain',
      size: bin.length,
      folder: b.folder || '',
      tags: [],
      shared: false,
      ownerUserId: u.id,
      uploadedBy: u.name,
      createdAt: new Date().toISOString(),
      data: bin.toString('base64'),
    })
    return ok({ document: decorate(doc) })
  },
  'GET /api/documents/:id/download': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const doc = store.get(tid, 'documents', Number(ctx.params.id))
    if (!doc) return err(404, 'Document not found')
    const raw = Buffer.from(doc.data || '', 'base64')
    return { code: 200, raw, type: doc.mime || 'application/octet-stream', name: doc.name }
  },
  'PUT /api/documents/:id': async (ctx, body) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    const updated = store.update(tid, 'documents', Number(ctx.params.id), {
      name: b.name !== undefined ? String(b.name).trim() : undefined,
      folder: b.folder !== undefined ? String(b.folder || '') : undefined,
      tags: b.tags !== undefined ? (Array.isArray(b.tags) ? b.tags.slice(0, 8) : []) : undefined,
      shared: b.shared !== undefined ? !!b.shared : undefined,
      notes: b.notes !== undefined ? String(b.notes || '') : undefined,
    })
    if (!updated) return err(404, 'Document not found')
    return ok({ document: decorate(updated) })
  },
  'DELETE /api/documents/:id': async (ctx) => {
    const blocked = guard(ctx, 1)
    if (blocked) return blocked
    store.remove(tenantOf(ctx), 'documents', Number(ctx.params.id))
    return ok({ ok: true })
  },
  'GET /internal/documents': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    return ok({ documents: docsOf(tid).map(decorate) })
  },
  'POST /internal/documents/link-task': async (ctx, body) => {
    const b = body || {}
    const tid = String(b.tid || '')
    const doc = store.get(tid, 'documents', Number(b.documentId))
    if (!doc) return err(404, 'Document not found')
    const attachments = (doc.attachments || []).filter((a) => a.taskId !== b.taskId)
    attachments.push({ taskId: Number(b.taskId), at: new Date().toISOString() })
    doc.attachments = attachments
    store.save()
    return ok({ ok: true })
  },
}

function decorate(d) {
  const { data, ...rest } = d
  return rest
}

createService('documents', handlers)