/* global TrelloPowerUp, window, document */
/*
 * Kursöversikt (Vy2) — glue mot riktig Trello-data via REST.
 *
 * En kurs = en Trello-lista. Deltagare = kort i listan. Status per steg härleds
 * ur kortets checklista (klar) + labels (gap = label satt men ej bockad), exakt
 * som deltagardashboarden — men board-brett.
 *
 * Checklist-item-status finns INTE via t.cards → vi hämtar korten + checklistor
 * via Trello REST (t.getRestApi, direkt från webbläsaren). Kräver att Malin
 * anslutit (authorize) en gång + att APP_KEY är ifylld i config.js.
 */
'use strict';

var CFG = window.NYA_ZAPIER_CONFIG;
var t = TrelloPowerUp.iframe({ appKey: CFG.APP_KEY, appName: CFG.APP_NAME, appAuthor: CFG.APP_AUTHOR });
var ROOT = function () { return document.getElementById('root'); };

function norm(s) { return String(s || '').trim().toLowerCase(); }
// Dedupa e-postlista skiftlägesokänsligt, behåll ordning. Ren funktion (proof-bar). (Granskning 2026-06-18: 3 kopior → en källa.)
function dedupeEmailsCI_(emails) {
  var seen = {}, uniq = [];
  (emails || []).forEach(function (e) { var k = String(e).toLowerCase(); if (!seen[k]) { seen[k] = true; uniq.push(e); } });
  return uniq;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/* bild16: bevara användarens MANUELLT ändrade textarea-höjd mellan öppningar (per id, localStorage).
 * Sparar BARA på pekar-drag (mousedown→mouseup) → krockar ej med programmatisk auto-fit (fitAllergi/fit).
 * Restaurerar sparad höjd på init. vzTaHasSavedSize_ = guard så auto-fit hoppas när manuell storlek finns. */
function vzTaSizeKey_(el) { return el && el.id ? 'vz_tasize_' + el.id : null; }
function vzTaHasSavedSize_(el) { var k = vzTaSizeKey_(el); if (!k) { return false; } try { return !!localStorage.getItem(k); } catch (e) { return false; } }
function persistTextareaSize_(el) {
  var key = vzTaSizeKey_(el);
  if (!key) { return; }
  try { var saved = localStorage.getItem(key); if (saved) { el.style.height = saved; } } catch (e) {}
  if (el.getAttribute('data-vzsize') === '1') { return; }   // koppla lyssnaren bara en gång per element
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

/* E-post ur ett kort-desc. Föredrar markdown-mönstret "**Epost:** [x](mailto:x)"
 * eller "**Epost:** x", faller tillbaka till första rena adressen. Ren funktion. */
var STAFF_EMAIL_RE = /\*\*Epost:\*\*\s*(?:\[(.*?)\]\(mailto:[^)]+\)|([\w.\-+]+@[\w.\-+]+\.\w+))/i;

// Parsar deltagarkortets desc → {namn, telefon, epost} (porterat från dashboard.js parseDesc: strippar
// markdown-fetstil + mailto-länkad e-post). Ren funktion. För uppföljningens enskilda kontaktmejl (#10).
function parseContactFromDesc(desc) {
  var out = {};
  String(desc || '').split('\n').forEach(function (line) {
    var clean = line.replace(/\*+/g, '').trim();
    var m = clean.match(/^([^:]{2,30}):\s*(.+?)\s*$/);
    if (!m) { return; }
    var val = m[2].trim();
    var link = val.match(/^\[([^\]]+)\]\([^)]*\)$/);
    if (link) { val = link[1].trim(); }
    out[norm(m[1])] = val;
  });
  return { namn: out['namn'] || '', telefon: out['telefonnummer'] || out['telefon'] || '', epost: out['epost'] || '' };
}
var ANY_EMAIL_RE = /[\w.\-+]+@[\w.\-]+\.\w+/;
function extractStaffEmail(desc) {
  var s = String(desc || '');
  var m = s.match(STAFF_EMAIL_RE);
  if (m) { return (m[1] || m[2] || '').trim(); }
  var f = s.match(ANY_EMAIL_RE);
  return f ? f[0].trim() : '';
}

// Assistentkortets beskrivning → AI-extraherbar text. Formatet har aldrig parsats förut
// (Robert 2026-06-15) och texten är liten → vi skickar HELA desc:en till AI:n och låter
// den plocka ut allergin (robust mot okänt format). Anonymisering bevaras genom att
// städa bort namn/mejl/telefon lokalt INNAN sändning; nyrader → " · ". Tom → ''.
function stripStaffDescForAI(desc, name) {
  var s = String(desc || '');
  if (!s.trim()) { return ''; }
  s = s.replace(STAFF_EMAIL_RE, ' ').replace(new RegExp(ANY_EMAIL_RE.source, 'gi'), ' ');
  s = s.replace(/\(?\+?\d[\d\s\-()]{6,}\d/g, ' ');           // telefonnummer
  if (name) {                                                 // ta bort namnet (för- och efternamn)
    String(name).split(/\s+/).filter(Boolean).forEach(function (part) {
      if (part.length >= 2) { s = s.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '); }
    });
  }
  return s.replace(/[*_#>`]/g, ' ').replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim();
}

/* ---------- Status-härledning per kort (samma logik som Vy1) ---------- */
function statusForCard(card, naKeys) {
  var checked = {};
  (card.checklists || []).forEach(function (cl) {
    (cl.checkItems || []).forEach(function (it) {
      if (norm(it.state) === 'complete') { checked[norm(it.name)] = true; }
    });
  });
  var labels = {};
  (card.labels || []).forEach(function (l) { if (l.name) { labels[norm(l.name)] = true; } });
  function isChecked(name) {
    if (!name) { return false; }
    var n = norm(name);
    if (checked[n]) { return true; }
    return Object.keys(checked).some(function (k) { return k.indexOf(n) !== -1 || n.indexOf(k) !== -1; });
  }
  var status = {};
  var flow = window.NYA_ZAPIER_FLOW || [];
  flow.forEach(function (s) {
    if (naKeys && naKeys[s.key]) { status[s.key] = 'na'; return; }   // ej relevant för detta kurssteg (t.ex. uppföljning utanför Steg 1)
    var checklistDone = isChecked(s.checkItem);
    var labelSet = s.triggerLabel ? !!labels[norm(s.triggerLabel)] : false;
    status[s.key] = s.always ? 'done' : checklistDone ? 'done' : (s.triggerLabel ? (labelSet ? 'gap' : 'wait') : 'manual');
  });
  // Logisk slutledning (Malin): done-steg promotar sina implies-steg → done.
  flow.forEach(function (s) {
    if (s.implies && status[s.key] === 'done') {
      s.implies.forEach(function (k) { if (status[k] && status[k] !== 'done' && status[k] !== 'na') { status[k] = 'done'; } });
    }
  });
  var done = 0, gaps = 0, total = 0;   // 'na'-steg exkluderas ur progress/total (ej relevant)
  flow.forEach(function (s) { if (status[s.key] === 'na') { return; } total++; if (status[s.key] === 'done') { done++; } else if (status[s.key] === 'gap') { gaps++; } });
  return { status: status, progress: { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0 }, gapCount: gaps };
}
// Bara Steg 1 har uppföljningssamtal (Robert 2026-06-21) → steg 14 + uppföljnings-matrisen göms/markeras ej relevant för 2/3A/3B.
function courseHasUppfoljning(courseName) {
  var m = String(courseName == null ? '' : courseName).match(/steg\s*([0-9a-zåäö]+)/i);
  return !m || norm(m[1]) === '1';   // okänt steg → visa (bakåtkompat)
}

/* ---------- Datum ur listnamn → dagar till start ---------- */
var MONTHS = { januari: 0, februari: 1, mars: 2, april: 3, maj: 4, juni: 5, juli: 6, augusti: 7, september: 8, oktober: 9, november: 10, december: 11 };
// Kursens startdatum ur listnamnet (ex "24 juni - 2 juli 2026 (Steg 1)") → Date, eller null. Ren funktion.
function courseStartDate(listName) {
  var s = String(listName || '');
  // BUGGFIX (Robert 2026-06-21): kompakt samma-månad-intervall "22-30 juli 2026" → FÖRSTA talet är startdagen
  // (annars matchade "30 juli" = slutdagen). Kräver siffra-bindestreck-siffra-mellanslag-månad.
  var rng = s.match(/(\d{1,2})\s*[-–]\s*\d{1,2}\s+([a-zåäö]+).*?(\d{4})/i);
  if (rng && MONTHS[norm(rng[2])] !== undefined) { return new Date(parseInt(rng[3], 10), MONTHS[norm(rng[2])], parseInt(rng[1], 10)); }
  var m = s.match(/(\d{1,2})\s+([a-zåäö]+).*?(\d{4})/i);
  if (!m) { return null; }
  var mon = MONTHS[norm(m[2])];
  if (mon === undefined) { return null; }
  return new Date(parseInt(m[3], 10), mon, parseInt(m[1], 10));
}
function daysToStart(listName) {
  var start = courseStartDate(listName);
  if (!start) { return null; }
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((start - today) / 86400000);
}
// Deadline = startdatum minus N dagar, formaterat "D mån" (sv). Ren funktion. '' om ogiltigt.
var MONTHS_SV = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];
function deadlineDateStr(listName, daysBefore) {
  var start = courseStartDate(listName);
  var n = parseInt(daysBefore, 10);
  if (!start || isNaN(n)) { return ''; }
  var d = new Date(start.getTime() - n * 86400000);
  return d.getDate() + ' ' + MONTHS_SV[d.getMonth()] + ' ' + d.getFullYear();
}
// Rik deadline-info per checklist-item (bild15): { label, passed, today }. Deadline = start − N dagar.
// Relativt (Idag/Imorgon/Igår) för ±1 dag; annars "D mån"; röd (passed) om datumet ligger bakåt i tiden.
function deadlineDateInfo(listName, daysBefore) {
  var start = courseStartDate(listName);
  var n = parseInt(daysBefore, 10);
  if (!start || isNaN(n)) { return null; }
  var d = new Date(start.getTime() - n * 86400000);
  d.setHours(0, 0, 0, 0);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var diff = Math.round((d - today) / 86400000);   // dagar från idag till deadline (neg = passerat)
  var label;
  if (diff === 0) { label = 'Idag'; }
  else if (diff === 1) { label = 'Imorgon'; }
  else if (diff === -1) { label = 'Igår'; }
  else { label = d.getDate() + ' ' + MONTHS_SV[d.getMonth()]; }
  return { label: label, passed: diff < 0, today: diff === 0 };
}

// Praktisk info-tokens ur kursnamnet (bild: "24 juni - 2 juli 2026 (Steg 1)"). STARTTID hårdkodad till
// standardtiden 19:00 (kvällsfika). Ren funktion → proof-bar. Plats är hårdkodad i mallen (ingen token).
var WEEKDAYS_SV = ['söndagen', 'måndagen', 'tisdagen', 'onsdagen', 'torsdagen', 'fredagen', 'lördagen'];
var MONTHS_SV_FULL = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
function courseEndDate(listName) {
  var s = String(listName || '');
  var ym = s.match(/(\d{4})/); if (!ym) { return null; }
  var year = parseInt(ym[1], 10);
  var dm = [], re = /(\d{1,2})\s+([a-zåäö]+)/gi, m;
  while ((m = re.exec(s))) { var mon = MONTHS[norm(m[2])]; if (mon !== undefined) { dm.push({ d: parseInt(m[1], 10), mon: mon }); } }
  if (!dm.length) { return null; }
  var first = dm[0], last = dm[dm.length - 1];
  // Årskorsande intervall ("28 december 2025 - 4 januari 2026"): slutmånad < startmånad → slutdatum nästa år.
  var endYear = (last.mon < first.mon) ? year + 1 : year;
  return new Date(endYear, last.mon, last.d);
}
function practicalTokens(courseName) {
  var start = courseStartDate(courseName), end = courseEndDate(courseName);
  function fmt(d) { return d.getDate() + ' ' + MONTHS_SV_FULL[d.getMonth()]; }
  return {
    KURSDATUM: String(courseName == null ? '' : courseName).trim(),
    STARTDAG: start ? (WEEKDAYS_SV[start.getDay()] + ' den ' + fmt(start)) : '',
    STARTTID: '19:00',
    SLUTDAG: end ? fmt(end) : '',
  };
}

// Steg-medveten etikett för livsberättelse-MOTSVARIGHETEN (Robert 2026-06-21; verifierat mot nya-zapier Step_Configs.js).
// CheckItem-namnet ("Levnadsbeskrivning klar") är samma över alla steg → bara ETIKETTEN är steg-beroende.
var STEP_LIVS_LABELS = { '1': 'Livsberättelse', '2': 'Nulägesbeskrivning', '3a': 'Du och dina relationer', '3b': 'Steg 3B-formulär' };
function livsLabelForCourse(courseName) {
  var m = String(courseName == null ? '' : courseName).match(/steg\s*([0-9a-zåäö]+)/i);
  return (m && STEP_LIVS_LABELS[norm(m[1])]) || 'Livsberättelse';
}
// "Steg 3A" / "Steg 1" ur kursnamnet (för steg-formulär-rubriken steg 7). Versaliserar suffixet (3a → 3A).
function courseStegDisplay(courseName) {
  var m = String(courseName == null ? '' : courseName).match(/steg\s*([0-9]+[a-zåäö]?)/i);
  return m ? ('Steg ' + m[1].toUpperCase()) : 'Steg 1';
}
function buildCourseModel(listName, cards) {
  var livsLabel = livsLabelForCourse(listName);
  var steps = (window.NYA_ZAPIER_FLOW || []).map(function (s) {
    var title = (s.key === 'livs_klar') ? (livsLabel + ' klar')
      : (s.key === 'livs_delad') ? (livsLabel + ' → kursledare')   // steg 12: "Du och dina relationer → kursledare" (3A)
      : (s.key === 'steg1') ? (courseStegDisplay(listName) + ' – formulär')   // steg 7: "Steg 3A – formulär" (ej hårdkodat "Steg 1")
      : s.title;   // steg-medveten kolumnrubrik
    return { key: s.key, title: title, short: title.split(' ')[0], phase: s.phase };
  });
  var naKeys = courseHasUppfoljning(listName) ? null : { uppfoljning: true };   // steg 14 ej relevant utanför Steg 1
  var participants = cards.map(function (c) {
    var d = statusForCard(c, naKeys);
    return {
      key: c.id,
      name: (c.name || '').replace(/^\s*\d+\s*[-–]\s*/, ''),
      cardUrl: c.url,
      status: d.status, progress: d.progress, gapCount: d.gapCount,
    };
  });
  return { course: { name: listName, datum: listName, daysToStart: daysToStart(listName) }, steps: steps, participants: participants };
}

// Inline steg-detalj (Robert 2026-06-17: klick på cell → expandera rad med stegets Fas1/Fas2 + noteringar;
// porterar Vy1:s detalj in i Vy2 → gör deltagarstatus-vyn överflödig). COURSE_CARDS_BY_ID fylls i loadCourse.
var COURSE_CARDS_BY_ID = {};
var COURSE_NAME = '';   // kursens listnamn (för fold-out-actions, t.ex. enstaka praktisk-info-utskick)
var DOC_BYKEY = {};   // #11/bild14: senaste dok-statusen (per kort-id → {hf,livs}), läses av inline-detaljen för steg 8/9

var handlers = {
  onOpenCard: function (p) { if (p && p.cardUrl) { window.open(p.cardUrl, '_blank'); } },
  onSelectCell: function (p, stepKey, host) {
    if (!host) { return; }
    var card = p && COURSE_CARDS_BY_ID[p.key];
    if (!card) { host.innerHTML = '<div class="vz-cv-detail-empty">Kortdata saknas — ladda om vyn.</div>'; return; }
    renderInlineStepDetail(host, p, stepKey, card);
  },
};

// Härled ETT stegs fulla detalj ur kortet (status, label satt?, checkItem-id + bockad?, automation).
function stepDetailForCard(card, stepKey) {
  var s = (window.NYA_ZAPIER_FLOW || []).filter(function (f) { return f.key === stepKey; })[0];
  if (!s) { return null; }
  var ci = null;
  (card.checklists || []).forEach(function (cl) {
    (cl.checkItems || []).forEach(function (it) {
      if (ci) { return; }
      var nm = norm(it.name || ''), tg = norm(s.checkItem || '');
      if (tg && (nm === tg || nm.indexOf(tg) !== -1 || tg.indexOf(nm) !== -1)) { ci = { id: it.id, complete: norm(it.state) === 'complete' }; }
    });
  });
  var labels = {};
  (card.labels || []).forEach(function (l) { if (l.name) { labels[norm(l.name)] = true; } });
  return {
    key: s.key, title: s.title, phase: s.phase, always: !!s.always,
    triggerLabel: s.triggerLabel || null, automation: s.automation || null,
    checkItemName: s.checkItem || null, checkItemId: ci ? ci.id : null,
    labelSet: s.triggerLabel ? !!labels[norm(s.triggerLabel)] : false,
    checklistDone: !!(ci && ci.complete),
  };
}

function vzPhaseCard_(num, kind, title, bodyHtml, actionHtml) {
  return '<div class="vz-pd-card"><div class="vz-pd-k"><span class="vz-pd-dot">' + num + '</span>Fas ' + num + ' · ' + esc(kind) + '</div>'
    + '<div class="vz-pd-title">' + title + '</div><div class="vz-pd-body">' + bodyHtml + '</div>'
    + (actionHtml ? '<div class="vz-pd-actions">' + actionHtml + '</div>' : '') + '</div>';
}

// Tusentalsavgränsare (svenskt mellanslag): 6612 → "6 612"
function groupNum_(n) { return String(n == null ? '' : n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

// #11/bild14: Fas 1 för steg 8/9 (Hälsoformulär klart / Livsberättelse klar) visar dokumentets status
// (samma info som matriscellens tooltip — besvarat/tecken/bild/ändrad — men presenterat som en stat-lista).
function docStatFas1_(stepKey, card) {
  var isLivs = stepKey === 'livs_klar';
  var docName = isLivs ? livsLabelForCourse(COURSE_NAME) : 'Hälsoformulär';   // steg-medveten rubrik i fold-out
  var st = (DOC_BYKEY[card.id] || {})[isLivs ? 'livs' : 'hf'];
  var docUrl = commentLink(card, isLivs ? STORY_LINK_RES : HF_LINK_RES);
  var openBtn = docUrl ? '<a class="vz-btn vz-pd-act" href="' + esc(docUrl) + '" target="_blank" rel="noopener">Öppna dokumentet ↗</a>' : '';
  if ((st && st.loading) || (!st && docUrl)) {   // skannas just nu, eller har länk men ej skannat än
    return vzPhaseCard_('1', docName, 'Läser dokumentet…', '<span class="vz-pd-note">⏳ Skannar svar och bilder — vänta några sekunder.</span>', '');
  }
  if (!st || st.ok !== true) {   // ingen länk på kortet, eller skanning misslyckades
    return vzPhaseCard_('1', docName, 'Dokument saknas', '<span class="vz-pd-note">Inget ' + esc(docName.toLowerCase()) + '-dokument hittat på kortet.</span>', '');
  }
  var title = (st.pct != null ? st.pct + ' % ifyllt' : st.filled + '/' + st.total + ' besvarat');
  var stats = '<ul class="vz-pd-stats">'
    + '<li><span>Besvarade frågor</span><b>' + st.filled + ' / ' + st.total + '</b></li>'
    + (st.chars != null ? '<li><span>Tecken</span><b>' + groupNum_(st.chars) + '</b></li>' : '')
    + (isLivs ? '<li><span>Bild</span><b>' + (st.hasImage ? '✓ finns' : 'saknas') + '</b></li>' : '')
    + (st.docUpdated ? '<li><span>Senast ändrad</span><b>' + esc(st.docUpdated) + '</b></li>' : '')
    + '</ul>'
    + (st.ready ? '<span class="vz-pd-ok">Komplett — klart att bocka av.</span>' : '<span class="vz-pd-note">Ännu inte komplett.</span>');
  return vzPhaseCard_('1', docName, esc(title), stats, openBtn);
}

function renderInlineStepDetail(host, p, stepKey, card) {
  var d = stepDetailForCard(card, stepKey);
  if (!d) { host.innerHTML = '<div class="vz-cv-detail-empty">Okänt steg.</div>'; return; }

  var fas1;
  if (stepKey === 'hf_klart' || stepKey === 'livs_klar') {
    fas1 = docStatFas1_(stepKey, card);
  } else if (!d.triggerLabel && !d.automation) {
    fas1 = vzPhaseCard_('1', 'Trigger', 'Ingen automation', '<span class="vz-pd-note">✋ Inget mejl, inget dokument — utförs manuellt av dig.</span>', '');
  } else if (!d.triggerLabel) {
    fas1 = vzPhaseCard_('1', 'Trigger', esc(d.automation || 'Automatiskt'), '<span class="vz-pd-note">Triggas automatiskt — krävde ingen label.</span>', '');
  } else if (d.labelSet) {
    fas1 = vzPhaseCard_('1', 'Trigger', 'Label satt ✓', '<span class="vz-pd-ok">«' + esc(d.triggerLabel) + '» är satt — automationen har körts.</span>', '');
  } else {
    fas1 = vzPhaseCard_('1', 'Sätt label', 'Starta automationen', '<span class="vz-pd-note">Sätt «' + esc(d.triggerLabel) + '»' + (d.automation ? ' → «' + esc(d.automation) + '» (kan skicka mejl)' : '') + '.</span>',
      '<button class="vz-btn vz-pd-act" data-act="label">Sätt label</button>');
  }

  var fas2;
  if (stepKey === 'praktisk' && !d.checklistDone) {
    // Steg 7: skicka praktisk info-PDF till DENNA deltagare (+ bocka) direkt ur fold-out.
    var piEmail = parseContactFromDesc(card.desc).epost || '';
    var piAction = !piEmail ? '<span class="vz-pd-note">deltagaren saknar e-post i kortet</span>'
      : (!d.checkItemId ? '<span class="vz-pd-note">checkItem "Praktisk info skickat" saknas — bocka i kortet</span>'
        : '<button class="vz-btn vz-pd-act" data-act="sendpi">Skicka praktisk info</button>');
    fas2 = vzPhaseCard_('2', 'Skicka', 'Praktisk info som PDF', '<span class="vz-pd-note">Mejlar den kursgemensamma PDF:en till deltagaren och bockar steget (fail-closed i testläge).</span>', piAction);
  } else if (d.always) {
    fas2 = vzPhaseCard_('2', 'Bock', 'Klart', '<span class="vz-pd-ok">Steget är alltid klart.</span>', '');
  } else if (!d.checkItemName) {
    fas2 = vzPhaseCard_('2', 'Bock', '—', '<span class="vz-pd-note">Ingen checklistpunkt för detta steg.</span>', '');
  } else if (d.checklistDone) {
    fas2 = vzPhaseCard_('2', 'Bock', 'Bockad ✓', '<span class="vz-pd-ok">«' + esc(d.checkItemName) + '» är bockad — steget är klart.</span>', '');
  } else {
    fas2 = vzPhaseCard_('2', 'Bock i checklista', 'Bocka när utfört', '<span class="vz-pd-note">Bocka «' + esc(d.checkItemName) + '» när steget är gjort.</span>',
      d.checkItemId ? '<button class="vz-btn vz-pd-act" data-act="tick">Bocka av</button>' : '<span class="vz-pd-note">checkItem-id saknas — bocka i kortet</span>');
  }

  host.innerHTML = '<div class="vz-pd-head"><b>' + esc(d.title) + '</b><span class="vz-pd-phase">' + esc(d.phase) + '</span>'
    + '<button class="vz-btn vz-pd-notes" data-act="notes">Visa noteringar</button></div>'
    + '<div class="vz-pd-phases">' + fas1 + '<span class="vz-pd-arrow">→</span>' + fas2 + '</div>';

  var lb = host.querySelector('[data-act="label"]'); if (lb) { lb.addEventListener('click', function () { inlineSetLabel(card.id, d, lb); }); }
  var tb = host.querySelector('[data-act="tick"]'); if (tb) { tb.addEventListener('click', function () { inlineTick(card.id, d, tb); }); }
  var nb = host.querySelector('[data-act="notes"]'); if (nb) { nb.addEventListener('click', function () { showParticipantNotes(p, card); }); }
  var pib = host.querySelector('[data-act="sendpi"]');
  if (pib) {
    pib.addEventListener('click', function () {
      var row = { code: card.id, name: p.name, email: parseContactFromDesc(card.desc).epost || '', cardId: card.id, checkItemId: d.checkItemId, done: !!d.checklistDone };
      sendPracticalInfoFlow([row], COURSE_NAME, pib, 'enstaka', function (sent) {
        sent.forEach(function (r) { applyStepChange_(r.cardId, d, 'tick'); });   // uppdatera matriscell + kortdata
        renderInlineStepDetail(host, p, stepKey, COURSE_CARDS_BY_ID[card.id] || card);   // visa "Bockad ✓"
      });
    });
  }
}

// Efter lyckad bock/label: mutera kortdatan lokalt + uppdatera matriscellerna (inkl. implies-kaskad) utan omladdning.
function applyStepChange_(cardId, d, kind) {
  var card = COURSE_CARDS_BY_ID[cardId];
  if (!card) { return; }
  if (kind === 'tick' && d.checkItemId) {
    (card.checklists || []).forEach(function (cl) { (cl.checkItems || []).forEach(function (it) { if (it.id === d.checkItemId) { it.state = 'complete'; } }); });
  } else if (kind === 'label' && d.triggerLabel) {
    card.labels = card.labels || []; card.labels.push({ name: d.triggerLabel });
  }
  var ns = statusForCard(card).status;
  Object.keys(ns).forEach(function (k) { if (window.CourseView && CourseView.setCellStatus) { CourseView.setCellStatus(cardId, k, ns[k]); } });
}

// Fas 1: sätt triggerlabeln (POST idLabels → startar nya-zapier-automationen). Bekräftelse + fail-closed test-läge.
function inlineSetLabel(cardId, d, btn) {
  courseInModalConfirm('Sätt labeln «' + d.triggerLabel + '» på kortet?\n\nDet startar automationen'
    + (d.automation ? ' «' + d.automation + '»' : '') + ' (kan skicka mejl till deltagaren).', 'Sätt label', function () {
    getCourseSettings().then(function (settings) {
      if (!resolveSendMode(settings).live) { try { t.alert({ message: 'Testläge: skulle satt «' + d.triggerLabel + '» (ingen ändring).', duration: 6, display: 'info' }); } catch (e) {} return; }
      btn.disabled = true; btn.textContent = '⏳ Sätter…';
      t.board('labels').then(function (b) {
        var lbl = ((b && b.labels) || []).filter(function (l) { return norm(l.name) === norm(d.triggerLabel); })[0];
        if (!lbl) { throw new Error('Hittar ingen label «' + d.triggerLabel + '» på brädan.'); }
        return t.getRestApi().getToken().then(function (token) {
          if (!token) { throw new Error('Ingen Trello-token.'); }
          return restWrite(token, 'POST', 'cards/' + cardId + '/idLabels?value=' + encodeURIComponent(lbl.id));
        });
      }).then(function () {
        btn.textContent = '✓ Label satt'; btn.classList.add('is-done');
        applyStepChange_(cardId, d, 'label');   // uppdatera matriscellen utan omladdning
        try { t.alert({ message: '✓ Satte «' + d.triggerLabel + '» — automationen startar.', duration: 7, display: 'success' }); } catch (e) {}
      }).catch(function (err) { btn.disabled = false; btn.textContent = 'Sätt label'; try { t.alert({ message: '⚠️ ' + ((err && err.message) || err), duration: 8, display: 'error' }); } catch (e) {} });
    });
  });
}

// Fas 2: bocka checklistpunkten (PUT checkItem). Bekräftelse + fail-closed test-läge.
function inlineTick(cardId, d, btn) {
  courseInModalConfirm('Bocka «' + d.checkItemName + '» i checklistan?', 'Bocka av', function () {
    getCourseSettings().then(function (settings) {
      if (!resolveSendMode(settings).live) { try { t.alert({ message: 'Testläge: skulle bockat «' + d.checkItemName + '» (ingen ändring).', duration: 6, display: 'info' }); } catch (e) {} return; }
      btn.disabled = true; btn.textContent = '⏳ Bockar…';
      t.getRestApi().getToken().then(function (token) {
        if (!token) { throw new Error('Ingen Trello-token.'); }
        return restWrite(token, 'PUT', 'cards/' + cardId + '/checkItem/' + d.checkItemId + '?state=complete');
      }).then(function () {
        btn.textContent = '✓ Bockad'; btn.classList.add('is-done');
        applyStepChange_(cardId, d, 'tick');   // uppdatera matriscellen utan omladdning
        try { t.alert({ message: '✓ Bockade «' + d.checkItemName + '».', duration: 6, display: 'success' }); } catch (e) {}
      }).catch(function (err) { btn.disabled = false; btn.textContent = 'Bocka av'; try { t.alert({ message: '⚠️ ' + ((err && err.message) || err), duration: 8, display: 'error' }); } catch (e) {} });
    });
  });
}

// "Mänskliga noteringar": kortets kommentarer i en lightbox (filtrera bort bot-postade doklänkar).
function showParticipantNotes(p, card) {
  var notes = (card.actions || []).filter(function (a) {
    return a.type === 'commentCard' && a.data && a.data.text
      && !/zpr\.io|docs\.google|drive\.google|l[äa]nk till|levnadsbeskriv|livsber[äa]ttelse:|h[äa]lsoformul[äa]r.*:|mappen "/i.test(a.data.text);
  });
  var bodyHtml = notes.length
    ? '<ul class="vz-notes-list">' + notes.map(function (a) {
        var who = (a.memberCreator && a.memberCreator.fullName) || 'Okänd';
        var when = (a.date || '').slice(0, 10);
        return '<li><div class="vz-notes-meta">' + esc(who) + (when ? ' · ' + esc(when) : '') + '</div><div class="vz-notes-text">' + esc(a.data.text) + '</div></li>';
      }).join('') + '</ul>'
    : '<div class="vz-notes-empty">Inga mänskliga noteringar på det här kortet än.</div>';
  courseLightbox('Noteringar · ' + (p.name || 'Deltagare'), bodyHtml);
}

// Enkel lightbox-visare (ej bekräftelse) — egen overlay (t.popup funkar ej i fullscreen-modal). Esc stänger.
function courseLightbox(title, bodyHtml) {
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,68,92,.4);display:flex;align-items:center;justify-content:center;font-family:Calibri,system-ui,sans-serif;padding:20px';
  var box = document.createElement('div');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.style.cssText = 'background:#fff;max-width:560px;width:100%;max-height:80vh;overflow:auto;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.3);color:#0d3142';
  box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid rgba(8,68,92,.12);position:sticky;top:0;background:#fff">'
    + '<b style="font-size:15px">' + esc(title) + '</b><button class="vz-lb-x" style="border:none;background:#eef6f6;cursor:pointer;border-radius:8px;width:30px;height:30px;font-size:16px;color:#5d7c87">✕</button></div>'
    + '<div style="padding:16px 20px">' + bodyHtml + '</div>';
  ov.appendChild(box);
  (document.body || document.documentElement).appendChild(ov);
  function close() { document.removeEventListener('keydown', onKey, true); ov.remove(); }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.addEventListener('keydown', onKey, true);
  box.querySelector('.vz-lb-x').addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) { close(); } });
}

/* ---------- GAS-anrop (CORS-säkert, samma mönster som popup.js) ----------
 * text/plain → "simple request" → ingen OPTIONS-preflight. Body = JSON-sträng.
 * GAS svarar alltid HTTP 200; fel signaleras i kroppens ok-fält. Klienten
 * skickar all Trello-data hit; GAS gör bara Google-sidan (Doc/Claude/Gmail).
 */
function postToGas(action, payload) {
  var url = CFG.GAS_URL;
  if (!url || url.indexOf('REPLACE_WITH_DEPLOYMENT_ID') !== -1) {
    return Promise.reject(new Error('GAS_URL är inte ifylld i config.js'));
  }
  var body = JSON.stringify({ action: action, payload: payload || {} });
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body,
  }).then(function (res) {
    return res.text().then(function (text) {
      if (!res.ok) { throw new Error('GAS HTTP ' + res.status + ': ' + text.slice(0, 200)); }
      try { return JSON.parse(text); } catch (e) { throw new Error('Ogiltigt JSON-svar från GAS: ' + text.slice(0, 200)); }
    });
  });
}

