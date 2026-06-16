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
var TPL = (window.NYA_ZAPIER_TPL) || {}; // delade default-mallar (config.js) → förifyll textrutorna
// Spara TOM om rutan är oförändrad från default → genereringen fortsätter följa default (auto-uppdateras);
// bara en faktisk ändring lagras. @param {string} id @param {string} def @return {string}
function tplVal(id, def) { var v = document.getElementById(id).value || ''; return v === (def || '') ? '' : v; }

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

    + '<div class="vz-field">'
    + '<label for="vz-sendername">Avsändarnamn</label>'
    + '<p class="hint">Visas som avsändare på gruppledar-/kock-mejlen. Tom = "Vitalisera AB".</p>'
    + '<input type="text" id="vz-sendername" placeholder="Vitalisera AB" value="' + esc(s.senderName || '') + '">'
    + '</div>'

    + '<div class="vz-field">'
    + '<label for="vz-replyto">Svara-till (reply-to)</label>'
    + '<p class="hint">Svar på utskicken går hit, t.ex. malin.kraft@vitalisera.se. Tom = sändande kontot. (Rensas i testläge.)</p>'
    + '<input type="email" id="vz-replyto" placeholder="malin.kraft@vitalisera.se" value="' + esc(s.replyTo || '') + '">'
    + '</div>'

    + '<div class="vz-field">'
    + '<label>Mall-texter för gruppledar-mejlen</label>'
    + '<p class="hint">Redigera mejltexterna fritt (förifyllda med standardtexten). Dessa tokens fylls automatiskt vid generering/utskick: <b>{ANTAL}</b>, <b>{TILLDELNING}</b>, <b>{GRUPPLEDARE}</b>, <b>{DELTAGARE}</b>, <b>{SAMMANFATTNINGSLÄNK}</b>.</p>'
    + '<label for="vz-tpl-livsalla" class="vz-sub">Livsberättelser – till alla</label>'
    + '<textarea id="vz-tpl-livsalla" class="vz-ta">' + esc(s.tpl_livsAlla || TPL.livsAlla || '') + '</textarea>'
    + '<label for="vz-tpl-livsenskild" class="vz-sub">Livsberättelser – enskild mall</label>'
    + '<textarea id="vz-tpl-livsenskild" class="vz-ta">' + esc(s.tpl_livsEnskild || TPL.livsEnskild || '') + '</textarea>'
    + '<label for="vz-tpl-uppfoljning" class="vz-sub">Uppföljningssamtal – om Malin VAR med på kursveckan</label>'
    + '<textarea id="vz-tpl-uppfoljning" class="vz-ta">' + esc(s.tpl_uppfoljning || TPL.uppfoljning || '') + '</textarea>'
    + '<label for="vz-tpl-uppfoljningb" class="vz-sub">Uppföljningssamtal – om Malin INTE var med</label>'
    + '<textarea id="vz-tpl-uppfoljningb" class="vz-ta">' + esc(s.tpl_uppfoljningB || TPL.uppfoljningB || '') + '</textarea>'
    + '<p class="hint">Rätt uppföljnings-mall väljs automatiskt utifrån om Malin finns som "Vitaliseraperson på plats" i gruppledar-listan.</p>'
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
    var replyTo = (document.getElementById('vz-replyto').value || '').trim();
    if (admin && !isEmail(admin)) { saved.style.color = '#b23a2e'; saved.textContent = '⚠️ Admin-e-posten ser inte giltig ut.'; return; }
    if (redirect && !isEmail(redirect)) { saved.style.color = '#b23a2e'; saved.textContent = '⚠️ Test-mottagarens e-post ser inte giltig ut.'; return; }
    if (replyTo && !isEmail(replyTo)) { saved.style.color = '#b23a2e'; saved.textContent = '⚠️ Svara-till-adressen ser inte giltig ut.'; return; }
    var next = {
      doctorEmail: doctor,
      adminEmail: admin,
      testMode: !!document.getElementById('vz-testmode').checked,
      testRedirectEmail: redirect,
      senderName: (document.getElementById('vz-sendername').value || '').trim(),
      replyTo: replyTo,
      tpl_livsAlla: tplVal('vz-tpl-livsalla', TPL.livsAlla),
      tpl_livsEnskild: tplVal('vz-tpl-livsenskild', TPL.livsEnskild),
      tpl_uppfoljning: tplVal('vz-tpl-uppfoljning', TPL.uppfoljning),
      tpl_uppfoljningB: tplVal('vz-tpl-uppfoljningb', TPL.uppfoljningB),
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
