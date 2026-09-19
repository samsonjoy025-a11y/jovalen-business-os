import { api, J, money, esc, pill, fmtDate } from '../api.js'
import { openDrawer, closeOverlay, confirmDelete, toast } from '../app.js'

let products = []

export function init() {
  J.actions['product-new'] = () => productForm(null)
  J.actions['product-edit'] = (el) => productForm(products.find((p) => p.id === Number(el.dataset.id)))
  J.actions['product-toggle'] = async (el) => {
    const p = products.find((x) => x.id === Number(el.dataset.id))
    if (!p) return
    await api('PUT', `/api/products/${p.id}`, { active: !p.active })
    toast(p.active ? 'Product deactivated' : 'Product activated')
    window.location.reload()
  }
  J.actions['product-delete'] = async (el) => {
    if (!confirmDelete('Delete this product?')) return
    await api('DELETE', `/api/products/${el.dataset.id}`)
    toast('Product deleted')
    window.location.reload()
  }
  J.forms['product-form'] = async (form, ev) => {
    ev.preventDefault()
    const body = {
      name: form.name.value.trim(),
      description: form.description.value.trim(),
      unitPrice: Number(form.unitPrice.value || 0),
      sku: form.sku.value.trim(),
      unit: form.unit.value.trim(),
      active: true,
    }
    const id = form.dataset.id
    const res = id ? await api('PUT', `/api/products/${id}`, body) : await api('POST', '/api/products', body)
    toast(id ? 'Product updated' : 'Product added — it is now available on invoices')
    closeOverlay()
    window.location.reload()
  }
}

export async function render() {
  const res = await api('GET', '/api/products')
  products = res.products

  const rows = products
    .map((p) => {
      return `<tr>
        <td><strong>${esc(p.name)}</strong>${p.description ? `<br><span class="muted" style="font-size:.78rem">${esc(p.description)}</span>` : ''}</td>
        <td class="muted">${esc(p.sku || '—')}</td>
        <td class="muted">${esc(p.unit || 'unit')}</td>
        <td><strong>${money(p.unitPrice, J.session.org.currency)}</strong></td>
        <td>${pill(p.active ? 'active' : 'inactive')}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm" data-action="product-edit" data-id="${p.id}">Edit</button>
          <button class="btn btn-sm" data-action="product-toggle" data-id="${p.id}">${p.active ? 'Deactivate' : 'Activate'}</button>
          <button class="btn btn-sm btn-danger" data-action="product-delete" data-id="${p.id}">Del</button>
        </div></td>
      </tr>`
    })
    .join('')

  return `
  <div class="maxw">
    <div class="view-head"><h2>Product catalogue</h2><div class="page-actions"><button class="btn btn-primary" data-action="product-new">+ Add product</button></div></div>
    <div class="card">
      ${
        products.length
          ? `<div class="table-wrap"><table><thead><tr><th>Product / service</th><th>SKU</th><th>Unit</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
          : `<div class="empty"><div class="big">📦</div>No products yet. Add what you sell so invoices can reference them.<br><button class="btn btn-primary mt" data-action="product-new">Add your first product</button></div>`
      }
    </div>
    <p class="hint mt">Products and services in this catalogue are the reference data behind every invoice line item, keeping one source of truth for what you sell.</p>
  </div>`
}

function productForm(product) {
  const p = product || { name: '', description: '', unitPrice: 0, sku: '', unit: 'unit' }
  openDrawer(`
    <div class="dialog-head"><h3>${product ? 'Edit product' : 'Add product'}</h3><button class="close-x" data-action="drawer-close">×</button></div>
    <form data-form="product-form" data-id="${product ? product.id : ''}">
      <label>Name<input name="name" value="${esc(p.name)}" required /></label>
      <label>Description<textarea name="description" rows="2">${esc(p.description)}</textarea></label>
      <div class="grid-2">
        <label>Unit price<input type="number" name="unitPrice" min="0" value="${p.unitPrice}" /></label>
        <label>Unit<input name="unit" value="${esc(p.unit)}" placeholder="unit, month, kg…" /></label>
      </div>
      <label>SKU / reference<input name="sku" value="${esc(p.sku)}" /></label>
      <div class="row-actions" style="justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn" data-action="drawer-close">Cancel</button>
        <button type="submit" class="btn btn-primary">${product ? 'Save changes' : 'Add product'}</button>
      </div>
    </form>
  `)
}