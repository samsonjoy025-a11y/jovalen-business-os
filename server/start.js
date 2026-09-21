import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SERVICE_PORTS } from './core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SERVICES = [
  'auth',
  'workspace',
  'crm',
  'sales',
  'catalog',
  'finance',
  'tasks',
  'analytics',
  'ai',
  'automation',
  'import',
  'documents',
]

function migrateIfNeeded() {
  const dataDir = path.join(__dirname, 'services', 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const marker = path.join(dataDir, '.migrated')
  if (fs.existsSync(marker)) return
  if (fs.existsSync(path.join(__dirname, 'data', 'db.json')) || fs.existsSync(path.join(__dirname, 'data', 'sessions.json'))) {
    console.log('Running one-time migration of existing data…')
    const res = spawnSync(process.execPath, [path.join(__dirname, 'migrate.js')], { stdio: 'inherit' })
    if (res.status !== 0) {
      console.error('Migration failed. Refusing to start.')
      process.exit(1)
    }
    fs.writeFileSync(marker, String(Date.now()))
  } else {
    fs.writeFileSync(marker, String(Date.now()))
  }
}

const children = []

function start(script, name) {
  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => process.stdout.write(`  ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`  ${d}`))
  child.on('exit', (code) => {
    console.error(`[${name}] exited with code ${code}`)
  })
  children.push(child)
  return child
}

async function main() {
  migrateIfNeeded()
  console.log('Starting Jovalen services…')
  for (const name of SERVICES) {
    start(path.join(__dirname, 'services', `${name}-service.js`), name)
  }
  start(path.join(__dirname, 'gateway.js'), 'gateway')
  console.log(`Gateway on http://127.0.0.1:${SERVICE_PORTS.gateway}`)
  console.log('Press Ctrl+C to stop all services.\n')

  const shutdown = () => {
    console.log('\nStopping all services…')
    for (const c of children) {
      try {
        c.kill()
      } catch {}
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()