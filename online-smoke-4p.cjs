const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname } = require('node:path');
const root = "C:\\Users\\蒋天颢\\Documents\\Codex\\2026-10-22\\sofa-duel-v15-showtime";
const mockSrc = "\n(() => {\n  const channelName = 'sofa-duel-peer-mock';\n  class MockConnection {\n    constructor(peer, remote) {\n      this.peerObject = peer;\n      this.peer = remote;\n      this.open = false;\n      this.closed = false;\n      this.handlers = {};\n    }\n    on(type, handler) { (this.handlers[type] ||= []).push(handler); }\n    emit(type, value) { for (const handler of this.handlers[type] || []) handler(value); }\n    markOpen() {\n      if (this.closed || this.open) return;\n      this.open = true;\n      this.emit('open');\n    }\n    send(payload) {\n      if (!this.open || this.closed) throw new Error('Mock connection is not open');\n      (window.__mockPackets ||= []).push({ type: payload.type, at: performance.now(), payload });\n      this.peerObject.post({ kind: 'data', to: this.peer, payload });\n    }\n    close() {\n      if (this.closed) return;\n      this.closed = true;\n      this.open = false;\n      this.peerObject.post({ kind: 'close', to: this.peer });\n      this.emit('close');\n    }\n    remoteClose() {\n      if (this.closed) return;\n      this.closed = true;\n      this.open = false;\n      this.emit('close');\n    }\n  }\n  class MockPeer {\n    constructor(id, options) {\n      this.id = id;\n      window.__lastPeerOptions = options;\n      this.handlers = {};\n      this.connections = new Set();\n      this.channel = new BroadcastChannel(channelName);\n      this.channel.onmessage = event => this.receive(event.data);\n      setTimeout(() => this.emit('open', id), 20);\n    }\n    on(type, handler) { (this.handlers[type] ||= []).push(handler); }\n    emit(type, value) { for (const handler of this.handlers[type] || []) handler(value); }\n    post(message) { this.channel.postMessage({ ...message, from: this.id }); }\n    connect(remote) {\n      const conn = new MockConnection(this, remote);\n      this.connections.add(conn);\n      this.post({ kind: 'connect', to: remote });\n      return conn;\n    }\n    receive(message) {\n      if (!message || message.to !== this.id) return;\n      if (message.kind === 'connect') {\n        const conn = new MockConnection(this, message.from);\n        this.connections.add(conn);\n        this.emit('connection', conn);\n        this.post({ kind: 'accept', to: message.from });\n        setTimeout(() => conn.markOpen(), 30);\n        return;\n      }\n      const conn = [...this.connections].find(item => item.peer === message.from);\n      if (!conn) return;\n      if (message.kind === 'accept') setTimeout(() => conn.markOpen(), 20);\n      if (message.kind === 'data') conn.emit('data', message.payload);\n      if (message.kind === 'close') conn.remoteClose();\n    }\n    destroy() {\n      for (const conn of this.connections) conn.close();\n      this.channel.close();\n    }\n  }\n  window.Peer = MockPeer;\n})();";
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = mkdtempSync(join(tmpdir(), 'sofa-4p-v2-'));
const filePort = 21000 + Math.floor(Math.random() * 4000);
const dbgPort = filePort + 1;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const data = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('no'); }
});
server.listen(filePort);
const edge = spawn(edgePath, [`--user-data-dir=${profile}`, `--remote-debugging-port=${dbgPort}`, '--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-timer-throttling', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  let tab;
  for (let i = 0; i < 250 && !tab; i++) {
    try { const tabs = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json(); tab = tabs.find(t => t.type === 'page'); if (!tab) await sleep(200); } catch { await sleep(200); }
  }
  const mk = async (tabInfo, label) => {
    const ws = new WebSocket(tabInfo.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let nid = 0; const np = new Map(); const errors = [];
    ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && np.has(m.id)) { np.get(m.id)(m); np.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text).slice(0, 120)); };
    const send = (method, params = {}) => new Promise(res => { const i = ++nid; np.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.result?.exceptionDetails) return { __err: String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 150) };
      return r.result?.result?.value;
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: mockSrc });
    return { ws, send, evaluate, errors, label };
  };
  const list0 = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
  const host = await mk(list0.find(t => t.type === 'page'), 'host');
  const clients = [host];
  const url = 'http://127.0.0.1:' + filePort + '/index.html?bench=1';
  await host.send('Page.navigate', { url });
  await sleep(2200);
  await host.evaluate("document.querySelector('.mode[data-mode=online]').click()");
  await host.evaluate("document.querySelectorAll('.size-btn')[2].click()");
  await host.evaluate("document.getElementById('create-room-btn').click()");
  let code = '';
  for (let k = 0; k < 15 && code.length !== 6; k++) { await sleep(400); code = await host.evaluate('(window.SofaBench.online().roomCode || "")'); }
  console.log('room:', code);
  for (let gi = 1; gi <= 3; gi++) {
    const t = await host.send('Target.createTarget', { url: 'about:blank' });
    const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
    const info = list.find(x => x.id === t.result.targetId);
    const c = await mk(info, 'guest' + gi);
    clients.push(c);
    await c.send('Page.navigate', { url });
    await sleep(1800);
    await c.evaluate("document.querySelector('.mode[data-mode=online]').click()");
    await c.evaluate(`document.getElementById('room-code-input').value = '${code}';document.getElementById('join-room-btn').click()`);
    await sleep(1400);
    const st = await c.evaluate('({ state: window.SofaBench.online().state, pn: window.SofaBench.online().playerNumber })');
    console.log('guest' + gi + ':', JSON.stringify(st));
  }
  // pick + ready with retry tolerance
  for (let attempt = 0; attempt < 10; attempt++) {
    const ready = await host.evaluate('window.SofaBench.online().ready.join(",")');
    if (ready === 'true,true,true,true') break;
    for (let i = 0; i < 4; i++) {
      const st = await clients[i].evaluate('window.SofaBench.online()');
      if (!st.characters[st.playerNumber] || !st.ready[st.playerNumber]) {
        await clients[i].evaluate(`document.querySelectorAll('#online-picker .character-choice')[${i}].click()`);
        await clients[i].evaluate("document.getElementById('online-ready-btn').click()");
      }
    }
    await sleep(700);
  }
  await sleep(1800);
  const hs = await host.evaluate('window.SofaBench.online()');
  console.log('host:', JSON.stringify({ state: hs.state, picks: hs.picks, players: (hs.players || []).length }));
  // drive the match
  await host.evaluate('window.__benchTimer = setInterval(() => window.SofaBench.step(.033), 33)');
  let finished = false;
  for (let k = 0; k < 4500; k++) {
    await host.evaluate('window.SofaBench.step(.033)');
    if (k % 400 === 0) {
      const ph = await host.evaluate('window.SofaBench.online().phase');
      if (ph === 'finished') { finished = true; console.log('match finished at tick', k); break; }
    }
  }
  for (let i = 0; i < 4; i++) {
    const s = await clients[i].evaluate('window.SofaBench.online()');
    console.log('seat' + i, JSON.stringify({ state: s.state, phase: s.phase, players: (s.players || []).length, scores: s.scores }));
  }
  console.log('ERRORS:', clients.map(c => c.errors.length ? c.label + ':' + c.errors[0] : null).filter(Boolean).join(' | ') || 'none');
  for (const c of clients) c.ws.close();
}
main().finally(() => { try { edge.kill(); server.close(); rmSync(profile, { recursive: true, force: true }); } catch {} });
