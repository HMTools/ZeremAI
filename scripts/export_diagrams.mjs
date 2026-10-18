#!/usr/bin/env node
// Turns each Archify diagram (site/diagrams/<slug>.html) into two static pictures the docs can show:
//   site/images/diagrams/<slug>-light.svg and <slug>-dark.svg
// It opens the diagram in headless Chrome and presses the two SVG export buttons of the viewer, so the pictures are
// the ones the viewer itself would download. Needs Node 22 or later (for WebSocket) and Chrome or Chromium
// (set CHROME to its path if it is not found).
// Usage: node scripts/export_diagrams.mjs [slug ...]     (no slug: every diagram)

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(import.meta.url), '../..')
const diagrams = join(root, 'site/diagrams')
const out = join(root, 'site/images/diagrams')

const CHROME = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find(p => p && existsSync(p))
if (!CHROME) { console.error('Chrome or Chromium not found. Set CHROME to its path.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))

// The page code: presses an export button and keeps the file that the viewer would download.
const EXPORT = `(async () => {
  const made = {}, make = URL.createObjectURL.bind(URL); let last = null
  URL.createObjectURL = blob => { last = blob; return make(blob) }
  for (const theme of ['light', 'dark']) {
    last = null
    // A newer viewer has one button for each theme. An older one has a single "svg" button that saves the theme on the page.
    let button = document.querySelector('button[data-format="svg-' + theme + '"]')
    if (!button) {
      document.documentElement.setAttribute('data-theme', theme)
      await new Promise(r => setTimeout(r, 200))
      button = document.querySelector('button[data-format="svg"]')
    }
    if (!button) throw new Error('no export button for ' + theme)
    button.click()
    for (let i = 0; i < 100 && !last; i++) await new Promise(r => setTimeout(r, 50))
    if (!last) throw new Error('the ' + theme + ' picture was not made')
    made[theme] = await last.text()
    // The older viewer saves one SVG that follows the system theme. The docs follow the site theme, so pin this copy to its own theme.
    if (!/<svg[^>]*\sdata-theme=/.test(made[theme])) made[theme] = made[theme].replace('<svg ', '<svg data-theme="' + theme + '" ')
  }
  return made
})()`

async function connect(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
      const ws = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
      return ws
    } catch { await sleep(100) }
  }
  throw new Error('Chrome did not start')
}

function session(ws) {
  let id = 0; const waiting = new Map(); const events = []
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    if (m.id && waiting.has(m.id)) { const { ok, no } = waiting.get(m.id); waiting.delete(m.id); m.error ? no(new Error(m.error.message)) : ok(m.result) } else if (m.method) events.push(m.method)
  }
  return {
    send: (method, params = {}) => new Promise((ok, no) => { waiting.set(++id, { ok, no }); ws.send(JSON.stringify({ id, method, params })) }),
    loaded: async () => { for (let i = 0; i < 200 && !events.includes('Page.loadEventFired'); i++) await sleep(50) },
  }
}

async function exportAll(slugs) {
  const port = 9300 + Math.floor(Math.random() * 500)
  const profile = mkdtempSync(join(tmpdir(), 'chrome-'))
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  let failed = 0
  try {
    for (const slug of slugs) {
      const ws = await connect(port)
      try {
        const cdp = session(ws)
        await cdp.send('Page.enable')
        await cdp.send('Page.navigate', { url: pathToFileURL(join(diagrams, slug + '.html')).href })
        await cdp.loaded()
        await sleep(800)
        const result = await cdp.send('Runtime.evaluate', { expression: EXPORT, awaitPromise: true, returnByValue: true })
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'the page code failed')
        mkdirSync(out, { recursive: true })
        for (const theme of ['light', 'dark']) writeFileSync(join(out, `${slug}-${theme}.svg`), result.result.value[theme])
        console.log(`${slug}: ${slug}-light.svg, ${slug}-dark.svg`)
      } catch (e) { failed++; console.error(`${slug}: ${e.message ?? e}`) } finally { ws.close() }
    }
  } finally { chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }) }
  return failed
}

const wanted = process.argv.slice(2)
const slugs = wanted.length ? wanted : readdirSync(diagrams).filter(f => f.endsWith('.html')).map(f => basename(f, '.html'))
process.exit((await exportAll(slugs)) ? 1 : 0)
