import { api, J, esc, fmtDate } from '../api.js'

export function init() {
  J.actions['notif-open'] = async (el) => {
    const id = el.dataset.id
    await api('POST', `/api/notifications/item/${id}`).catch(() => {})
    const link = el.dataset.link
    if (link) window.location.hash = link
    window.location.reload()
  }
  J.actions['notif-readall'] = async () => {
    await api('POST', '/api/notifications/read-all')
    window.location.reload()
  }
}

const ICONS = {
  welcome: '👋',
  lead_assigned: '🎯',
  task_assigned: '📋',
  task_overdue: '⏰',
  task_completed: '✅',
  invoice_created: '🧾',
  invoice_overdue: '🔔',
  invoice_paid: '💳',
  expense_submitted: '💸',
  expense_approved: '✅',
  expense_rejected: '🚫',
  role_changed: '⚙️',
}

export async function render() {
  const res = await api('GET', '/api/notifications')
  const items = res.notifications

  return `
  <div class="maxw">
    <div class="view-head"><h2>Notifications</h2><div class="page-actions"><button class="btn btn-sm" data-action="notif-readall">Mark all as read</button></div></div>
    <div class="feed">
      ${
        items.length
          ? items
              .map((n) => {
                return `<div class="notif ${n.read ? '' : 'unread'}" data-action="notif-open" data-id="${n.id}" data-link="${esc(n.link || '')}">
                  <div style="font-size:1.2rem">${ICONS[n.type] || '•'}</div>
                  <div class="notif-txt"><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span></div>
                  <div class="muted" style="font-size:.75rem;flex:none">${n.ageLabel}</div>
                </div>`
              })
              .join('')
          : `<div class="empty"><div class="big">🔕</div>No notifications yet. They will appear here as your team works.</div>`
      }
    </div>
  </div>`
}