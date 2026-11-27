// Subject 09 multiplayer relay. Players connect only to Cloudflare; nobody sees anyone else's IP.
// One Durable Object per room keeps the sockets and forwards presence between players.
const MAX_PEERS = 40, MAX_MSG = 24000;
const ORIGINS = ['https://subject09.app', 'https://www.subject09.app', 'https://sirfxey-cell.github.io', 'http://localhost:8765'];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    if (url.pathname === '/ice') return ice(env, origin);
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Subject 09 relay', { status: 200 });
    if (origin && !ORIGINS.includes(origin) && !origin.startsWith('https://appassets.androidplatform.net')) return new Response('forbidden', { status: 403 });
    const room = (url.searchParams.get('room') || 'lobby').slice(0, 64);
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
  }
};

// Short-lived TURN credentials for voice chat. Voice only ever flows through Cloudflare's TURN relay.
async function ice(env, origin) {
  const ok = !origin || ORIGINS.includes(origin) || origin.startsWith('https://appassets.androidplatform.net');
  const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': ok && origin ? origin : 'https://subject09.app', 'Vary': 'Origin' };
  if (!ok) return new Response('{}', { status: 403, headers: h });
  if (!env.TURN_KEY_ID || !env.TURN_TOKEN) return new Response('{"iceServers":[]}', { status: 503, headers: h });
  const r = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + String(env.TURN_KEY_ID).trim() + '/credentials/generate-ice-servers', {
    method: 'POST', headers: { Authorization: 'Bearer ' + String(env.TURN_TOKEN).trim(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 21600 }) });
  if (!r.ok) return new Response(JSON.stringify({ iceServers: [], upstream: r.status, key: String(env.TURN_KEY_ID).slice(0, 4), tokenLen: String(env.TURN_TOKEN).trim().length, body: (await r.text()).slice(0, 200) }), { status: 502, headers: h });
  const d = await r.json();
  // keep only relay (turn/turns) entries: no STUN, so a player's real address is never discovered or shared
  let servers = d.iceServers; if (!Array.isArray(servers)) servers = [servers];
  servers = servers.map(s => ({ ...s, urls: [].concat(s.urls || []).filter(u => /^turns?:/.test(u)) })).filter(s => s.urls.length);
  return new Response(JSON.stringify({ iceServers: servers }), { headers: h });
}

export class Room {
  constructor(state) { this.state = state; }
  peers() { return this.state.getWebSockets(); }
  info(ws) { try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; } }
  send(ws, obj) { try { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch (e) {} }
  broadcast(obj, except) { const s = JSON.stringify(obj); for (const ws of this.peers()) if (ws !== except && this.info(ws).joined) this.send(ws, s); }
  async fetch(req) {
    if (this.peers().length >= MAX_PEERS) return new Response('room full', { status: 429 });
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    const id = crypto.randomUUID().slice(0, 12);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id, presence: {}, joined: false });
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > MAX_MSG) return;
    let d; try { d = JSON.parse(msg); } catch (e) { return; }
    const me = this.info(ws);
    if (d.t === 'join' && !me.joined) {
      me.joined = true; ws.serializeAttachment(me);
      const peers = [];
      for (const o of this.peers()) { if (o === ws) continue; const i = this.info(o); if (i.joined) peers.push({ peer: i.id, presence: i.presence }); }
      this.send(ws, { t: 'hello', id: me.id, peers });
      this.broadcast({ t: 'join', peer: me.id }, ws);
    } else if (d.t === 'p' && me.joined && d.patch && typeof d.patch === 'object') {
      for (const k of Object.keys(d.patch)) { if (d.patch[k] === null) delete me.presence[k]; else me.presence[k] = d.patch[k]; }
      ws.serializeAttachment(me);
      this.broadcast({ t: 'p', peer: me.id, patch: d.patch }, ws);
    } else if (d.t === 'sig' && me.joined && typeof d.to === 'string' && d.d) {
      for (const o of this.peers()) { if (this.info(o).id === d.to) { this.send(o, { t: 'sig', from: me.id, d: d.d }); break; } }
    } else if (d.t === 'ping') this.send(ws, { t: 'pong' });
  }
  async webSocketClose(ws) { const me = this.info(ws); if (me.joined) this.broadcast({ t: 'left', peer: me.id }, ws); try { ws.close(); } catch (e) {} }
  async webSocketError(ws) { return this.webSocketClose(ws); }
}
