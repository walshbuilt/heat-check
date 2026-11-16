/* Heat Check — freeze recorder. Loaded first. Keeps a short trail of what the page just did (requests,
 * coin opens, errors). A watcher on a separate thread checks that the page answers every second; if
 * it stops answering for 5+ seconds, the watcher sends the trail to /api/prices (POST), where it shows up in the
 * server logs. Script errors are sent the same way. No personal data: paths, timings and error text. */
(function () {
  'use strict';
  var trail = [], t0 = Date.now(), sent = 0;
  function crumb(s) { trail.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + String(s).slice(0, 160)); if (trail.length > 40) trail.shift(); }
  window.HCCrumb = crumb;
  function send(kind, extra) {
    if (sent >= 5) return; sent++;
    try { navigator.sendBeacon('/api/prices', JSON.stringify({ kind: kind, extra: extra, url: location.hash, ua: navigator.userAgent, w: innerWidth, trail: trail.slice(-25) })); } catch (e) {}
  }
  window.addEventListener('error', function (e) { crumb('ERROR ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); send('error', e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno); });
  window.addEventListener('unhandledrejection', function (e) { var m = e.reason && (e.reason.stack || e.reason.message) || String(e.reason); crumb('REJECT ' + m); });
  // Record every request: path, status, time.
  var raw = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '', s = Date.now();
    var p = url.replace(location.origin, '').split('&')[0].slice(0, 70);
    return raw(input, init).then(function (r) { crumb(p + ' ' + r.status + ' ' + (Date.now() - s) + 'ms'); return r; }, function (e) { crumb(p + ' FAILED'); throw e; });
  };
  window.addEventListener('hashchange', function () { crumb('nav ' + location.hash.slice(0, 70)); });
  // The watcher thread.
  try {
    var src = "var LOG=" + JSON.stringify(location.origin + '/api/prices') + ";var last=Date.now(),hidden=false,trail=[],meta={},told=false;onmessage=function(e){last=Date.now();hidden=e.data.h;trail=e.data.t;meta=e.data.m;if(told&&!hidden){told=false;}};" +
      "setInterval(function(){var gap=Date.now()-last;if(!hidden&&!told&&gap>5000){told=true;fetch(LOG,{method:'POST',keepalive:true,body:JSON.stringify({kind:'freeze',extra:'page stopped answering for '+gap+'ms',url:meta.url,ua:meta.ua,w:meta.w,trail:trail})}).catch(function(){});}},1000);";
    var w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    setInterval(function () { w.postMessage({ h: document.hidden, t: trail.slice(-25), m: { url: location.hash, ua: navigator.userAgent, w: innerWidth } }); }, 1000);
  } catch (e) {}
})();