/* ---------- REST ---------- */
// Trello REST autentiseras med key+token i query (kanoniskt), ej Bearer-header.
function restGet(token, path) {
  var sep = path.indexOf('?') === -1 ? '?' : '&';
  var url = 'https://api.trello.com/1/' + path + sep + 'key=' + encodeURIComponent(CFG.APP_KEY) + '&token=' + encodeURIComponent(token);
  return fetch(url).then(function (r) { if (!r.ok) { throw new Error('Trello ' + r.status); } return r.json(); });
}
// Cacha öppna boards per modal-session (granskning 2026-06-18: samma fetch på 5 ställen, board-listan ändras ~aldrig
// i en session). Reset vid fel så ett enstaka nätfel inte poisonar cachen. Modal-återöppning = ny iframe = ny cache.
var _openBoardsP = null;
function getOpenBoards_(token) {
  if (!_openBoardsP) { _openBoardsP = restGet(token, 'members/me/boards?fields=name&filter=open').catch(function (e) { _openBoardsP = null; throw e; }); }
  return _openBoardsP;
}
// Trello-skrivning (PUT/POST) — för #11 Fas 2 auto-bockning av checkItem. Samma auth som restGet.
function restWrite(token, method, path) {
  var sep = path.indexOf('?') === -1 ? '?' : '&';
  var url = 'https://api.trello.com/1/' + path + sep + 'key=' + encodeURIComponent(CFG.APP_KEY) + '&token=' + encodeURIComponent(token);
  return fetch(url, { method: method }).then(function (r) { if (!r.ok) { throw new Error('Trello ' + r.status); } return r.json(); });
}

/* ---------- Personal (gruppledare/assistenter/kockar = egna boards) ----------
 * Regler från Rumsindelning (Hämta alla som ska vara närvarande.js):
 *  - Gruppledare-board: kort MÅSTE ha en av filterLabels → rollen = labelnamnet.
 *  - Kockar-board: kort MÅSTE ha label "Kock".
 *  - Assistenter-board: ingen label-filter, men EXKLUDERA kort vars namn innehåller
 *    "Assistenter"/"Intresserad"/"Status". Roll = "Assistent".
 *  - Namn = delen efter " - " i kortnamnet (annars hela).
 */
var STAFF_BOARDS = [
  { key: 'gruppledare', label: 'Gruppledare', re: /gruppled|ledare/i,
    filterLabels: ['Gruppledare', 'Kursledare', 'Biträdande kursledare', 'Gruppledarpraktikant', 'Vitaliseraperson på plats'],
    excludeName: [], defaultRole: 'Gruppledare' },
  { key: 'assistenter', label: 'Assistenter', re: /assistent/i,
    filterLabels: [], excludeName: ['assistenter', 'intresserad', 'status'], defaultRole: 'Assistent' },
  { key: 'kockar', label: 'Kockar', re: /kock/i,
    filterLabels: ['Kock'], excludeName: [], defaultRole: 'Kock' },
];
var ASSIST_LIST_ID = null; // assistent-listans id, satt av renderStaffPanel → matallergi-hämtning
var KOCK_LIST_ID = null;   // kock-listans id, satt av renderStaffPanel → "Skicka till kock" (kockens mejl)
var STAFF_COUNT = 0;       // total personal (gruppledare + assistenter + kockar), satt av renderStaffPanel
var KOCK_NAME = '';        // kockens förnamn (för hälsning "Hej Arpan,")
var COURSE_KOCK_NAMES = []; // kursens kock-namn → matcha mot "Kontaktuppgifter kockar" för e-post
var COURSE_GL_NAMES = [];  // kursens gruppledar/VP-namn → matcha mot "Matallergier Gruppledare/VP"-listan
var COURSE_LEADERS = [];   // kursens gruppledar-personer {name, role} → cc kursledare/bitr i gruppledar-mejl
var MALIN_PRESENT = false; // Malin var med på kursveckan = finns som "Vitaliseraperson på plats" i gruppledar-listan
// Samma kurs = samma listnamn ELLER samma startdatum (datum-namngivna listor).
function sameCourse(a, b) {
  if (norm(a) === norm(b)) { return true; }
  var da = daysToStart(a), db = daysToStart(b);
  return da !== null && db !== null && da === db;
}
// Kort-namn ofta "Roll - Namn" → visa namnet.
function cleanStaffName(n) {
  var s = String(n || '').trim();
  var parts = s.split(' - ');
  return (parts.length > 1 ? parts.slice(1).join(' - ') : s).trim();
}

/* ── Flyttbara below-paneler (KANBAN): TVÅ oberoende kolumn-stackar (.vz-panel-col) som man drar moduler inom/mellan.
 * Oberoende kolumner → sömlös vertikal stacking utan radhöjds-koppling; topp-modulernas toppar möts (Robert 2026-06-18).
 * Layout board-delat (vz_panel_layout = [[col0-nycklar],[col1-nycklar]]). Varje panel wrappas i .vz-panel-wrap (handtaget
 * överlever panelens innerHTML-repaints). Drag BARA via handtaget. Ny/okänd modul → kortare kolumnen (balansering). */
