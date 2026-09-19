import { api, J, esc } from '../api.js'

export function init() {
  J.actions['ai-send'] = () => sendQuestion()
  J.actions['ai-suggest'] = (el) => {
    const input = document.querySelector('#ai-input')
    if (!input) return
    input.value = el.dataset.q
    input.focus()
  }
  J.actions['ai-cite'] = (el) => {
    const type = el.dataset.type
    const hash = type === 'customer' ? 'customers' : type === 'deal' ? 'pipeline' : `${type}s`
    window.location.hash = '/' + hash
    window.location.reload()
  }
  J.forms['ai-chat'] = (form, ev) => {
    ev.preventDefault()
    sendQuestion()
  }
}

export async function render() {
  let suggested = []
  try {
    suggested = (await api('GET', '/api/ai/suggested')).questions
  } catch {
    suggested = []
  }

  const welcome = aiMsg(
    `Hello ${J.session.user.name.split(' ')[0]} 👋 I'm Jovalen AI.\n\nAsk me anything about your business — I answer only from your authorized records and show the data behind every answer.`,
    [],
    suggested
  )

  return `
  <div class="maxw chat">
    <div class="view-head"><h2>Jovalen AI</h2></div>
    <div class="chat-list" id="chat-list">
      <div class="msg user" style="align-self:center;max-width:none;background:none;color:var(--muted);font-size:.9rem;font-weight:700">Start a conversation with your business data ↓</div>
      ${welcome}
    </div>
    <div class="chat-suggest" id="chat-suggest">
      ${suggested.slice(0, 6).map((q) => `<button class="sugg" data-action="ai-suggest" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
    </div>
    <form class="chat-input" data-form="ai-chat">
      <input id="ai-input" placeholder="Ask about revenue, customers, expenses, pipeline…" autocomplete="off" />
      <button class="btn btn-primary" type="submit">Ask</button>
    </form>
  </div>`
}

async function sendQuestion() {
  const input = document.querySelector('#ai-input')
  const list = document.querySelector('#chat-list')
  const q = input.value.trim()
  if (!q) return
  input.value = ''
  append(list, `<div class="msg user">${esc(q)}</div>`)
  const typing = aiMsg('Thinking…', [], [])
  const typingEl = append(list, typing)
  let res
  try {
    res = await api('POST', '/api/ai/ask', { question: q })
  } catch (e) {
    res = { answer: 'Sorry, I could not process that request. ' + e.message, citations: [], suggested: [] }
  }
  typingEl.remove()
  append(list, aiMsg(res.answer, res.citations || [], res.suggested || []))
  list.scrollTop = list.scrollHeight
}

function append(list, html) {
  const div = document.createElement('div')
  div.innerHTML = html
  list.appendChild(div)
  list.scrollTop = list.scrollHeight
  return div
}

function aiMsg(text, citations, suggested) {
  const cites = (citations || [])
    .filter((c) => c.id)
    .map((c) => {
      return `<div class="chat-cite flex between"><span>${esc(c.label)}</span><button class="btn btn-sm" data-action="ai-cite" data-type="${esc(c.type)}" data-id="${c.id}">View</button></div>`
    })
    .join('')
  const sug = (suggested || [])
    .slice(0, 3)
    .map((s) => `<button class="sugg" data-action="ai-suggest" data-q="${esc(s)}">${esc(s)}</button>`)
    .join('')
  return `<div class="msg ai"><div class="msg-meta">Jovalen AI</div>${esc(text)}
    ${cites ? `<div class="chat-cites">${cites}</div>` : ''}
    ${sug ? `<div class="chat-cites">${sug}</div>` : ''}
  </div>`
}