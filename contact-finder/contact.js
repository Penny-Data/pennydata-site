/* Contact finder: calls the public Gradio API of the Hugging Face Space directly. */
(function () {
  var API = 'https://pennydata-website-contact-finder-demo.hf.space/gradio_api/call/find_contact_page';
  var SPACE = 'https://huggingface.co/spaces/pennydata/website-contact-finder-demo';
  var $ = function (id) { return document.getElementById(id); };
  var form = $('cf-form'), input = $('cf-url'), go = $('cf-go'), st = $('cf-status'), out = $('cf-out'), err = $('cf-err');
  var limit = pdLimit('contact-finder', 20, 3600000), last = null, run = 0;

  function normalize(raw) {
    var s = (raw || '').trim();
    if (!s) return { e: 'Enter a website address, for example https://www.eff.org/about/contact.' };
    if (/\s/.test(s)) return { e: 'That has spaces in it. Enter one website address, with no spaces.' };
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return { e: 'Only http and https addresses work. Remove "' + s.split(':')[0] + ':" or use https://.' };
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    var u;
    try { u = new URL(s); } catch (x) { return { e: 'That does not look like a web address. Try something like example.com.' }; }
    if (!/^[^.]+(\.[^.]+)+$/.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname === 'localhost') return { e: 'Enter a public website name such as example.com (not an IP address or localhost).' };
    return { url: u.href };
  }
  function safeHref(u) { try { var x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clearOut() { out.textContent = ''; last = null; }
  function showSkel() { clearOut(); var s = el('div', 'cf-skel'); s.setAttribute('aria-hidden', 'true'); s.appendChild(el('i')); s.appendChild(el('i')); s.appendChild(el('i')); out.appendChild(s); }
  function friendlyError(msg) {
    msg = String(msg || '');
    if (/robots/i.test(msg)) return 'That site asks automated tools not to read this page (robots.txt), so it was skipped.';
    if (/InvalidURL|url is required/i.test(msg)) return 'That does not look like a working web address. Check it and try again.';
    if (/timeout|timed out/i.test(msg)) return 'The site took longer than 10 seconds to answer, so the lookup gave up. Try again, or try a different page of the site.';
    if (/fetch failed|connect|dns|resolve|ssl|certificate/i.test(msg)) return 'The page could not be reached. Check the spelling and that the site is online.';
    return 'The lookup could not read that page (' + msg.replace(/^fetch failed:\s*/, '') + ').';
  }
  function fail(msg, showSpace) {
    clearOut(); pdStatus(st, msg, 'err');
    if (showSpace) {
      var p = el('p', 'cf-alt'); p.appendChild(document.createTextNode('You can also '));
      var a = el('a', '', 'open the tool directly on Hugging Face'); a.href = SPACE; a.rel = 'noopener'; p.appendChild(a); p.appendChild(document.createTextNode('.'));
      out.appendChild(p);
    }
    var rb = el('button', 'btn sm', 'Retry'); rb.type = 'button'; rb.onclick = function () { submit(); };
    var rp = el('p', 'cf-alt'); rp.appendChild(rb); out.insertBefore(rp, out.firstChild);
  }
  function render(d, asked) {
    clearOut(); last = d;
    var emails = Array.isArray(d.emails) ? d.emails.filter(function (e) { return typeof e === 'string'; }) : [];
    var cp = d.contact_page ? safeHref(d.contact_page) : '';
    var host = ''; try { host = new URL(d.url || asked).hostname.replace(/^www\./, ''); } catch (e) { host = asked; }
    var card = el('article', 'rcard cf-card'); var hd = el('header');
    var t = el('div'); t.appendChild(el('h3', '', host)); t.appendChild(el('p', 'sub2', 'Checked ' + (d.url || asked))); hd.appendChild(t);
    hd.appendChild(el('span', 'pill ' + (emails.length ? 'pill-ok' : 'pill-warn'), emails.length ? emails.length + (emails.length === 1 ? ' email found' : ' emails found') : 'No emails on this page'));
    card.appendChild(hd);
    var dl = el('dl'), a = el('div', 'wide'), b = el('div', 'wide');
    a.appendChild(el('dt', '', 'Contact page')); var dd = el('dd');
    if (cp) { var l = el('a', 'cf-link', cp); l.href = cp; l.target = '_blank'; l.rel = 'noopener'; dd.appendChild(l); } else dd.appendChild(el('span', 'dim', 'This page does not link to a contact page.'));
    a.appendChild(dd); dl.appendChild(a);
    b.appendChild(el('dt', '', 'Email addresses')); var dd2 = el('dd');
    if (emails.length) {
      var ul = el('ul', 'cf-emails');
      emails.forEach(function (m) {
        var li = el('li'); var ma = el('a', 'cf-mail', m); ma.href = 'mailto:' + encodeURIComponent(m).replace(/%40/g, '@'); li.appendChild(ma);
        var cb = el('button', 'btn ghost', 'Copy'); cb.type = 'button'; cb.setAttribute('aria-label', 'Copy ' + m);
        cb.onclick = function () { pdCopy(m, 'Copied ' + m); }; li.appendChild(cb); ul.appendChild(li);
      });
      dd2.appendChild(ul);
    } else {
      dd2.appendChild(el('p', 'cf-none', 'No email addresses are printed on this page. Many sites use a contact form instead' + (cp ? ', so open the contact page above.' : '. Try the site’s contact or about page address.')));
    }
    b.appendChild(dd2); dl.appendChild(b); card.appendChild(dl);
    if (emails.length || cp) {
      var ac = el('div', 'actions');
      if (emails.length) {
        var c1 = el('button', 'btn sm', emails.length > 1 ? 'Copy all emails' : 'Copy email'); c1.type = 'button';
        c1.onclick = function () { pdCopy(emails.join('\n'), 'Copied ' + emails.length + (emails.length > 1 ? ' emails' : ' email')); }; ac.appendChild(c1);
      }
      var c2 = el('button', 'btn ghost sm', 'Download CSV'); c2.type = 'button';
      c2.onclick = function () {
        var rows = [['website', 'contact_page', 'email']];
        if (emails.length) emails.forEach(function (m) { rows.push([d.url || asked, cp, m]); }); else rows.push([d.url || asked, cp, '']);
        pdDownload('contacts-' + host.replace(/[^a-z0-9.-]/gi, '_') + '.csv', pdCsv(rows));
      };
      ac.appendChild(c2); card.appendChild(ac);
    }
    out.appendChild(card);
    pdStatus(st, emails.length ? 'Done. Found ' + emails.length + (emails.length === 1 ? ' email address.' : ' email addresses.') : 'Done. This page prints no email addresses.', 'ok');
  }
  function parseSSE(text) {
    var ev = '', data = '', res = null;
    text.split('\n').forEach(function (line) {
      if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
      else if (line.indexOf('data:') === 0) { data = line.slice(5).trim(); if (ev === 'complete') res = { ok: 1, data: data }; else if (ev === 'error') res = { err: 1, data: data }; }
    });
    return res;
  }
  function find(url) {
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 90000);
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [url] }), signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { return fetch(API + '/' + j.event_id, { signal: ctl.signal }); })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) {
        clearTimeout(timer);
        var r = parseSSE(t);
        if (!r || r.err) throw new Error('space-error');
        var arr = JSON.parse(r.data); return arr && arr[0];
      }, function (e) { clearTimeout(timer); throw e; });
  }
  function submit(e) {
    if (e) e.preventDefault();
    var n = normalize(input.value);
    if (n.e) { err.textContent = n.e; clearOut(); pdStatus(st, ''); input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    err.textContent = ''; input.removeAttribute('aria-invalid');
    if (limit.left() < 1) { clearOut(); pdStatus(st, 'Free limit reached: 20 lookups per hour in this browser. Wait a bit, or use the bulk version below.', 'err'); return; }
    var id = ++run; pdBusy(go, true); showSkel();
    pdStatus(st, 'Reading ' + n.url + ' ...', 'work');
    var slow = setTimeout(function () { if (id === run) pdStatus(st, 'Waking up the free server. The first run can take up to a minute, later ones take seconds.', 'work'); }, 3000);
    find(n.url).then(function (d) {
      if (id !== run) return; limit.use(1);
      if (!d) return fail('The tool returned nothing. Try again in a moment.', true);
      if (d.error) return fail(friendlyError(d.error), false);
      render(d, n.url);
    }).catch(function (x) {
      if (id !== run) return;
      fail(x && x.name === 'AbortError' ? 'The free server did not answer within 90 seconds. It may be asleep or busy.' : 'Could not reach the lookup service. It may be down, or your connection blocked it.', true);
    }).then(function () { clearTimeout(slow); if (id === run) pdBusy(go, false); });
  }
  form.addEventListener('submit', submit);
  document.querySelectorAll('[data-ex]').forEach(function (b) { b.onclick = function () { input.value = b.dataset.ex; submit(); }; });
  $('cf-try').onclick = function () { input.value = 'https://www.eff.org/about/contact'; submit(); };
  input.addEventListener('input', function () { err.textContent = ''; input.removeAttribute('aria-invalid'); });
})();