var DEFAULT_PANEL_LAYOUT = [['livs_matris', 'hf', 'checklist'], ['uppf_matris', 'praktisk', 'allergi']];
var PANEL_LAYOUT = [[], []];
function loadPanelLayout() {
  return t.get('board', 'shared', 'vz_panel_layout').then(function (o) {
    PANEL_LAYOUT = (o && o.length === 2 && Array.isArray(o[0]) && Array.isArray(o[1])) ? o : [DEFAULT_PANEL_LAYOUT[0].slice(), DEFAULT_PANEL_LAYOUT[1].slice()];
    return PANEL_LAYOUT;
  }).catch(function () { PANEL_LAYOUT = [DEFAULT_PANEL_LAYOUT[0].slice(), DEFAULT_PANEL_LAYOUT[1].slice()]; return PANEL_LAYOUT; });
}
function panelPos_(key) {
  for (var c = 0; c < 2; c++) { var i = PANEL_LAYOUT[c].indexOf(key); if (i !== -1) { return { col: c, idx: i }; } }
  return null;
}
// Vilken wrap pekaren ligger FÖRE i en kolumn (vertikal närmast-mitt).
function dragAfterElement_(col, y) {
  var els = [].slice.call(col.querySelectorAll('.vz-panel-wrap:not(.is-dragging)'));
  var closest = -Infinity, found = null;
  for (var i = 0; i < els.length; i++) {
    var box = els[i].getBoundingClientRect();
    var offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest) { closest = offset; found = els[i]; }
  }
  return found;
}
function makeCol_(idx) {
  var col = document.createElement('div'); col.className = 'vz-panel-col'; col.setAttribute('data-col', String(idx));
  col.addEventListener('dragover', function (e) {
    var dragging = document.querySelector('.vz-panel-wrap.is-dragging'); if (!dragging) { return; }
    e.preventDefault();
    var after = dragAfterElement_(col, e.clientY);
    if (after == null) { col.appendChild(dragging); } else if (after !== dragging) { col.insertBefore(dragging, after); }
  });
  col.addEventListener('drop', function (e) { e.preventDefault(); });
  return col;
}
function belowCols_() {
  var host = vzRegion('below'); if (!host) { return null; }
  var existing = host.querySelectorAll('.vz-panel-col');
  if (existing.length === 2) { return [existing[0], existing[1]]; }
  var a = makeCol_(0), b = makeCol_(1);
  host.appendChild(a); host.appendChild(b);
  return [a, b];
}
function savePanelLayout_() {
  var cols = belowCols_(); if (!cols) { return; }
  PANEL_LAYOUT = cols.map(function (col) { return [].map.call(col.querySelectorAll('.vz-panel-wrap[data-panel]'), function (w) { return w.getAttribute('data-panel'); }); });
  try { t.set('board', 'shared', 'vz_panel_layout', PANEL_LAYOUT).catch(function () {}); } catch (e) {}
}
// Säkerhetsnät: flytta wrappar till rätt kolumn+ordning enligt sparad layout (om de landade innan layouten kom).
function reorderBelowPanels_() {
  var cols = belowCols_(); if (!cols) { return; }
  [].slice.call(vzRegion('below').querySelectorAll('.vz-panel-wrap[data-panel]')).forEach(function (w) {
    var pos = panelPos_(w.getAttribute('data-panel')); if (!pos) { return; }
    var col = cols[pos.col], before = null;
    [].slice.call(col.querySelectorAll('.vz-panel-wrap[data-panel]')).forEach(function (s) {
      if (before || s === w) { return; }
      var sp = panelPos_(s.getAttribute('data-panel')); if (sp && sp.idx > pos.idx) { before = s; }
    });
    col.insertBefore(w, before);
  });
}
// Kollapsbara moduler (board-delat vz_panel_collapsed). Fäll ihop till bara rubriken → mindre scroll-vägg.
var COLLAPSED = {};
function loadPanelCollapsed() {
  return t.get('board', 'shared', 'vz_panel_collapsed').then(function (a) {
    COLLAPSED = {}; (Array.isArray(a) ? a : []).forEach(function (k) { COLLAPSED[k] = true; }); return COLLAPSED;
  }).catch(function () { COLLAPSED = {}; return COLLAPSED; });
}
function savePanelCollapsed_() {
  var host = vzRegion('below'); if (!host) { return; }
  var keys = [].map.call(host.querySelectorAll('.vz-panel-wrap.is-collapsed[data-panel]'), function (w) { return w.getAttribute('data-panel'); });
  COLLAPSED = {}; keys.forEach(function (k) { COLLAPSED[k] = true; });
  try { t.set('board', 'shared', 'vz_panel_collapsed', keys).catch(function () {}); } catch (e) {}
}
function makeWrap_(sec, key) {
  var wrap = document.createElement('div');
  wrap.className = 'vz-panel-wrap'; wrap.setAttribute('data-panel', key); wrap.setAttribute('draggable', 'false');
  if (COLLAPSED[key]) { wrap.classList.add('is-collapsed'); }
  var grip = document.createElement('span');
  grip.className = 'vz-panel-drag'; grip.title = 'Dra för att flytta modulen'; grip.setAttribute('aria-label', 'Flytta modul'); grip.textContent = '⠿';
  var chev = document.createElement('button');
  chev.className = 'vz-panel-collapse'; chev.type = 'button'; chev.title = 'Fäll ihop / expandera'; chev.setAttribute('aria-label', 'Fäll ihop modul'); chev.textContent = '▾';
  chev.addEventListener('click', function () { wrap.classList.toggle('is-collapsed'); savePanelCollapsed_(); });
  wrap.appendChild(grip); wrap.appendChild(chev); wrap.appendChild(sec);
  grip.addEventListener('mousedown', function () { wrap.setAttribute('draggable', 'true'); });
  var reset = function () { wrap.setAttribute('draggable', 'false'); };
  wrap.addEventListener('dragstart', function (e) { wrap.classList.add('is-dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); } catch (x) {} });
  wrap.addEventListener('dragend', function () { wrap.classList.remove('is-dragging'); reset(); savePanelLayout_(); });
  document.addEventListener('mouseup', reset);
  return wrap;
}
// Wrappa + sätt in i rätt kolumn enligt sparad layout. Ny/okänd → kortare kolumnen (balansera).
function placeBelowPanel(sec, key) {
  var cols = belowCols_(); if (!cols) { return; }
  var dup = vzRegion('below').querySelector('.vz-panel-wrap[data-panel="' + key + '"]');
  if (dup && dup.parentNode) { dup.parentNode.removeChild(dup); }   // re-render-skydd: ingen dubblett
  var wrap = makeWrap_(sec, key);
  var pos = panelPos_(key);
  if (pos) {
    var col = cols[pos.col], before = null;
    [].slice.call(col.querySelectorAll('.vz-panel-wrap[data-panel]')).forEach(function (s) {
      if (before) { return; }
      var sp = panelPos_(s.getAttribute('data-panel')); if (sp && sp.idx > pos.idx) { before = s; }
    });
    col.insertBefore(wrap, before);
  } else {
    (cols[0].children.length <= cols[1].children.length ? cols[0] : cols[1]).appendChild(wrap);
  }
}
// Filtrera + rolla ett personalkort enligt board-reglerna. Returnerar {name,role} eller null.
function staffPerson(card, cfg) {
  var labelNames = (card.labels || []).map(function (l) { return l.name; });
  var role = cfg.defaultRole;
  if (cfg.filterLabels.length) {
    var hit = labelNames.filter(function (n) { return cfg.filterLabels.indexOf(n) !== -1; })[0];
    if (!hit) { return null; }            // måste ha en av filter-labels
    role = hit;                            // rollen = labelnamnet
  }
  var nm = String(card.name || '');
  if (cfg.excludeName.some(function (x) { return norm(nm).indexOf(x) !== -1; })) { return null; }
  var name = cleanStaffName(nm);
  return name ? { name: name, role: role } : null;
}
function loadStaff(courseName) {
  t.getRestApi().getToken().then(function (token) {
    if (!token) { return null; }
    return getOpenBoards_(token).then(function (boards) {
      boards = boards || [];
      var jobs = STAFF_BOARDS.map(function (cfg) {
        var b = boards.filter(function (bd) { return cfg.re.test(bd.name || ''); })[0];
        if (!b) { return Promise.resolve({ cfg: cfg, found: false, people: [] }); }
        return restGet(token, 'boards/' + b.id + '/lists?fields=name').then(function (lists) {
          var list = (lists || []).filter(function (l) { return sameCourse(l.name, courseName); })[0];
          if (!list) { return { cfg: cfg, found: true, list: null, people: [] }; }
          return restGet(token, 'lists/' + list.id + '/cards?fields=name,labels').then(function (cards) {
            var people = (cards || []).map(function (c) { return staffPerson(c, cfg); }).filter(Boolean);
            // Specialregel: översta assistenten är alltid Assistentledare.
            if (cfg.key === 'assistenter' && people.length) { people[0].role = 'Assistentledare'; }
            // Stash:a assistent-listans id så "Alla emailadresser" kan hämta desc skarpt.
            return { cfg: cfg, found: true, list: list.name, listId: list.id, people: people };
          });
        }).catch(function () { return { cfg: cfg, found: true, people: [] }; });
      });
      return Promise.all(jobs);
    });
  }).then(function (groups) { if (groups) { renderStaffPanel(groups, courseName); } }).catch(function () { /* tyst */ });
}
/* ---------- Layout-regioner: placera paneler i rätt del av vyn ----------
 * CourseView bygger namngivna regioner (.vz-region-aside / .vz-region-below).
 * vzRegion() returnerar rätt element; faller fail-soft tillbaka till .vz-course.
 */
function vzRegion(name) {
  if (window.CourseView && typeof window.CourseView.region === 'function') {
    var r = window.CourseView.region(name);
    if (r) { return r; }
  }
  return document.querySelector('.vz-course') || ROOT();
}

function renderStaffPanel(groups, courseName) {
  var emailsKey = 'vz_emails_' + courseSlug(courseName);
  // Total personal (gruppledare + assistenter + kockar) + kockens förnamn → matallergi-mejlet.
  STAFF_COUNT = (groups || []).reduce(function (n, g) { return n + ((g.people && g.people.length) || 0); }, 0);
  var kockGroup = (groups || []).filter(function (g) { return g.cfg.key === 'kockar'; })[0];
  KOCK_NAME = (kockGroup && kockGroup.people && kockGroup.people[0])
    ? ((kockGroup.people[0].name || '').trim().split(/\s+/)[0] || '') : '';
  COURSE_KOCK_NAMES = ((kockGroup && kockGroup.people) || []).map(function (p) { return p.name; }).filter(Boolean);
  var glGroup = (groups || []).filter(function (g) { return g.cfg.key === 'gruppledare'; })[0];
  var glPeople = (glGroup && glGroup.people) || [];
  COURSE_GL_NAMES = glPeople.map(function (p) { return p.name; }).filter(Boolean);
  COURSE_LEADERS = glPeople.slice();   // {name, role} → cc kursledare/bitr vid gruppledar-mejl
  // Malin var med på kursveckan = hon finns som "Vitaliseraperson på plats" i gruppledar-listan (Robert).
  MALIN_PRESENT = glPeople.some(function (p) { return p.role === 'Vitaliseraperson på plats' && /malin/i.test(p.name || ''); });
  var host = vzRegion('aside');
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.className = 'vz-panel vz-panel--aside';
  var cards = groups.map(function (g) {
    var body;
    if (!g.found) { body = '<div class="vz-panel-empty">Ingen board hittad</div>'; }
    else if (!g.people.length) { body = '<div class="vz-panel-empty">' + (g.list ? 'Inga tilldelade än' : 'Ingen kurslista hittad') + '</div>'; }
    else {
      var rows = g.people.map(function (p) {
        var roleTag = (p.role && p.role !== g.cfg.defaultRole) ? '<span class="vz-staff-role">' + esc(p.role) + '</span>' : '';
        return '<li class="vz-staff-row"><span class="vz-staff-name">' + esc(p.name) + '</span>' + roleTag + '</li>';
      }).join('');
      body = '<ul class="vz-staff-list">' + rows + '</ul>';
    }
    if (g.cfg.key === 'assistenter' && g.listId) { ASSIST_LIST_ID = g.listId; }  // för matallergi-hämtning
    if (g.cfg.key === 'kockar' && g.listId) { KOCK_LIST_ID = g.listId; }          // för "Skicka till kock"
    var extra = (g.cfg.key === 'assistenter' && g.people.length && g.listId)
      ? '<div class="vz-stub-row">'
        + '<button class="vz-btn" id="vz-asst-emails" data-listid="' + esc(g.listId) + '">Alla emailadresser</button>'
        + '<span class="vz-stub-note">läser korten skarpt (read-only)</span></div>'
        + '<textarea id="vz-asst-emails-out" class="vz-textarea" style="display:none" placeholder="E-postadresser…"></textarea>'
      : '';
    return '<div class="vz-staff-group">'
      + '<div class="vz-staff-grouphead">' + esc(g.cfg.label) + (g.people.length ? '<span class="vz-staff-badge">' + g.people.length + '</span>' : '') + '</div>'
      + body + extra + '</div>';
  }).join('');
  sec.innerHTML = '<div class="vz-panel-title">Personal på kursen</div>' + cards;
  host.appendChild(sec);

  // #14: fyll EGEN Personal-ruta i summary (siffra + underkategorier). Async, fail-soft.
  var staffCountEl = document.getElementById('vz-cv-staff-count');
  if (staffCountEl) { staffCountEl.textContent = STAFF_COUNT > 0 ? String(STAFF_COUNT) : '–'; }
  var staffEl = document.getElementById('vz-cv-staff');
  if (staffEl && STAFF_COUNT > 0) {
    var noun = { gruppledare: ['gruppledare', 'gruppledare'], assistenter: ['assistent', 'assistenter'], kockar: ['kock', 'kockar'] };
    var parts = (groups || []).map(function (g) {
      var n = (g.people && g.people.length) || 0;
      if (!n) { return null; }
      var nm = noun[g.cfg.key] || [g.cfg.label, g.cfg.label];
      return n + ' ' + (n === 1 ? nm[0] : nm[1]);
    }).filter(Boolean);
    staffEl.innerHTML = parts.map(esc).join(' · ');
  }

  // "Alla emailadresser": hämta assistent-listans kort med desc skarpt via REST,
  // extrahera mejl per kort, visa kommaseparerat i en kopierbar ruta. Read-only.
  var emBtn = sec.querySelector('#vz-asst-emails');
  var emOut = sec.querySelector('#vz-asst-emails-out');
  if (emOut) { persistTextareaSize_(emOut); }   // bild16: bevara höjd
  if (emBtn && emOut) {
    // Visa tidigare sparad lista direkt (överlever stäng/öppna).
    t.get('board', 'shared', emailsKey).then(function (saved) {
      if (saved && !emOut.value) { emOut.style.display = ''; emOut.value = String(saved); }
    }).catch(function () {});
    emBtn.addEventListener('click', function () {
      var listId = emBtn.getAttribute('data-listid');
      emBtn.disabled = true;
      emOut.style.display = ''; emOut.value = '⏳ Hämtar e-postadresser…';
      t.getRestApi().getToken().then(function (token) {
        if (!token) { throw new Error('Ingen Trello-token.'); }
        return restGet(token, 'lists/' + listId + '/cards?fields=name,desc');
      }).then(function (cards) {
        var uniq = dedupeEmailsCI_((cards || []).map(function (c) { return extractStaffEmail(c.desc); }).filter(Boolean));
        emOut.value = uniq.length ? uniq.join(', ') : 'Inga e-postadresser hittades i assistentkortens beskrivningar.';
        if (uniq.length) { persistText(emailsKey, emOut.value); }   // spara så det överlever stäng/öppna
      }).catch(function (err) {
        emOut.value = '⚠️ ' + err.message;
      }).then(function () { emBtn.disabled = false; });
    });
  }
}

// #17b: "Alla emailadresser" för DELTAGARNA som SISTA RAD i deltagartabellen (Robert 2026-06-16 —
// en below-panel knuffade om disposition; en tfoot-rad ligger i tabellen och överlever sortering/sök
// (paintBody rör bara tbody)). Deltagar-mejlen finns i kortens desc → parseContactFromDesc; ingen extra REST.
function renderParticipantEmails(cards, courseName) {
  var table = document.querySelector('.vz-cv-table[data-cv-table]') || document.querySelector('.vz-cv-table');
  if (!table) { return; }
  var emailsKey = 'vz_pemails_' + courseSlug(courseName);
  var old = table.querySelector('tfoot.vz-cv-emailfoot');   // idempotent
  if (old) { old.parentNode.removeChild(old); }
  var tfoot = document.createElement('tfoot');
  tfoot.className = 'vz-cv-emailfoot';
  tfoot.innerHTML = '<tr><td colspan="99">'
    + '<div class="vz-cv-emailrow">'
    + '<button class="vz-btn" id="vz-part-emails">Alla emailadresser</button>'
    + '<button class="vz-btn vz-btn--send" id="vz-part-emails-copy" style="display:none">Kopiera</button>'
    + '<span class="vz-stub-note">deltagarnas mejl ur korten (read-only)</span>'
    + '</div>'
    + '<textarea id="vz-part-emails-out" class="vz-textarea" style="display:none" placeholder="E-postadresser…"></textarea>'
    + '</td></tr>';
  table.appendChild(tfoot);

  var btn = tfoot.querySelector('#vz-part-emails');
  var out = tfoot.querySelector('#vz-part-emails-out');
  var copyBtn = tfoot.querySelector('#vz-part-emails-copy');
  if (out) { persistTextareaSize_(out); }   // bild16: bevara höjd
  if (!btn || !out) { return; }
  function showCopy(has) { if (copyBtn) { copyBtn.style.display = has ? '' : 'none'; } }
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      copyTextToClipboard(out.value).then(function (okc) {
        var o = copyBtn.textContent; copyBtn.textContent = okc ? '✓ Kopierat' : '⚠️ Kunde ej kopiera';
        setTimeout(function () { copyBtn.textContent = o; }, 2000);
      });
    });
  }
  t.get('board', 'shared', emailsKey).then(function (saved) {
    if (saved && !out.value) { out.style.display = ''; out.value = String(saved); showCopy(true); }
  }).catch(function () {});
  btn.addEventListener('click', function () {
    out.style.display = '';
    var uniq = dedupeEmailsCI_((cards || []).map(function (c) { return parseContactFromDesc(c.desc).epost; }).filter(Boolean));
    out.value = uniq.length ? uniq.join(', ') : 'Inga e-postadresser hittades i deltagarkortens beskrivningar.';
    if (uniq.length) { persistText(emailsKey, out.value); }
    showCopy(uniq.length > 0);
  });
}

/* ---------- Kursnivå-checklista (#3) — GLOBAL per kurssteg (Malins beslut) ----------
 * Delas över alla kursomgångar; Steg 1/2/3A har varsin lista. Lagras board-shared.
 */
function courseKey(name) {
  var m = String(name || '').match(/steg\s*([0-9a-zåäö]+)/i);
  var steg = m ? norm(m[1]) : 'global';
  return 'vz_chk_steg_' + steg;
}
// Per-kursinstans-slug (olika omgångar = olika nyckel) — för cachade textfält.
function courseSlug(name) { return norm(name).replace(/[^a-z0-9]+/g, '_'); }
// Liten persist-helper för enkla textfält (board-shared pluginData).
function persistText(key, value) { try { t.set('board', 'shared', key, value).catch(function () {}); } catch (e) {} }
var DEFAULT_TODOS = ['Ordna kock', 'Inköp inför kurs', 'Tilldela livsberättelser till gruppledare', 'Full assistentgrupp'];
function loadCourseChecklist(courseName) {
  var key = courseKey(courseName);
  t.get('board', 'shared', key).then(function (items) {
    if (!Array.isArray(items)) { items = DEFAULT_TODOS.map(function (x) { return { text: x, done: false }; }); }
    renderChecklistPanel(key, items, courseName);
  }).catch(function () {
    renderChecklistPanel(key, DEFAULT_TODOS.map(function (x) { return { text: x, done: false }; }), courseName);
  });
}
function persistChecklist(key, items) { try { t.set('board', 'shared', key, items).catch(function () {}); } catch (e) {} }
function renderChecklistPanel(key, items, courseName) {
  var host = vzRegion('below');
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.className = 'vz-panel vz-panel--below';
  // bild15: per-item deadline (dagar innan kursstart) + datum-cell. Deadline = kursstart − item.days.
  // Datum rött om passerat; Idag/Imorgon/Igår för ±1 dag. item.days lagras i items[] (board-shared).
  function dateCellHtml(days) {
    if (days === '' || days == null) { return '<span class="vzchk-date vzchk-date--empty">–</span>'; }
    var info = deadlineDateInfo(courseName, days);
    if (!info) { return '<span class="vzchk-date vzchk-date--empty" title="kunde ej tolka kursdatum">?</span>'; }
    return '<span class="vzchk-date' + (info.passed ? ' is-passed' : '') + (info.today ? ' is-today' : '') + '">' + esc(info.label) + '</span>';
  }
  function paint() {
    var done = items.filter(function (i) { return i.done; }).length;
    var rows = items.map(function (it, idx) {
      var days = (it.days == null ? '' : it.days);
      return '<div data-i="' + idx + '" class="vzchk-row' + (it.done ? ' is-done' : '') + '">'
        + '<label class="vzchk-main"><input type="checkbox" data-i="' + idx + '"' + (it.done ? ' checked' : '') + ' class="vzchk-box">'
        + '<span class="vzchk-text">' + esc(it.text) + '</span></label>'
        + '<span class="vzchk-days"><input type="number" min="0" class="vzchk-daysinp" data-i="' + idx + '" value="' + esc(String(days)) + '" placeholder="–" aria-label="Deadline i dagar innan kursstart"><span class="vzchk-days-u">dgr</span></span>'
        + '<span class="vzchk-datecell" data-date="' + idx + '">' + dateCellHtml(days) + '</span>'
        + '<button data-del="' + idx + '" title="Ta bort" class="vzchk-del">✕</button>'
        + '</div>';
    }).join('');
    sec.innerHTML = '<div class="vz-panel-head">'
      + '<div class="vz-panel-title">Kurschecklista</div>'
      + '<div class="vz-panel-meta">' + done + '/' + items.length + ' klara · sparas automatiskt</div></div>'
      + '<div class="vzchk-collhead"><span class="vzchk-ch-task">Uppgift</span><span class="vzchk-ch-days">Deadline<small>dgr innan start</small></span><span class="vzchk-ch-date">Datum</span></div>'
      + '<div class="vzchk-list">' + rows + '</div>'
      + '<div class="vzchk-add-row">'
      + '<input id="vzchk-new" placeholder="Lägg till uppgift på kursnivå…" class="vz-input">'
      + '<button id="vzchk-add" class="vz-btn">Lägg till</button></div>';
    // checkbox-toggle (re-paint → datumceller räknas om)
    Array.prototype.forEach.call(sec.querySelectorAll('input.vzchk-box'), function (cb) {
      cb.addEventListener('change', function () { items[+cb.getAttribute('data-i')].done = cb.checked; persistChecklist(key, items); paint(); });
    });
    // per-item deadline-dagar: live-uppdatera BARA den radens datumcell (ingen re-paint → behåll fokus), persist på change.
    Array.prototype.forEach.call(sec.querySelectorAll('input.vzchk-daysinp'), function (di) {
      var i = +di.getAttribute('data-i');
      di.addEventListener('input', function () {
        items[i].days = di.value === '' ? '' : di.value;
        var cell = sec.querySelector('[data-date="' + i + '"]');
        if (cell) { cell.innerHTML = dateCellHtml(items[i].days); }
      });
      di.addEventListener('change', function () { persistChecklist(key, items); });
    });
    // P2.4: 2-klicks-bekräftelse (board-delad lista = lätt att råka radera). 1:a klick "armar"
    // (✕ → "Ta bort?"), återställs efter 3s; 2:a klick raderar. Ingen overlay, självständigt.
    Array.prototype.forEach.call(sec.querySelectorAll('button[data-del]'), function (b) {
      var armed = false, timer = null;
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (!armed) {
          armed = true; b.classList.add('is-arm'); b.textContent = 'Ta bort?';
          timer = setTimeout(function () { armed = false; b.classList.remove('is-arm'); b.textContent = '✕'; }, 3000);
          return;
        }
        if (timer) { clearTimeout(timer); }
        items.splice(+b.getAttribute('data-del'), 1); persistChecklist(key, items); paint();
      });
    });
    var add = sec.querySelector('#vzchk-add'), inp = sec.querySelector('#vzchk-new');
    function addItem() { var v = (inp.value || '').trim(); if (!v) { return; } items.push({ text: v, done: false }); persistChecklist(key, items); paint(); }
    add.addEventListener('click', addItem);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
  }
  paint();
  placeBelowPanel(sec, 'checklist');
}

