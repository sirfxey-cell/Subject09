// Multiplayer through the Subject 09 relay (Cloudflare). Players only ever connect to the relay,
// so nobody can see another player's IP address. Voice chat is off in this mode.
(function(){
  var url = window.S09_RELAY_URL;
  if (!url || window.claude) return;
  window.S09Net = { join: function(name){ return new Promise(function(resolve, reject){
    var ws = new WebSocket(url + (url.indexOf('?') < 0 ? '?' : '&') + 'room=' + encodeURIComponent(name));
    var peers = new Map(), hs = new Set(), me = null, mine = {}, pend = null, timer = null, ping = null, done = false;
    function list(){ var a = []; peers.forEach(function(p, id){ a.push({peer:id, isMe:false, presence:p}); }); if (me) a.push({peer:me, isMe:true, presence:mine}); return a; }
    function fire(){ var l = list(); hs.forEach(function(h){ try { h({peers:l, joined:[], left:[], updated:[]}); } catch(e){} }); }
    function merge(t, patch){ Object.keys(patch).forEach(function(k){ if (patch[k] === null || patch[k] === undefined) delete t[k]; else t[k] = patch[k]; }); }
    function flush(){ timer = null; if (!pend || ws.readyState !== 1) return; ws.send(JSON.stringify({t:'p', patch:pend})); pend = null; }
    var room = { name:name, peers:list,
      presence:function(patch){ merge(mine, patch); pend = pend || {}; Object.keys(patch).forEach(function(k){ pend[k] = patch[k] === undefined ? null : patch[k]; }); if (!timer) timer = setTimeout(flush, 120); return Promise.resolve(); },
      onPeers:function(h){ hs.add(h); return function(){ hs.delete(h); }; },
      leave:function(){ clearInterval(ping); try { ws.close(); } catch(e){} return Promise.resolve(); } };
    ws.onopen = function(){ ws.send(JSON.stringify({t:'join', room:name})); ping = setInterval(function(){ if (ws.readyState === 1) ws.send('{"t":"ping"}'); }, 25000); };
    ws.onmessage = function(ev){ var d; try { d = JSON.parse(ev.data); } catch(e){ return; }
      if (d.t === 'hello'){ me = d.id; d.peers.forEach(function(p){ peers.set(p.peer, p.presence || {}); }); done = true; resolve(room); fire(); if (Object.keys(mine).length) room.presence(mine); }
      else if (d.t === 'join'){ peers.set(d.peer, {}); fire(); }
      else if (d.t === 'p'){ var p = peers.get(d.peer) || {}; merge(p, d.patch); peers.set(d.peer, p); fire(); }
      else if (d.t === 'left'){ peers.delete(d.peer); fire(); } };
    ws.onerror = function(){ if (!done) reject(new Error('relay')); };
    ws.onclose = function(){ clearInterval(ping); peers.clear(); fire(); if (!done) reject(new Error('relay')); };
  }); } };
})();
