export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  const s = String(text || '').replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((v) => v.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  row.push(field)
  if (row.some((v) => v.trim() !== '')) rows.push(row)
  return rows
}

export function matchColumn(headers) {
  const norm = (h) => String(h || '').toLowerCase().replace(/[\s_-]+/g, '').replace(/\./g, '')
  const map = { name: [], email: [], phone: [], status: [], tags: [] }
  headers.forEach((h, i) => {
    const n = norm(h)
    if (/name|company|business|fullname/.test(n)) map.name.push(i)
    else if (/email|e-mail|mail/.test(n)) map.email.push(i)
    else if (/phone|tel|mobile|whatsapp/.test(n)) map.phone.push(i)
    else if (/status/.test(n)) map.status.push(i)
    else if (/tag|categor/.test(n)) map.tags.push(i)
  })
  return map
}

const ENTITY_FIELDS = {
  customer: [
    ['name', /name|company|business|customer/i],
    ['email', /email|e-?mail/i],
    ['phone', /phone|tel|mobile|whatsapp/i],
    ['status', /status/i],
    ['tags', /tag|categor/i],
  ],
  lead: [
    ['name', /name|company|business|customer/i],
    ['email', /email|e-?mail/i],
    ['phone', /phone|tel|mobile|whatsapp/i],
    ['source', /source|channel/i],
    ['status', /status/i],
    ['followUpDate', /follow.?up|next.?contact/i],
  ],
  product: [
    ['sku', /sku|itemcode|ref/i],
    ['name', /product|item|name/i],
    ['description', /descri/i],
    ['unitPrice', /unit.?price|price|rate|amount/i],
    ['unit', /unit/i],
    ['active', /active|status/i],
  ],
  expense: [
    ['name', /title|name|item|expense/i],
    ['category', /categor/i],
    ['amount', /amount|cost|value|total/i],
    ['date', /^date$/i],
    ['status', /status/i],
    ['note', /note|descr/i],
  ],
  invoice: [
    ['customer', /customer|company|client/i],
    ['invoiceNumber', /invoice\s?(number|no|#)?|invoicenumber/i],
    ['issueDate', /issue|date/i],
    ['dueDate', /^due/i],
    ['status', /status/i],
    ['amount', /amount|total/i],
    ['paidAmount', /paid/i],
    ['product', /product|item/i],
    ['qty', /qty|quantity/i],
  ],
}

export function matchColumns(headers, entity) {
  const norm = (h) => String(h || '').toLowerCase().trim()
  const fields = ENTITY_FIELDS[entity] || ENTITY_FIELDS.customer
  const used = new Set()
  const map = {}
  for (const [field, re] of fields) {
    let idx = -1
    headers.forEach((h, i) => {
      if (idx === -1 && !used.has(i) && re.test(norm(h))) idx = i
    })
    if (idx !== -1) {
      map[field] = idx
      used.add(idx)
    }
  }
  map.index = headers
  return map
}