/* ---------- HF-urval (#3): speglar kortets checklist-punkt (skriva senare) ----------
 * "Delat Hälsoformulär till läkare/kursledare" i kortets checklista = sanningskälla.
 * Läses här (read-only mirror). Skarp av/på-bockning kopplas via mutation senare.
 */
/* Länk ur kort-kommentar — regler från nya-zapier (Skicka formulär-flödet):
 * specifika markörer + dokument-URL (docs.google/zpr.io), EXKLUDERA drive-mapp.
 * zpr.io är short-URL som redirectar till dokumentet → fungerar som klickbar länk.
 * Trello returnerar commentCard nyast först → första matchen = senaste länken.
 */
var HF_LINK_RES = [
  /l[äa]nk till h[äa]lsoformul[äa]ret:\s*(?:\[[^\]]*\]\()?(https?:\/\/[^\s)\]"]+)/i,
  /h[äa]lsoformul[äa]r[^:]*:\s*(?:\[[^\]]*\]\()?(https:\/\/(?:zpr\.io|docs\.google\.com)[^\s)\]"]+)/i,
];
var STORY_LINK_RES = [
  /livsber[äa]ttelse[^:]*:\s*(?:\[[^\]]*\]\()?(https:\/\/(?:zpr\.io|docs\.google\.com)[^\s)\]"]+)/i,
  /nul[äa]gesbeskriv[^:]*:\s*(?:\[[^\]]*\]\()?(https:\/\/(?:zpr\.io|docs\.google\.com)[^\s)\]"]+)/i,
  /\*\*livsber[äa]ttelse:\*\*\s*(https?:\/\/[^\s)\]"]+)/i,
  // Steg-formulär-doket (livsberättelse-MOTSVARIGHETEN per kurssteg): nya-zapier postar "Länk till Steg 3A-formuläret: <url>"
  // (3A = "Du och dina relationer", även Steg 3B). Kräver "steg X" → matchar EJ "Hälsoformuläret". (Robert 2026-06-21, verifierat mot Actions_Step3AForm.js.)
  /l[äa]nk till steg\s*[0-9a-zåäö]+\s*[-–]?\s*formul[äa]ret[^:]*:\s*(?:\[[^\]]*\]\()?(https?:\/\/[^\s)\]"]+)/i,
  /du och dina relationer[^:]*:\s*(?:\[[^\]]*\]\()?(https?:\/\/[^\s)\]"]+)/i,
];
function isFolderUrl(u) { return /drive\.google\.com\/drive\/folders/i.test(u || ''); }
function commentLink(card, regexes) {
  var acts = card.actions || [];
  for (var i = 0; i < acts.length; i++) {
    var txt = (acts[i].data && acts[i].data.text) || '';
    for (var j = 0; j < regexes.length; j++) {
      var m = txt.match(regexes[j]);
      if (m && m[1] && !isFolderUrl(m[1])) { return m[1]; }
    }
  }
  return null;
}
var HF_ITEM_RE = /h[äa]lsoformul[äa]r.*(l[äa]kare|kursledare)|(l[äa]kare|kursledare).*h[äa]lsoformul[äa]r/i;
function hfDoneForCard(card) {
  var done = false, exists = false, id = null;
  (card.checklists || []).forEach(function (cl) {
    (cl.checkItems || []).forEach(function (it) {
      if (HF_ITEM_RE.test(it.name || '')) { exists = true; id = it.id; if (norm(it.state) === 'complete') { done = true; } }
    });
  });
  return { exists: exists, done: done, id: id };
}

/* ---------- #11 Dokumentstatus (Fas 1, READ-ONLY): skanna HF + livsberättelse via GAS ----------
 * Per kort: HF-länk + livsberättelse-länk ur kommentarerna → GAS courseDocStatus skannar (% besvarat,
 * tecken, bild via Docs-API). Resultatet injiceras i MATRISENS steg 8/9-celler (hf_klart/livs_klar) via
 * CourseView.applyDocStatus (Robert 2026-06-17: i deltagartabellen, ej egen tabell). Chunkar parallellt
 * (6/grupp) mot timeout + fyller progressivt. Auto-bockning = Fas 2 m. Robert.
 */
// Luckor (Robert 2026-06-21): ett 'gap'-steg = trigger-labeln satt (handlingen gjord/bekräftad, t.ex. "Anm. avgift
// betald") men checkItem:et ej bockat. Att stänga luckan = bocka för att matcha labeln. Verifierat säkert för alla
// gap-bara steg (tack/antagen/avgift/steg1). Samma write som manuell bock; Malin bekräftar i dialog.
function computeGapBocks(cards) {
  var flow = window.NYA_ZAPIER_FLOW || [];
  var na = courseHasUppfoljning(COURSE_NAME) ? null : { uppfoljning: true };
  var out = [];
  (cards || []).forEach(function (c) {
    var d = statusForCard(c, na);
    flow.forEach(function (s) {
      if (d.status[s.key] !== 'gap') { return; }
      var ci = findCheckItemByName_(c, s.checkItem);
      if (!ci || !ci.id || ci.complete) { return; }   // checkItem saknas/redan bockad → kan ej/behöver ej stängas
      var title = (s.key === 'steg1') ? (courseStegDisplay(COURSE_NAME) + ' – formulär') : s.title;
      out.push({ cardId: c.id, checkItemId: ci.id, stepKey: s.key, stepTitle: title, cardName: (c.name || '').replace(/^\s*\d+\s*[-–]\s*/, '') });
    });
  });
  return out;
}
function offerGapClose(cards) {
  var gaps = computeGapBocks(cards);
  if (!gaps.length) { try { t.alert({ message: 'Inga öppna luckor att stänga just nu.', duration: 5, display: 'info' }); } catch (e) {} return; }
  var lines = gaps.map(function (g) { return '• ' + g.cardName + ' — ' + g.stepTitle; }).join('\n');
  courseInModalConfirm(
    gaps.length + ' öppna luckor kan stängas (labeln är satt men checkrutan inte bockad — handlingen är gjord, bara bocken saknas):\n\n' + lines + '\n\nBocka dessa checkrutor i Trello-korten?',
    'Stäng luckorna',
    function () {
      t.getRestApi().getToken().then(function (token) {
        if (!token) { try { t.alert({ message: 'Ingen Trello-token — kunde inte stänga. Försök igen.', duration: 8, display: 'error' }); } catch (e) {} return; }
        var doneN = [], failN = [];
        gaps.reduce(function (p, g) {
          return p.then(function () {
            return restWrite(token, 'PUT', 'cards/' + g.cardId + '/checkItem/' + g.checkItemId + '?state=complete')
              .then(function () { doneN.push(g); try { if (window.CourseView && CourseView.setCellStatus) { CourseView.setCellStatus(g.cardId, g.stepKey, 'done'); } } catch (e) {} })
              .catch(function () { failN.push(g.cardName + ' (' + g.stepTitle + ')'); });
          });
        }, Promise.resolve()).then(function () {
          var msg = doneN.length ? '✓ Stängde ' + doneN.length + ' luckor.' : '';
          if (failN.length) { msg += (msg ? ' ' : '') + '⚠️ ' + failN.length + ' kunde inte bockas — bocka manuellt: ' + failN.join(', ') + '.'; }
          try { t.alert({ message: msg, duration: failN.length ? 13 : 7, display: failN.length ? 'warning' : 'success' }); } catch (e) {}
        });
      }).catch(function () {});
    },
    { cancelText: 'Inte nu' }
  );
}
// Färgkoda deltagar-namnen efter dok-status (klart/del/ej) + tooltip %/bild. Generell över livsberättelse-matrisen
// (data-doc-kind=livs) OCH HF→läkare-panelen (kind=hf). Anropas när DOC_BYKEY uppdateras (progressivt). Robert 2026-06-21.
function applyDocNameColors_() {
  Array.prototype.forEach.call(document.querySelectorAll('[data-doc-pk]'), function (el) {
    var kind = el.getAttribute('data-doc-kind') === 'hf' ? 'hf' : 'livs';
    var st = (DOC_BYKEY[el.getAttribute('data-doc-pk')] || {})[kind];
    el.classList.remove('is-doc-done', 'is-doc-part', 'is-doc-none');
    if (!st || st.loading || st.ok !== true) { return; }   // okänt/ej skannat → neutral
    el.classList.add(st.ready ? 'is-doc-done' : (st.pct > 0 ? 'is-doc-part' : 'is-doc-none'));
    var label = kind === 'hf' ? 'Hälsoformulär' : livsLabelForCourse(COURSE_NAME);
    el.setAttribute('title', label + ': ' + st.filled + '/' + st.total + ' besvarat'
      + (st.chars ? ', ' + groupNum_(st.chars) + ' tecken' : '')
      + (kind === 'livs' ? (st.hasImage ? ', bild ✓' : ', bild saknas') : '')
      + (st.ready ? ' · klart' : ' · ej klart'));
  });
}
function loadDocStatus(courseName, cards) {
  var withDocs = (cards || []).map(function (c) {
    return { key: c.id, hfUrl: commentLink(c, HF_LINK_RES), livsUrl: commentLink(c, STORY_LINK_RES) };
  }).filter(function (it) { return it.hfUrl || it.livsUrl; });
  if (!withDocs.length) { return; }

  // visa ⏳ i steg 8/9-cellerna direkt (skanning kan ta ~10-30s första gången, sedan cachat)
  DOC_BYKEY = {}; var byKey = DOC_BYKEY;   // modul-mappen följer den levande byKey (progressiv ifyllning syns i inline-detaljen)
  withDocs.forEach(function (it) { byKey[it.key] = { hf: it.hfUrl ? { loading: true } : null, livs: it.livsUrl ? { loading: true } : null }; });
  if (window.CourseView && CourseView.applyDocStatus) { CourseView.applyDocStatus(byKey); }

  var CHUNK = 6, chunks = [];
  for (var i = 0; i < withDocs.length; i += CHUNK) { chunks.push(withDocs.slice(i, i + CHUNK)); }
  Promise.all(chunks.map(function (grp) {
    return postToGas('courseDocStatus', { items: grp })
      .then(function (data) {
        ((data && data.items) || []).forEach(function (r) { byKey[r.key] = r; });
        if (window.CourseView && CourseView.applyDocStatus) { CourseView.applyDocStatus(byKey); }  // progressiv ifyllning
        applyDocNameColors_();   // färgkoda gruppledar-matrisens namn när dok-status kommer
      })
      .catch(function () { /* en chunk kan fela — övriga fyller ändå */ });
  })).then(function () { maybeAutoBock(cards, byKey); });   // #11 Fas 2: bocka färdiga steg 8/9
}

/* #11 Fas 2: AUTO-BOCKA steg 8/9 när dokumentet är färdigt (ready = ≥85%, livs även bild).
 * Skriver checkItem complete via Malins token — SAMMA write som manuell bock (steg utan prod-automation).
 * SÄKERHET: idempotent (hoppar redan bockade), fail-closed test-läge (skriver BARA om testMode===false),
 * per-kort-felisolering, transparent toast. computeAutoBocks är ren → proof-testad. */
function flowCheckItem_(key) { var f = (window.NYA_ZAPIER_FLOW || []).filter(function (s) { return s.key === key; })[0]; return f ? f.checkItem : null; }
// Härdad matchning (granskning 2026-06-18): resultatet matas RAKT in i skarp checkItem-PUT (auto-bock, praktisk
// steg 7, inlineTick) → en felmatch bockar fel ruta (delvis irreversibelt). Prioritet: 1) EXAKT vinner alltid,
// 2) kortets punkt INNEHÅLLER hela målnamnet (säker riktning), 3) sista utväg reverse + ≥6 tecken (undvik korta falska).
function findCheckItemByName_(card, name) {
  if (!name) { return null; }
  var n = norm(name), exact = null, contains = null, loose = null;
  (card.checklists || []).forEach(function (cl) {
    (cl.checkItems || []).forEach(function (it) {
      var inm = norm(it.name || ''); if (!inm) { return; }
      var hit = { id: it.id, complete: norm(it.state) === 'complete' };
      if (inm === n) { if (!exact) { exact = hit; } }
      else if (inm.indexOf(n) !== -1) { if (!contains) { contains = hit; } }
      else if (inm.length >= 6 && n.indexOf(inm) !== -1) { if (!loose) { loose = hit; } }
    });
  });
  return exact || contains || loose || null;
}
function computeAutoBocks(cards, byKey) {
  var steps = [{ stepKey: 'hf_klart', docKey: 'hf' }, { stepKey: 'livs_klar', docKey: 'livs' }];
  var out = [];
  (cards || []).forEach(function (c) {
    var r = byKey && byKey[c.id];
    if (!r) { return; }
    steps.forEach(function (s) {
      var st = r[s.docKey];
      if (!st || st.ok !== true || !st.ready) { return; }            // bara FÄRDIGA dok
      var ci = findCheckItemByName_(c, flowCheckItem_(s.stepKey));
      if (!ci || !ci.id || ci.complete) { return; }                  // saknas/redan bockad → hoppa (idempotent)
      out.push({ cardId: c.id, checkItemId: ci.id, stepKey: s.stepKey,
        cardName: (c.name || '').replace(/^\s*\d+\s*[-–]\s*/, '') });
    });
  });
  return out;
}
function autoBockLabel_(stepKey) { return stepKey === 'livs_klar' ? livsLabelForCourse(COURSE_NAME) : 'Hälsoformulär'; }   // steg-medveten (3A → "Du och dina relationer")
// Robert 2026-06-21: ingen TYST auto-bock + ingen fly-by-toast. Visa en STÄNGBAR dialog som NAMNGER vilka deltagares
// dokument är färdiga + låt Malin bekräfta innan något bockas i Trello. Testläge → info-dialog (bockar ej).
function maybeAutoBock(cards, byKey) {
  var bocks;
  try { bocks = computeAutoBocks(cards, byKey); } catch (e) { return; }
  if (!bocks.length) { return; }
  var lines = bocks.map(function (b) { return '• ' + b.cardName + ' — ' + autoBockLabel_(b.stepKey); }).join('\n');
  getCourseSettings().then(function (settings) {
    if (!resolveSendMode(settings).live) {   // FAIL-CLOSED: bocka ej i testläge — bara informera (namngivet)
      courseInModalConfirm(
        bocks.length + ' deltagares dokument är färdiga:\n\n' + lines + '\n\n(Testläge — markeras EJ automatiskt. Slå av testläget i Inställningar för att markera dem klara.)',
        'OK', function () {}, { hideCancel: true }
      );
      return;
    }
    courseInModalConfirm(
      bocks.length + ' deltagares dokument är färdiga och kan markeras klara:\n\n' + lines + '\n\nMarkera dessa steg som klara i Trello-korten?',
      'Markera klara',
      function () {
        t.getRestApi().getToken().then(function (token) {
          if (!token) { try { t.alert({ message: 'Ingen Trello-token — kunde inte markera. Försök igen.', duration: 8, display: 'error' }); } catch (e) {} return; }
          var doneN = [], failN = [];
          bocks.reduce(function (p, b) {
            return p.then(function () {
              return restWrite(token, 'PUT', 'cards/' + b.cardId + '/checkItem/' + b.checkItemId + '?state=complete')
                .then(function () { doneN.push(b.cardName + ' (' + autoBockLabel_(b.stepKey) + ')'); })
                .catch(function () { failN.push(b.cardName + ' (' + autoBockLabel_(b.stepKey) + ')'); });
            });
          }, Promise.resolve()).then(function () {
            var msg = doneN.length ? '✓ Markerade ' + doneN.length + ' klara.' : '';
            if (failN.length) { msg += (msg ? ' ' : '') + '⚠️ ' + failN.length + ' kunde inte markeras — bocka manuellt i kortet: ' + failN.join(', ') + '.'; }
            try { t.alert({ message: msg, duration: failN.length ? 13 : 7, display: failN.length ? 'warning' : 'success' }); } catch (e) {}
          });
        }).catch(function () {});
      },
      { cancelText: 'Inte nu' }
    );
  });
}

/* ---------- Praktisk info-utskick (PDF-bilaga per deltagare, bockar steg 7 "Praktisk info skickat") ----------
 * Mall + kurs-Tokens → PDF (GAS createPracticalInfoDoc). Mejl per deltagare (GAS sendPracticalInfo, fail-closed).
 * Batch = alla som ej fått (steg 7 obockat). Enstaka = en rad / fold-out-knapp. Steg 7 bockas BARA vid live+lyckat. */
function loadPracticalInfoPanel(cards, courseName) {
  var ciName = flowCheckItem_('praktisk');   // "Praktisk info skickat"
  var rows = (cards || []).map(function (c, i) {
    var ci = findCheckItemByName_(c, ciName);
    return {
      code: 'P' + (i + 1), name: (c.name || '').replace(/^\s*\d+\s*[-–]\s*/, ''),
      email: parseContactFromDesc(c.desc).epost || '',
      cardId: c.id, checkItemId: ci ? ci.id : null, done: !!(ci && ci.complete),
    };
  });
  renderPracticalInfoPanel(rows, courseName);
}
function practicalRowAction_(r) {
  if (!r.email) { return '<span class="vz-status vz-status--missing">– e-post saknas i kortet</span>'; }
  if (!r.checkItemId) { return '<span class="vz-status vz-status--missing">– "Praktisk info skickat" saknas i checklistan</span>'; }
  if (r.done) { return '<button class="vz-hf-share is-done" disabled>✓ Skickad</button>'; }
  // skickad men steg 7-bock misslyckades → re-skicka EJ (dubbel-utskick), uppmana manuell bock
  if (r.sentNoBock) { return '<span class="vz-status" style="color:var(--amber)" title="Mejlet är skickat men steg 7 kunde inte bockas automatiskt">✓ Skickad · bocka steg 7 manuellt</span>'; }
  return '<button class="vz-hf-share vz-pi-send" data-code="' + esc(r.code) + '">Skicka</button>';
}
function renderPracticalInfoPanel(rows, courseName) {
  var host = vzRegion('below');
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.className = 'vz-panel vz-panel--below';
  var byCode = {}; rows.forEach(function (r) { byCode[r.code] = r; });
  var tokens = practicalTokens(courseName);
  function pending() { return rows.filter(function (r) { return r.email && r.checkItemId && !r.done && !r.sentNoBock; }); }
  function paint() {
    var done = rows.filter(function (r) { return r.done; }).length;
    var sendable = rows.filter(function (r) { return r.email && r.checkItemId; }).length;
    var nPending = pending().length;
    var bodyRows = rows.map(function (r) {
      return '<tr data-code="' + esc(r.code) + '"><td class="vz-tbl-namecell"><span class="vz-tbl-name">' + esc(r.name) + '</span>'
        + (r.email ? '<span class="vz-pi-email">' + esc(r.email) + '</span>' : '') + '</td>'
        + '<td class="vz-tbl-statuscell">' + practicalRowAction_(r) + '</td></tr>';
    }).join('');
    var table = rows.length
      ? '<table class="vz-tbl vz-tbl--hf"><colgroup><col class="vz-col-name"><col class="vz-col-status"></colgroup><tbody>' + bodyRows + '</tbody></table>'
      : '<div class="vz-panel-empty">Inga deltagare.</div>';
    sec.innerHTML = '<div class="vz-panel-head"><div class="vz-panel-title">Praktisk information till deltagare</div>'
      + '<div class="vz-panel-meta">' + done + ' av ' + sendable + ' skickade</div></div>'
      + '<div class="vz-panel-note">Skickar den <a id="vz-pi-doclink" class="vz-tbl-link" href="#" title="Öppna dokumentet (skapas om det inte finns)">kursgemensamma praktiska informationen <span class="vz-ext">↗</span></a> som <b>PDF-bilaga</b> per deltagare och bockar steg 7 "Praktisk info skickat". Verifiera kursdatumen nedan innan du skickar.</div>'
      + '<div class="vz-pi-tokens"><span>Kursdatum: <b>' + esc(tokens.KURSDATUM || '–') + '</b></span>'
      + '<span>Start: <b>' + esc((tokens.STARTDAG || '–') + (tokens.STARTTID ? ' kl. ' + tokens.STARTTID : '')) + '</b></span>'
      + '<span>Slut: <b>' + esc(tokens.SLUTDAG || '–') + '</b></span></div>'
      + table
      + '<div class="vz-stub-row" style="margin-top:12px"><button class="vz-btn" id="vz-pi-batch"' + (nPending ? '' : ' disabled') + '>Skicka till alla som inte fått (' + nPending + ')</button>'
      + '<span class="vz-stub-note">skapar/återanvänder kurs-PDF:en, mejlar per deltagare (fail-closed i testläge), bockar steg 7</span></div>';
    Array.prototype.forEach.call(sec.querySelectorAll('.vz-pi-send'), function (btn) {
      btn.addEventListener('click', function () { var r = byCode[btn.getAttribute('data-code')]; if (r) { sendPracticalInfoFlow([r], courseName, btn, 'enstaka', onSent); } });
    });
    var batch = sec.querySelector('#vz-pi-batch');
    if (batch) { batch.addEventListener('click', function () { sendPracticalInfoFlow(pending(), courseName, batch, 'alla som inte fått', onSent); }); }
    // doc-länk: öppna praktisk info-dokumentet (skapas idempotent om det inte finns — INGET mejl, bara Doc/Drive).
    var docLink = sec.querySelector('#vz-pi-doclink');
    if (docLink) {
      docLink.addEventListener('click', function (e) {
        e.preventDefault();
        if (docLink.dataset.busy) { return; }
        docLink.dataset.busy = '1'; var orig = docLink.innerHTML; docLink.textContent = '⏳ öppnar dokumentet…';
        postToGas('createPracticalInfoDoc', { dryRun: false, courseName: courseName, tokens: practicalTokens(courseName) }).then(function (r) {
          docLink.innerHTML = orig; delete docLink.dataset.busy;
          if (r && r.ok && r.url) { docLink.setAttribute('href', r.url); docLink.setAttribute('target', '_blank'); docLink.setAttribute('rel', 'noopener'); window.open(r.url, '_blank'); }
          else {
            var err = (r && r.error) || 'okänt fel';
            var msg = err === 'course_folder_not_found' ? 'Hittar ingen kursmapp för "' + courseName + '" — dokumentet kan inte skapas än.'
              : err === 'tokens_missing' ? 'Kursdatumen kunde inte tolkas ur kursnamnet — dokumentet kan inte fyllas.'
              : 'Kunde inte öppna/skapa dokumentet: ' + err;
            try { t.alert({ message: '⚠️ ' + msg, duration: 9, display: 'error' }); } catch (e2) {}
          }
        }).catch(function (er) { docLink.innerHTML = orig; delete docLink.dataset.busy; try { t.alert({ message: '⚠️ ' + ((er && er.message) || er), duration: 8, display: 'error' }); } catch (e2) {} });
      });
    }
  }
  // efter lyckat live-utskick: markera raderna som skickade (in-place) + uppdatera matriscellen, utan full reload.
  function onSent(sentRows) {
    sentRows.forEach(function (r) { r.done = true; try { if (window.CourseView && CourseView.setCellStatus) { CourseView.setCellStatus(r.cardId, 'praktisk', 'done'); } } catch (e) {} });
    paint();
  }
  paint();
  placeBelowPanel(sec, 'praktisk');
}
/* Orkestrering: bekräfta (visa tokens + läges-varning) → createPracticalInfoDoc → sendPracticalInfo → bocka steg 7
 * (BARA vid live + lyckat utskick; testläge redirectar och bockar INTE). onSent(rader[]) uppdaterar UI in-place. */
