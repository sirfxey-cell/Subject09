// Multiplayer through the Subject 09 relay (Cloudflare). Players only ever connect to the relay,
// so nobody can see another player's IP address. Voice goes through Cloudflare's TURN relay only (relay candidates),
// so voice never reveals an address either.
(function(){
  var url = window.S09_RELAY_URL;
  if (!url) return;
  window.S09Net = { join: function(name){ return new Promise(function(resolve, reject){
    var ws = new WebSocket(url + (url.indexOf('?') < 0 ? '?' : '&') + 'room=' + encodeURIComponent(name));
    var peers = new Map(), hs = new Set(), me = null, mine = {}, pend = null, timer = null, ping = null, done = false;
    function list(){ var a = []; peers.forEach(function(p, id){ a.push({peer:id, isMe:false, presence:p}); }); if (me) a.push({peer:me, isMe:true, presence:mine}); return a; }
    function fire(){ var l = list(); hs.forEach(function(h){ try { h({peers:l, joined:[], left:[], updated:[]}); } catch(e){} }); }
    function merge(t, patch){ Object.keys(patch).forEach(function(k){ if (patch[k] === null || patch[k] === undefined) delete t[k]; else t[k] = patch[k]; }); }
    function flush(){ timer = null; if (!pend || ws.readyState !== 1) return; ws.send(JSON.stringify({t:'p', patch:pend})); pend = null; }
    /* ---- voice: WebRTC forced through TURN (iceTransportPolicy 'relay'); signaling goes through the relay socket ---- */
    var iceUrl = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/?(\?.*)?$/, '') + '/ice', ice = null, iceAt = 0;
    var local = null, pcs = new Map(), onStream = null, onGone = null;
    function getIce(){ if (ice && Date.now() - iceAt < 3*3600e3) return Promise.resolve(ice);
      return fetch(iceUrl).then(function(r){ return r.json(); }).then(function(d){ ice = (d && d.iceServers) || []; iceAt = Date.now(); return ice; }).catch(function(){ return []; }); }
    function sig(to, d){ if (ws.readyState === 1) ws.send(JSON.stringify({t:'sig', to:to, d:d})); }
    function relayOnly(c){ return !c || / typ relay /.test(c.candidate || ''); }
    function conn(id){ var e = pcs.get(id); if (e) return Promise.resolve(e);
      return getIce().then(function(servers){ if (!servers.length) return null; if (pcs.get(id)) return pcs.get(id);
        var pc = new RTCPeerConnection({iceServers:servers, iceTransportPolicy:'relay'});
        e = {pc:pc, polite:String(me) < String(id), making:false, ignore:false}; pcs.set(id, e);
        pc.onicecandidate = function(ev){ if (ev.candidate && relayOnly(ev.candidate)) sig(id, {cand:ev.candidate.toJSON()}); };
        pc.ontrack = function(ev){ if (onStream) onStream(ev.streams[0] || new MediaStream([ev.track]), id); };
        pc.onnegotiationneeded = function(){ e.making = true; pc.setLocalDescription().then(function(){ sig(id, {desc:pc.localDescription.toJSON()}); }).catch(function(){}).then(function(){ e.making = false; }); };
        pc.onconnectionstatechange = function(){ if (pc.connectionState === 'failed') try { pc.restartIce(); } catch(x){} };
        if (local) local.getAudioTracks().forEach(function(t){ pc.addTrack(t, local); });
        return e; }); }
    function onSig(from, d){ conn(from).then(function(e){ if (!e) return; var pc = e.pc;
      if (d.desc){ var collide = d.desc.type === 'offer' && (e.making || pc.signalingState !== 'stable'); e.ignore = !e.polite && collide; if (e.ignore) return;
        pc.setRemoteDescription(d.desc).then(function(){ if (d.desc.type === 'offer') return pc.setLocalDescription().then(function(){ sig(from, {desc:pc.localDescription.toJSON()}); }); }).catch(function(){}); }
      else if (d.cand && relayOnly(d.cand)) pc.addIceCandidate(d.cand).catch(function(){}); }); }
    function drop(id){ var e = pcs.get(id); if (e){ try { e.pc.close(); } catch(x){} pcs.delete(id); } if (onGone) onGone(id); }
    var voice = {
      send:function(stream){ if (local === stream) return; local = stream; peers.forEach(function(p, id){ conn(id).then(function(e){ if (!e || !local) return;
        var tr = local.getAudioTracks()[0], snd = e.pc.getSenders().find(function(s){ return s.track && s.track.kind === 'audio'; });
        if (snd) snd.replaceTrack(tr); else e.pc.addTrack(tr, local); }); }); },
      onStream:function(h){ onStream = h; }, onGone:function(h){ onGone = h; } };
    var room = { name:name, peers:list, voice:voice,
      presence:function(patch){ merge(mine, patch); pend = pend || {}; Object.keys(patch).forEach(function(k){ pend[k] = patch[k] === undefined ? null : patch[k]; }); if (!timer) timer = setTimeout(flush, 120); return Promise.resolve(); },
      onPeers:function(h){ hs.add(h); return function(){ hs.delete(h); }; },
      leave:function(){ clearInterval(ping); pcs.forEach(function(e, id){ drop(id); }); try { ws.close(); } catch(e){} return Promise.resolve(); } };
    ws.onopen = function(){ ws.send(JSON.stringify({t:'join', room:name})); ping = setInterval(function(){ if (ws.readyState === 1) ws.send('{"t":"ping"}'); }, 25000); };
    ws.onmessage = function(ev){ var d; try { d = JSON.parse(ev.data); } catch(e){ return; }
      if (d.t === 'hello'){ me = d.id; d.peers.forEach(function(p){ peers.set(p.peer, p.presence || {}); }); done = true; resolve(room); fire(); if (Object.keys(mine).length) room.presence(mine); }
      else if (d.t === 'join'){ peers.set(d.peer, {}); fire(); if (local) voice.send(local === null ? null : (function(x){ local = null; return x; })(local)); }
      else if (d.t === 'p'){ var p = peers.get(d.peer) || {}; merge(p, d.patch); peers.set(d.peer, p); fire(); }
      else if (d.t === 'left'){ peers.delete(d.peer); drop(d.peer); fire(); }
      else if (d.t === 'sig' && d.from && d.d){ onSig(d.from, d.d); } };
    ws.onerror = function(){ if (!done) reject(new Error('relay')); };
    ws.onclose = function(){ clearInterval(ping); peers.clear(); fire(); if (!done) reject(new Error('relay')); };
  }); } };
})();
