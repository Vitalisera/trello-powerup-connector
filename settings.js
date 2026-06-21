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

/* bild16: bevara användarens MANUELLT ändrade textarea-höjd mellan öppningar (per id, localStorage).
 * Sparar BARA på pekar-drag → ingen krock med ev. auto-fit. (Inline-kopia av course.js-helpern.) */
function persistTextareaSize_(el) {
  if (!el || !el.id) { return; }
  var key = 'vz_tasize_' + el.id;
  try { var saved = localStorage.getItem(key); if (saved) { el.style.height = saved; } } catch (e) {}
  if (el.getAttribute('data-vzsize') === '1') { return; }
  el.setAttribute('data-vzsize', '1');
  el.addEventListener('mousedown', function () {
    var h0 = el.style.height;
    var onUp = function () {
      document.removeEventListener('mouseup', onUp);
      try { if (el.style.height && el.style.height !== h0) { localStorage.setItem(key, el.style.height); } } catch (e) {}
    };
    document.addEventListener('mouseup', onUp);
  });
}

function render(s) {
  s = s || {};
  var root = document.getElementById('root');
  root.innerHTML =
    '<div class="vz-set">'
    + '<div class="vz-set-head"><img src="' + esc(CFG.MARK_URL) + '" alt=""><h1>Inställningar</h1></div>'
    + '<p class="vz-set-sub">Konfiguration för Power-Up:en. Sparas på boarden och delas av alla vyer.</p>'

    + '<div class="vz-fieldgrid">'
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
    + '<label for="vz-sendername">Avsändarnamn</label>'
    + '<p class="hint">Visas som avsändare på gruppledar-/kock-mejlen. Tom = "Vitalisera AB".</p>'
    + '<input type="text" id="vz-sendername" placeholder="Vitalisera AB" value="' + esc(s.senderName || '') + '">'
    + '</div>'
    + '<div class="vz-field">'
    + '<label for="vz-replyto">Svara-till (reply-to)</label>'
    + '<p class="hint">Svar på utskicken går hit, t.ex. malin.kraft@vitalisera.se. Tom = sändande kontot. (Rensas i testläge.)</p>'
    + '<input type="email" id="vz-replyto" placeholder="malin.kraft@vitalisera.se" value="' + esc(s.replyTo || '') + '">'
    + '</div>'
    + '</div>'

    + '<div class="vz-field">'
    + '<label>Test-läge</label>'
    + '<p class="hint">När test-läge är på går skarpa utskick och mapp-delningar till test-mottagaren nedan i stället för riktig mottagare. Säkerhetsspärr vid provkörning.</p>'
    + '<div class="vz-row"><input type="checkbox" id="vz-testmode"' + (s.testMode ? ' checked' : '') + '>'
    + '<label for="vz-testmode" style="margin:0;font-weight:normal">Test-läge på</label>'
    + '<span id="vz-testbadge">' + (s.testMode ? ' <span class="vz-testbadge">TEST PÅ</span>' : '') + '</span></div>'
    + '<input type="email" id="vz-testredirect" style="margin-top:9px" placeholder="test-mottagare@vitalisera.se" value="' + esc(s.testRedirectEmail || '') + '">'
    + '</div>'

    + '<div class="vz-field">'
    + '<label>Mall-texter för gruppledar-mejlen</label>'
    + '<p class="hint">Redigera mejltexterna fritt (förifyllda med standardtexten). Dessa tokens fylls automatiskt vid generering/utskick: <b>{ANTAL}</b>, <b>{TILLDELNING}</b>, <b>{GRUPPLEDARE}</b>, <b>{DELTAGARE}</b>, <b>{SAMMANFATTNINGSLÄNK}</b>, <b>{DOKTYP}</b> (dok-typ i plural, anpassas per kurssteg: livsberättelser/nulägesbeskrivningar/formulär).</p>'
    + '<label for="vz-tpl-livsalla" class="vz-sub">Dokumenttilldelning – till alla</label>'
    + '<textarea id="vz-tpl-livsalla" class="vz-ta">' + esc(s.tpl_livsAlla || TPL.livsAlla || '') + '</textarea>'
    + '<label for="vz-tpl-livsenskild" class="vz-sub">Dokumenttilldelning – enskild mall</label>'
    + '<textarea id="vz-tpl-livsenskild" class="vz-ta">' + esc(s.tpl_livsEnskild || TPL.livsEnskild || '') + '</textarea>'
    + '<label for="vz-tpl-uppfoljning" class="vz-sub">Uppföljningssamtal – om Malin VAR med på kursveckan</label>'
    + '<textarea id="vz-tpl-uppfoljning" class="vz-ta">' + esc(s.tpl_uppfoljning || TPL.uppfoljning || '') + '</textarea>'
    + '<label for="vz-tpl-uppfoljningb" class="vz-sub">Uppföljningssamtal – om Malin INTE var med</label>'
    + '<textarea id="vz-tpl-uppfoljningb" class="vz-ta">' + esc(s.tpl_uppfoljningB || TPL.uppfoljningB || '') + '</textarea>'
    + '<p class="hint">Rätt uppföljnings-mall väljs automatiskt utifrån om Malin finns som "Vitaliseraperson på plats" i gruppledar-listan.</p>'
    + '<label for="vz-tpl-uppfenskild" class="vz-sub">Uppföljningssamtal – enskilt kontaktmejl (per gruppledare)</label>'
    + '<textarea id="vz-tpl-uppfenskild" class="vz-ta">' + esc(s.tpl_uppfoljningEnskild || TPL.uppfoljningEnskild || '') + '</textarea>'
    + '<p class="hint">Token <b>{DELTAGARKONTAKTER}</b> fylls med namn/telefon/epost per tilldelad deltagare.</p>'
    + '</div>'

    + '<div class="vz-field">'
    + '<label for="vz-tpl-kock">Mall-text för kock-mejlet (matallergier)</label>'
    + '<p class="hint">Matallergi-sammanställningen som mejlas till kocken. Tokens: <b>{HÄLSNING}</b> (Hej + kockens namn), <b>{ANTAL_DELTAGARE}</b>, <b>{ANTAL_PERSONAL}</b>, <b>{DELTAGARE}</b> (allergier ur hälsoformulären), <b>{PERSONAL}</b>.</p>'
    + '<textarea id="vz-tpl-kock" class="vz-ta">' + esc(s.tpl_kock || TPL.kock || '') + '</textarea>'
    + '</div>'

    + '<div class="vz-autosave"><span class="vz-autosave-txt">Ändringar sparas automatiskt</span><span class="vz-note" id="vz-saved"></span></div>'
    + '</div>';

  // bild16: bevara användarens manuellt ändrade textarea-höjd mellan öppningar (per id, localStorage).
  Array.prototype.forEach.call(document.querySelectorAll('textarea.vz-ta'), persistTextareaSize_);

  var saved = document.getElementById('vz-saved');
  var savedTimer = null, saveTimer = null;
  function val(id) { var el = document.getElementById(id); return el ? (el.value || '').trim() : ''; }
  // Validera e-postfälten → första felet (inline-varning) eller null. Tomt = OK (frivilligt).
  function validationError() {
    var checks = [['vz-doctor', 'Läkar-e-posten'], ['vz-admin', 'Admin-e-posten'], ['vz-testredirect', 'Test-mottagarens e-post'], ['vz-replyto', 'Svara-till-adressen']];
    for (var i = 0; i < checks.length; i++) { var v = val(checks[i][0]); if (v && !isEmail(v)) { return '⚠️ ' + checks[i][1] + ' ser inte giltig ut — sparas ej.'; } }
    return null;
  }
  function payload() {
    return {
      doctorEmail: val('vz-doctor'), adminEmail: val('vz-admin'),
      testMode: !!document.getElementById('vz-testmode').checked, testRedirectEmail: val('vz-testredirect'),
      senderName: val('vz-sendername'), replyTo: val('vz-replyto'),
      tpl_livsAlla: tplVal('vz-tpl-livsalla', TPL.livsAlla), tpl_livsEnskild: tplVal('vz-tpl-livsenskild', TPL.livsEnskild),
      tpl_uppfoljning: tplVal('vz-tpl-uppfoljning', TPL.uppfoljning), tpl_uppfoljningB: tplVal('vz-tpl-uppfoljningb', TPL.uppfoljningB),
      tpl_uppfoljningEnskild: tplVal('vz-tpl-uppfenskild', TPL.uppfoljningEnskild),
      tpl_kock: tplVal('vz-tpl-kock', TPL.kock),
    };
  }
  function flash(text, cls) {
    if (!saved) { return; }
    saved.className = 'vz-note' + (cls ? ' ' + cls : ''); saved.style.color = ''; saved.textContent = text;
    if (savedTimer) { clearTimeout(savedTimer); }
    if (cls === 'vz-saved-pill') { savedTimer = setTimeout(function () { if (saved) { saved.textContent = ''; saved.className = 'vz-note'; } }, 2500); }
  }
  // Auto-save: debouncad (ingen omritning → behåll fokus/cursor). Ogiltig e-post → spara INTE, visa varning.
  function doSave() {
    var err = validationError();
    if (err) { flash(err); saved.style.color = '#b23a2e'; return; }
    flash('⏳ Sparar…');
    t.set('board', 'shared', KEY, payload()).then(function () { flash('✓ Sparat', 'vz-saved-pill'); })
      .catch(function (e) { flash('⚠️ Kunde inte spara: ' + esc(e && e.message || e)); saved.style.color = '#b23a2e'; });
  }
  function scheduleSave() { if (saveTimer) { clearTimeout(saveTimer); } saveTimer = setTimeout(doSave, 600); }
  // Text/e-post-fält + textareas → debouncad auto-save på input.
  Array.prototype.forEach.call(document.querySelectorAll('#root input[type=email], #root input[type=text], #root textarea'), function (el) {
    el.addEventListener('input', scheduleSave);
  });
  // Test-läge (kryssruta) → spara DIREKT + uppdatera TEST-badgen in-place (ingen omritning → behåll scroll/fokus).
  var tm = document.getElementById('vz-testmode');
  if (tm) {
    tm.addEventListener('change', function () {
      var badge = document.getElementById('vz-testbadge');
      if (badge) { badge.innerHTML = tm.checked ? ' <span class="vz-testbadge">TEST PÅ</span>' : ''; }
      if (saveTimer) { clearTimeout(saveTimer); }
      doSave();
    });
  }
}

t.get('board', 'shared', KEY).then(function (s) { render(s || {}); }).catch(function () { render({}); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { try { t.closeModal(); } catch (x) {} } });