function sendPracticalInfoFlow(targets, courseName, btn, label, onSent) {
  targets = (targets || []).filter(function (r) { return r.email && r.checkItemId && !r.done && !r.sentNoBock; });
  if (!targets.length) { try { t.alert({ message: 'Inga mottagare som saknar utskick.', duration: 6, display: 'info' }); } catch (e) {} return; }
  getCourseSettings().then(function (settings) {
    var mode = resolveSendMode(settings);
    var tokens = practicalTokens(courseName);
    var tokenLines = 'Kursdatum: ' + (tokens.KURSDATUM || '–') + '\nStart: ' + (tokens.STARTDAG || '–') + ' kl. ' + tokens.STARTTID + '\nSlut: ' + (tokens.SLUTDAG || '–');
    var modeWarn = mode.live
      ? '⚠️ SKARPT LÄGE — PDF:en mejlas till ' + targets.length + ' RIKTIGA deltagare.'
      : 'TESTLÄGE — mejlen redirectas till ' + (mode.redirect || '(ingen redirect satt!)') + '. Inga deltagare nås, steg 7 bockas ej.';
    courseInModalConfirm(
      'Skicka praktisk information (' + label + ') till ' + targets.length + ' deltagare?\n\n' + tokenLines + '\n\n' + modeWarn + '\n\nVerifiera datumen ovan innan du skickar.',
      'Skicka', function () {
        if (!mode.live && !mode.redirect) { try { t.alert({ message: 'Testläge utan redirect-adress — sätt en i Inställningar. Inget skickades.', duration: 8, display: 'error' }); } catch (e) {} return; }
        var orig = btn.textContent; btn.disabled = true; btn.textContent = '⏳ Skapar dok…';
        postToGas('createPracticalInfoDoc', { dryRun: false, courseName: courseName, tokens: tokens }).then(function (doc) {
          if (!doc || !doc.ok || !doc.docId) { throw new Error('Kunde inte skapa PDF-underlaget (' + ((doc && doc.error) || 'okänt') + ').'); }
          btn.textContent = '⏳ Skickar…';
          return postToGas('sendPracticalInfo', {
            dryRun: false, live: mode.live === true, redirectEmail: mode.redirect, courseName: courseName, docId: doc.docId,
            recipients: targets.map(function (r) { return { code: r.code, email: r.email }; }),
            senderName: settings.senderName, replyTo: settings.replyTo,
          });
        }).then(function (res) {
          if (!res || !res.ok) { throw new Error('Utskick misslyckades (' + ((res && res.error) || 'okänt') + ').'); }
          var okCodes = {}; (res.sent || []).forEach(function (s) { if (s.ok) { okCodes[s.code] = true; } });
          var okTargets = targets.filter(function (r) { return okCodes[r.code]; });
          if (!res.live) {   // testläge: redirectat, bocka INTE (deltagaren fick inget)
            btn.disabled = false; btn.textContent = orig;
            try { t.alert({ message: 'Testläge: ' + okTargets.length + ' mejl gick till redirect (' + mode.redirect + '). Inga deltagare nåddes, steg 7 ej bockat.', duration: 10, display: 'info' }); } catch (e) {}
            return;
          }
          // live: bocka steg 7 för lyckade utskick (Malins token), seriellt. Spåra per deltagare (bockad vs skickad-men-ej-bockad).
          t.getRestApi().getToken().then(function (token) {
            if (!token) { throw new Error('Ingen Trello-token för att bocka steg 7.'); }
            var bocked = [], notBocked = [];
            return okTargets.reduce(function (p, r) {
              return p.then(function () {
                return restWrite(token, 'PUT', 'cards/' + r.cardId + '/checkItem/' + r.checkItemId + '?state=complete')
                  .then(function () { bocked.push(r); }).catch(function () { notBocked.push(r); });
              });
            }, Promise.resolve()).then(function () { return { bocked: bocked, notBocked: notBocked }; });
          }).then(function (rr) {
            btn.disabled = false; btn.textContent = orig;
            // mejlet ÄR skickat → markera ALLA okTargets så de aldrig dubbel-skickas; bockade=fullt klara, övriga=bocka manuellt.
            rr.notBocked.forEach(function (r) { r.sentNoBock = true; });
            if (onSent) { onSent(rr.bocked); }   // markera BARA bockade done; paint visar sentNoBock-rader distinkt
            var msg = '✓ Skickade praktisk info till ' + okTargets.length + ' deltagare'
              + (rr.notBocked.length ? '. ⚠️ ' + rr.notBocked.length + ' steg 7-bock misslyckades — bocka manuellt i korten (mejlen ÄR skickade, skicka INTE igen).' : ' och bockade steg 7.');
            try { t.alert({ message: msg, duration: rr.notBocked.length ? 13 : 9, display: rr.notBocked.length ? 'warning' : 'success' }); } catch (e) {}
          }).catch(function (err) {
            btn.disabled = false; btn.textContent = orig;
            okTargets.forEach(function (r) { r.sentNoBock = true; });   // mejlen gick, bock-steget kraschade → re-skicka ej
            if (onSent) { onSent([]); }
            try { t.alert({ message: '⚠️ Mejlen gick men steg 7 kunde inte bockas: ' + ((err && err.message) || err) + '. Bocka manuellt — skicka INTE igen.', duration: 12, display: 'error' }); } catch (e) {}
          });
        }).catch(function (err) {
          btn.disabled = false; btn.textContent = orig;
          try { t.alert({ message: '⚠️ ' + ((err && err.message) || err), duration: 10, display: 'error' }); } catch (e) {}
        });
      }
    );
  });
}

function loadHfPanel(cards, courseName) {
  var rows = (cards || []).map(function (c, i) {
    var hf = hfDoneForCard(c);
    return {
      code: 'P' + (i + 1), // anonym deltagarkod (skickas till GAS istället för namn)
      name: (c.name || '').replace(/^\s*\d+\s*[-–]\s*/, ''),
      exists: hf.exists, done: hf.done,
      cardId: c.id, checkItemId: hf.id,   // #18: skarp delning (PUT hf_delad → triggar "Kopiera HF till läkare")
      link: commentLink(c, HF_LINK_RES), // HF-dokumentlänk ur kommentar om den finns
    };
  });
  renderHfPanel(rows, courseName);
}
function renderHfPanel(rows, courseName) {
  var allergiKey = 'vz_allergi_' + courseSlug(courseName);
  // Kock-mejlmall: default ur config.js, override ur Inställningar (vz_settings.tpl_kock). Läses async → fallback tills den kommit.
  var kockTpl = (DEFAULT_TPL.kock || '');
  getCourseSettings().then(function (s) { if (s && s.tpl_kock) { kockTpl = s.tpl_kock; } }).catch(function () {});
  var host = vzRegion('below');
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.className = 'vz-panel vz-panel--below';
  var done = rows.filter(function (r) { return r.done; }).length;
  var sharable = rows.filter(function (r) { return r.exists && r.checkItemId; }).length;
  // #18: status-kolumnen → DELNINGS-knapp. Bockar "Delat Hälsoformulär till läkare/kursledare" = skapar den
  // anonyma kopian i läkarens mapp (prod-automation). Redan delad → disabled grön. Saknar checkItem → ingen åtgärd.
  var bodyRows = rows.map(function (r) {
    var nameHtml = r.link
      ? '<a href="' + esc(r.link) + '" target="_blank" rel="noopener" class="vz-tbl-link">' + esc(r.name) + ' <span class="vz-ext">↗</span></a>'
      : '<span class="vz-tbl-name">' + esc(r.name) + '</span>';
    var action;
    if (!r.exists || !r.checkItemId) {
      action = '<span class="vz-status vz-status--missing">– saknas i checklistan</span>';
    } else if (r.done) {
      action = '<button class="vz-hf-share is-done" disabled>✓ Läkarkopia skapad</button>';
    } else {
      action = '<button class="vz-hf-share" data-card="' + esc(r.cardId) + '" data-ci="' + esc(r.checkItemId) + '" data-name="' + esc(r.name) + '">Skapa läkarkopia</button>';
    }
    return '<tr><td class="vz-tbl-namecell" data-doc-pk="' + esc(r.cardId) + '" data-doc-kind="hf">' + nameHtml + '</td><td class="vz-tbl-statuscell">' + action + '</td></tr>';
  }).join('');
  var table = rows.length
    ? '<table class="vz-tbl vz-tbl--hf"><colgroup><col class="vz-col-name"><col class="vz-col-status"></colgroup>'
      + '<tbody>' + bodyRows + '</tbody></table>'
    : '<div class="vz-panel-empty">Inga deltagare.</div>';
  sec.innerHTML = '<div class="vz-panel-head">'
    + '<div class="vz-panel-title">Hälsoformulär till läkare</div>'
    + '<div class="vz-panel-meta">' + done + ' av ' + sharable + ' läkarkopior skapade</div></div>'
    + '<div class="vz-panel-note">Klicka <b>Skapa läkarkopia</b> för att skapa den anonymiserade kopian i läkarens mapp (bockar "Delat Hälsoformulär till läkare/kursledare"). Här avgör du vilka som går till läkaren. Dela sedan hela mappen till läkaren med knappen nedan. Namn med ↗ öppnar hälsoformuläret.</div>'
    + table
    + '<div class="vz-stub-row" style="margin-top:12px">'
    + '<button class="vz-btn" id="vz-hf-sharefolder">Dela mapp till läkare</button>'
    + '<span class="vz-stub-note">sätter läsrätt på mappen för läkarens e-post (Inställningar) — läkaren får en Google Drive-notis</span></div>';
  placeBelowPanel(sec, 'hf');
  applyDocNameColors_();   // initial HF-namn-färgning (om dok-status cachad); loadDocStatus uppdaterar progressivt

  // Matallergier = EGEN modul (Robert 2026-06-18: ej inbäddad i HF-panelen). Egen sektion, samma closures (rows/courseName/kockTpl).
  var allergiSec = document.createElement('section');
  allergiSec.className = 'vz-panel vz-panel--below';
  allergiSec.innerHTML = '<div class="vz-panel-head"><div class="vz-panel-title">Matallergier</div></div>'
    + '<div class="vz-panel-note">Läser hälsoformulär + assistentkort anonymiserat (koder, ej namn) och sammanställer ett mejl till kocken.</div>'
    + '<textarea id="vz-allergi" placeholder="Matallergier sammanställs här…" class="vz-textarea"></textarea>'
    + '<div class="vz-allergi-actions"><button class="vz-btn" id="vz-allergi-btn">Sammanställ matallergier</button>'
    + '<button class="vz-btn" id="vz-allergi-kock">Skicka till kock</button></div>'
    + '<div id="vz-allergi-info" class="vz-panel-note" style="display:none;margin-top:6px;color:#8a5a00"></div>'
    + '<div id="vz-allergi-kock-out" class="vz-panel-note" style="display:none"></div>';
  placeBelowPanel(allergiSec, 'allergi');

  // #18: per-rad "Skapa läkarkopia" (bockar hf_delad → anonym kopia i mappen). Bekräftelse + fail-closed test-läge + idempotent.
  Array.prototype.forEach.call(sec.querySelectorAll('.vz-hf-share[data-card]'), function (btn) {
    btn.addEventListener('click', function () { shareHfToDoctor(btn.getAttribute('data-card'), btn.getAttribute('data-ci'), btn.getAttribute('data-name'), btn); });
  });
  // #18: "Dela mapp till läkare" — sätter läsrätt på "HF till läkare - <kurs>" för läkarens e-post (Inställningar).
  var folderBtn = sec.querySelector('#vz-hf-sharefolder');
  if (folderBtn) { folderBtn.addEventListener('click', function () { shareDoctorFolder(courseName, folderBtn); }); }

  // ── Matallergier: skicka BARA koder + HF-länkar (inga namn) till GAS,
  //    ersätt koderna med riktiga namn lokalt i svaret.
  var allergiBtn = allergiSec.querySelector('#vz-allergi-btn');
  var allergiOut = allergiSec.querySelector('#vz-allergi');
  if (allergiOut) { persistTextareaSize_(allergiOut); }   // bild16: bevara höjd (guard i fitAllergi)
  var allergiInfo = allergiSec.querySelector('#vz-allergi-info');
  // Rutan växer med innehållet.
  function fitAllergi() { if (allergiOut && !vzTaHasSavedSize_(allergiOut)) { allergiOut.style.height = 'auto'; allergiOut.style.height = (allergiOut.scrollHeight + 4) + 'px'; } }
  if (allergiOut) {
    allergiOut.addEventListener('input', fitAllergi);
    // Visa tidigare sparad sammanställning direkt (överlever stäng/öppna).
    t.get('board', 'shared', allergiKey).then(function (saved) {
      if (saved && !allergiOut.value) { allergiOut.value = String(saved); fitAllergi(); }
    }).catch(function () {});
  }
  if (allergiBtn) {
    allergiBtn.addEventListener('click', function () {
      // Deltagare → kod Pn + HF-doklänk. Assistenter (egen lista) → kod An + anonymiserad desc.
      var items = [];
      var codeToName = {};
      rows.filter(function (r) { return r.link; }).forEach(function (r) {
        items.push({ code: r.code, url: r.link });
        codeToName[r.code] = r.name;
      });
      allergiBtn.disabled = true;
      allergiOut.value = '⏳ Hämtar underlag…';

      // Hämta assistentkortens beskrivning skarpt (read-only) och städa bort PII innan sändning.
      var asstP = ASSIST_LIST_ID
        ? t.getRestApi().getToken().then(function (token) {
            if (!token) { return []; }
            return restGet(token, 'lists/' + ASSIST_LIST_ID + '/cards?fields=name,desc');
          }).catch(function () { return []; })
        : Promise.resolve([]);

      Promise.all([asstP, fetchGroupLeaderAllergies()]).then(function (rr) {
        var cards = rr[0] || [], glAll = rr[1] || [];
        var aN = 0; // löpande A-kod-räknare (assistenter + gruppledare/VP)
        cards.forEach(function (c) {
          if (['assistenter', 'intresserad', 'status'].some(function (x) { return norm(c.name).indexOf(x) !== -1; })) { return; }
          var nm = cleanStaffName(c.name);
          var blob = stripStaffDescForAI(c.desc, nm);
          var code = 'A' + (++aN);
          // Hoppa INTE över tom beskrivning → alla assistenter räknas; tom = platshållare (flaggas oklar).
          items.push({ code: code, allergy: blob || '(inget angivet i kortet)' });
          codeToName[code] = nm;
        });
        // Gruppledar/VP-allergier ur "Matallergier Gruppledare/VP" (matchade mot kursens gruppledare).
        // Desc = hela allergitexten (enda texten i korten, Robert) → skickas rakt, ingen PII-städning.
        glAll.forEach(function (g) {
          var code = 'A' + (++aN);
          items.push({ code: code, allergy: g.allergy });
          codeToName[code] = g.name;
        });
        if (!items.length) {
          allergiOut.value = 'Inget underlag än: inga deltagare med hälsoformulär-länk och inga assistentkort.';
          allergiBtn.disabled = false;
          return;
        }
        allergiOut.value = '⏳ Läser ' + items.length + ' underlag (deltagare + personal) och sammanställer…';
        return postToGas('courseAllergies', { items: items }).then(function (data) {
          if (!data || data.ok !== true) {
            if (data && data.error === 'anthropic_key_missing') {
              allergiOut.value = '⚠️ Kan inte sammanställa: AI-nyckeln (ANTHROPIC_API_KEY) saknas i serverns inställningar.';
            } else {
              var detail = (data && data.detail) ? ' (' + data.detail + ')' : '';
              // 404/400 från Anthropic = modellen utfasad/okänd → tydlig vink, inte tyst fel.
              var hint = (data && /anthropic_http_(404|400)/.test(data.detail || ''))
                ? ' — AI-modellen verkar vara utfasad eller okänd; modell-ID:t behöver uppdateras i servern (Code.gs).' : '';
              allergiOut.value = '⚠️ Sammanställningen misslyckades: ' + ((data && data.error) || 'okänt fel') + detail + hint;
            }
            return;
          }
          // ── Malins mall: per person, FÖRNAMN, mejl-ramat. ──
          var raw = String(data.summary || '');
          var byCode = data.byCode || {};
          // Förnamn; kollision (samma förnamn på flera) → + efternamnsinitial ("Lena S").
          var firstCount = {};
          Object.keys(codeToName).forEach(function (code) {
            var fn = (codeToName[code] || '').trim().split(/\s+/)[0]; if (fn) { firstCount[fn] = (firstCount[fn] || 0) + 1; }
          });
          function displayFirst(code) {
            var toks = (codeToName[code] || '').trim().split(/\s+/); var fn = toks[0] || '';
            return (firstCount[fn] > 1 && toks.length > 1) ? (fn + ' ' + toks[toks.length - 1].charAt(0)) : fn;
          }
          function deanonFirst(s) {
            Object.keys(codeToName).forEach(function (code) { s = s.replace(new RegExp('\\b' + code + '\\b', 'g'), displayFirst(code)); });
            return s;
          }
          var pp = raw.split(/===\s*PERSONAL\s*===/i);
          var deltBody = deanonFirst((pp[0] || '').replace(/===\s*DELTAGARE\s*===/i, '').trim()) || 'Inga kända matallergier.';
          var persBody = deanonFirst((pp[1] || '').trim()) || 'Inga kända matallergier.';
          var dCount = rows.length;
          // Personal = ALL staff (gruppledare + assistenter + kockar) inkl. kocken (mottagaren).
          var pCount = STAFF_COUNT || items.filter(function (it) { return /^A/.test(it.code); }).length;
          var greeting = KOCK_NAME ? ('Hej ' + KOCK_NAME + ',') : 'Hej!';
          // Kock-mejlet ur mall (Inställningar → tpl_kock, annars config-default). Tokens fylls här.
          var mejl = applyTokens(kockTpl || DEFAULT_TPL.kock || '', {
            'HÄLSNING': greeting,
            'ANTAL_DELTAGARE': String(dCount),
            'ANTAL_PERSONAL': String(pCount),
            'DELTAGARE': deltBody,
            'PERSONAL': persBody,
          });
          allergiOut.value = mejl;
          persistText(allergiKey, mejl);
          // Oklar/saknat → SEPARAT info (medvetet EJ med i kock-mejlet).
          var oklar = [];
          Object.keys(byCode).forEach(function (code) {
            var v = String(byCode[code] || '');
            var reason = /ingen doc-länk/i.test(v) ? 'inget hälsoformulär länkat'
              : /(kunde ej läsas|läsfel)/i.test(v) ? 'formuläret kunde inte läsas'
              : /inget angivet i kortet/i.test(v) ? 'inget angivet i personalkortet'
              : /okänd/i.test(v) ? 'allergifrågan ej besvarad' : '';
            if (reason) { oklar.push((codeToName[code] || code) + ' – ' + reason); }
          });
          rows.filter(function (r) { return !r.link; }).forEach(function (r) { oklar.push(r.name + ' – saknar hälsoformulär'); });
          if (allergiInfo) {
            allergiInfo.style.display = oklar.length ? '' : 'none';
            allergiInfo.textContent = oklar.length ? ('Att kontrollera manuellt (ej med i mejlet): ' + oklar.join('; ')) : '';
          }
        });
      }).catch(function (err) {
        allergiOut.value = '⚠️ ' + err.message;
      }).then(function () { allergiBtn.disabled = false; fitAllergi(); });
    });
  }

  // ── Skicka till kock: riktig send via samma väg som gruppledar-mejlen (GAS, brandat, fail-closed,
  //    in-modal bekräftelse, admin-cc). Body = matallergi-sammanställningen (allergiOut). Malins knapptryck.
  var kockBtn = allergiSec.querySelector('#vz-allergi-kock');
  var kockOut = allergiSec.querySelector('#vz-allergi-kock-out');
  if (kockBtn && kockOut) {
    kockBtn.addEventListener('click', function () {
      var text = (allergiOut.value || '').trim();
      kockOut.style.display = '';
      if (!text || /^[⏳⚠]/.test(text)) {
        kockOut.textContent = 'Sammanställ matallergierna först (klicka "Sammanställ matallergier").';
        return;
      }
      runSendMail({
        kind: 'kock', btn: kockBtn, note: kockOut, emptyHint: '. Fyll i "Kontaktuppgifter kockar".',
        prepare: function () {
          return fetchKockContacts().then(function (contacts) {
            var names = COURSE_KOCK_NAMES.length ? COURSE_KOCK_NAMES : (KOCK_NAME ? [KOCK_NAME] : []);
            var tos = [], missing = [], seen = {};
            names.forEach(function (n) {
              var em = glContactEmail(n, contacts);
              if (em) { var k = em.toLowerCase(); if (!seen[k]) { seen[k] = true; tos.push(em); } }
              else { missing.push(n); }
            });
            return {
              emails: tos.length ? [{ to: tos.join(','), subject: 'Matallergier – ' + (courseName || 'kursen'), bodyHtml: plainToHtml(text), bodyText: text }] : [],
              missing: missing,
            };
          });
        },
      });
    });
  }

  // ── Skicka till läkare: dry-run förhandsvisning (inget skickas skarpt).
}

