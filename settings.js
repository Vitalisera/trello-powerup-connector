/* global TrelloPowerUp, window, document */
/*
 * Inställningar — Vitalisera Power-Up. Öppnas via board-knappen "Vitalisera – Inställningar"
 * (Vitalisera-loggan högst upp på brädan). Det finns inget kugghjul.
 *
 * Samlar konfigurerbara värden som annars vore hårdkodade. Lagras board-shared
 * (pluginData, nyckel 'vz_settings') så de delas av alla vyer på boarden och
 * överlever stäng/öppna. Andra vyer läser dem via t.get('board','shared','vz_settings').
 *
 * Fält (MVP):
 *   - doctorEmailByCourse: läkarens e-post PER KURS ({listnamn: adress}). ERSATTE den globala
 *                          doctorEmail 2026-08-29. Se NYA_ZAPIER_DOCTOR i config.js för varför
 *                          (kort: den globala pekade på en kursdeltagare och läckte hälsoformulär)
 *   - adminEmail         : kopia på skarpa utskick → cc på gruppledar-mejl, och hemlig kopia +
 *                          kvittens på praktisk info (Malin såg annars inte att mejlen gick iväg —
 *                          Apps Script kör som Roberts konto, så de hamnar i HANS skickat-mapp)
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
var DOCTOR = window.NYA_ZAPIER_DOCTOR;   // läkaradress-kontraktet (config.js) — delas med course.js
var SAVED = {};                          // senast lästa vz_settings (fail-safe-källa för payload)
var DOCTOR_ROWS_READY = false;           // false = kursraderna ej renderade → rör INTE sparade adresser

// Trello REST (samma mönster som course.js): kurslistorna måste hämtas live — Malin ska slippa
// skriva kursnamn för hand, och en felstavning ger tyst utebliven delning.
function settingsRestGet(token, path) {
  var sep = path.indexOf('?') === -1 ? '?' : '&';
  return fetch('https://api.trello.com/1/' + path + sep + 'key=' + encodeURIComponent(CFG.APP_KEY)
    + '&token=' + encodeURIComponent(token)).then(function (r) {
    if (!r.ok) { throw new Error('Trello ' + r.status); }
    return r.json();
  });
}
// Läser tillbaka kursraderna ur DOM:en → [{course, email}]. Kursnamnet bärs i data-attributet,
// aldrig i ett redigerbart fält (nyckeln måste matcha Trello-listan exakt).
function readDoctorRows() {
  return Array.prototype.map.call(document.querySelectorAll('[data-vz-doctor-course]'), function (el) {
    return { course: el.getAttribute('data-vz-doctor-course'), email: (el.value || '').trim() };
  });
}
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

    + '<div class="vz-field">'
    + '<label>Läkarens e-postadress <span style="font-weight:normal;color:#6a7a82">— per kurs</span></label>'
    + '<p class="hint">Hit delas mappen "HF till läkare" för respektive kurs (läkaren får läs-åtkomst till de anonymiserade hälsoformulären). '
    + '<b>Varje kurs måste ha sin egen adress.</b> Saknas den delas ingenting — det är avsiktligt: en gemensam adress '
    + 'för alla kurser delade hälsoformulär till fel person i augusti 2026. Lämna tom för att ta bort en adress.</p>'
    + '<div id="vz-doctor-rows" class="hint">⏳ hämtar kurser…</div>'
    + '</div>'

    + '<div class="vz-fieldgrid">'
    + '<div class="vz-field">'
    + '<label for="vz-admin">Admin-e-post (kopia + kvittens)</label>'
    + '<p class="hint">Får kopia på skarpa utskick: cc på gruppledar-mejlen, och på praktisk info <b>både en hemlig kopia av varje deltagarmejl och en kvittens</b> som listar vilka som fick det och vilka som inte gjorde det. Lämna tom = ingen kopia alls, och då syns utskicket inte för någon annan än den som skickade. (I testläge skickas inget hit — allt går till test-mottagaren.)</p>'
    + '<input type="email" id="vz-admin" placeholder="admin@vitalisera.se" value="' + esc(s.adminEmail || '') + '">'
    + '</div>'
    + '<div class="vz-field">'
    + '<label for="vz-sendername">Avsändarnamn</label>'
    + '<p class="hint">Visas som avsändare på gruppledar-/kock-mejlen. Tom = "Vitalisera AB".</p>'
    + '<input type="text" id="vz-sendername" placeholder="Vitalisera AB" value="' + esc(s.senderName || '') + '">'
    + '</div>'
    + '<div class="vz-field">'
    + '<label for="vz-replyto">Svara-till (reply-to)</label>'
    + '<p class="hint">Utskicken kommer från <b>info@vitalisera.se</b>. Svar går hit i stället, t.ex. malin.kraft@vitalisera.se — sätt den som ska ta emot svaren. Tom = svar går till info@vitalisera.se. (Rensas i testläge.)</p>'
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
    // Lagringsdiagnostik (Robert 2026-07-10): Trello board/shared har en TOTAL 8192-teckensbudget som ALLA
    // nycklar delar. Mät faktisk förbrukning + per-nyckel-nedbrytning så vi vet hur nära taket vi är.
    + '<div class="vz-field" style="margin-top:18px;border-top:1px solid #e4eef0;padding-top:14px">'
    + '<label>Trello-lagring (board · delad budget)</label>'
    + '<p class="hint">Trello ger hela Power-Upen <b>8192 tecken totalt</b> på board-nivå — alla kurser och listor delar samma budget. Här ser du faktisk förbrukning.</p>'
    + '<div id="vz-storage-readout" class="hint" style="font-variant-numeric:tabular-nums">⏳ mäter…</div>'
    + '</div>'
    + '</div>';

  // bild16: bevara användarens manuellt ändrade textarea-höjd mellan öppningar (per id, localStorage).
  Array.prototype.forEach.call(document.querySelectorAll('textarea.vz-ta'), persistTextareaSize_);

  var saved = document.getElementById('vz-saved');
  var savedTimer = null, saveTimer = null;
  function val(id) { var el = document.getElementById(id); return el ? (el.value || '').trim() : ''; }
  // Validera e-postfälten → första felet (inline-varning) eller null. Tomt = OK (frivilligt).
  function validationError() {
    var checks = [['vz-admin', 'Admin-e-posten'], ['vz-testredirect', 'Test-mottagarens e-post'], ['vz-replyto', 'Svara-till-adressen']];
    for (var i = 0; i < checks.length; i++) { var v = val(checks[i][0]); if (v && !isEmail(v)) { return '⚠️ ' + checks[i][1] + ' ser inte giltig ut — sparas ej.'; } }
    // Läkaradresserna: en ogiltig adress får inte sparas — den styr vem som ser hälsoformulär.
    var bad = readDoctorRows().filter(function (r) { return r.email && !isEmail(r.email); })[0];
    if (bad) { return '⚠️ Läkar-e-posten för "' + bad.course + '" ser inte giltig ut — sparas ej.'; }
    return null;
  }
  function payload() {
    return {
      // 🔴 Panelen skriver HELA objektet, så allt som ska överleva måste finnas här. Har kurs-
      // raderna inte hunnit laddas (eller kunde inte hämtas) återanvänds det SPARADE objektet
      // oförändrat — annars raderar en tidig sparning varje läkaradress vi har.
      doctorEmailByCourse: DOCTOR_ROWS_READY ? DOCTOR.toSaved(readDoctorRows()) : (SAVED.doctorEmailByCourse || {}),
      adminEmail: val('vz-admin'),
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
  /* Kursraderna: hämta boardens listor live → en rad per kurs som fortfarande kan behöva delas,
   * PLUS varje redan sparad adress (se NYA_ZAPIER_DOCTOR.buildRows — en sparad nyckel som inte
   * renderas skulle raderas tyst vid nästa sparning).
   * Misslyckas hämtningen renderas INGA fält och DOCTOR_ROWS_READY förblir false → payload()
   * återanvänder de sparade adresserna oförändrade. En trasig hämtning får inte radera något. */
  (function () {
    var host = document.getElementById('vz-doctor-rows');
    if (!host) { return; }
    function fail(msg) { host.innerHTML = '<span style="color:#b23a2e">⚠️ ' + esc(msg) + '</span>'; }
    var ctx = {};
    try { ctx = t.getContext() || {}; } catch (e) { ctx = {}; }
    if (!ctx.board) { fail('Kunde inte läsa vilken bräda det gäller — öppna Inställningar från brädan.'); return; }
    t.getRestApi().getToken().then(function (token) {
      if (!token) { throw new Error('Trello är inte anslutet. Öppna Kursöversikt och klicka Anslut först, kom sedan tillbaka hit.'); }
      return settingsRestGet(token, 'boards/' + ctx.board + '/lists?fields=name');
    }).then(function (lists) {
      var names = (lists || []).map(function (l) { return (l && l.name) || ''; });
      var rows = DOCTOR.buildRows(names, SAVED, new Date());
      if (!rows.length) { host.innerHTML = '<span>Inga kurser i fönstret just nu (kommande, samt de som slutade för mindre än 45 dagar sedan).</span>'; DOCTOR_ROWS_READY = true; return; }
      host.innerHTML = rows.map(function (r) {
        return '<div style="display:flex;align-items:center;gap:10px;margin:7px 0;flex-wrap:wrap">'
          + '<span style="min-width:250px;font-size:13px;color:#0d3142">' + esc(r.course)
          + (r.orphan ? ' <span title="Adressen är sparad under ett namn som inte finns bland brädans kurslistor. Kursen kan ha bytt namn i Trello — mappen i Drive bär i så fall kvar det gamla namnet, så adressen behövs fortfarande här." style="background:#fbe9c6;color:#8a5a00;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:600">okänt kursnamn</span>' : '')
          + '</span>'
          + '<input type="email" list="vz-doctor-known" autocomplete="off" data-vz-doctor-course="' + esc(r.course) + '" placeholder="lakare@exempel.se" value="' + esc(r.email) + '" style="flex:1;min-width:210px;padding:7px 9px;border:1px solid #cfd8dc;border-radius:8px;font-size:13px;font-family:inherit">'
          + '</div>';
      }).join('');
      // Samma förslagslista som i Kursöversiktens HF-panel — tidigare använda läkaradresser, härledda
      // ur de som redan är satta. Att välja i stället för att skriva tar bort felskrivningsrisken.
      host.innerHTML += '<datalist id="vz-doctor-known">' + DOCTOR.knownEmails(SAVED).map(function (e) {
        return '<option value="' + esc(e.email) + '" label="' + esc(e.label) + '"></option>';
      }).join('') + '</datalist>';
      if (rows.some(function (r) { return r.orphan; })) {
        host.innerHTML += '<p class="hint" style="margin-top:9px">En rad märkt <b>okänt kursnamn</b> har en sparad adress men matchar ingen kurslista på brädan — kursen kan ha döpts om. '
          + 'Ta inte bort den utan att veta: mappen i Drive bär kvar det gamla namnet, så det är den adressen som används. Lägg hellre till en rad för det nya namnet också.</p>';
      }
      DOCTOR_ROWS_READY = true;
      Array.prototype.forEach.call(host.querySelectorAll('input[data-vz-doctor-course]'), function (el) {
        el.addEventListener('input', scheduleSave);
      });
    }).catch(function (e) { fail(((e && e.message) || e) + ' Inga läkaradresser ändras.'); });
  })();
  // Lagringsdiagnostik: läs ALL board/shared plugin-data (t.getAll) → summera tecken mot 8192-budgeten + topp-nycklar.
  (function () {
    var el = document.getElementById('vz-storage-readout');
    if (!el || !t.getAll) { if (el) { el.textContent = 'Kunde inte mäta (getAll saknas).'; } return; }
    t.getAll().then(function (all) {
      var shared = (all && all.board && all.board.shared) || {};
      var keys = Object.keys(shared).map(function (k) {
        return { k: k, n: (k + JSON.stringify(shared[k])).length };
      }).sort(function (a, b) { return b.n - a.n; });
      var total = JSON.stringify(shared).length;   // faktisk serialiserad längd = det Trello mäter mot 8192
      var pct = Math.round(total / 8192 * 100);
      var color = pct >= 90 ? '#b23a2e' : pct >= 70 ? '#b5710b' : '#1f7a53';
      var top = keys.slice(0, 6).map(function (x) { return esc(x.k) + ' (' + x.n + ')'; }).join(' · ');
      el.innerHTML = '<b style="color:' + color + '">' + total + ' / 8192 tecken (' + pct + '%)</b>'
        + '<br>' + keys.length + ' nycklar. Störst: ' + (top || '—');
    }).catch(function (e) { el.textContent = '⚠️ Kunde inte mäta: ' + esc((e && e.message) || e); });
  })();
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

t.get('board', 'shared', KEY).then(function (s) { SAVED = s || {}; render(SAVED); }).catch(function () { SAVED = {}; render({}); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { try { t.closeModal(); } catch (x) {} } });
