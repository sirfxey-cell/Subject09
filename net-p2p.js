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
        var pair = room.makeAction('pres');
        var send = pair[0], get = pair[1];
        var mine = {}, others = new Map(), handlers = new Set(), left = false;

        function list() {
          var a = [{ peer: T.selfId, isMe: true, presence: mine }];
          others.forEach(function (p, id) { a.push({ peer: id, isMe: false, presence: p }); });
          return a;
        }
        function fire() {
          var l = list();
          handlers.forEach(function (h) { try { h({ peers: l, joined: [], left: [], updated: [] }); } catch (e) {} });
        }

        room.onPeerJoin(function (id) {
          if (!others.has(id)) others.set(id, {});
          try { send(mine, id); } catch (e) {}
          fire();
        });
        room.onPeerLeave(function (id) { others.delete(id); fire(); });
        get(function (data, id) {
          if (!data || typeof data !== 'object') return;
          others.set(id, data);
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
            try { send(mine); } catch (e) {}
            return Promise.resolve();
          },
          onPeers: function (h) { handlers.add(h); return function () { handlers.delete(h); }; },
          leave: function () {
            left = true;
            others.clear();
            try { room.leave(); } catch (e) {}
            return Promise.resolve();
          }
        };
        return api;
      });
    }
  };
})();