/* #18: skarp delning av ETT hälsoformulär till läkaren. Bockar hf_delad → prod-automationen "Kopiera HF
 * till läkare" skapar den anonyma kopian i läkarens mapp. IRREVERSIBEL hälsodata-delning → bekräftelse-dialog
 * (in-modal; t.popup funkar ej i fullscreen-modal) + FAIL-CLOSED test-läge (skriver bara om testMode===false)
 * + idempotent (redan-delade knappar är disabled). Samma write som Vy1:s gap-stängning. */
function shareHfToDoctor(cardId, checkItemId, name, btn) {
  if (!cardId || !checkItemId) { return; }
  courseInModalConfirm(
    'Skapa läkarkopian för ' + name + '?\n\nDetta bockar "Delat Hälsoformulär till läkare/kursledare", '
      + 'vilket skapar den anonymiserade kopian i läkarens mapp. Det kan inte ångras härifrån.',
    'Skapa läkarkopia',
    function () {
      getCourseSettings().then(function (settings) {
        if (!resolveSendMode(settings).live) {   // FAIL-CLOSED: skapa ej kopia i testläge/osäkert läge
          try { t.alert({ message: 'Testläge: skulle skapat läkarkopia för ' + name + ' (ingen ändring gjordes).', duration: 7, display: 'info' }); } catch (e) {}
          return;
        }
        var orig = btn.textContent;
        btn.disabled = true; btn.textContent = '⏳ Skapar…';
        t.getRestApi().getToken().then(function (token) {
          if (!token) { throw new Error('Ingen Trello-token — anslut Power-Up:en först.'); }
          return restWrite(token, 'PUT', 'cards/' + cardId + '/checkItem/' + checkItemId + '?state=complete');
        }).then(function () {
          btn.textContent = '✓ Läkarkopia skapad'; btn.classList.add('is-done');
          try { t.alert({ message: '✓ Skapade läkarkopia för ' + name + '.', duration: 7, display: 'success' }); } catch (e) {}
        }).catch(function (err) {
          btn.disabled = false; btn.textContent = orig;
          try { t.alert({ message: '⚠️ Kunde inte dela: ' + ((err && err.message) || err), duration: 8, display: 'error' }); } catch (e) {}
        });
      });
    }
  );
}

/* #18: "Dela mapp till läkare" — sätter läsrätt på mappen "HF till läkare - <kurs>" för läkarens e-post
 * (vz_settings.doctorEmail) via GAS. Läkaren får en Google Drive-notis. Bekräftelse + fail-closed test-läge. */
function shareDoctorFolder(courseName, btn) {
  getCourseSettings().then(function (settings) {
    var doctor = String(settings.doctorEmail || '').trim();
    if (!doctor) {
      try { t.alert({ message: 'Sätt läkarens e-postadress i Inställningar (kugghjulet) först.', duration: 8, display: 'error' }); } catch (e) {}
      return;
    }
    courseInModalConfirm(
      'Dela mappen "HF till läkare - ' + courseName + '" till läkaren (' + doctor + ')?\n\n'
        + 'Läkaren får läsrätt + ett mejl från Google Drive. Mappen innehåller de anonymiserade läkarkopiorna.',
      'Dela mapp till läkare',
      function () {
        if (!resolveSendMode(settings).live) {   // FAIL-CLOSED: dela ej i testläge
          try { t.alert({ message: 'Testläge: skulle delat mappen med ' + doctor + ' (ingen ändring gjordes).', duration: 7, display: 'info' }); } catch (e) {}
          return;
        }
        var orig = btn.textContent; btn.disabled = true; btn.textContent = '⏳ Delar mapp…';
        postToGas('shareDoctorFolder', { courseName: courseName, doctorEmail: doctor }).then(function (data) {
          btn.disabled = false; btn.textContent = orig;
          if (data && data.ok) {
            try { t.alert({ message: '✓ Mappen delad med läkaren (' + doctor + '). Hon får ett mejl från Google Drive.', duration: 9, display: 'success' }); } catch (e) {}
          } else {
            var err = (data && data.error) || 'okänt fel';
            var msg = err === 'folder_not_found'
              ? 'Hittade ingen mapp "HF till läkare - ' + courseName + '" än. Skapa minst en läkarkopia först (då skapas mappen).'
              : (err === 'doctor_email_required' ? 'Läkarens e-post saknas.' : 'Kunde inte dela mappen: ' + err);
            try { t.alert({ message: '⚠️ ' + msg, duration: 9, display: 'error' }); } catch (e) {}
          }
        }).catch(function (err) {
          btn.disabled = false; btn.textContent = orig;
          try { t.alert({ message: '⚠️ Kunde inte dela mappen: ' + ((err && err.message) || err), duration: 8, display: 'error' }); } catch (e) {}
        });
      }
    );
  });
}

/* In-modal bekräftelse-dialog (t.popup renderar ej i fullscreen t.modal). Esc avbryter, Enter bekräftar,
 * autofokus på bekräfta. Vi äger modalens DOM → egen overlay. */
function courseInModalConfirm(message, confirmText, onYes, opts) {
  opts = opts || {};
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,68,92,.35);display:flex;align-items:center;justify-content:center;font-family:Calibri,system-ui,sans-serif';
  var box = document.createElement('div');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.style.cssText = 'background:#fff;max-width:440px;margin:16px;padding:20px 22px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);color:#0d3142';
  var p = document.createElement('div'); p.style.cssText = 'font-size:14.5px;line-height:1.5;margin-bottom:16px;white-space:pre-line'; p.textContent = message;
  var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
  var no = document.createElement('button'); no.textContent = opts.cancelText || 'Avbryt'; no.style.cssText = 'border:none;cursor:pointer;background:#7a8a91;color:#fff;font-weight:700;padding:8px 16px;border-radius:8px;font-family:inherit';
  var yes = document.createElement('button'); yes.textContent = confirmText || 'Bekräfta'; yes.style.cssText = 'border:none;cursor:pointer;background:#357087;color:#fff;font-weight:700;padding:8px 16px;border-radius:8px;font-family:inherit';
  if (!opts.hideCancel) { row.appendChild(no); }   // info-dialog (hideCancel) → bara en knapp
  row.appendChild(yes); box.appendChild(p); box.appendChild(row); ov.appendChild(box);
  (document.body || document.documentElement).appendChild(ov);
  function close() { document.removeEventListener('keydown', onKey, true); ov.remove(); }
  function cancel() { close(); if (opts.onCancel) { opts.onCancel(); } }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); cancel(); } else if (e.key === 'Enter') { e.preventDefault(); close(); onYes(); } }
  document.addEventListener('keydown', onKey, true);
  no.addEventListener('click', cancel);
  ov.addEventListener('click', function (e) { if (e.target === ov) { cancel(); } });
  yes.addEventListener('click', function () { close(); onYes(); });
  yes.focus();
}

// Åtgärdsknapp-stub: visar vad den SKULLE göra (mejl/sidoeffekter kopplas server-side).
function stubBtn(label, msgText) {
  return '<div class="vz-stub-row">'
    + '<button class="vz-stub vz-btn" data-msg="' + esc(msgText) + '">' + esc(label) + '</button>'
    + '<span class="vz-stub-note">stub — kopplas senare</span></div>';
}
function wireStubs(scope) {
  Array.prototype.forEach.call(scope.querySelectorAll('.vz-stub'), function (b) {
    b.addEventListener('click', function () { t.alert({ message: b.getAttribute('data-msg'), duration: 8, display: 'info' }); });
  });
}

/* ---------- Livsberättelse-matris (#3): deltagare × gruppledare ---------- */
function loadStoryMatrix(courseName, participants, cards) {
  var slug = norm(courseName).replace(/[^a-z0-9]+/g, '_');
  var key = 'vz_story_' + slug;
  var followKey = 'vz_followup_' + slug;
  // Livsberättelse-länk per deltagare ur kort-kommentar + kontaktuppgifter ur kort-desc (#10 uppf-enskild).
  var storyLinks = {}, contactByKey = {};
  (cards || []).forEach(function (c) { storyLinks[c.id] = commentLink(c, STORY_LINK_RES); contactByKey[c.id] = parseContactFromDesc(c.desc); });
  var GL = STAFF_BOARDS[0];
  function asObj(x) { return (x && typeof x === 'object') ? x : {}; }
  t.getRestApi().getToken().then(function (token) {
    if (!token) { return null; }
    return Promise.all([
      getOpenBoards_(token),
      t.get('board', 'shared', key).catch(function () { return {}; }),
      t.get('board', 'shared', followKey).catch(function () { return {}; }),
    ]).then(function (r) {
      var boards = r[0] || [], selStory = asObj(r[1]), selFollow = asObj(r[2]);
      var b = boards.filter(function (bd) { return GL.re.test(bd.name || ''); })[0];
      if (!b) { return { leaders: [], selStory: selStory, selFollow: selFollow }; }
      return restGet(token, 'boards/' + b.id + '/lists?fields=name').then(function (lists) {
        var list = (lists || []).filter(function (l) { return sameCourse(l.name, courseName); })[0];
        if (!list) { return { leaders: [], selStory: selStory, selFollow: selFollow }; }
        return restGet(token, 'lists/' + list.id + '/cards?fields=name,labels').then(function (cs) {
          // Matriserna ska INTE innehålla "Vitaliseraperson på plats" (de läser ej livsberättelser/
          // har ej uppföljningssamtal) — men de är kvar i "Personal på kursen"-panelen.
          var leaders = (cs || []).map(function (c) { return staffPerson(c, GL); })
            .filter(function (p) { return p && p.role !== 'Vitaliseraperson på plats'; })
            .map(function (p) { return p.name; });
          return { leaders: leaders, selStory: selStory, selFollow: selFollow };
        });
      });
    });
  }).then(function (d) {
    if (!d) { return; }
    renderStoryMatrix(key, participants || [], d.leaders, d.selStory, {
      title: livsLabelForCourse(courseName) + ' → gruppledare', storyLinks: storyLinks, kind: 'livsberattelse',   // steg-medveten titel
      note: 'Bocka vilken gruppledare som läser vilken deltagares ' + livsLabelForCourse(courseName).toLowerCase() + '. Sparas automatiskt.',
    });
    // Uppföljningssamtal finns BARA i Steg 1 (Robert 2026-06-21) → rendera ej matrisen för 2/3A/3B.
    if (courseHasUppfoljning(courseName)) {
      renderStoryMatrix(followKey, participants || [], d.leaders, d.selFollow, {
        title: 'Uppföljningssamtal → gruppledare', storyLinks: {}, kind: 'uppfoljning', courseName: courseName, contacts: contactByKey,
        note: 'Bocka vilken gruppledare som har uppföljningssamtal med vilken deltagare. Sparas automatiskt.',
      });
    }
  }).catch(function () {});
}
/* Bygger gruppledar-tilldelningar ur urvalskartan (cellKey 'pKey||leader'=true).
 * Ren funktion (testbar): returnerar [{leaderName, leaderEmail:'', participants:[namn,...]}]
 * med bara gruppledare som har minst en bockad deltagare. leaderEmail lämnas
 * tom — gruppledar-mejl finns inte i kursvyns data än (TODO-källa). */
function buildLeaderAssignments(sel, participants, leaders) {
  sel = sel || {}; participants = participants || []; leaders = leaders || [];
  var nameByKey = {};
  participants.forEach(function (p) { nameByKey[p.key] = p.name; });
  return leaders.map(function (ld) {
    var names = [];
    participants.forEach(function (p) {
      if (sel[p.key + '||' + ld]) { names.push(nameByKey[p.key]); }
    });
    return { leaderName: ld, leaderEmail: '', participants: names };
  }).filter(function (a) { return a.participants.length; });
}

/* ---------- Gruppledar-mejl: textgenerering (Malins mallar) ---------- */
// #13: deltagare som INTE tilldelats någon gruppledare i matrisen (glömd bock). Ren funktion → testbar.
function unassignedParticipants(sel, participants, leaders) {
  sel = sel || {}; leaders = leaders || [];
  return (participants || []).filter(function (p) {
    return !leaders.some(function (l) { return sel[p.key + '||' + l]; });
  }).map(function (p) { return p.name; });
}
function firstNameOf(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }
// "A" / "A och B" / "A, B och C"
function swedishList(arr) {
  arr = (arr || []).filter(Boolean);
  if (!arr.length) { return ''; }
  if (arr.length === 1) { return arr[0]; }
  return arr.slice(0, -1).join(', ') + ' och ' + arr[arr.length - 1];
}
// Redigerbar mejl-ruta (rubrik + auto-växande textarea). pkey = pluginData-nyckel → Malins
// redigeringar persisteras board-shared (överlever stäng/öppna), som övriga textfält.
// Robust kopiering i Trello-modalen: navigator.clipboard.writeText blockeras ofta av iframe-permissions
// (rejectar tyst → "✓ Kopierat" ljuger, gammalt clipboard-innehåll blir kvar). execCommand('copy') via en
// temporär textarea i klick-gesten funkar i iframe → primär; clipboard-API som fallback. Returnerar Promise<bool>.
function copyTextToClipboard(text) {
  var ok = false;
  try {
    var tmp = document.createElement('textarea');
    tmp.value = String(text == null ? '' : text);
    tmp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(tmp);
    tmp.focus(); tmp.select();
    try { tmp.setSelectionRange(0, tmp.value.length); } catch (e) {}
    ok = document.execCommand('copy');
    tmp.remove();
  } catch (e) { ok = false; }
  if (ok) { return Promise.resolve(true); }
  if (navigator.clipboard) { return navigator.clipboard.writeText(String(text == null ? '' : text)).then(function () { return true; }).catch(function () { return false; }); }
  return Promise.resolve(false);
}
function mailBox(label, value, pkey, sendCfg, docCfg) {
  var wrap = document.createElement('div');
  wrap.className = 'vz-mailbox';
  var lbl = document.createElement('div'); lbl.className = 'vz-mailbox-label'; lbl.textContent = label;
  var ta = document.createElement('textarea'); ta.className = 'vz-textarea'; ta.value = value;
  ta.id = 'vz-mailbox-ta-' + norm(label).replace(/[^a-z0-9]+/g, '-');   // bild16: stabilt id per mejltyp → bevara höjd
  persistTextareaSize_(ta);
  var row = document.createElement('div'); row.className = 'vz-mailbox-actions';
  var note = document.createElement('span'); note.className = 'vz-stub-note';
  // "Kopiera text" är meningslös på en MALL med platshållare (enskild-rutorna) → dölj där (#20).
  if (!(sendCfg && sendCfg.hideCopy)) {
    var btn = document.createElement('button'); btn.className = 'vz-btn'; btn.textContent = 'Kopiera text';
    btn.addEventListener('click', function () {
      copyTextToClipboard(ta.value).then(function (okCopy) {
        note.textContent = okCopy ? '✓ Kopierat' : '⚠️ Kunde ej kopiera — markera texten i rutan och tryck Cmd+C.';
      });
    });
    row.appendChild(btn);
  }
  // Valfri Skicka-knapp (personal-mejl via GAS, fail-closed + bekräfta-dialog). build får aktuell ta.value.
  if (sendCfg) {
    var sendBtn = document.createElement('button'); sendBtn.className = 'vz-btn vz-btn--send';
    sendBtn.textContent = sendCfg.btnLabel || 'Skicka'; sendBtn.style.marginLeft = '6px';
    sendBtn.addEventListener('click', function () {
      runSendMail({ kind: sendCfg.kind, btn: sendBtn, note: note, emptyHint: '. Fyll i "Kontaktuppgifter Gruppledare".',
        prepare: function () { return fetchGroupLeaderContacts().then(function (contacts) { return sendCfg.build(contacts, ta.value); }); } });
    });
    row.appendChild(sendBtn);
  }
  // Valfri "Skapa sammanfattningsdokument"-knapp (Inc3): GAS kopierar mallen till kursmappen + delar,
  // returnerar länken som ersätter {SAMMANFATTNINGSLÄNK} i rutan. Idempotent (server-sidan).
  if (docCfg) {
    var docBtn = document.createElement('button'); docBtn.className = 'vz-btn'; docBtn.textContent = 'Skapa sammanfattningsdok';
    docBtn.style.marginLeft = '6px';
    function insertSummaryLink(url) {
      ta.value = upsertSummaryLink_(ta.value, url);
      if (pkey) { persistText(pkey, ta.value); }
      fit();
    }
    function summaryError_(res) {
      var err = (res && res.error) || 'kunde ej skapa dokument';
      var msg = err === 'course_folder_not_found' ? 'Hittar ingen kursmapp för "' + docCfg.courseName + '".'
        : err === 'no_assignments' ? 'Bocka minst en deltagare per gruppledare i matrisen först.' : err;
      if (res && res.detail) { msg += ' — ' + res.detail; }
      return '⚠️ ' + msg;
    }
    function createSummary(replace) {
      docBtn.disabled = true; note.textContent = replace ? '⏳ Ersätter dokument…' : '⏳ Skapar dokument…';
      postToGas('createSummaryDoc', { dryRun: false, replace: !!replace, courseName: docCfg.courseName, groups: docCfg.getGroups ? docCfg.getGroups() : [] }).then(function (res) {
        if (res && res.ok && res.url) {
          // Befintligt dok (utan replace) → erbjud ersätt eller använd befintligt (Robert 2026-06-17).
          if (res.existed && !replace) {
            docBtn.disabled = false;
            courseInModalConfirm(
              'Ett sammanfattningsdok finns redan för kursen.\n\nVill du ersätta det med ett nytt (genereras om från matrisen — det gamla hamnar i papperskorgen) eller använda det befintliga?',
              'Ersätt med nytt',
              function () { createSummary(true); },
              { cancelText: 'Använd befintligt', onCancel: function () { insertSummaryLink(res.url); note.textContent = '✓ Använde befintligt dok + länk infogad'; docBtn.textContent = '✓ Sammanfattningsdok klart'; } }
            );
            return;
          }
          insertSummaryLink(res.url);
          note.textContent = replace ? '✓ Ersatt med nytt dok + länk infogad' : '✓ Dokument skapat + länk infogad';
          docBtn.textContent = '✓ Sammanfattningsdok klart';
        } else {
          note.textContent = summaryError_(res);
        }
        docBtn.disabled = false;
      }).catch(function (e) { note.textContent = '⚠️ ' + e.message; docBtn.disabled = false; });
    }
    docBtn.addEventListener('click', function () { createSummary(false); });
    row.appendChild(docBtn);
  }
  row.appendChild(note);
  wrap.appendChild(lbl); wrap.appendChild(ta); wrap.appendChild(row);
  function fit() { if (vzTaHasSavedSize_(ta)) { return; } ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 4) + 'px'; }
  ta.addEventListener('input', function () { fit(); if (pkey) { persistText(pkey, ta.value); } });
  if (pkey && value) { persistText(pkey, value); } // spara genererad text direkt
  setTimeout(fit, 0);
  return wrap;
}
// Default-mallar = DELAD källa i config.js (window.NYA_ZAPIER_TPL) → samma text som settings.js förifyller.
var DEFAULT_TPL = (typeof window !== 'undefined' && window.NYA_ZAPIER_TPL) || {};
// Ersätt {TOKEN} ur map. OKÄND token lämnas ORÖRD (t.ex. {SAMMANFATTNINGSLÄNK} fylls senare, {GRUPPLEDARE}/
// {DELTAGARE} fylls per gruppledare vid utskick). Ren funktion. @param {string} tpl @param {Object} map
function applyTokens(tpl, map) {
  return String(tpl == null ? '' : tpl).replace(/\{([A-ZÅÄÖ_]+)\}/g, function (m, k) {
    return (map && map[k] != null) ? map[k] : m;
  });
}
// Sätt in/uppdatera sammanfattningsdok-länken UTAN att ackumulera (Robert 2026-06-18-bugg: "skapa om" lade till ny varje gång).
// Prioritet: (1) finns redan minst en länk → ersätt FÖRSTA in-place + ta bort dubbletter; (2) token kvar → fyll; (3) annars sist. Ren funktion.
function upsertSummaryLink_(text, url) {
  var mdLink = '[länk till sammanfattningsdokumentet](' + url + ')';
  text = String(text == null ? '' : text);
  if (/\[länk till sammanfattningsdokumentet\]\([^)]*\)/.test(text)) {
    var seen = false;
    return text.replace(/\n*\[länk till sammanfattningsdokumentet\]\([^)]*\)/g, function (m) {
      if (!seen) { seen = true; return (/^\n/.test(m) ? '\n\n' : '') + mdLink; }
      return '';   // dubblett → bort
    });
  }
  if (text.indexOf('{SAMMANFATTNINGSLÄNK}') !== -1) { return text.replace(/\{SAMMANFATTNINGSLÄNK\}/g, mdLink); }
  return text + '\n\n' + mdLink;
}
// tpl = settings-override (eller tom → default). assignLines → {TILLDELNING}; antal → {ANTAL} (neutralt, utan omdöme).
function livsAllaText(tpl, total, men, women, assignLines) {
  var antal = (men != null && women != null)
    ? (total + ', ' + men + (men === 1 ? ' man' : ' män') + ' och ' + women + (women === 1 ? ' kvinna' : ' kvinnor'))
    : (total + ' deltagare');
  return applyTokens(tpl || DEFAULT_TPL.livsAlla, { ANTAL: antal, TILLDELNING: assignLines });
}
function livsEnskildMall(tpl) {
  return tpl || DEFAULT_TPL.livsEnskild;  // {GRUPPLEDARE}/{DELTAGARE} fylls per gruppledare vid utskick
}
// Två redigerbara mallar: tplA = Malin VAR med, tplB = Malin INTE med. Auto-välj efter MALIN_PRESENT
// (= finns som "Vitaliseraperson på plats" i gruppledar-listan). Tom override → default-varianten.
function uppfoljningText(tplA, tplB, assignLines) {
  var base = MALIN_PRESENT ? (tplA || DEFAULT_TPL.uppfoljning) : (tplB || DEFAULT_TPL.uppfoljningB);
  return applyTokens(base, { TILLDELNING: assignLines });  // {SAMMANFATTNINGSLÄNK} lämnas → fylls av knappen
}

