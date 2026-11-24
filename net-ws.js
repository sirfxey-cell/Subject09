(function(){
  var url = window.S09_RELAY_URL;
  if (!url || window.claude) return;
  window.S09Net = { join: function(name){ return new Promise(function(resolve, reject){
    var ws = new WebSocket(url), peers = new Map(), hs = new Set(), me = null, mine = {};
    function list(){ var a = []; peers.forEach(function(p, id){ a.push({peer:id, isMe:false, presence:p}); }); if (me) a.push({peer:me, isMe:true, presence:mine}); return a; }
    function fire(){ var l = list(); hs.forEach(function(h){ try { h({peers:l, joined:[], left:[], updated:[]}); } catch(e){} }); }
    function merge(t, patch){ Object.keys(patch).forEach(function(k){ if (patch[k] === null) delete t[k]; else t[k] = patch[k]; }); }
    var room = { name:name, peers:list,
      presence:function(patch){ merge(mine, patch); if (ws.readyState === 1) ws.send(JSON.stringify({t:'p', patch:patch})); return Promise.resolve(); },
      onPeers:function(h){ hs.add(h); return function(){ hs.delete(h); }; },
      leave:function(){ try { ws.close(); } catch(e){} return Promise.resolve(); } };
    ws.onopen = function(){ ws.send(JSON.stringify({t:'join', room:name})); };
    ws.onmessage = function(ev){ var d; try { d = JSON.parse(ev.data); } catch(e){ return; }
      if (d.t === 'hello'){ me = d.id; d.peers.forEach(function(p){ peers.set(p.peer, p.presence || {}); }); resolve(room); fire(); }
      else if (d.t === 'join'){ peers.set(d.peer, {}); fire(); }
      else if (d.t === 'p'){ var p = peers.get(d.peer) || {}; merge(p, d.patch); peers.set(d.peer, p); fire(); }
      else if (d.t === 'left'){ peers.delete(d.peer); fire(); } };
    ws.onerror = function(){ reject(new Error('relay')); };
    ws.onclose = function(){ peers.clear(); fire(); };
  }); } };
})();
