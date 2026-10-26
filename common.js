/* PennyData shared helpers. No dependencies, no network except the lookups below. */
// Per-browser free-use limit. Stored in localStorage only, nothing is sent anywhere.
// The window is recomputed on every call, so a long-open tab never works from stale state.
function pdLimit(key, max, windowMs) {
  var k = 'pd-limit-' + key;
  function load() {
    var now = Date.now(), log = [];
    try { log = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
    return log.filter(function (t) { return now - t < windowMs; });
  }
  return {
    left: function () { return Math.max(0, max - load().length); },
    use: function (n) {
      var log = load(), now = Date.now();
      if (log.length + n > max) return false;
      for (var i = 0; i < n; i++) log.push(now);
      try { localStorage.setItem(k, JSON.stringify(log)); } catch (e) {}
      return true;
    }
  };
}
// Friendly message when the free limit is hit.
function pdLimitMsg(limit, wanted, noun, per) {
  var left = limit.left();
  return 'Free limit reached: ' + left + ' ' + noun + ' left ' + (per || 'this hour') + (wanted ? ', you asked for ' + wanted : '') +
    '. Try fewer, wait a bit, or use the bulk version below.';
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
function pdDownload(name, text, type) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
}
// Small toast, announced politely to screen readers.
function pdToast(msg) {
  var t = document.getElementById('pd-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'pd-toast'; t.className = 'toast';
    t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t);
  }
  t.textContent = msg; t.hidden = false;
  clearTimeout(pdToast.t); pdToast.t = setTimeout(function () { t.hidden = true; }, 2200);
}
function pdCopy(text, doneMsg) {
  function fallback() {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove(); pdToast(ok ? (doneMsg || 'Copied') : 'Copy failed, select the text and copy it');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { pdToast(doneMsg || 'Copied'); }, fallback);
  } else fallback();
}
// Status line: kind is '' (plain), 'work' (spinner), 'ok' or 'err'.
function pdStatus(el, msg, kind) { el.className = 'status' + (kind ? ' ' + kind : ''); el.textContent = msg || ''; }
// Busy state for a button (spinner, disabled).
function pdBusy(btn, on) { btn.disabled = !!on; btn.classList.toggle('busy', !!on); btn.setAttribute('aria-busy', on ? 'true' : 'false'); }