/* ---------- Gruppledar-mejl: SKICKA (Inc2) ----------
 * Personal-mejl (gruppledare/kursledare), brandat, via GAS. INGEN deltagar-kommunikation den här vägen.
 * INGEN auto-send: bara Malins knapptryck + bekräfta-dialog. FAIL-CLOSED: skarpt BARA om
 * vz_settings.testMode === false (explicit); allt annat → redirect till testRedirectEmail.
 */
// Mottagar-adresserna: "Kontaktuppgifter Gruppledare"-listan på Gruppledare-boarden (kort: namn=person,
// desc="**Epost:** x"). Samma board-/mejl-mönster som fetchGroupLeaderAllergies/extractStaffEmail. Fail-soft.
function fetchGroupLeaderContacts() {
  return t.getRestApi().getToken().then(function (token) {
    if (!token) { return []; }
    return getOpenBoards_(token).then(function (boards) {
      var b = (boards || []).filter(function (bd) { return /gruppled|ledare/i.test(bd.name || ''); })[0];
      if (!b) { return []; }
      return restGet(token, 'boards/' + b.id + '/lists?fields=name').then(function (lists) {
        var lst = (lists || []).filter(function (l) { return /kontaktuppgifter.*(gruppled|ledare)/i.test(l.name || ''); })[0];
        if (!lst) { return []; }
        return restGet(token, 'lists/' + lst.id + '/cards?fields=name,desc').then(function (cs) {
          return (cs || []).map(function (c) {
            return { name: cleanStaffName(c.name), email: extractStaffEmail(c.desc) };
          }).filter(function (x) { return x.name && x.email; });
        });
      });
    });
  }).catch(function () { return []; });
}
// Kock-kontakter ur listan "Kontaktuppgifter kockar" på Kockar-boarden (kort: namn=person, desc="**Epost:** x").
// Samma mönster som fetchGroupLeaderContacts (kockarna har en EGEN kontaktlista, Robert 2026-06-16). Fail-soft.
function fetchKockContacts() {
  return t.getRestApi().getToken().then(function (token) {
    if (!token) { return []; }
    return getOpenBoards_(token).then(function (boards) {
      var b = (boards || []).filter(function (bd) { return /kock/i.test(bd.name || ''); })[0];
      if (!b) { return []; }
      return restGet(token, 'boards/' + b.id + '/lists?fields=name').then(function (lists) {
        var lst = (lists || []).filter(function (l) { return /kontaktuppgifter.*kock/i.test(l.name || ''); })[0];
        if (!lst) { return []; }
        return restGet(token, 'lists/' + lst.id + '/cards?fields=name,desc').then(function (cs) {
          return (cs || []).map(function (c) { return { name: cleanStaffName(c.name), email: extractStaffEmail(c.desc) }; })
            .filter(function (x) { return x.name && x.email; });
        });
      });
    });
  }).catch(function () { return []; });
}
// Slå upp en persons mejl ur kontaktlistan (fuzzy, samma namn-match som allergierna). '' om ingen träff.
function glContactEmail(name, contacts) {
  var hit = (contacts || []).filter(function (c) { return glNameMatch(name, c.name); })[0];
  return hit ? hit.email : '';
}
// Kursledare + biträdande kursledares mejl (cc på enskilda läs-mejl). Ur COURSE_LEADERS-rollerna + kontakter.
function leaderCcEmails(contacts) {
  return (COURSE_LEADERS || [])
    .filter(function (p) { return /kursledare/i.test(p.role || ''); })   // "Kursledare" + "Biträdande kursledare"
    .map(function (p) { return glContactEmail(p.name, contacts); })
    .filter(Boolean);
}
// Per-gruppledare deltagare + livsberättelse-länk (ur urvalskartan + storyLinks). Ren funktion.
function leaderParticipantLinks(sel, participants, leaderName, storyLinks) {
  sel = sel || {}; storyLinks = storyLinks || {};
  return (participants || []).filter(function (p) { return sel[p.key + '||' + leaderName]; })
    .map(function (p) { return { name: p.name, link: storyLinks[p.key] || '' }; });
}
// Per-gruppledare deltagare + kontakt (#10): ur urvalskartan + contactByKey. Ren funktion.
function leaderParticipantContacts(sel, participants, leaderName, contactByKey) {
  sel = sel || {}; contactByKey = contactByKey || {};
  return (participants || []).filter(function (p) { return sel[p.key + '||' + leaderName]; })
    .map(function (p) { return { name: p.name, contact: contactByKey[p.key] || {} }; });
}
// Kontaktblock (plaintext) för uppföljnings-enskild-mejlet. items = [{name, contact:{telefon,epost}}]. Ren funktion.
function kontaktBlockText(items) {
  return (items || []).map(function (it) {
    var c = it.contact || {};
    return 'Namn: ' + it.name + '\nTelefonnummer: ' + (c.telefon || '') + '\nEpost: ' + (c.epost || '');
  }).join('\n\n');
}
// Fritext (Malins ruta) → inre HTML: escape, gör markdown-länkar [text](url) + bara-URL:er klickbara, radbrytningar.
// Ren funktion. (esc körs FÖRST → []() överlever; url:en escapas men &amp; m.m. är giltigt i href.)
function plainToHtml(text) {
  var s = esc(String(text == null ? '' : text));
  // [etikett](https://url) → <a href="url">etikett</a>  (snygg länk, som enskild-mejlets deltagarlänkar)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, label, url) { return '<a href="' + url + '">' + label + '</a>'; });
  // bara-URL (ej redan i en href) → klickbar
  s = s.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, function (m, pre, url) { return pre + '<a href="' + url + '">' + url + '</a>'; });
  return s.replace(/\n/g, '<br>');
}
// FAILSAFE: hitta orenderade VERSAL-platshållare ({SAMMANFATTNINGSLÄNK}, {GRUPPLEDARE}…) i utskicken — ett mejl
// får ALDRIG gå med synlig token (Robert 2026-06-16). Skannar subject/bodyText/bodyHtml. Ren funktion → testbar.
function findUnrenderedTokens(emails) {
  var found = {};
  (emails || []).forEach(function (e) {
    [e && e.subject, e && e.bodyText, e && e.bodyHtml].forEach(function (s) {
      var re = /\{[A-ZÅÄÖ_]{2,}\}/g, m;
      while ((m = re.exec(String(s == null ? '' : s)))) { found[m[0]] = true; }
    });
  });
  return Object.keys(found);
}
// Markdown-länk → läsbar plaintext "etikett: url" (för plaintext-fallbacken). Ren funktion.
function mdToPlain(text) {
  return String(text == null ? '' : text).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1: $2');
}
// Enskild-mall → inre HTML per gruppledare: {GRUPPLEDARE}=förnamn, {DELTAGARE}=namn (länkade om länk finns).
// Mallen escapas (platshållarna saknar specialtecken → överlever), platshållare ersätts med säker HTML.
function enskildBodyHtml(template, leaderName, items) {
  var namesHtml = (items || []).map(function (it) {
    var n = esc(it.name);
    // Länka BARA http(s)-URL:er (defense-in-depth mot javascript:/data:-scheman, utöver att
    // storyLinks redan är domän-begränsade vid källan via STORY_LINK_RES).
    return (it.link && /^https?:\/\//i.test(it.link)) ? '<a href="' + esc(it.link) + '">' + n + '</a>' : n;
  }).join('<br>');
  return esc(String(template == null ? '' : template))
    .replace(/\{GRUPPLEDARE\}/g, esc(firstNameOf(leaderName)))
    .replace(/\{DELTAGARE\}/g, namesHtml)
    .replace(/\n/g, '<br>');
}
// Enskild-mall → plaintext per gruppledare: namn + ev. länk på egen rad.
function enskildBodyText(template, leaderName, items) {
  var namesTxt = (items || []).map(function (it) { return it.link ? (it.name + ' — ' + it.link) : it.name; }).join('\n');
  return String(template == null ? '' : template)
    .replace(/\{GRUPPLEDARE\}/g, firstNameOf(leaderName))
    .replace(/\{DELTAGARE\}/g, namesTxt);
}
// FAIL-CLOSED läges-resolvering: skarpt (live) ENBART om testMode === false (explicit). {} / undefined /
// trasig läsning → testläge (redirect). Ren funktion. @return {{live, redirect}}
function resolveSendMode(settings) {
  settings = settings || {};
  return { live: settings.testMode === false, redirect: String(settings.testRedirectEmail || '').trim() };
}
function getCourseSettings() { return t.get('board', 'shared', 'vz_settings').then(function (s) { return s || {}; }).catch(function () { return {}; }); }
// Räknar faktiska mottagare (to kan vara komma-separerad för "till alla"). Ren funktion.
function countRecipients(emails) {
  return (emails || []).reduce(function (n, e) { return n + String(e.to || '').split(',').filter(function (x) { return x.trim(); }).length; }, 0);
}
// Timeout-skydd: en hängande Trello-/inställnings-fetch ska bli ett synligt fel, aldrig en evig spinner.
function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise(function (_, rej) {
    setTimeout(function () { rej(new Error((label || 'Något') + ' svarade inte i tid — försök igen.')); }, ms);
  })]);
}
// Orkestrering: bekräfta-dialog → hämta kontakter+settings → bygg emails → GAS-send. FAIL-CLOSED.
// opts: { kind, btn, note, build(contacts) -> {emails, missing} }
// ⚠️ t.popup MÅSTE öppnas SYNKRONT i klick-gesten (som dashboard.js gap-stängning). Öppnas den EFTER
// async-arbete renderar Trello den inte → knappen fastnade på "Förbereder…". Allt async sker i onConfirm.
// opts: { kind, btn, note, prepare() -> {emails,missing}|Promise<...>, emptyHint }. Källan (kontakter/kock-mejl)
// hämtas i prepare() → samma orkestrering för gruppledar- OCH kock-mejl. FAIL-CLOSED + in-modal bekräftelse.
function runSendMail(opts) {
  var note = opts.note, btn = opts.btn;
  btn.disabled = true; note.textContent = '⏳ Förbereder…';
  Promise.all([
    withTimeout(Promise.resolve(opts.prepare()), 15000, 'Förberedelsen'),
    withTimeout(getCourseSettings(), 8000, 'Inställningarna'),
  ]).then(function (r) {
    var built = r[0] || { emails: [], missing: [] }, settings = r[1] || {}, mode = resolveSendMode(settings);
    var emails = (built.emails || []).filter(function (e) { return e && e.to; });
    var missing = built.missing || [];
    // Admin-cc (Inställningar.adminEmail): kopia på skarpa utskick. cc rensas av GAS i testläge → admin
    // får bara kopia på riktiga utskick (avsiktligt). Läggs på ALLA mejl, dedupas mot ev. befintlig cc.
    var admin = String(settings.adminEmail || '').trim();
    if (admin) {
      emails.forEach(function (e) {
        e.cc = (e.cc || []).slice();
        if (e.cc.map(function (x) { return String(x).toLowerCase(); }).indexOf(admin.toLowerCase()) === -1) { e.cc.push(admin); }
      });
    }
    if (!emails.length) {
      note.textContent = '⚠️ Inga mottagar-adresser' + (missing.length ? ' (saknas: ' + missing.join(', ') + ')' : '') + (opts.emptyHint || '.');
      btn.disabled = false; return;
    }
    if (!mode.live && !mode.redirect) {
      note.textContent = '⚠️ Testläge utan test-mottagare. Sätt test-mottagare i Inställningar (kugghjul) först.';
      btn.disabled = false; return;
    }
    // FAILSAFE: blockera om någon platshållare är ofylld (t.ex. {SAMMANFATTNINGSLÄNK} — doc-knappen ej klickad).
    var leftover = findUnrenderedTokens(emails);
    if (leftover.length) {
      note.textContent = '⚠️ Ofylld platshållare: ' + leftover.join(', ') + ' — fyll den först (t.ex. klicka "Skapa sammanfattningsdok") innan du skickar.';
      btn.disabled = false; return;
    }
    // IN-MODAL bekräftelse — t.popup renderar INTE inifrån en fullscreen t.modal (känd Trello-begränsning,
    // verifierad live: knappen blev "stum"). Vi äger modalens DOM → rendera confirm där, garanterat synligt.
    var recN = countRecipients(emails);
    note.textContent = '';
    var q = document.createElement('span');
    q.textContent = (mode.live ? '⚠️ SKARPT — ' + recN + ' riktig(a) mottagare. ' : 'Testläge → allt till ' + mode.redirect + '. ')
      + (missing.length ? '(saknad adress: ' + missing.join(', ') + ') ' : '') + 'Skicka?';
    var yes = document.createElement('button'); yes.className = 'vz-btn vz-btn--send'; yes.textContent = 'Bekräfta';
    yes.style.cssText = 'margin-left:6px;padding:4px 11px;font-size:12px';
    var no = document.createElement('button'); no.className = 'vz-btn'; no.textContent = 'Avbryt';
    no.style.cssText = 'margin-left:5px;padding:4px 11px;font-size:12px;background:#7a8a91';
    note.appendChild(q); note.appendChild(yes); note.appendChild(no);
    no.addEventListener('click', function () { note.textContent = ''; btn.disabled = false; });
    yes.addEventListener('click', function () {
      note.textContent = '⏳ Skickar…';
      postToGas('sendGroupLeaderMail', { dryRun: false, live: mode.live, redirectEmail: mode.redirect, kind: opts.kind, emails: emails, senderName: settings.senderName, replyTo: settings.replyTo }).then(function (res) {
        if (res && res.ok) {
          var okN = (res.sent || []).filter(function (s) { return s.ok; }).length;
          var failed = (res.sent || []).filter(function (s) { return !s.ok; });
          note.textContent = '✓ ' + okN + ' skickat'
            + (failed.length ? ', ⚠️ ' + failed.length + ' misslyckades (' + ((failed[0] && failed[0].error) || 'okänt') + ')' : '')
            + (missing.length ? ' · saknad adress: ' + missing.join(', ') : '')
            + (res.live ? ' (skarpt)' : ' (test → ' + res.redirect + ')');
        } else { note.textContent = '⚠️ ' + ((res && res.error) || 'okänt fel') + (res && res.detail ? ' — ' + res.detail : ''); }
        btn.disabled = false;
      }).catch(function (e) { note.textContent = '⚠️ ' + e.message; btn.disabled = false; });
    });
  }).catch(function (e) { note.textContent = '⚠️ ' + e.message; btn.disabled = false; });
}

