// Simple per-browser free-use limit (stored in localStorage, nothing is sent anywhere).
function pdLimit(key, max, windowMs) {
  var now = Date.now(), k = 'pd-limit-' + key, log = [];
  try { log = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
  log = log.filter(function (t) { return now - t < windowMs; });
  return {
    left: function () { return max - log.length; },
    use: function (n) {
      if (log.length + n > max) return false;
      for (var i = 0; i < n; i++) log.push(now);
      try { localStorage.setItem(k, JSON.stringify(log)); } catch (e) {}
      return true;
    }
  };
}
function pdEsc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pdCsv(rows) {
  return rows.map(function (r) {
    return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
}
function pdDownload(name, text) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
