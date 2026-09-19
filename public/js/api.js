export const J = (window.J = window.J || {})

J.token = localStorage.getItem('jovalen.token') || ''
J.session = null
J.apiBase = ''

export async function api(method, path, body) {
  const headers = {}
  if (J.token) headers.Authorization = `Bearer ${J.token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(J.apiBase + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (res.status === 401) {
    J.token = ''
    localStorage.removeItem('jovalen.token')
    if (!window.location.pathname.endsWith('index.html') && !window.location.pathname.endsWith('/')) {
      window.location.href = '/'
    }
    throw new Error('Session expired. Please log in again.')
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export function setToken(token) {
  J.token = token
  if (token) localStorage.setItem('jovalen.token', token)
  else localStorage.removeItem('jovalen.token')
}

export function money(amount, currency) {
  const cur = currency || (J.session && J.session.org && J.session.org.currency) || ''
  const n = Number(amount || 0)
  const s = n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return cur ? `${cur} ${s}` : s
}

export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return String(iso)
  return d.toISOString().slice(0, 10)
}

export function relDate(iso) {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  if (!d) return ''
  const diff = d - Date.now()
  const days = Math.round(diff / 86400000)
  if (days < 0) return `${-days}d overdue`
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days}d`
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function pill(status) {
  const map = {
    active: ['green', 'Active'],
    inactive: ['slate', 'Inactive'],
    new: ['blue', 'New'],
    contacted: ['blue', 'Contacted'],
    qualified: ['indigo', 'Qualified'],
    converted: ['green', 'Converted'],
    lost: ['red', 'Lost'],
    qualification: ['blue', 'Qualification'],
    proposal: ['indigo', 'Proposal'],
    negotiation: ['amber', 'Negotiation'],
    won: ['green', 'Won'],
    lost2: ['red', 'Lost'],
    draft: ['gray', 'Draft'],
    sent: ['blue', 'Sent'],
    paid: ['green', 'Paid'],
    partial: ['amber', 'Partially paid'],
    overdue: ['red', 'Overdue'],
    todo: ['gray', 'To do'],
    in_progress: ['blue', 'In progress'],
    done: ['green', 'Done'],
    pending: ['amber', 'Pending approval'],
    approved: ['green', 'Approved'],
    rejected: ['red', 'Rejected'],
    low: ['slate', 'Low'],
    medium: ['amber', 'Medium'],
    high: ['red', 'High'],
  }
  const p = map[status] || ['gray', status || '—']
  return `<span class="pill ${p[0]}">${esc(p[1])}</span>`
}

export function avatar(name) {
  const initials = String(name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return `<span class="avatar">${esc(initials)}</span>`
}

export function moneyCell(n, currency) {
  return `<span class="muted" style="font-weight:600">${money(n, currency)}</span>`
}

export function table(columns, rows) {
  if (!rows.length) return `<div class="empty"><div class="big">📭</div>Nothing here yet. Add your first record to get started.</div>`
  return `<div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}

export function pageHeader(title, actionsHtml) {
  return `<div class="view-head"><h2>${esc(title)}</h2><div class="page-actions">${actionsHtml || ''}</div></div>`
}