function renderStoryMatrix(key, participants, leaders, sel, opts) {
  opts = opts || {}; sel = sel || {};
  var storyLinks = opts.storyLinks || {};
  var host = vzRegion('below');
  if (!host) { return; }
  var sec = document.createElement('section');
  // Matriserna ligger 2-i-bredd i below-griddet (egen horisontell scroll vid behov).
  sec.className = 'vz-panel vz-panel--below';
  // Egen panel-nyckel per matris (Livsberättelser/Uppföljning är SEPARATA flyttbara moduler) — ej kollidera.
  var matrisKey = opts.kind === 'uppfoljning' ? 'uppf_matris' : 'livs_matris';
  var head = '<div class="vz-panel-title">' + esc(opts.title || 'Matris') + '</div>';
  if (!leaders.length) {
    sec.innerHTML = head + '<div class="vz-panel-empty">Inga gruppledare hittade för kursen (kontrollera Gruppledare-boarden + listnamn).</div>';
    placeBelowPanel(sec, matrisKey); return;
  }
  function cellKey(pk, ld) { return pk + '||' + ld; }
  // ── Skicka-cfg per mejl-ruta (personal-mejl via GAS). build(contacts, taVal) → {emails, missing}. ──
  function leaderEmailsFor(contacts) {
    var asg = buildLeaderAssignments(sel, participants, leaders), tos = [], missing = [];
    asg.forEach(function (a) { var em = glContactEmail(a.leaderName, contacts); if (em) { tos.push(em); } else { missing.push(a.leaderName); } });
    return { tos: tos, missing: missing };
  }
  var cfgAlla = { kind: 'livsberattelse', btnLabel: 'Skicka till alla', build: function (contacts, taVal) {
    var r = leaderEmailsFor(contacts);
    return { emails: r.tos.length ? [{ to: r.tos.join(','), cc: [], subject: 'Livsberättelser inför kursen', bodyHtml: plainToHtml(taVal), bodyText: mdToPlain(taVal) }] : [], missing: r.missing };
  } };
  var cfgEnskild = { kind: 'livsberattelse', btnLabel: 'Skicka enskilt', hideCopy: true, build: function (contacts, taVal) {
    var cc = leaderCcEmails(contacts), asg = buildLeaderAssignments(sel, participants, leaders), emails = [], missing = [];
    asg.forEach(function (a) {
      var em = glContactEmail(a.leaderName, contacts);
      if (!em) { missing.push(a.leaderName); return; }
      var items = leaderParticipantLinks(sel, participants, a.leaderName, storyLinks);
      emails.push({ to: em, cc: cc, subject: 'Livsberättelser att läsa', bodyHtml: enskildBodyHtml(taVal, a.leaderName, items), bodyText: enskildBodyText(taVal, a.leaderName, items) });
    });
    return { emails: emails, missing: missing };
  } };
  var cfgUppf = { kind: 'uppfoljning', btnLabel: 'Skicka till alla', build: function (contacts, taVal) {
    var r = leaderEmailsFor(contacts);
    return { emails: r.tos.length ? [{ to: r.tos.join(','), cc: [], subject: 'Uppföljningssamtal', bodyHtml: plainToHtml(taVal), bodyText: mdToPlain(taVal) }] : [], missing: r.missing };
  } };
  // #10: uppföljning enskilt kontaktmejl per gruppledare (kontaktuppgifter + sammanfattningslänk).
  var cfgUppfEnskild = { kind: 'uppfoljning', btnLabel: 'Skicka enskilt', hideCopy: true, build: function (contacts, taVal) {
    var cc = leaderCcEmails(contacts), asg = buildLeaderAssignments(sel, participants, leaders), emails = [], missing = [];
    asg.forEach(function (a) {
      var em = glContactEmail(a.leaderName, contacts);
      if (!em) { missing.push(a.leaderName); return; }
      var items = leaderParticipantContacts(sel, participants, a.leaderName, opts.contacts);
      var filled = applyTokens(String(taVal == null ? '' : taVal), { GRUPPLEDARE: firstNameOf(a.leaderName), DELTAGARKONTAKTER: kontaktBlockText(items) });
      emails.push({ to: em, cc: cc, subject: 'Kontaktuppgifter uppföljningssamtal', bodyHtml: plainToHtml(filled), bodyText: mdToPlain(filled) });
    });
    return { emails: emails, missing: missing };
  } };
  // Inc3: "Skapa sammanfattningsdokument"-knapp bara på uppföljnings-rutan (fyller {SAMMANFATTNINGSLÄNK}).
  // getGroups() ger gruppledare→deltagare ur matrisen (förnamn, som doket) → GAS bygger tabellerna.
  var docCfgUppf = (opts.kind === 'uppfoljning' && opts.courseName) ? {
    courseName: opts.courseName,
    getGroups: function () {
      return buildLeaderAssignments(sel, participants, leaders).map(function (a) {
        return { leader: firstNameOf(a.leaderName), deltagare: a.participants.map(firstNameOf) };
      });
    },
  } : null;
  function paint() {
    var ths = leaders.map(function (l) { return '<th class="vz-story-leader"><span class="vz-story-leader-label">' + esc(l) + '</span></th>'; }).join('');
    var trs = participants.map(function (p) {
      var cells = leaders.map(function (l) {
        var ck = cellKey(p.key, l);
        var lbl = esc(p.name) + ' – ' + esc(l);   // a11y: skärmläsare läser deltagare + gruppledare, ej bara "kryssruta"
        return '<td class="vz-story-cell"><input type="checkbox" data-ck="' + esc(ck) + '"' + (sel[ck] ? ' checked' : '') + ' class="vz-story-box" aria-label="' + lbl + '" title="' + lbl + '"></td>';
      }).join('');
      var lk = storyLinks[p.key];
      var nm = lk ? '<a href="' + esc(lk) + '" target="_blank" rel="noopener" class="vz-tbl-link">' + esc(p.name) + ' <span class="vz-ext">↗</span></a>' : '<span class="vz-tbl-name">' + esc(p.name) + '</span>';
      // Robert 2026-06-21: färgkoda namnet efter dok-status (klart/ej) + tooltip med %/bild. Bara livsberättelse-matrisen (har dok).
      var docAttr = (opts.kind === 'livsberattelse') ? ' data-doc-pk="' + esc(p.key) + '" data-doc-kind="livs"' : '';
      return '<tr><td class="vz-story-namecell"' + docAttr + '>' + nm + '</td>' + cells + '</tr>';
    }).join('');
    sec.innerHTML = head
      + '<div class="vz-panel-note">' + esc(opts.note || '') + '</div>'
      + '<div class="vz-story-scroll"><table class="vz-tbl vz-story-tbl"><thead><tr><th class="vz-story-corner">Deltagare</th>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table></div>'
      + '<div class="vz-stub-row">'
      + '<button class="vz-btn" id="vz-mail-btn">Skapa mejltext</button>'
      + '<span class="vz-stub-note">genererar redigerbar text — du granskar och skickar själv</span></div>'
      + '<div id="vz-mail-warn" class="vz-panel-note" style="color:#b5710b"></div>'
      + '<div id="vz-mail-out"></div>';
    Array.prototype.forEach.call(sec.querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.addEventListener('change', function () { sel[cb.getAttribute('data-ck')] = cb.checked; try { t.set('board', 'shared', key, sel).catch(function () {}); } catch (e) {} });
    });
    applyDocNameColors_();   // initial färgkodning (om dok-status redan cachad); loadDocStatus uppdaterar sedan progressivt
    var mailBtn = sec.querySelector('#vz-mail-btn');
    var mailOut = sec.querySelector('#vz-mail-out');
    var mailWarn = sec.querySelector('#vz-mail-warn');
    if (mailBtn) {
      mailBtn.addEventListener('click', function () {
        var assignments = buildLeaderAssignments(sel, participants, leaders);
        if (!assignments.length) {
          mailOut.innerHTML = '<div class="vz-panel-note">Bocka minst en deltagare per gruppledare först.</div>';
          return;
        }
        // #13: varna (icke-blockerande) för deltagare som inte tilldelats någon gruppledare (glömd bock).
        if (mailWarn) {
          var oassigned = unassignedParticipants(sel, participants, leaders);
          mailWarn.textContent = oassigned.length
            ? '⚠️ ' + oassigned.length + ' deltagare saknar gruppledare och är INTE med: ' + oassigned.join(', ') + '. Bocka dem om de ska ingå.'
            : '';
        }
        mailBtn.disabled = true;
        mailOut.innerHTML = '<div class="vz-panel-note">⏳ Skapar mejltext…</div>';
        // Tilldelnings-rader ("Gruppledare-förnamn: deltagare1, deltagare2 och deltagare3").
        var assignLines = assignments.map(function (a) {
          return firstNameOf(a.leaderName) + ': ' + swedishList(a.participants.map(firstNameOf));
        }).join('\n');
        var MALL_LBL = 'Enskilt mejl – mall (fylls per gruppledare vid utskick; cc kursledare)';
        // Läs ev. redigerade malltexter ur Inställningar (vz_settings.tpl_*); tomt → default-mall.
        getCourseSettings().then(function (s) {
          s = s || {};
          if (opts.kind === 'uppfoljning') {
            mailOut.innerHTML = '';
            mailOut.appendChild(mailBox('Uppföljningssamtal – till alla gruppledare', uppfoljningText(s.tpl_uppfoljning, s.tpl_uppfoljningB, assignLines), key + '_mailU', cfgUppf, docCfgUppf));
            mailOut.appendChild(mailBox('Uppföljningssamtal – enskilt kontaktmejl (per gruppledare)', s.tpl_uppfoljningEnskild || DEFAULT_TPL.uppfoljningEnskild, key + '_mailUE', cfgUppfEnskild, docCfgUppf));
            return;
          }
          // Livsberättelser: behöver M/K-antal → hämta könsfördelning (cachad), bygg sedan båda rutorna.
          var firstNames = participants.map(function (p) { return firstNameOf(p.name); }).filter(Boolean);
          return postToGas('courseGenderSplit', { names: firstNames }).then(function (g) {
            var c = (g && g.ok && g.counts) || { K: 0, M: 0, unknown: 0 };
            mailOut.innerHTML = '';
            mailOut.appendChild(mailBox('Till alla gruppledare (översikt)', livsAllaText(s.tpl_livsAlla, participants.length, c.M, c.K, assignLines), key + '_mailA', cfgAlla));
            mailOut.appendChild(mailBox(MALL_LBL, livsEnskildMall(s.tpl_livsEnskild), key + '_mailB', cfgEnskild));
          }).catch(function () {
            mailOut.innerHTML = '';
            mailOut.appendChild(mailBox('Till alla gruppledare (översikt)', livsAllaText(s.tpl_livsAlla, participants.length, null, null, assignLines), key + '_mailA', cfgAlla));
            mailOut.appendChild(mailBox(MALL_LBL, livsEnskildMall(s.tpl_livsEnskild), key + '_mailB', cfgEnskild));
          });
        }).then(function () { mailBtn.disabled = false; });
      });
    }
    // Visa tidigare genererad/redigerad mejltext direkt (överlever stäng/öppna).
    if (mailOut) {
      var MALL_LBL2 = 'Enskilt mejl – mall (fylls per gruppledare vid utskick; cc kursledare)';
      if (opts.kind === 'uppfoljning') {
        Promise.all([
          t.get('board', 'shared', key + '_mailU').catch(function () { return null; }),
          t.get('board', 'shared', key + '_mailUE').catch(function () { return null; }),
        ]).then(function (r) {
          if ((r[0] || r[1]) && !mailOut.children.length) {
            mailOut.appendChild(mailBox('Uppföljningssamtal – till alla gruppledare', String(r[0] || ''), key + '_mailU', cfgUppf, docCfgUppf));
            mailOut.appendChild(mailBox('Uppföljningssamtal – enskilt kontaktmejl (per gruppledare)', String(r[1] || DEFAULT_TPL.uppfoljningEnskild), key + '_mailUE', cfgUppfEnskild, docCfgUppf));
          }
        }).catch(function () {});
      } else {
        Promise.all([
          t.get('board', 'shared', key + '_mailA').catch(function () { return null; }),
          t.get('board', 'shared', key + '_mailB').catch(function () { return null; }),
        ]).then(function (r) {
          if ((r[0] || r[1]) && !mailOut.children.length) {
            mailOut.appendChild(mailBox('Till alla gruppledare (översikt)', String(r[0] || ''), key + '_mailA', cfgAlla));
            mailOut.appendChild(mailBox(MALL_LBL2, String(r[1] || ''), key + '_mailB', cfgEnskild));
          }
        }).catch(function () {});
      }
    }
  }
  paint();
  placeBelowPanel(sec, matrisKey);
}

// Kön-fördelning (M/K) överst i kursvyn. Skickar BARA deltagarnas förnamn (låg PII) till GAS,
// som härleder kön via Claude. Fyller #vz-cv-gender asynkront; tyst om något fallerar.
function loadGenderSplit(participants) {
  var names = (participants || []).map(function (p) { return (p.name || '').trim().split(/\s+/)[0]; }).filter(Boolean);
  if (!names.length) { return; }
  postToGas('courseGenderSplit', { names: names }).then(function (data) {
    var el = document.getElementById('vz-cv-gender');
    if (!el || !data || data.ok !== true) { return; }
    var c = data.counts || {};
    var parts = [];
    if (c.K) { parts.push(c.K + (c.K === 1 ? ' kvinna' : ' kvinnor')); }
    if (c.M) { parts.push(c.M + (c.M === 1 ? ' man' : ' män')); }
    if (c.unknown) { parts.push(c.unknown + ' okänt'); }
    el.textContent = parts.join(' · ');
  }).catch(function () { /* tyst */ });
}

// Fuzzy namn-match (kursens gruppledare ↔ "Matallergier Gruppledare/VP"-kortens namn).
function glNameMatch(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) { return false; }
  if (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1) { return true; }
  var ta = a.split(/\s+/), tb = b.split(/\s+/);
  return ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1]; // samma för- OCH efternamn
}

// Hämtar gruppledar/VP-allergier ur listan "Matallergier Gruppledare/VP" på Gruppledare-boarden
// och behåller bara de som matchar kursens gruppledare (COURSE_GL_NAMES). READ-ONLY, fail-soft.
// Korten: namn = personen, desc = allergin (hela texten). Returnerar [{name, allergy}].
function fetchGroupLeaderAllergies() {
  if (!COURSE_GL_NAMES.length) { return Promise.resolve([]); }
  return t.getRestApi().getToken().then(function (token) {
    if (!token) { return []; }
    return getOpenBoards_(token).then(function (boards) {
      var b = (boards || []).filter(function (bd) { return /gruppled|ledare/i.test(bd.name || ''); })[0];
      if (!b) { return []; }
      return restGet(token, 'boards/' + b.id + '/lists?fields=name').then(function (lists) {
        var lst = (lists || []).filter(function (l) { return /matallerg.*(gruppled|vp)/i.test(l.name || ''); })[0];
        if (!lst) { return []; }
        return restGet(token, 'lists/' + lst.id + '/cards?fields=name,desc').then(function (cs) {
          var out = [];
          (cs || []).forEach(function (c) {
            var person = cleanStaffName(c.name);
            var allergy = String(c.desc || '').trim();
            if (!allergy) { return; }
            if (COURSE_GL_NAMES.some(function (gl) { return glNameMatch(person, gl); })) {
              out.push({ name: person, allergy: allergy });
            }
          });
          return out;
        });
      });
    });
  }).catch(function () { return []; });
}

function loadCourse(listId, listName) {
  ROOT().innerHTML = msg('⏳ Hämtar deltagare och checklistor …');
  var tokLen = 0;
  t.getRestApi().getToken().then(function (token) {
    tokLen = token ? String(token).length : 0;
    if (!token) { throw new Error('no-token'); }
    var nameP = listName ? Promise.resolve(listName)
      : restGet(token, 'lists/' + listId + '?fields=name').then(function (l) { return l.name; });
    var cardsP = restGet(token, 'lists/' + listId + '/cards?fields=name,desc,labels,idList,url&checklists=all&checklist_fields=name&checkItem_fields=name,state&actions=commentCard&actions_limit=50');
    return Promise.all([nameP, cardsP]);
  }).then(function (res) {
    COURSE_CARDS_BY_ID = {};
    COURSE_NAME = res[0] || '';
    (res[1] || []).forEach(function (c) { COURSE_CARDS_BY_ID[c.id] = c; });   // för inline steg-detalj (klick på cell)
    var model = buildCourseModel(res[0], res[1] || []);
    window.CourseView.render(ROOT(), model, handlers);
    // "öppna luckor"-raden → lucka-stäng-dialog (Robert 2026-06-21)
    var _cg = document.getElementById('vz-cv-closegaps');
    if (_cg) { _cg.addEventListener('click', function (e) { e.preventDefault(); offerGapClose(res[1] || []); }); }
    loadGenderSplit(model.participants);
    loadStaff(res[0]);
    // Ladda sparad panel-layout (kolumner+ordning) + kollaps-tillstånd FÖRST → panelerna placeras deterministiskt.
    Promise.all([loadPanelLayout(), loadPanelCollapsed()]).then(function () {
      loadHfPanel(res[1] || [], res[0]);
      loadStoryMatrix(res[0], model.participants, res[1] || []);
      loadCourseChecklist(res[0]);
      loadPracticalInfoPanel(res[1] || [], res[0]);    // Praktisk info-utskick (PDF per deltagare + bock steg 7)
      setTimeout(reorderBelowPanels_, 1500);           // säkerhetsnät: sortera om när alla (även sen-laddade) panelerna landat
    });
    renderParticipantEmails(res[1] || [], res[0]);   // #17b
    loadDocStatus(res[0], res[1] || []);             // #11 Fas 1 (dokumentstatus)

  }).catch(function (err) {
    var diag;
    if (err.message === 'no-token') {
      diag = 'Ingen Trello-token kunde läsas (token-längd 0). Vanlig orsak: Chrome "Third Party Storage Partitioning" — popupens token når inte modalen.';
    } else if (/401/.test(err.message)) {
      diag = 'Token avvisades (401). Token-längd: ' + tokLen + '. (Längd 0 = lagrings­problem; >0 = nyckel/scope.)';
    } else {
      diag = 'Kunde inte hämta kursdata: ' + esc(err.message);
    }
    ROOT().innerHTML = msg('⚠️ ' + diag
      + '<br><button class="vzbtn" id="reauth">Anslut om</button> &nbsp; <button class="vzbtn" id="retry">Försök igen</button>');
    var rb = document.getElementById('retry'); if (rb) { rb.addEventListener('click', function () { loadCourse(listId, listName); }); }
    var ab = document.getElementById('reauth'); if (ab) { ab.addEventListener('click', function () {
      try { t.getRestApi().clearToken(); } catch (e) {}
      t.popup({ title: 'Anslut Trello', url: './authorize.html', height: 220 });
    }); }
  });
}

function msg(html) {
  return '<div style="font-family:Calibri,\'Segoe UI\',system-ui,sans-serif;color:#08445c;padding:40px;text-align:center">'
    + '<img src="' + esc(CFG.MARK_URL) + '" style="width:44px;height:44px;border-radius:10px;margin-bottom:12px"><br>'
    + '<div style="font-size:15px;line-height:1.5">' + html + '</div>'
    + '<style>.vzbtn{margin-top:14px;border:none;cursor:pointer;background:#357087;color:#fff;font-weight:700;font-size:14px;padding:10px 18px;border-radius:9px;font-family:inherit}</style></div>';
}

function showAuth(reason) {
  ROOT().innerHTML = msg((reason || 'Power-Up:en behöver anslutas till Trello för att läsa kursdata.')
    + '<br><button class="vzbtn" id="connect">Anslut Trello</button>');
  document.getElementById('connect').addEventListener('click', function () {
    t.popup({ title: 'Anslut Trello', url: './authorize.html', height: 200 });
  });
}

/* ---------- Lista-väljare (board-entry utan specifik lista) ---------- */
function pickAndLoad() {
  // t.getContext() ger board/card/list-id även i modal — robustare än t.lists.
  var ctx = {};
  try { ctx = t.getContext() || {}; } catch (e) { ctx = {}; }
  var argList = null;
  try { argList = t.arg('listId'); } catch (e) { argList = null; }
  argList = argList || ctx.list || null;

  // Kort-entry: vi har listId → ren REST, rör aldrig t.lists.
  if (argList) { loadCourse(argList); return; }

  // Board-entry: räkna upp listor via REST (boards/{id}/lists), ej t.lists.
  if (!ctx.board) {
    ROOT().innerHTML = msg('Öppna kursöversikten från ett deltagarkort (board-läget kunde inte avgöra kursen).');
    return;
  }
  t.getRestApi().getToken().then(function (token) {
    return restGet(token, 'boards/' + ctx.board + '/lists?fields=name');
  }).then(function (lists) {
    lists = (lists || []).filter(function (l) { return l && l.name; });
    var courses = lists.filter(function (l) { return daysToStart(l.name) !== null; });
    if (!courses.length) { courses = lists; }
    var chosen = courses[0];
    if (!chosen) { ROOT().innerHTML = msg('Inga kurslistor hittades på boarden.'); return; }
    if (courses.length > 1) { renderSwitcher(courses, chosen); }
    loadCourse(chosen.id, chosen.name);
  }).catch(function (err) {
    ROOT().innerHTML = msg('⚠️ Kunde inte läsa listor: ' + esc(err.message)
      + '<br><span style="font-size:12.5px;color:#5d7c87">Öppna kursöversikten från ett deltagarkort istället.</span>');
  });
}

function renderSwitcher(courses, chosen) {
  var bar = document.getElementById('vzbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'vzbar';
    bar.style.cssText = 'font-family:Calibri,system-ui,sans-serif;background:#08445c;color:#fff;padding:8px 14px;display:flex;align-items:center;gap:10px';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  var opts = courses.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === chosen.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
  bar.innerHTML = '<span style="font-size:12.5px;opacity:.85">Kurs:</span>'
    + '<select id="vzsel" style="font-family:inherit;font-size:13.5px;padding:5px 8px;border-radius:7px;border:none">' + opts + '</select>';
  document.getElementById('vzsel').addEventListener('change', function (e) {
    var id = e.target.value, name = e.target.options[e.target.selectedIndex].text;
    loadCourse(id, name);
  });
}

/* ---------- Boot ---------- */
function boot() {
  if (!CFG.APP_KEY || CFG.APP_KEY.indexOf('REPLACE_WITH') !== -1) {
    ROOT().innerHTML = msg('Trello-API-nyckel (APP_KEY) är inte ifylld i config.js. Generera den i Power-Up admin → API Key, och lägg in den.');
    return;
  }
  t.getRestApi().isAuthorized().then(function (ok) {
    if (ok) { pickAndLoad(); } else { showAuth(); }
  }).catch(function () { showAuth('Kunde inte kontrollera Trello-anslutningen.'); });
}

// Esc stänger modalen oavsett var fokus ligger i iframen.
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { try { t.closeModal(); } catch (_) {} }
});
document.addEventListener('DOMContentLoaded', boot);
