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
 *   - adminEmail         : cc på skarpa utskick (gruppledar-mejl) → admin får kopia
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
    + '<label for="vz-admin">Admin-e-post (cc)</label>'
    + '<p class="hint">Läggs som cc på skarpa utskick (t.ex. gruppledar-mejl) så admin får en kopia. Lämna tom för ingen cc. (I testläge skickas inget hit — allt går till test-mottagaren.)</p>'
    + '<input type="email" id="vz-admin" placeholder="admin@vitalisera.se" value="' + esc(s.adminEmail || '') + '">'
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
    + '</div>';

  var btn = document.getElementById('vz-save');
  var saved = document.getElementById('vz-saved');
  btn.addEventListener('click', function () {
    var doctor = (document.getElementById('vz-doctor').value || '').trim();
    var admin = (document.getElementById('vz-admin').value || '').trim();
    var redirect = (document.getElementById('vz-testredirect').value || '').trim();
    if (doctor && !isEmail(doctor)) { saved.style.color = '#b23a2e'; saved.textContent = '⚠️ Läkar-e-posten ser inte giltig ut.'; return; }
    if (admin && !isEmail(admin)) { saved.style.color = '#b23a2e'; saved.textContent = '⚠️ Admin-e-posten ser inte giltig ut.'; return; }
    if (redirect && !isEmail(redirect)) { saved.style.color = '#b23a2e'; saved.textContent = '⚠️ Test-mottagarens e-post ser inte giltig ut.'; return; }
    var next = {
      doctorEmail: doctor,
      adminEmail: admin,
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
}

t.get('board', 'shared', KEY).then(function (s) { render(s || {}); }).catch(function () { render({}); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { try { t.closeModal(); } catch (x) {} } });
