/**
 * DASHBOARD HOST — port 4400.
 *
 * Deliberately thin. It spawns `engine/run.js` as a child process, reads its NDJSON event
 * stream off stdout, and rebroadcasts to browsers over one WebSocket. It contains NO
 * business logic and computes NO numbers.
 *
 * That is the insurance architecture: if the UI breaks or the projector dies, the demo
 * degrades to `node engine/run.js` in a terminal, and every number is still real. The story
 * survives a missing dashboard; it does not survive a missing engine.
 */

const express = require('express')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { WebSocketServer } = require('ws')

const ROOT = path.join(__dirname, '..')
const PORT = 4400
const app = express()

app.use(express.json())
app.use(express.static(path.join(ROOT, 'dashboard')))

const server = app.listen(PORT, () => {
  console.log(`[engine] GlassBox QA dashboard   http://localhost:${PORT}`)
})

const wss = new WebSocketServer({ server })
const clients = new Set()
let history = [] // replayed to a client that connects mid-run
let running = null

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.send(JSON.stringify({ type: 'hello', running: !!running, thresholds: readGate().thresholds }))
  for (const ev of history) ws.send(JSON.stringify(ev))
  ws.on('close', () => clients.delete(ws))
})

function broadcast(ev) {
  const s = JSON.stringify(ev)
  for (const ws of clients) { if (ws.readyState === 1) ws.send(s) }
}

const readGate = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'gate.json'), 'utf8'))

/** Spawn a run and stream its events. One at a time. */
function startRun(mode) {
  if (running) return { ok: false, error: 'a run is already in progress' }

  history = []
  const args = [path.join(__dirname, 'run.js')]
  if (mode === 'baseline') args.push('--baseline')

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, GLASSBOX_STREAM: '1' },
  })
  running = child

  const push = (ev) => { history.push(ev); broadcast(ev) }
  push({ type: 'run-start', mode })

  let buf = ''
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (line.startsWith('@@GBX@@')) {
        try { push(JSON.parse(line.slice(7))) } catch {}
      }
    }
  })
  child.stderr.on('data', (c) => push({ type: 'stderr', message: c.toString() }))

  child.on('close', (code) => {
    running = null
    push({ type: 'run-end', code })
  })

  return { ok: true }
}

app.post('/api/run', (req, res) => res.json(startRun(req.body && req.body.mode === 'baseline' ? 'baseline' : 'change')))

app.post('/api/mutate', (req, res) => {
  const { execFileSync } = require('child_process')
  const name = String((req.body && req.body.mutation) || '')
  const label = String((req.body && req.body.label) || '')
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'mutate.js'), name, label], { cwd: ROOT, encoding: 'utf8' })
    broadcast({ type: 'mutation', name, output: out.trim() })
    res.json({ ok: true, output: out.trim() })
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.stderr || e.message) })
  }
})

app.get('/api/last-run', (_req, res) => {
  const p = path.join(ROOT, '.glassbox', 'last-run.json')
  if (!fs.existsSync(p)) return res.json(null)
  res.type('json').send(fs.readFileSync(p, 'utf8'))
})

app.get('/api/git-log', (_req, res) => {
  const { execFileSync } = require('child_process')
  try {
    res.json({ log: execFileSync('git', ['log', '--oneline', '-8'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n') })
  } catch {
    res.json({ log: [] })
  }
})

app.get('/api/diff', (_req, res) => {
  const { execFileSync } = require('child_process')
  try {
    res.json({ diff: execFileSync('git', ['show', '--format=%s', '--no-color', 'HEAD', '--', 'sut/'], { cwd: ROOT, encoding: 'utf8' }) })
  } catch {
    res.json({ diff: '' })
  }
})
