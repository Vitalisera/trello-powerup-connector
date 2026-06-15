/* global TrelloPowerUp, window, document */
/*
 * Inställningar (kugghjul) — Vitalisera Power-Up.
 *
 * Samlar konfigurerbara värden som annars vore hårdkodade. Lagras board-shared
 * (pluginData, nyckel 'vz_settings') så de delas av alla vyer på boarden och
 * överlever stäng/öppna. Andra vyer läser dem via t.get('board','shared','vz_settings').
 *
 * Fält (MVP):
 *   - doctorEmail        : läkarens e-post (HF-mappen delas hit; fast adress, B1)
 *   - testMode           : test-läge på/av (fail-closed grind för skarpa mutationer/utskick)
 *   - testRedirectEmail  : i test-läge går utskick/delning HIT istället för skarp mottagare
 *
 * ⚠️ Inga hemligheter här (pluginData är läsbar för boardens medlemmar). Endast
 *    konfiguration — tokens/API-nycklar bor server-side i GAS.
 */
'use strict';

var CFG = window.NYA_ZAPIER_CONFIG;
var t = TrelloPowerUp.iframe({ appKey: CFG.APP_KEY, appName: CFG.APP_NAME, appAuthor: CFG.APP_AUTHOR });
var KEY = 'vz_settings';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }

// Förinlagd gruppledar-kontaktlista (Robert 2026-06-15). En rad: "Namn <mejl>".
var DEFAULT_GL_CONTACTS = [
  'Simon Forsman <simon.forsman@gmail.com>',
  'Cecilia Navik <cecilia@innerligt.eu>',
  'Josefina Tengroth <josefina@tengrothcoaching.se>',
  'Lena Birath <info@lenabirath.se>',
  'Ola Ek <ola@olaek.se>',
  'Gunnar Elseth <gelseth@hotmail.com>',
  'Lena Sifversson <lena.sifversson@telia.com>',
  'Anna Blomquist <anna@annablomquist.se>',
  'Lena de Val <lenadeval@hotmail.com>',
  'Roger Kangas <roger@rogerkangas.se>',
  'Roger Marklund <roger@zencoaching.nu>',
  'Tapio Kanerva <tappekan@hotmail.com>',
  'Robert Kraft <robert.kraft@vitalisera.se>',
  'Daniel Arogen <daniel.arogen@vitalisera.se>',
  'Linda Arogen <linda.arogen@vitalisera.se>',
  'Pia af Klercker <pia@klercker.net>',
  'Camilla Marydotter <cmarydotter@gmail.com>',
].join('\n');

// Trello REST (in-browser-token + publik appKey).
function trelloGet(token, path) {
  var sep = path.indexOf('?') === -1 ? '?' : '&';
  return fetch('https://api.trello.com/1/' + path + sep + 'key=' + encodeURIComponent(CFG.APP_KEY) + '&token=' + encodeURIComponent(token))
    .then(function (r) { if (!r.ok) { throw new Error('Trello ' + r.status); } return r.json(); });
}
function trelloPost(token, path, params) {
  var qs = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  return fetch('https://api.trello.com/1/' + path + '?key=' + encodeURIComponent(CFG.APP_KEY) + '&token=' + encodeURIComponent(token) + '&' + qs, { method: 'POST' })
    .then(function (r) { if (!r.ok) { throw new Error('Trello ' + r.status); } return r.json(); });
}
// "Namn <mejl>" / "Namn mejl" / "mejl" → {name, email}. Hoppar rader utan e-post.
function parseContacts(text) {
  var out = [];
  String(text || '').split('\n').forEach(function (line) {
    line = line.trim(); if (!line) { return; }
    var em = line.match(/[\w.\-+]+@[\w.\-]+\.\w+/);
    if (!em) { return; }
    var email = em[0];
    var name = line.replace(/<[^>]*>/, '').split(email)[0].replace(/[<>(),]/g, '').trim();
    out.push({ name: name || email, email: email });
  });
  return out;
}
function norm(s) { return String(s || '').trim().toLowerCase(); }

