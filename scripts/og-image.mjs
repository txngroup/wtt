// Renders scripts/og-image.html to public/og.png (1200x630) with headless Chrome over the DevTools protocol. The card
// shows the host of SITE_URL, read from the environment or .env.
//   node --env-file-if-exists=.env scripts/og-image.mjs
// CHROME overrides the browser binary (default: Google Chrome on macOS, google-chrome elsewhere).
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME =
  process.env.CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const here = resolve(import.meta.dirname)
const host = process.env.SITE_URL ? new URL(process.env.SITE_URL).host : ''
const profile = mkdtempSync(join(tmpdir(), 'og-chrome-'))
const page = join(profile, 'og-image.html')
writeFileSync(page, readFileSync(join(here, 'og-image.html'), 'utf8').replaceAll('{{host}}', host))
const port = 9400 + Math.floor(Math.random() * 500)
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  let targets
  for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200)
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => undefined)
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const waiting = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    waiting.get(m.id)?.(m)
    waiting.delete(m.id)
  }
  const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false })
  await send('Page.enable')
  await send('Page.navigate', { url: `file://${page}` })
  await sleep(1000)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(here, '..', 'public', 'og.png'), Buffer.from(shot.result.data, 'base64'))
  ws.close()
  console.log('wrote public/og.png')
} finally {
  chrome.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
