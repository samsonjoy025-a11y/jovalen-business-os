import { api, J, esc } from '../api.js'
import { toast } from '../app.js'

let entity = 'customers'
let lastCsv = ''
let preview = null
let committed = null

const ENTITIES = [
  { key: 'customers', label: 'Customers', fields: 'name, email, phone, status, tags', sample: 'name,email,phone,status,tags\nAdaeze Boutique,hello@adaezeboutique.com,+234 701 234 5678,active,wholesale\nBright Foods,buyer@brightfoods.com,+234 703 456 7890,inactive,ia' },
  { key: 'leads', label: 'Leads', fields: 'name, email, phone, source, status, followUpDate', sample: 'name,email,source,status,followUpDate\nFlora and Co,hello@flora.com,Website,new,2026-10-01\nTechBro Services,ops@techbro.com,Referral,qualified,2026-10-05' },
  { key: 'products', label: 'Products', fields: 'sku, name, description, unitPrice, unit, active', sample: 'sku,name,unitPrice,unit,active\nSKU-001,Wool throw blanket,18500,unit,active\nSKU-002,Glass serving bowl,9200,unit,active' },
  { key: 'expenses', label: 'Expenses', fields: 'name/title, category, amount, date, status, note', sample: 'title,category,amount,date,status\nOffice rent,Rent,250000,2026-09-01,approved\nLogistics,Transport,40000,2026-09-12,pending' },
  { key: 'invoices', label: 'Invoices', fields: 'customer, invoiceNumber, issueDate, dueDate, status, amount, paidAmount, product, qty', sample: 'customer,invoiceNumber,issueDate,dueDate,status,amount,paidAmount,product,qty\nAdaeze Boutique,INV-1001,2026-09-01,2026-09-15,sent,74000,0,Throws,4\nBright Foods,INV-1002,2026-09-05,2026-09-20,paid,9200,9200,Bowls,1' },
]

export function init() {
  J.actions['import-tab'] = (elBtn) => {
    entity = elBtn.dataset.entity
    preview = null
    committed = null
    window.location.hash = '/import'
    window.location.reload()
  }
  J.forms['csv-import'] = async (form, ev) => {
    ev.preventDefault()
    entity = form.entity.value
    const file = form.csv.files[0]
    if (!file) return toast('Choose a CSV file first')
    lastCsv = await file.text()
    preview = await api('POST', `/api/import/${entity}`, { csv: lastCsv, dryRun: true })
    committed = null
    el('import-preview').innerHTML = previewHtml(preview)
    toast(`Preview ready — ${preview.ready} ready, ${preview.errors.length} row problems`)
  }
  J.forms['csv-commit'] = async (form, ev) => {
    ev.preventDefault()
    const res = await api('POST', `/api/import/${preview.entity}`, { csv: lastCsv })
    committed = preview
    el('import-preview').innerHTML = resultOnly(res)
    el('import-commit').remove()
    toast(`Imported ${res.imported} ${preview.entity}${res.imported === 1 ? '' : 's'}${res.skipped ? `, skipped ${res.skipped}` : ''}`)
  }
}

function el(id) {
  return document.getElementById(id)
}

function previewHtml(res) {
  const errors = (res.errors || []).map((e) => `<tr><td class="muted">${esc(e)}</td></tr>`).join('')
  const samples = (res.preview || []).map((p) => `<tr><td class="muted">${esc(p)}</td></tr>`).join('')
  return `
  <div class="card card-pad" style="margin-top:16px">
    <strong>Preview — ${esc(ENTITIES.find((x) => x.key === res.entity).label)}</strong>
    <div class="flex wrap mt" style="gap:24px">
      <div><span class="stat-value" style="font-size:1.3rem">${res.ready}</span> <span class="muted">ready to add</span></div>
      <div><span class="stat-value" style="font-size:1.3rem">${res.errors.length}</span> <span class="muted">row problems</span></div>
    </div>
    <div class="table-wrap mt"><table><thead><tr><th>First ${res.preview.length} records</th></tr></thead><tbody>${samples || '<tr><td class="muted">No valid rows yet.</td></tr>'}</tbody></table></div>
    ${errors ? `<div class="table-wrap mt"><table><thead><tr><th>Row issues</th></tr></thead><tbody>${errors}</tbody></table></div>` : ''}
    <form data-form="csv-commit" id="import-commit" class="mt"><button class="btn btn-primary" ${res.ready ? '' : 'disabled'}>${res.ready ? `Confirm import (${res.ready} records)` : 'Nothing to import'}</button></form>
  </div>`
}

function resultOnly(res) {
  const errors = (res.errors || []).map((e) => `<tr><td class="muted">${esc(e)}</td></tr>`).join('')
  return `
  <div class="card card-pad" style="margin-top:16px">
    <strong>Import complete</strong>
    <div class="flex wrap mt" style="gap:24px">
      <div><span class="stat-value" style="font-size:1.3rem">${res.imported}</span> <span class="muted">created</span></div>
      <div><span class="stat-value" style="font-size:1.3rem">${res.skipped}</span> <span class="muted">skipped</span></div>
    </div>
    ${errors ? `<div class="table-wrap mt"><table><thead><tr><th>Row issues</th></tr></thead><tbody>${errors}</tbody></table></div>` : ''}
  </div>`
}

export async function render() {
  const selected = ENTITIES.find((x) => x.key === entity)
  const tabs = ENTITIES.map((e) => `<button class="chip ${e.key === entity ? 'chip-active' : ''}" data-action="import-tab" data-entity="${e.key}">${e.label}</button>`).join('')
  return `
  <div class="maxw stack">
    <div class="view-head"><h2>Import data</h2></div>
    <div class="welcome-card">
      <h2>Bring your existing records into Jovalen</h2>
      <p>Pick what you are importing, upload a CSV or spreadsheet export, and preview the result before it is committed. Jovalen detects columns by header name, reports row-level problems, and skips duplicates so you keep one clean source of truth.</p>
    </div>
    <div class="card card-pad">
      <h3 class="card-title">Choose data type</h3>
      <div class="flex wrap" style="gap:8px">${tabs}</div>
    </div>
    <div class="card card-pad">
      <h3 class="card-title">Import ${selected.label}</h3>
      <form data-form="csv-import">
        <div class="grid-2">
          <label>Data type<select name="entity">${ENTITIES.map((e) => `<option value="${e.key}" ${e.key === entity ? 'selected' : ''}>${e.label}</option>`).join('')}</select></label>
          <label>CSV file <input type="file" name="csv" accept=".csv,.txt,text/csv" required /></label>
        </div>
        <button class="btn btn-primary mt">Preview import</button>
      </form>
      <div id="import-preview"></div>
    </div>
    <div class="card card-pad">
      <h3 class="card-title">Expected columns</h3>
      <p class="hint">Header names are matched flexibly. For ${selected.label} we map: <code>${selected.fields}</code>.</p>
      <pre style="background:var(--surface-2);padding:12px;border-radius:8px;overflow:auto;font-size:.8rem">${esc(selected.sample)}</pre>
    </div>
  </div>`
}