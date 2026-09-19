import { api, setToken, J, esc, money } from './api.js'

J.actions = J.actions || {}
J.forms = J.forms || {}
J.state = J.state || {}

const NAV = [
  { title: 'Dashboard', icon: '⌂', route: '/dashboard', roles: ['owner', 'finance', 'sales', 'staff'] },
  { title: 'Sales', icon: '◆', route: '', roles: [], section: true },
  { title: 'Customers', icon: '👥', route: '/customers', roles: ['owner', 'finance', 'sales'] },
  { title: 'Leads', icon: '🎯', route: '/leads', roles: ['owner', 'finance', 'sales'] },
  { title: 'Pipeline', icon: '📊', route: '/pipeline', roles: ['owner', 'finance', 'sales'] },
  { title: 'Finance', icon: '◆', route: '', roles: [], section: true },
  { title: 'Invoices', icon: '🧾', route: '/invoices', roles: ['owner', 'finance'] },
  { title: 'Expenses', icon: '💸', route: '/expenses', roles: ['owner', 'finance', 'sales', 'staff'] },
  { title: 'Approvals', icon: '✅', route: '/approvals', roles: ['owner', 'finance'] },
  { title: 'Catalogue', icon: '📦', route: '/products', roles: ['owner', 'finance'] },
  { title: 'Work', icon: '◆', route: '', roles: [], section: true },
  { title: 'Tasks', icon: '📋', route: '/tasks', roles: ['owner', 'finance', 'sales', 'staff'] },
  { title: 'Jovalen AI', icon: '✨', route: '/ai', roles: ['all'] },
  { title: 'Data', icon: '◆', route: '', roles: [], section: true },
  { title: 'Import', icon: '📥', route: '/import', roles: ['owner', 'finance', 'sales'] },
  { title: 'Team & Settings', icon: '⚙️', route: '/settings', roles: ['owner'] },
]

const VIEWS = {
  '/dashboard': 'dashboard',
  '/customers': 'customers',
  '/leads': 'leads',
  '/pipeline': 'pipeline',
  '/products': 'products',
  '/invoices': 'invoices',
  '/expenses': 'expenses',
  '/approvals': 'approvals',
  '/tasks': 'tasks',
  '/notifications': 'notifications',
  '/ai': 'ai',
  '/import': 'import',
  '/settings': 'settings',
}

const $ = (sel) => document.querySelector(sel)

function currentRoute() {
  const hash = window.location.hash.replace(/^#/, '') || '/dashboard'
  const [basePart] = hash.split('?')
  const [base, ...rest] = basePart.split('/').filter(Boolean)
  const path = '/' + (base || 'dashboard')
  return { path, params: rest }
}

function buildNav(role) {
  const active = currentRoute().path
  return NAV.filter((n) => n.section || n.roles.includes('all') || n.roles.includes(role))
    .map((n) =>
      n.section
        ? `<div class="nav-section">${esc(n.title)}</div>`
        : `<button class="nav-item ${active === n.route ? 'active' : ''}" data-action="nav" data-view="${n.route}"><span class="nav-icon">${n.icon}</span><span>${esc(n.title)}</span></button>`
    )
    .join('')
}

function renderShell() {
  const s = J.session
  $('#org-name').textContent = s.org.name
  $('#user-chip').textContent = `${s.user.name} · ${s.user.role}`
  $('#nav').innerHTML = buildNav(s.user.role)
}

async function refreshBadge() {
  if (!J.token || currentRoute().path === '/notifications') return
  try {
    const res = await api('GET', '/api/notifications/unread-count')
    const badge = $('#bell-badge')
    badge.classList.toggle('hidden', !res.unread)
    badge.textContent = res.unread || ''
  } catch {
    //
  }
}

async function renderView() {
  const { path, params } = currentRoute()
  const name = VIEWS[path]
  const container = $('#view')
  $('#page-title').textContent = NAV.find((n) => n.route === path)?.title || 'Jovalen'
  $('#nav').innerHTML = buildNav(J.session.user.role)

  if (!name) {
    container.innerHTML = `<div class="empty"><div class="big">🧭</div>Page not found. <a href="#/dashboard">Go to dashboard</a></div>`
    return
  }
  container.innerHTML = `<div class="loading">Loading…</div>`
  try {
    const mod = await import(`/js/views/${name}.js`)
    J.state.viewInit = J.state.viewInit || {}
    if (!J.state.viewInit[name]) {
      J.state.viewInit[name] = true
      mod.init && mod.init()
    }
    container.innerHTML = await mod.render({ path, params, session: J.session })
    window.scrollTo(0, 0)
  } catch (e) {
    container.innerHTML = `<div class="empty"><div class="big">⚠️</div>Failed to load view: ${esc(e.message)}</div>`
  }
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]')
  if (!el) return
  const action = el.dataset.action
  if (action === 'nav') {
    window.location.hash = el.dataset.view
    return
  }
  if (action === 'modal-close' || action === 'drawer-close') {
    closeOverlay()
    return
  }
  const fn = J.actions[action]
  if (fn) {
    ev.preventDefault()
    fn(el, ev)
  }
})

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('[data-form]')
  if (!form) return
  const fn = J.forms[form.dataset.form]
  if (fn) fn(form, ev)
})

function overlayHtml(kind, panel) {
  return `<div class="${kind}" data-overlay><div class="${kind === 'modal' ? 'modal-panel' : 'drawer-panel'}">${panel}</div></div>`
}

export function openDrawer(html) {
  $('#modal-root').innerHTML = overlayHtml('drawer', html)
}
export function openModal(html) {
  $('#modal-root').innerHTML = overlayHtml('modal', html)
}
export function closeOverlay() {
  $('#modal-root').innerHTML = ''
}
export function dialog(head, body) {
  openModal(
    `<div class="dialog-head"><h3>${head}</h3><button class="close-x" data-action="modal-close">×</button></div>${body}`
  )
}
export function confirmDelete(msg) {
  return window.confirm(msg)
}
export function toast(msg) {
  const el = document.createElement('div')
  el.textContent = msg
  el.style.cssText = 'position:fixed;bottom:18px;right:18px;background:#0f172a;color:#fff;padding:11px 18px;border-radius:10px;z-index:99;font-size:.85rem;box-shadow:0 8px 24px rgba(0,0,0,.25)'
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2600)
}

J.actions.logout = () => {
  api('POST', '/api/auth/logout').catch(() => {})
  setToken('')
  window.location.href = '/'
}

async function boot() {
  if (!J.token) {
    window.location.href = '/'
    return
  }
  try {
    const res = await api('GET', '/api/session')
    J.session = res
    renderShell()
    window.addEventListener('hashchange', renderView)
    await renderView()
    refreshBadge()
    setInterval(refreshBadge, 20000)
  } catch {
    window.location.href = '/'
  }
}

boot()