// WHOIS/DNS helpers, shared by the home mini tool and the tool page.
var pdLookup = (function () {
  function dateOf(r, action) {
    var e = (r.events || []).filter(function (x) { return x.eventAction === action; })[0];
    return e ? e.eventDate.slice(0, 10) : '';
  }
  function registrar(r) {
    var e = (r.entities || []).filter(function (x) { return (x.roles || []).indexOf('registrar') >= 0; })[0];
    if (!e) return '';
    var fn = ((e.vcardArray || [])[1] || []).filter(function (v) { return v[0] === 'fn'; })[0];
    return fn ? fn[3] : (e.handle || '');
  }
  var T = { A: 1, NS: 2, MX: 15, TXT: 16 };
  // resolves to an array, or null when the lookup itself failed
  function dns(name, type) {
    return fetch('https://dns.google/resolve?name=' + encodeURIComponent(name) + '&type=' + type)
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j.Answer || []).filter(function (a) { return a.type === T[type]; }).map(function (a) { return a.data.replace(/^"|"$/g, ''); }); })
      .catch(function () { return null; });
  }
  // [registered, expires, updated, registrar, note]
  function rdap(name) {
    return fetch('https://rdap.org/domain/' + encodeURIComponent(name))
      .then(function (r) {
        if (r.status === 404) return { nf: 1 };
        if (!r.ok) throw 0;
        return r.json();
      })
      .then(function (r) {
        if (r.nf) return ['', '', '', '', 'No registry record found (unregistered, or this ending does not publish RDAP)'];
        return [dateOf(r, 'registration'), dateOf(r, 'expiration'), dateOf(r, 'last changed'), registrar(r), ''];
      })
      .catch(function () { return ['', '', '', '', 'Registry lookup failed or is not published']; });
  }
  function clean(s) {
    s = s.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[\/?#]/)[0].replace(/^www\./, '').replace(/\.$/, '');
    return /^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(s) ? s : '';
  }
  function full(d) {
    return Promise.all([rdap(d), dns(d, 'A'), dns(d, 'MX'), dns(d, 'NS'), dns(d, 'TXT')]).then(function (x) {
      return { domain: d, registered: x[0][0], expires: x[0][1], updated: x[0][2], registrar: x[0][3], note: x[0][4],
        a: x[1], mx: x[2], ns: x[3], txt: x[4] };
    });
  }
  function daysLeft(iso) {
    if (!iso) return null;
    return Math.round((new Date(iso + 'T00:00:00Z') - Date.now()) / 864e5);
  }
  function pill(iso) {
    var n = daysLeft(iso);
    if (n === null) return '';
    if (n < 0) return '<span class="pill pill-bad">expired ' + (-n) + ' d ago</span>';
    if (n < 60) return '<span class="pill pill-warn">' + n + ' days left</span>';
    return '<span class="pill pill-ok">' + n + ' days left</span>';
  }
  function card(r) {
    return pdDomainCard({ domain: r.domain, pills: pill(r.expires), note: r.note, registered: r.registered, expires: r.expires,
      updated: r.updated, registrar: r.registrar, a: r.a, aaaa: null, mx: r.mx, ns: r.ns, txt: r.txt, skipAaaa: true });
  }
  function j(a, sep) { return a ? a.join(sep) : ''; }
  var HEAD = ['domain', 'registered', 'expires', 'updated', 'registrar', 'a', 'mx', 'ns', 'txt', 'note'];
  function csvRows(rows) {
    return [HEAD].concat(rows.map(function (r) {
      return [r.domain, r.registered, r.expires, r.updated, r.registrar, j(r.a, ' '), j(r.mx, '; '), j(r.ns, ' '), j(r.txt, ' | '), r.note];
    }));
  }
  function table(rows) {
    return '<table><thead><tr>' + ['Domain', 'Registered', 'Expires', 'Updated', 'Registrar', 'A', 'MX', 'NS', 'TXT'].map(function (h) { return '<th scope="col">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><th scope="row">' + pdEsc(r.domain) + '</th><td>' + pdEsc(r.registered) + '</td><td>' + pdEsc(r.expires) + '</td><td>' + pdEsc(r.updated) + '</td><td>' + pdEsc(r.registrar) + '</td><td>' +
          pdEsc(j(r.a, ' ')) + '</td><td>' + pdEsc(j(r.mx, '; ')) + '</td><td>' + pdEsc(j(r.ns, ' ')) + '</td><td>' + pdEsc(j(r.txt, ' | ')) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  // Turn pasted text into a clean list. Reports truncation and unreadable entries.
  function parse(raw, max) {
    var bad = [], note = '';
    var list = raw.split(/[\s,]+/).filter(Boolean).map(function (s) { var c = clean(s); if (!c) bad.push(s); return c; }).filter(Boolean);
    list = list.filter(function (d, i) { return list.indexOf(d) === i; });
    if (list.length > max) { note = 'Only the first ' + max + ' of ' + list.length + ' domains are checked. '; list = list.slice(0, max); }
    if (bad.length) note += 'Skipped unreadable: ' + bad.slice(0, 3).join(', ') + '. ';
    return { list: list, bad: bad, note: note };
  }
  // Full flow with messaging. Resolves {rows, note, msg} or {error}. Never throws.
  // The caller keeps its old results when {error} comes back.
  function run(raw, max, limit) {
    var p = parse(raw, max);
    if (!p.list.length) {
      return Promise.resolve({ error: p.bad.length ? 'Could not read "' + p.bad[0] + '" as a domain. Use a name like example.com (no @, ports or IP addresses).' : 'Enter at least one domain, like example.com.' });
    }
    if (!limit.use(p.list.length)) return Promise.resolve({ error: pdLimitMsg(limit, p.list.length, 'lookups') });
    return Promise.all(p.list.map(full)).then(function (rows) {
      return { rows: rows, note: p.note, msg: p.note + 'Done: ' + rows.length + ' domain(s). ' + limit.left() + ' free lookups left this hour.' };
    }, function () { return { error: 'Something went wrong. Try again.' }; });
  }
  return { clean: clean, full: full, card: card, table: table, csvRows: csvRows, parse: parse, run: run };
})();

// ---- shared result-card helpers (home mini tool and the WHOIS page) ----
// One record per line with its own Copy button. null = the lookup failed, [] = none. Trailing dots are stripped.
function pdRecs(a, o) {
  o = o || {};
  if (a === null || a === undefined) return '<span class="na">lookup failed</span>';
  if (!a.length) return '<span class="na">none</span>';
  if (o.mx && a.length === 1 && /^0\s+\.?$/.test(a[0])) return '<span class="na">Null MX: this domain says it accepts no email.</span>';
  return '<div class="recs">' + a.map(function (v) {
    var s = String(v).replace(/\.$/, ''), pri = '', m;
    if (o.mx && (m = s.match(/^(\d+)\s+(.*)$/))) { pri = '<span class="pri">' + m[1] + '</span>'; s = m[2].replace(/\.$/, ''); }
    return '<div class="rec"><code>' + pri + pdEsc(s) + '</code><button type="button" class="cp" data-copy="' + pdEsc(s) + '" aria-label="Copy ' + pdEsc(s) + '">Copy</button></div>';
  }).join('') + '</div>';
}
function pdDomainCard(d) {
  function na(v) { return v ? pdEsc(v) : '<span class="na">not available</span>'; }
  function sec(title, body) { return '<section class="rsec"><h4>' + title + '</h4>' + body + '</section>'; }
  var txt = d.txt === null || d.txt === undefined ? '<span class="na">lookup failed</span>' : !d.txt.length ? '<span class="na">none</span>' :
    '<details class="txt"><summary>Show ' + d.txt.length + ' TXT record' + (d.txt.length === 1 ? '' : 's') + '</summary>' +
    '<div class="recs">' + d.txt.map(function (v) { return '<div class="rec"><code>' + pdEsc(v) + '</code><button type="button" class="cp" data-copy="' + pdEsc(v) + '" aria-label="Copy TXT record">Copy</button></div>'; }).join('') + '</div></details>';
  var addr = '<p class="rlabel">A (IPv4)</p>' + pdRecs(d.a) + (d.skipAaaa ? '' : '<p class="rlabel">AAAA (IPv6)</p>' + pdRecs(d.aaaa));
  return '<article class="rcard"><header><h3>' + pdEsc(d.shown || d.domain) + (d.shown && d.shown !== d.domain ? ' <span class="dim" style="font-size:.7em;font-weight:600">' + pdEsc(d.domain) + '</span>' : '') + '</h3>' +
    '<div class="meta" style="display:flex;gap:8px;flex-wrap:wrap">' + (d.pills || '') + '</div></header>' + (d.state || '') +
    (d.note ? '<p class="rnote">' + pdEsc(d.note) + '</p>' : '') +
    sec('Registration', '<dl class="rfacts"><div><dt>Registered</dt><dd>' + na(d.registered) + '</dd></div><div><dt>Expires</dt><dd>' + na(d.expires) + '</dd></div>' +
      '<div><dt>Last changed</dt><dd>' + na(d.updated) + '</dd></div><div><dt>Registrar</dt><dd>' + na(d.registrar) + '</dd></div></dl>') +
    sec('Web address', addr) + sec('Mail servers (MX)', pdRecs(d.mx, { mx: true })) + sec('Name servers (NS)', pdRecs(d.ns)) + sec('TXT records', txt) + '</article>';
}
// Copy buttons: any <button data-copy="..."> on the page.
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-copy]');
  if (!b) return;
  pdCopy(b.getAttribute('data-copy'), 'Copied');
  var t = b.textContent; b.textContent = 'Copied'; setTimeout(function () { b.textContent = t; }, 1200);
});

