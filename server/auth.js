import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findTenantByUserEmail, findTenant, createUser } from './store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_FILE = path.join(__dirname, 'data', 'sessions.json')
const SCRYPT_KEYLEN = 64
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const sessions = new Map()

function loadSessions() {
  try {
    const saved = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
    for (const [token, s] of Object.entries(saved || {})) sessions.set(token, s)
  } catch {}
}

function persistSessions() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions)))
  } catch {}
}

loadSessions()

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':')
  if (!salt || !hash) return false
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'))
}

export function authenticate(email, password) {
  const found = findTenantByUserEmail(email)
  if (!found) return null
  if (!verifyPassword(password, found.user.passwordHash)) return null
  return found
}

export function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, { userId: user.id, tenantId: user.tenantId, createdAt: Date.now() })
  persistSessions()
  return token
}

export function destroySession(token) {
  if (sessions.has(token)) {
    sessions.delete(token)
    persistSessions()
  }
}

export function resolveSession(token) {
  const s = sessions.get(token)
  if (!s) return null
  if (Date.now() - (s.createdAt || 0) > SESSION_TTL_MS) {
    sessions.delete(token)
    persistSessions()
    return null
  }
  const tenant = findTenant(s.tenantId)
  if (!tenant) return null
  const user = tenant.users.find((u) => u.id === s.userId)
  if (!user) return null
  return { tenant, user }
}

export function registerUserInTenant(tenant, name, email, password, role) {
  const user = {
    name,
    email: String(email).toLowerCase(),
    passwordHash: hashPassword(password),
    role: role || 'staff',
  }
  return createUser(tenant, user)
}