function render(s) {
  s = s || {};
  var root = document.getElementById('root');
  root.innerHTML =
    '<div class="vz-set">'
    + '<div class="vz-set-head"><img src="' + esc(CFG.MARK_URL) + '" alt=""><h1>Inställningar</h1></div>'
    + '<p class="vz-set-sub">Konfiguration för Power-Up:en. Sparas på boarden och delas av alla vyer.</p>'

    + '<div class="vz-field">'
    + '<label for="vz-doctor">Läkarens e-postadress</label>'
    + '<p class="hint">Hit delas mappen "HF till läkare" (läkaren får läs-åtkomst till de anonymiserade hälsoformulären).</p>'
    + '<input type="email" id="vz-doctor" placeholder="lakare@exempel.se" value="' + esc(s.doctorEmail || '') + '">'
    + '</div>'

    + '<div class="vz-field">'
    + '<label>Test-läge</label>'
    + '<p class="hint">När test-läge är på går skarpa utskick och mapp-delningar till test-mottagaren nedan i stället för riktig mottagare. Säkerhetsspärr vid provkörning.</p>'
    + '<div class="vz-row"><input type="checkbox" id="vz-testmode"' + (s.testMode ? ' checked' : '') + '>'
    + '<label for="vz-testmode" style="margin:0;font-weight:normal">Test-läge på</label>'
    + (s.testMode ? ' <span class="vz-testbadge">TEST PÅ</span>' : '') + '</div>'
    + '<input type="email" id="vz-testredirect" style="margin-top:9px" placeholder="test-mottagare@vitalisera.se" value="' + esc(s.testRedirectEmail || '') + '">'
    + '</div>'

    + '<div class="vz-actions">'
    + '<button class="vz-btn" id="vz-save">Spara</button>'
    + '<span class="vz-note" id="vz-saved"></span>'
    + '</div>'

    + '<div class="vz-field">'
    + '<label>Gruppledar-kontakter → listan "Kontaktuppgifter Gruppledare"</label>'
    + '<p class="hint">Skapar ett kort per rad (kortnamn = namn, beskrivning = "**Epost:** mejl") i listan på '
    + 'Gruppledare-brädan — samma format som kockarnas lista, så Skicka-knappen kan läsa mejlen. Format per rad: '
    + '"Namn &lt;mejl&gt;". Idempotent (skapar inte dubbletter). Kräver att du anslutit Trello (öppna Kursöversikt en gång).</p>'
    + '<textarea id="vz-gl-contacts" rows="9" style="width:100%;box-sizing:border-box;font-family:inherit;font-size:13px;padding:8px;border:1px solid #cfd8dc;border-radius:7px">' + esc(DEFAULT_GL_CONTACTS) + '</textarea>'
    + '<div class="vz-actions" style="margin-top:8px"><button class="vz-btn" id="vz-mk-contacts">Skapa kontaktkort</button><span class="vz-note" id="vz-mk-status"></span></div>'
    + '</div>'
    + '</div>';

  var btn = document.getElementById('vz-save');
  var saved = document.getElementById('vz-saved');
  btn.addEventListener('click', function () {
    var doctor = (document.getElementById('vz-doctor').value || '').trim();
    var redirect = (document.getElementById('vz-testredirect').value || '').trim();
    if (doctor && !isEmail(doctor)) { saved.style.color = '#b23a2e'; saved.textContent = '⚠️ Läkar-e-posten ser inte giltig ut.'; return; }
    if (redirect && !isEmail(redirect)) { saved.style.color = '#b23a2e'; saved.textContent = '⚠️ Test-mottagarens e-post ser inte giltig ut.'; return; }
    var next = {
      doctorEmail: doctor,
      testMode: !!document.getElementById('vz-testmode').checked,
      testRedirectEmail: redirect,
    };
    btn.disabled = true; saved.style.color = '#437a3a'; saved.textContent = '⏳ Sparar…';
    t.set('board', 'shared', KEY, next).then(function () {
      saved.textContent = '✓ Sparat.';
      render(next); // rita om → test-badge speglar nytt läge
    }).catch(function (err) {
      saved.style.color = '#b23a2e'; saved.textContent = '⚠️ Kunde inte spara: ' + esc(err && err.message || err);
      btn.disabled = false;
    });
  });

  // Skapa gruppledar-kontaktkort i "Kontaktuppgifter Gruppledare" (idempotent, via in-browser-token).
  var mkBtn = document.getElementById('vz-mk-contacts');
  var mkStatus = document.getElementById('vz-mk-status');
  if (mkBtn) {
    mkBtn.addEventListener('click', function () {
      var contacts = parseContacts(document.getElementById('vz-gl-contacts').value);
      if (!contacts.length) { mkStatus.style.color = '#b23a2e'; mkStatus.textContent = 'Inga giltiga rader (Namn <mejl>).'; return; }
      mkBtn.disabled = true; mkStatus.style.color = '#437a3a'; mkStatus.textContent = '⏳ Skapar kontaktkort…';
      t.getRestApi().getToken().then(function (token) {
        if (!token) { throw new Error('Ingen Trello-token — öppna Kursöversikt och anslut först.'); }
        return trelloGet(token, 'members/me/boards?fields=name&filter=open').then(function (boards) {
          var b = (boards || []).filter(function (bd) { return /gruppled|ledare/i.test(bd.name || ''); })[0];
          if (!b) { throw new Error('Hittar ingen Gruppledare-bräda.'); }
          return trelloGet(token, 'boards/' + b.id + '/lists?fields=name').then(function (lists) {
            var lst = (lists || []).filter(function (l) { return /kontaktuppgifter/i.test(l.name || ''); })[0];
            var listP = lst ? Promise.resolve(lst) : trelloPost(token, 'lists', { name: 'Kontaktuppgifter Gruppledare', idBoard: b.id });
            return listP.then(function (list) {
              return trelloGet(token, 'lists/' + list.id + '/cards?fields=name').then(function (cards) {
                var existing = {}; (cards || []).forEach(function (c) { existing[norm(c.name)] = true; });
                var toCreate = contacts.filter(function (c) { return !existing[norm(c.name)]; });
                var created = 0;
                return toCreate.reduce(function (p, c) {
                  return p.then(function () { return trelloPost(token, 'cards', { idList: list.id, name: c.name, desc: '**Epost:** ' + c.email }).then(function () { created++; }); });
                }, Promise.resolve()).then(function () { return { created: created, skipped: contacts.length - toCreate.length, listName: list.name }; });
              });
            });
          });
        });
      }).then(function (r) {
        mkStatus.style.color = '#437a3a';
        mkStatus.textContent = '✓ Klart: ' + r.created + ' skapade, ' + r.skipped + ' fanns redan, i "' + r.listName + '".';
      }).catch(function (err) {
        mkStatus.style.color = '#b23a2e'; mkStatus.textContent = '⚠️ ' + (err && err.message || err);
      }).then(function () { mkBtn.disabled = false; });
    });
  }
}

t.get('board', 'shared', KEY).then(function (s) { render(s || {}); }).catch(function () { render({}); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { try { t.closeModal(); } catch (x) {} } });
