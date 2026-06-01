import http from 'http'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import open from 'open'
import { exchangeCode } from './reddit.js'
import { state } from './state.js'

const CONFIG_DIR = path.join(os.homedir(), '.rshell')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const REDIRECT_PORT = 7474
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`
const SCOPES = 'identity vote submit read'

export async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export async function saveConfig(cfg) {
  await fs.mkdir(CONFIG_DIR, { recursive: true })
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

function waitForCode() {
  return new Promise((resolve, reject) => {
    let done = false

    const server = http.createServer((req, res) => {
      if (done) return
      try {
        const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`)
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`<h2>Authentication failed: ${error}</h2>`)
          done = true
          server.close()
          reject(new Error(`Reddit denied access: ${error}`))
          return
        }

        if (code) {
          done = true
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body style="font-family:monospace;padding:2rem"><h2>rshell authenticated ✓</h2><p>You can close this tab and return to your terminal.</p></body></html>')
          server.close()
          resolve(code)
        }
      } catch (e) {
        res.writeHead(500)
        res.end('Server error')
        reject(e)
      }
    })

    server.on('error', reject)
    server.listen(REDIRECT_PORT)

    setTimeout(() => {
      if (!done) {
        done = true
        server.close()
        reject(new Error('OAuth timed out after 60 seconds'))
      }
    }, 60_000)
  })
}

export async function login(clientId) {
  const authUrl = new URL('https://www.reddit.com/api/v1/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', 'rshell-auth')
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('duration', 'permanent')
  authUrl.searchParams.set('scope', SCOPES)

  console.log(`\nOpening Reddit authorization in your browser...`)
  console.log(`If the browser doesn't open, visit:\n${authUrl}\n`)

  await open(authUrl.toString())

  const code = await waitForCode()
  const tokenData = await exchangeCode(clientId, code, REDIRECT_URI)

  if (!tokenData.access_token) {
    throw new Error('No access_token in response — check your client_id and app type')
  }

  const cfg = await loadConfig()
  cfg.clientId = clientId
  cfg.token = tokenData.access_token
  if (tokenData.refresh_token) cfg.refreshToken = tokenData.refresh_token
  await saveConfig(cfg)

  return tokenData.access_token
}
