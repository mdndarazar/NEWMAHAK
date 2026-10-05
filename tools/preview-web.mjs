/**
 * پیش‌نمایش مرورگر برای Arena: Vite روی رندرر + پل HTTP به‌جای IPC الکترون.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, '.preview-data')
mkdirSync(DATA, { recursive: true })
process.env.HARNESS_DIR = DATA
process.env.HARNESS_DB = join(DATA, 'shop.db')
process.env.HARNESS_BIGINT = '1'
process.chdir(ROOT)

await import('../test/harness/register.mjs')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, fn) => {
  handlers.set(channel, fn)
}

const { IPC } = await import('../src/shared/ipc.ts')
const { seed } = await import('../src/main/db/seed.ts')
await seed()
const { registerIpcHandlers } = await import('../src/main/ipc/index.ts')
registerIpcHandlers()

const react = (await import('@vitejs/plugin-react')).default
const { createServer: createViteServer } = await import('vite')

const CHANNELS_JSON = JSON.stringify(IPC)
const INJECT = `<script>
window.api = {
  invoke: function (channel, payload) {
    return fetch('/api/ipc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channel, payload: payload })
    }).then(function (r) { return r.json() })
  },
  channels: ${CHANNELS_JSON}
};
</script>`

const vite = await createViteServer({
  configFile: false,
  root: join(ROOT, 'src/renderer'),
  appType: 'custom',
  plugins: [
    react(),
    {
      name: 'browser-ipc',
      transformIndexHtml(html) {
        return html
          .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
          .replace('<head>', `<head>${INJECT}`)
      }
    }
  ],
  resolve: {
    alias: {
      '@shared': join(ROOT, 'src/shared'),
      '@renderer': join(ROOT, 'src/renderer/src')
    }
  },
  css: { postcss: join(ROOT, 'postcss.config.js') },
  server: {
    host: '0.0.0.0',
    middlewareMode: true,
    allowedHosts: true,
    hmr: { protocol: 'wss', clientPort: 443 }
  }
})

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const PORT = Number(process.env.PORT || 5173)
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.url === '/api/ipc' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}')
      const fn = handlers.get(body.channel)
      if (!fn) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: 'این عملیات در پیش‌نمایش نیست.' }))
        return
      }
      const result = await fn({}, body.payload)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(result))
    } catch (e) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }))
    }
    return
  }
  vite.middlewares(req, res, async () => {
    try {
      const html = await vite.transformIndexHtml(
        req.url || '/',
        readFileSync(join(ROOT, 'src/renderer/index.html'), 'utf8')
      )
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(html)
    } catch (e) {
      res.statusCode = 500
      res.end(String(e?.message ?? e))
    }
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[preview] listening on 0.0.0.0:${PORT}`)
})