// ---- page behaviour shared by every page: menu, mascot mood, scroll to results/errors ----
(function () {
  var btn = document.querySelector('.menu-btn'), nav = document.getElementById('site-nav');
  if (btn && nav) {
    var close = function () { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', function (e) { e.stopPropagation(); var o = nav.classList.toggle('open'); btn.setAttribute('aria-expanded', o ? 'true' : 'false'); });
    document.addEventListener('click', function (e) { if (!nav.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    nav.addEventListener('click', close);
  }
  var acted = false;
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, function () { acted = true; }, { once: true, passive: true }); });
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
  var HH = 84;
  function kind(el) { var c = el.classList; return c.contains('work') ? 'work' : c.contains('ok') ? 'ok' : c.contains('err') ? 'err' : 'idle'; }
  function target() {
    var ids = ['res', 'out', 'cf-out', 'mini-out', 'results', 'mk'];
    for (var i = 0; i < ids.length; i++) { var e = document.getElementById(ids[i]); if (e && e.offsetParent !== null) return e; }
    return null;
  }
  function go(y) { window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' }); }
  var last = new WeakMap();
  function check(st) {
    var k = kind(st), sig = k + '|' + st.textContent;
    var prev = (last.get(st) || '').split('|')[0];
    if (last.get(st) === sig) return; last.set(st, sig);
    var pal = (st.closest('.panel') || document).querySelector('.pal') || document.querySelector('.pal');
    if (pal) pal.setAttribute('data-mood', k);
    if (!acted) return;
    requestAnimationFrame(function () {
      if (k === 'err') {
        var r = st.getBoundingClientRect();
        if (r.top < HH || r.bottom > innerHeight - 12) go(scrollY + r.top - innerHeight / 2 + r.height / 2);
      } else if (k === 'ok' && prev === 'work') {
        var t = target(); if (!t) return;
        var r2 = t.getBoundingClientRect();
        if (r2.top > innerHeight * 0.6 || r2.top < HH) go(scrollY + r2.top - HH - 10);
      }
    });
  }
  function scan(n) {
    var st = n.nodeType === 1 ? n : n.parentElement; if (!st) return;
    st = st.closest && st.closest('.status'); if (st) check(st);
  }
  if (window.MutationObserver) new MutationObserver(function (ms) { ms.forEach(function (m) { scan(m.target); }); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true, characterData: true });
})();

/* v3: hide-on-scroll header, "Try a lookup now" focuses the demo input, bookmarklet is drag-only on this page */
(function () {
  var top = document.querySelector('.top'); if (!top) return;
  var lastY = window.scrollY, tick = false;
  function upd() {
    var y = window.scrollY, nav = document.getElementById('site-nav');
    var open = nav && nav.classList.contains('open');
    if (open || y < 120 || y < lastY - 4 || top.contains(document.activeElement)) top.classList.remove('hide');
    else if (y > lastY + 8) top.classList.add('hide');
    lastY = y; tick = false;
  }
  window.addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true });
  top.addEventListener('focusin', function () { top.classList.remove('hide'); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#try"]');
    if (a) { var i = document.getElementById('mini-in'); if (i) setTimeout(function () { try { i.focus({ preventScroll: true }); i.select(); } catch (x) {} }, 350); }
    var bm = e.target.closest && e.target.closest('a.ix-bm');
    if (bm) { e.preventDefault(); if (window.pdToast) pdToast('Drag this button to your bookmarks bar, then click it on the page you want.'); }
  });
})();

/* v4: open a FAQ <details> when linked by #id (the footer and hero About links) */
(function () {
  function openHash() {
    var id = location.hash.slice(1); if (!id) return;
    var el = document.getElementById(id);
    if (el && el.tagName === 'DETAILS') { el.open = true; setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 30); }
  }
  window.addEventListener('hashchange', openHash); openHash();
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="#about"]');
    if (a && /#about$/.test(a.getAttribute('href')) && document.getElementById('about')) { var d = document.getElementById('about'); d.open = true; }
  });
})();
