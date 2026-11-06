// Two-tab online flow test with a deterministic in-browser PeerJS transport mock.
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { extname, join } = require('node:path');

const root = __dirname;
const realPeer = process.env.REAL_PEER === '1';
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = mkdtempSync(join(tmpdir(), 'sofa-online-smoke-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const edge = spawn(edgePath, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--headless=new', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });

const mockPeerSource = String.raw`
(() => {
  const channelName = 'sofa-duel-peer-mock';
  class MockConnection {
    constructor(peer, remote) {
      this.peerObject = peer;
      this.peer = remote;
      this.open = false;
      this.closed = false;
      this.handlers = {};
    }
    on(type, handler) { (this.handlers[type] ||= []).push(handler); }
    emit(type, value) { for (const handler of this.handlers[type] || []) handler(value); }
    markOpen() {
      if (this.closed || this.open) return;
      this.open = true;
      this.emit('open');
    }
    send(payload) {
      if (!this.open || this.closed) throw new Error('Mock connection is not open');
      (window.__mockPackets ||= []).push({ type: payload.type, at: performance.now(), payload });
      this.peerObject.post({ kind: 'data', to: this.peer, payload });
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      this.peerObject.post({ kind: 'close', to: this.peer });
      this.emit('close');
    }
    remoteClose() {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      this.emit('close');
    }
  }
  class MockPeer {
    constructor(id, options) {
      this.id = id;
      window.__lastPeerOptions = options;
      this.handlers = {};
      this.connections = new Set();
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = event => this.receive(event.data);
      setTimeout(() => this.emit('open', id), 20);
    }
    on(type, handler) { (this.handlers[type] ||= []).push(handler); }
    emit(type, value) { for (const handler of this.handlers[type] || []) handler(value); }
    post(message) { this.channel.postMessage({ ...message, from: this.id }); }
    connect(remote) {
      const conn = new MockConnection(this, remote);
      this.connections.add(conn);
      this.post({ kind: 'connect', to: remote });
      return conn;
    }
    receive(message) {
      if (!message || message.to !== this.id) return;
      if (message.kind === 'connect') {
        const conn = new MockConnection(this, message.from);
        this.connections.add(conn);
        this.emit('connection', conn);
        this.post({ kind: 'accept', to: message.from });
        setTimeout(() => conn.markOpen(), 30);
        return;
      }
      const conn = [...this.connections].find(item => item.peer === message.from);
      if (!conn) return;
      if (message.kind === 'accept') setTimeout(() => conn.markOpen(), 20);
      if (message.kind === 'data') conn.emit('data', message.payload);
      if (message.kind === 'close') conn.remoteClose();
    }
    destroy() {
      for (const conn of this.connections) conn.close();
      this.channel.close();
    }
  }
  window.Peer = MockPeer;
})();`;

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = join(root, relative);
    if (!file.startsWith(root)) throw new Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (_) {
    res.writeHead(404); res.end('Not found');
  }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(tab) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const exceptions = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  if (!realPeer) await send('Page.addScriptToEvaluateOnNewDocument', { source: mockPeerSource });
  return { ws, send, evaluate, exceptions };
}

async function waitFor(client, expression, description, timeout = realPeer ? 30000 : 7000) {
  const start = Date.now();
  let value;
  while (Date.now() - start < timeout) {
    value = await client.evaluate(expression);
    if (value) return value;
    await sleep(60);
  }
  const diagnostic = await client.evaluate(`({online:window.SofaBench?window.SofaBench.online():null,status:(document.getElementById('status-label')||{}).textContent||null,readyState:document.readyState,bodyLen:document.body?document.body.innerHTML.length:0,url:location.href})`);
  throw new Error(`Timed out: ${description}; last=${JSON.stringify(value)}; diagnostic=${JSON.stringify(diagnostic)}; exceptions=${JSON.stringify(client.exceptions)}`);
}

