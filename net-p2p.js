// Peer-to-peer multiplayer for hosts without a game server (GitHub Pages, the APK web view).
// Players find each other through public relays, then talk directly over WebRTC.
(function () {
  if (window.S09Net || window.claude) return;
  var LIB = 'https://cdn.jsdelivr.net/npm/trystero@0.25.4/+esm';
  var APP = 'subject09-sirfxey';
  var lib = null;

  function load() {
    if (!lib) lib = import(LIB);
    return lib;
  }

  window.S09Net = {
    join: function (name) {
      return load().then(function (T) {
        var room = T.joinRoom({ appId: APP }, String(name));
        var act = room.makeAction('pres');
        var send, get;
        if (Array.isArray(act)) {
          send = function (d, to) { return act[0](d, to); };
          get = act[1];
        } else {
          send = function (d, to) { return act.send(d, to ? { target: to } : {}); };
          get = function (h) { act.onMessage = h; };
        }
        function pid(x) { return x && typeof x === 'object' ? String(x.peerId || x.id || '') : String(x); }
        function on(ev, h) {
          if (typeof room[ev] === 'function') room[ev](h); else room[ev] = h;
        }
        var mine = {}, others = new Map(), seen = new Map(), handlers = new Set(), left = false;
        var oldApi = Array.isArray(act), voice = null, onStream = null, onGone = null;
        function sendVoice(to) {
          if (!voice) return;
          try { if (to) room.addStream(voice, oldApi ? to : { target: to }); else room.addStream(voice); } catch (e) {}
        }
        on('onPeerStream', function (stream, x) { if (onStream) onStream(stream, pid(x)); });

        function list() {
          var a = [{ peer: T.selfId, isMe: true, presence: mine }];
          var now = Date.now();
          others.forEach(function (p, id) {
            // Skip peers that have not said anything yet or went quiet (closed tab, lost connection).
            if (!seen.has(id) || now - seen.get(id) > 20000) return;
            a.push({ peer: id, isMe: false, presence: p });
          });
          return a;
        }
        function fire() {
          var l = list();
          handlers.forEach(function (h) { try { h({ peers: l, joined: [], left: [], updated: [] }); } catch (e) {} });
        }

        on('onPeerJoin', function (x) {
          var id = pid(x);
          if (!others.has(id)) others.set(id, {});
          try { Promise.resolve(send(mine, id)).catch(function () {}); } catch (e) {}
          sendVoice(id);
          fire();
        });
        on('onPeerLeave', function (x) { var id = pid(x); others.delete(id); seen.delete(id); if (onGone) onGone(id); fire(); });
        var sweep = setInterval(function () {
          var now = Date.now(), gone = false;
          seen.forEach(function (t, id) { if (now - t > 20000) { seen.delete(id); others.delete(id); if (onGone) onGone(id); gone = true; } });
          if (gone) fire();
          // Keep-alive so idle players are not dropped.
          if (!left) { try { Promise.resolve(send(mine)).catch(function () {}); } catch (e) {} }
        }, 5000);
        get(function (data, x) {
          var id = pid(x);
          if (!data || typeof data !== 'object') return;
          others.set(id, data);
          seen.set(id, Date.now());
          fire();
        });

        var api = {
          name: name,
          peers: list,
          presence: function (patch) {
            if (left) return Promise.resolve();
            Object.keys(patch || {}).forEach(function (k) {
              if (patch[k] === null || patch[k] === undefined) delete mine[k]; else mine[k] = patch[k];
            });
            try { Promise.resolve(send(mine)).catch(function () {}); } catch (e) {}
            return Promise.resolve();
          },
          voice: {
            send: function (stream) { if (voice === stream) return; voice = stream; sendVoice(null); },
            onStream: function (h) { onStream = h; },
            onGone: function (h) { onGone = h; }
          },
          onPeers: function (h) { handlers.add(h); return function () { handlers.delete(h); }; },
          leave: function () {
            left = true;
            clearInterval(sweep);
            others.clear();
            seen.clear();
            try { room.leave(); } catch (e) {}
            return Promise.resolve();
          }
        };
        return api;
      });
    }
  };
})();
