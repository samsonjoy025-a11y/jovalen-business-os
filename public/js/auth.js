import { api, setToken, J } from './api.js'

J.forms = J.forms || {}

const $ = (sel) => document.querySelector(sel)

document.querySelectorAll('.tab[data-auth-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn))
    const tab = btn.dataset.authTab
    $('#login-form').classList.toggle('hidden', tab !== 'login')
    $('#signup-form').classList.toggle('hidden', tab !== 'signup')
  })
})

function showError(msg) {
  $('#auth-error').textContent = msg
}

async function submitLogin(form) {
  try {
    const res = await api('POST', '/api/auth/login', {
      email: form.email.value.trim(),
      password: form.password.value,
    })
    setToken(res.token)
    window.location.href = '/app'
  } catch (e) {
    showError(e.message)
  }
}

async function submitSignup(form) {
  try {
    const res = await api('POST', '/api/auth/signup', {
      name: form.name.value.trim(),
      orgName: form.orgName.value.trim(),
      industry: form.industry.value.trim(),
      location: form.location.value.trim(),
      currency: form.currency.value,
      size: form.size.value,
      email: form.email.value.trim(),
      password: form.password.value,
    })
    setToken(res.token)
    window.location.href = '/app'
  } catch (e) {
    showError(e.message)
  }
}

J.forms.login = (form, ev) => {
  ev.preventDefault()
  submitLogin(form)
}
J.forms.signup = (form, ev) => {
  ev.preventDefault()
  submitSignup(form)
}

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('[data-form]')
  if (!form) return
  const fn = J.forms[form.dataset.form]
  if (fn) fn(form, ev)
})

if (J.token) {
  api('GET', '/api/session')
    .then(() => {
      window.location.href = '/app'
    })
    .catch(() => {})
}