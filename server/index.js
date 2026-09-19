import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApi } from './routes.js'
import { startAutomationLoop } from './automation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const PORT = Number(process.env.PORT || 3000)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

function serveStatic(res, urlPath, allowFallback) {
  let filePath = path.normalize(path.join(PUBLIC_DIR, urlPath))
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    if (allowFallback) filePath = path.join(PUBLIC_DIR, 'index.html')
    else {
      res.writeHead(404)
      res.end('Not found')
      return
    }
  }
  res.writeHead(200, { 'Content-Type': contentType(filePath) })
  fs.createReadStream(filePath).pipe(res)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const method = req.method || 'GET'

    if (url.pathname.startsWith('/api/')) {
      let body = null
      const ctype = req.headers['content-type'] || ''
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const raw = await readBody(req)
        if (raw.length) {
          try {
            body = ctype.includes('application/json') ? JSON.parse(raw.toString('utf8')) : Object.fromEntries(new URLSearchParams(raw.toString('utf8')))
          } catch {
            body = null
          }
        }
      }
      await handleApi(req, res, url, method, body)
      return
    }

    if (url.pathname === '/app' || url.pathname === '/app/') {
      serveStatic(res, '/app.html', false)
      return
    }
    if (url.pathname === '/' || url.pathname === '') {
      serveStatic(res, '/', true)
      return
    }
    serveStatic(res, url.pathname, false)
  } catch (err) {
    console.error('[request error]', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server error: ' + err.message }))
    } else {
      res.end()
    }
  }
})

process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err)
})

process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err)
})

server.listen(PORT, () => {
  console.log(`Jovalen Business OS running at http://localhost:${PORT}`)
  startAutomationLoop(15000)
})