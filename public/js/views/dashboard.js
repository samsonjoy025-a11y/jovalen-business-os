import { api, J, money, esc, pill, fmtDate, avatar } from '../api.js'

let state = {}
let period = 'month'

export function init() {
  J.actions['load-sample'] = async (el) => {
    if (!confirm('Load the sample business? This adds demo customers, invoices, expenses and tasks so you can explore the platform.')) return
    const res = await api('POST', '/api/bootstrap/seed')
    toast(res.message || 'Sample loaded')
    window.location.hash = '/dashboard'
    window.location.reload()
  }
  J.actions['export-csv'] = async () => {
    const res = await api('GET', `/api/export/csv?period=${period}`)
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(res.csv)
    a.download = res.filename
    a.click()
    toast('Report downloaded')
  }
}

function toast(msg) {
  window.dispatchEvent(new CustomEvent('jovalen-toast', { detail: msg }))
}

export async function render(ctx) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  period = params.get('period') || 'month'
  const res = await api('GET', `/api/dashboard?period=${period}`)
  state = res
  const m = res.metrics
  const cur = res.currency

  const onboarding =
    state.scope === 'business' && m.revenue === 0 && m.billed === 0 && m.expenses === 0 && m.pipelineValue === 0 && m.newCustomers === 0

  const isBusiness = state.scope === 'business'
  const periodWord = (res.periodLabel || 'month').toLowerCase()
  const stats = isBusiness
    ? [
        stat(`Revenue (${periodWord})`, money(m.revenue, cur), 'billed ' + money(m.billed, cur), true),
        stat(`Expenses (${periodWord})`, money(m.expenses, cur), money(m.profit, cur) >= 0 ? `Profit ${money(m.profit, cur)}` : `Loss ${money(Math.abs(m.profit), cur)}`, m.profit >= 0),
        stat('Outstanding', money(m.outstanding, cur), `${m.overdueInvoices} invoice${m.overdueInvoices === 1 ? '' : 's'} overdue`, false),
        stat('Pipeline', money(m.pipelineValue, cur), `${m.openDeals} open deals`, 'indigo'),
        stat('New customers', m.newCustomers, `${periodWord}`, true),
        stat('Open tasks', m.openTasks, 'across the team', false),
      ]
    : [
        stat('My open tasks', m.openTasks, `${m.overdueTasks} overdue`, m.overdueTasks === 0),
        stat('My leads', m.leadsOpen, `${m.leadsConverted} converted`, false),
        stat('My deals value', money(m.dealsValue, cur), `${m.dealsValue ? 'open' : 'no open deals'}`, 'indigo'),
        stat('Customers', m.customers, 'on record', true),
      ]

  const pipelineHtml = res.pipelineByStage
    ? `<div class="card card-pad"><h3 class="card-title">Pipeline by stage</h3><div class="bar">${res.pipelineByStage
        .filter((s) => s.stage !== 'lost')
        .map((s) => {
          const max = Math.max(...res.pipelineByStage.map((x) => x.value), 1)
          const pct = Math.round((s.value / max) * 100)
          return `<div class="bar-row"><span style="width:120px">${pill(s.stage)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span class="muted">${money(s.value, cur)}</span></div>`
        })
        .join('')}</div></div>`
    : ''

  const agingHtml = state.scope === 'business'
    ? `<div class="card card-pad"><h3 class="card-title">Invoice aging</h3><div class="table-wrap"><table><thead><tr><th>Bucket</th><th>Invoices</th><th>Outstanding</th></tr></thead><tbody>${res.aging
        .map((b) => `<tr><td>${b.label}</td><td>${b.count}</td><td>${money(b.value, cur)}</td></tr>`)
        .join('')}</tbody></table></div></div>`
    : ''

  const insightsHtml = `<div class="card card-pad"><h3 class="card-title">Jovalen insights</h3>${(res.insights || [])
    .map((i) => `<div class="insight">${esc(i)}</div>`)
    .join('')}<p class="hint mt">Ask Jovalen AI for a deeper analysis — it answers from your actual records.</p></div>`

  const activityHtml = `<div class="card card-pad"><h3 class="card-title">Recent activity</h3>${activityList(res.recentActivity)}</div>`

  const limitView = state.scope === 'business'
  const toolBar = `<div class="flex between wrap" style="align-items:center;gap:10px;margin-bottom:14px">
    <label style="flex-direction:row;align-items:center;gap:8px;font-size:.85rem;margin:0"><span class="muted">Period</span>
      <select onchange="location.hash='/dashboard?period='+this.value">${['day', 'week', 'month', 'quarter', 'year'].map((p) => `<option value="${p}" ${period === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select>
    </label>
    ${limitView ? '<button class="btn btn-sm" data-action="export-csv">⬇ Export CSV</button>' : ''}
  </div>`

  const setupHtml = state.scope === 'business' && res.setup
    ? `<div class="card card-pad"><h3 class="card-title">Getting started</h3><div class="flex between"><span class="muted">${res.setup.done} of ${res.setup.total} setup steps done</span><span class="muted" style="font-size:.8rem">${Math.round((res.setup.done / res.setup.total) * 100)}%</span></div><div class="progress mt"><div class="progress-fill" style="width:${Math.round((res.setup.done / res.setup.total) * 100)}%"></div></div><div class="flex wrap mt" style="gap:8px">${res.setup.steps.map((s) => `<a class="chip ${s.done ? 'chip-done' : ''}" href="${setupLink(s.key)}" data-action="jump-setup">${s.done ? '✓ ' : ''}${esc(s.label)}</a>`).join('')}</div></div>`
    : ''

  const onboardingCard = onboarding
    ? `<div class="welcome-card"><h2>Welcome to ${esc(ctx.session.org.name)} 👋</h2><p>Your workspace is ready. Load the sample business or start adding your own data.</p><button class="btn" style="background:#fff;color:#059669;font-weight:700" data-action="load-sample">Load a sample business</button> <a href="#/import" class="btn" style="background:transparent;color:#fff;border:1px solid #fff;display:inline-block">Import my data</a></div>`
    : ''

  return `
  <div class="maxw stack">
    ${onboardingCard}
    ${toolBar}
    ${setupHtml}
    <div class="stat-grid">${stats.join('')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
      ${insightsHtml}
      ${pipelineHtml}
      ${agingHtml}
      ${activityHtml}
    </div>
  </div>`
}

function setupLink(key) {
  return { profile: '#/settings', team: '#/settings', data: '#/customers', catalog: '#/products', invoice: '#/invoices', ai: '#/ai' }[key] || '#/dashboard'
}

function stat(label, value, sub, tone) {
  const cls = tone === 'indigo' ? 'indigo' : tone === false ? 'red' : 'green'
  return `<div class="stat ${cls}"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div></div>`
}

function activityList(activity) {
  if (!activity || !activity.length) return `<div class="empty">No activity yet.</div>`
  const icon = { customer: '👥', lead: '🎯', deal: '📊', product: '📦', invoice: '🧾', expense: '💸', task: '📋', user: '👤', payment: '💳' }
  return activity
    .map((a) => {
      const left = (icon[a.type] || '•') + ' '
      const verb = a.action === 'created' ? 'added' : 'updated'
      return `<div class="flex between" style="padding:9px 2px;border-bottom:1px solid var(--line)"><span><span style="margin-right:6px">${left}</span><strong>${esc(a.label)}</strong> <span class="muted">${verb}</span></span><span class="muted" style="font-size:.75rem">${fmtDate(a.at)}</span></div>`
    })
    .join('')
}

document.addEventListener('jovalen-toast', (e) => {
  const el = document.createElement('div')
  el.textContent = e.detail
  el.style.cssText = 'position:fixed;bottom:18px;right:18px;background:#0f172a;color:#fff;padding:11px 18px;border-radius:10px;z-index:99;font-size:.85rem'
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2600)
})