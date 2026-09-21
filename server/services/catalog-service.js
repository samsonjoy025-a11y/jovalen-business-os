import { createStore } from '../core.js'
import { loadConf, createService, ok, err, userOf, tenantOf, guard, can, callSvc, today } from '../lib.js'

const store = createStore('catalog')
const conf = loadConf()

function productsOf(tid) {
  return store.list(tid, 'products')
}

function stocksOf(tid) {
  return store.list(tid, 'stock')
}

const handlers = {
  'GET /api/products': async (ctx) => {
    const blocked = guard(ctx, 3)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    return ok({ products: productsOf(tid).map(withStock(tid)) })
  },
  'GET /api/inventory': async (ctx) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const items = productsOf(tid).map(withStock(tid))
    return ok({ inventory: items })
  },
  'POST /api/products': async (ctx, body) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    if (!b.name || !String(b.name).trim()) return err(400, 'Product name is required')
    const product = store.insert(tid, 'products', {
      name: String(b.name).trim(),
      description: b.description || '',
      unitPrice: Number(b.unitPrice || 0),
      sku: b.sku || '',
      unit: b.unit || 'unit',
      active: b.active !== false,
      reorderLevel: Number(b.reorderLevel || 0),
      createdAt: new Date().toISOString(),
    })
    store.insert(tid, 'stock', { productId: product.id, onHand: Number(b.onHand || 0), updatedAt: new Date().toISOString() })
    logActivity(tid, 'product', 'created', product.id, product.name)
    return ok({ product: { ...product, onHand: Number(b.onHand || 0) } })
  },
  'PUT /api/products/:id': async (ctx, body) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const b = body || {}
    const product = store.update(tid, 'products', Number(ctx.params.id), {
      name: b.name !== undefined ? String(b.name).trim() : undefined,
      description: b.description !== undefined ? b.description : undefined,
      unitPrice: b.unitPrice !== undefined ? Number(b.unitPrice) : undefined,
      sku: b.sku !== undefined ? b.sku : undefined,
      unit: b.unit !== undefined ? b.unit : undefined,
      active: b.active !== undefined ? !!b.active : undefined,
      reorderLevel: b.reorderLevel !== undefined ? Number(b.reorderLevel) : undefined,
    })
    if (!product) return err(404, 'Product not found')
    return ok({ product: { ...product, onHand: onHand(tid, product.id) } })
  },
  'POST /api/products/:id/stock': async (ctx, body) => {
    const blocked = guard(ctx, 4)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const id = Number(ctx.params.id)
    const product = store.get(tid, 'products', id)
    if (!product) return err(404, 'Product not found')
    const delta = Number(body && body.delta || 0)
    const rec = stocksOf(tid).find((s) => s.productId === id)
    const prev = rec ? rec.onHand : 0
    const next = Math.max(0, prev + delta)
    if (rec) rec.onHand = next
    else store.insert(tid, 'stock', { productId: id, onHand: next, updatedAt: new Date().toISOString() })
    store.save()
    logActivity(tid, 'stock', 'updated', id, product.name, `${prev} -> ${next}`)
    return ok({ product: { ...product, onHand: next } })
  },
  'DELETE /api/products/:id': async (ctx) => {
    const blocked = guard(ctx, 5)
    if (blocked) return blocked
    const tid = tenantOf(ctx)
    const id = Number(ctx.params.id)
    store.remove(tid, 'products', id)
    const i = stocksOf(tid).findIndex((s) => s.productId === id)
    if (i !== -1) {
      stocksOf(tid).splice(i, 1)
      store.save()
    }
    return ok({ ok: true })
  },
  'GET /internal/products': async (ctx) => {
    const tid = String(ctx.query.tid || '')
    const all = ctx.query.withstock === '1'
    return ok({ products: all ? productsOf(tid).map(withStock(tid)) : productsOf(tid) })
  },
  'POST /internal/products': async (ctx, body) => {
    const tid = String((body && body.tid) || '')
    const records = Array.isArray(body && body.records) ? body.records : []
    const created = records.map((r) => {
      const p = store.insert(tid, 'products', { ...r, active: r.active !== false, createdAt: r.createdAt || new Date().toISOString() })
      store.insert(tid, 'stock', { productId: p.id, onHand: Number(r.onHand || 0), updatedAt: new Date().toISOString() })
      return p
    })
    return ok({ products: created })
  },
}

function withStock(tid) {
  return function (p) {
    return { ...p, onHand: onHand(tid, p.id) }
  }
}

function onHand(tid, productId) {
  const rec = stocksOf(tid).find((s) => s.productId === productId)
  return rec ? rec.onHand : 0
}

function logActivity(tid, type, action, entityId, label, detail) {
  callSvc(conf, 'workspace', 'POST', '/internal/activity', { tid, type, action, entityId, label, detail }).catch(() => {})
}

createService('catalog', handlers)