async function key(client, type, keyValue, code, virtualKey) {
  await client.send('Input.dispatchKeyEvent', { type, key: keyValue, code, windowsVirtualKeyCode: virtualKey });
}


async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const httpPort = server.address().port;
  let initialTab;
  for (let i = 0; i < 80; i++) { try { const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); initialTab = tabs.find(t => t.type === 'page'); if (initialTab) break; } catch (_) {} await sleep(100); }
  const host = await connect(initialTab);
  if (!realPeer) await host.send('Page.addScriptToEvaluateOnNewDocument', { source: mockPeerSource });
  const { targetId } = await host.send('Target.createTarget', { url: 'about:blank', newWindow: true, background: false });
  let guestTab;
  for (let i = 0; i < 30 && !guestTab; i++) { const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); guestTab = tabs.find(t => t.id === targetId); if (!guestTab) await sleep(50); }
  const guest = await connect(guestTab);
  if (!realPeer) await guest.send('Page.addScriptToEvaluateOnNewDocument', { source: mockPeerSource });
  const url = `http://127.0.0.1:${httpPort}/index.html?bench=1`;
  // HOST on a PHONE viewport (the user's scenario)
  await host.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await guest.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true });
  await host.send('Page.navigate', { url });
  await guest.send('Page.navigate', { url });
  await waitFor(host, 'Boolean(window.SofaBench)', 'host init');
  await waitFor(guest, 'Boolean(window.SofaBench)', 'guest init');
  const dump = `(() => { const vis = id => document.getElementById(id).classList.contains('visible'); return { mode: window.SofaBench.online().mode, state: window.SofaBench.online().state, startVisible: vis('start-screen'), onlineVisible: vis('online-screen'), pickersHidden: document.querySelector('.pickers').hidden, diffHidden: document.getElementById('difficulty-selector').hidden, narrow: innerWidth <= 760 }; })()`;
  async function dumpState(who, label) { const st = await (who === 'host' ? host : guest).evaluate(dump); console.log(label, JSON.stringify(st)); return st; }

  await host.evaluate(`document.querySelector('#start-screen .start-mode-switch [data-mode="online"]').click();document.getElementById('create-room-btn').click()`);
  await waitFor(host, `window.SofaBench.online().state==='waiting'`, 'host waiting');
  await guest.evaluate(`document.querySelector('#start-screen .start-mode-switch [data-mode="online"]').click();document.getElementById('room-code-input').value='ZZZZZZ';document.getElementById('join-room-btn').click()`);
  // read the real code from host and rejoin if the placeholder was wrong
  const code = await host.evaluate('window.SofaBench.online().roomCode');
  await guest.evaluate(`document.getElementById('room-code-input').value='${code}';document.getElementById('join-room-btn').click()`);
  await waitFor(guest, `window.SofaBench.online().state==='select'`, 'guest in select');
  await waitFor(host, `window.SofaBench.online().state==='select'`, 'host in select');
  await dumpState('host', 'H0 host-in-select:');

  // THE BUG: host (phone) clicks 单人挑战 while in online select
  await guest.evaluate(`document.querySelector('.mode-switch [data-mode="cpu"]').click()`);
  const g1 = await dumpState('guest', 'G1 guest after click cpu:');
  const shot = await guest.send('Page.captureScreenshot', { format: 'png' });
  require('node:fs').writeFileSync(require('node:path').join(root, 'guest-after-mode-switch.png'), Buffer.from(shot.data, 'base64'));
  if (!g1.startVisible || g1.pickersHidden) console.log('BUG CONFIRMED: guest start pickers not restored');
  else console.log('guest transition OK');
  // guest side should also land somewhere sane
  await sleep(400);
  await dumpState('guest', 'G1 guest after host left:');
  console.log('PROBE_DONE');
  server.close();
  await sleep(200);
}
main().then(() => process.exit(0)).catch(err => { console.error('FAIL:', err.message); process.exit(1); });