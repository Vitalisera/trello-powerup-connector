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
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/* E-post ur ett kort-desc. Föredrar markdown-mönstret "**Epost:** [x](mailto:x)"
 * eller "**Epost:** x", faller tillbaka till första rena adressen. Ren funktion. */
var STAFF_EMAIL_RE = /\*\*Epost:\*\*\s*(?:\[(.*?)\]\(mailto:[^)]+\)|([\w.\-+]+@[\w.\-+]+\.\w+))/i;
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
function statusForCard(card) {
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
    var checklistDone = isChecked(s.checkItem);
    var labelSet = s.triggerLabel ? !!labels[norm(s.triggerLabel)] : false;
    status[s.key] = s.always ? 'done' : checklistDone ? 'done' : (s.triggerLabel ? (labelSet ? 'gap' : 'wait') : 'manual');
  });
  // Logisk slutledning (Malin): done-steg promotar sina implies-steg → done.
  flow.forEach(function (s) {
    if (s.implies && status[s.key] === 'done') {
      s.implies.forEach(function (k) { if (status[k] && status[k] !== 'done') { status[k] = 'done'; } });
    }
  });
  var done = 0, gaps = 0;
  flow.forEach(function (s) { if (status[s.key] === 'done') { done++; } else if (status[s.key] === 'gap') { gaps++; } });
  return { status: status, progress: { done: done, total: flow.length, pct: flow.length ? Math.round(done / flow.length * 100) : 0 }, gapCount: gaps };
}

/* ---------- Datum ur listnamn → dagar till start ---------- */
var MONTHS = { januari: 0, februari: 1, mars: 2, april: 3, maj: 4, juni: 5, juli: 6, augusti: 7, september: 8, oktober: 9, november: 10, december: 11 };
function daysToStart(listName) {
  // ex: "24 juni - 2 juli 2026 (Steg 1)"
  var m = String(listName || '').match(/(\d{1,2})\s+([a-zåäö]+).*?(\d{4})/i);
  if (!m) { return null; }
  var mon = MONTHS[norm(m[2])];
  if (mon === undefined) { return null; }
  var start = new Date(parseInt(m[3], 10), mon, parseInt(m[1], 10));
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((start - today) / 86400000);
}

function buildCourseModel(listName, cards) {
  var steps = (window.NYA_ZAPIER_FLOW || []).map(function (s) {
    return { key: s.key, title: s.title, short: s.title.split(' ')[0], phase: s.phase };
  });
  var participants = cards.map(function (c) {
    var d = statusForCard(c);
    return {
      key: c.id,
      name: (c.name || '').replace(/^\s*\d+\s*[-–]\s*/, ''),
      cardUrl: c.url,
      status: d.status, progress: d.progress, gapCount: d.gapCount,
    };
  });
  return { course: { name: listName, datum: listName, daysToStart: daysToStart(listName) }, steps: steps, participants: participants };
}

var handlers = {
  onOpenCard: function (p) { if (p && p.cardUrl) { window.open(p.cardUrl, '_blank'); } },
  onSelectCell: function () {},
};

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
    return restGet(token, 'members/me/boards?fields=name&filter=open').then(function (boards) {
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

  // "Alla emailadresser": hämta assistent-listans kort med desc skarpt via REST,
  // extrahera mejl per kort, visa kommaseparerat i en kopierbar ruta. Read-only.
  var emBtn = sec.querySelector('#vz-asst-emails');
  var emOut = sec.querySelector('#vz-asst-emails-out');
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
        var emails = (cards || []).map(function (c) { return extractStaffEmail(c.desc); }).filter(Boolean);
        // Dedupa, behåll ordning.
        var seen = {}, uniq = [];
        emails.forEach(function (e) { var k = e.toLowerCase(); if (!seen[k]) { seen[k] = true; uniq.push(e); } });
        emOut.value = uniq.length ? uniq.join(', ') : 'Inga e-postadresser hittades i assistentkortens beskrivningar.';
        if (uniq.length) { persistText(emailsKey, emOut.value); }   // spara så det överlever stäng/öppna
      }).catch(function (err) {
        emOut.value = '⚠️ ' + err.message;
      }).then(function () { emBtn.disabled = false; });
    });
  }
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
    renderChecklistPanel(key, items);
  }).catch(function () {
    renderChecklistPanel(key, DEFAULT_TODOS.map(function (x) { return { text: x, done: false }; }));
  });
}
function persistChecklist(key, items) { try { t.set('board', 'shared', key, items).catch(function () {}); } catch (e) {} }
function renderChecklistPanel(key, items) {
  var host = vzRegion('below');
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.className = 'vz-panel vz-panel--below';
  function paint() {
    var done = items.filter(function (i) { return i.done; }).length;
    var rows = items.map(function (it, idx) {
      return '<label data-i="' + idx + '" class="vzchk-row' + (it.done ? ' is-done' : '') + '">'
        + '<input type="checkbox" data-i="' + idx + '"' + (it.done ? ' checked' : '') + ' class="vzchk-box">'
        + '<span class="vzchk-text">' + esc(it.text) + '</span>'
        + '<button data-del="' + idx + '" title="Ta bort" class="vzchk-del">✕</button>'
        + '</label>';
    }).join('');
    sec.innerHTML = '<div class="vz-panel-head">'
      + '<div class="vz-panel-title">Kurschecklista</div>'
      + '<div class="vz-panel-meta">' + done + '/' + items.length + ' klara · sparas automatiskt</div></div>'
      + '<div class="vzchk-list">' + rows + '</div>'
      + '<div class="vzchk-add-row">'
      + '<input id="vzchk-new" placeholder="Lägg till uppgift på kursnivå…" class="vz-input">'
      + '<button id="vzchk-add" class="vz-btn">Lägg till</button></div>';
    // events
    Array.prototype.forEach.call(sec.querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.addEventListener('change', function () { items[+cb.getAttribute('data-i')].done = cb.checked; persistChecklist(key, items); paint(); });
    });
    Array.prototype.forEach.call(sec.querySelectorAll('button[data-del]'), function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); items.splice(+b.getAttribute('data-del'), 1); persistChecklist(key, items); paint(); });
    });
    var add = sec.querySelector('#vzchk-add'), inp = sec.querySelector('#vzchk-new');
    function addItem() { var v = (inp.value || '').trim(); if (!v) { return; } items.push({ text: v, done: false }); persistChecklist(key, items); paint(); }
    add.addEventListener('click', addItem);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
  }
  paint();
  host.appendChild(sec);
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
  var done = false, exists = false;
  (card.checklists || []).forEach(function (cl) {
    (cl.checkItems || []).forEach(function (it) {
      if (HF_ITEM_RE.test(it.name || '')) { exists = true; if (norm(it.state) === 'complete') { done = true; } }
    });
  });
  return { exists: exists, done: done };
}
function loadHfPanel(cards, courseName) {
  var rows = (cards || []).map(function (c, i) {
    var hf = hfDoneForCard(c);
    return {
      code: 'P' + (i + 1), // anonym deltagarkod (skickas till GAS istället för namn)
      name: (c.name || '').replace(/^\s*\d+\s*[-–]\s*/, ''),
      exists: hf.exists, done: hf.done,
      link: commentLink(c, HF_LINK_RES), // HF-dokumentlänk ur kommentar om den finns
    };
  });
  renderHfPanel(rows, courseName);
}
function renderHfPanel(rows, courseName) {
  var allergiKey = 'vz_allergi_' + courseSlug(courseName);
  var host = vzRegion('below');
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.className = 'vz-panel vz-panel--below';
  var done = rows.filter(function (r) { return r.done; }).length;
  var bodyRows = rows.map(function (r) {
    var nameHtml = r.link
      ? '<a href="' + esc(r.link) + '" target="_blank" rel="noopener" class="vz-tbl-link">' + esc(r.name) + ' <span class="vz-ext">↗</span></a>'
      : '<span class="vz-tbl-name">' + esc(r.name) + '</span>';
    var mark = r.done ? '<span class="vz-status vz-status--done">✓ Skickat</span>'
      : (r.exists ? '<span class="vz-status vz-status--pending">○ Ej skickat</span>'
        : '<span class="vz-status vz-status--missing">– saknas i checklista</span>');
    return '<tr><td class="vz-tbl-namecell">' + nameHtml + '</td><td class="vz-tbl-statuscell">' + mark + '</td></tr>';
  }).join('');
  var table = rows.length
    ? '<table class="vz-tbl vz-tbl--hf"><colgroup><col class="vz-col-name"><col class="vz-col-status"></colgroup>'
      + '<tbody>' + bodyRows + '</tbody></table>'
    : '<div class="vz-panel-empty">Inga deltagare.</div>';
  var withLink = rows.filter(function (r) { return r.link; }).length;
  sec.innerHTML = '<div class="vz-panel-head">'
    + '<div class="vz-panel-title">Hälsoformulär till läkare</div>'
    + '<div class="vz-panel-meta">' + done + '/' + rows.length + ' skickade</div></div>'
    + '<div class="vz-panel-note">Namn med ↗ länkar till hälsoformuläret. Status speglar checklistpunkten "Delat Hälsoformulär till läkare/kursledare".</div>'
    + table
    + '<div class="vz-stub-row">'
    + '<button class="vz-btn" id="vz-hf-doctor">Skicka till läkare</button>'
    + '<span class="vz-stub-note">förhandsvisning (dry-run) — inget skickas</span></div>'
    + '<div id="vz-hf-doctor-out" class="vz-panel-note" style="display:none"></div>'
    + '<div class="vz-allergi-box">'
    + '<div class="vz-allergi-title">Matallergier</div>'
    + '<textarea id="vz-allergi" placeholder="Matallergier sammanställs här…" class="vz-textarea"></textarea>'
    + '<div class="vz-allergi-actions"><button class="vz-btn" id="vz-allergi-btn">Matallergier</button>'
    + '<span class="vz-stub-note">läser hälsoformulär + assistentkort anonymiserat (koder, ej namn)</span></div></div>';
  host.appendChild(sec);

  // ── Matallergier: skicka BARA koder + HF-länkar (inga namn) till GAS,
  //    ersätt koderna med riktiga namn lokalt i svaret.
  var allergiBtn = sec.querySelector('#vz-allergi-btn');
  var allergiOut = sec.querySelector('#vz-allergi');
  // Rutan växer med innehållet.
  function fitAllergi() { if (allergiOut) { allergiOut.style.height = 'auto'; allergiOut.style.height = (allergiOut.scrollHeight + 4) + 'px'; } }
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

      asstP.then(function (cards) {
        (cards || []).forEach(function (c, i) {
          if (['assistenter', 'intresserad', 'status'].some(function (x) { return norm(c.name).indexOf(x) !== -1; })) { return; }
          var nm = cleanStaffName(c.name);
          var blob = stripStaffDescForAI(c.desc, nm);
          if (!blob) { return; }
          var code = 'A' + (i + 1);
          items.push({ code: code, allergy: blob });
          codeToName[code] = nm;
        });
        if (!items.length) {
          allergiOut.value = 'Inget underlag än: inga deltagare med hälsoformulär-länk och inga assistentkort.';
          allergiBtn.disabled = false;
          return;
        }
        allergiOut.value = '⏳ Läser ' + items.length + ' underlag (deltagare + assistenter) och sammanställer…';
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
          // Avanonymisera: byt varje kod (Pn/An) mot riktigt namn, lokalt.
          var text = String(data.summary || '');
          Object.keys(codeToName).forEach(function (code) {
            text = text.replace(new RegExp('\\b' + code + '\\b', 'g'), codeToName[code]);
          });
          allergiOut.value = text || '(tomt svar)';
          if (text) { persistText(allergiKey, allergiOut.value); }   // överlever stäng/öppna
        });
      }).catch(function (err) {
        allergiOut.value = '⚠️ ' + err.message;
      }).then(function () { allergiBtn.disabled = false; fitAllergi(); });
    });
  }

  // ── Skicka till läkare: dry-run förhandsvisning (inget skickas skarpt).
  var docBtn = sec.querySelector('#vz-hf-doctor');
  var docOut = sec.querySelector('#vz-hf-doctor-out');
  if (docBtn) {
    docBtn.addEventListener('click', function () {
      var withHf = rows.filter(function (r) { return r.link; });
      if (!withHf.length) {
        docOut.style.display = ''; docOut.textContent = 'Inga deltagare har en hälsoformulär-länk att skicka än.';
        return;
      }
      var doctorEmail = '';
      try { doctorEmail = (window.prompt('Läkarens e-postadress (lämna tom för att bara förhandsvisa):', '') || '').trim(); } catch (e) { doctorEmail = ''; }
      var items = withHf.map(function (r) { return { name: r.name, url: r.link }; });
      docBtn.disabled = true;
      docOut.style.display = ''; docOut.textContent = '⏳ Förhandsvisar…';
      postToGas('sendHealthFormsToDoctor', { dryRun: true, doctorEmail: doctorEmail, items: items }).then(function (data) {
        if (!data || data.ok !== true) {
          docOut.textContent = '⚠️ ' + ((data && data.error) || 'okänt fel');
          return;
        }
        var okN = (data.preview || []).filter(function (p) { return p.resolved; }).length;
        docOut.textContent = 'Skulle skicka ' + okN + '/' + items.length + ' hälsoformulär till '
          + (data.doctorEmail || '(ingen läkare angiven)') + '. Inget skickades — bekräfta-steg kommer.';
      }).catch(function (err) {
        docOut.textContent = '⚠️ ' + err.message;
      }).then(function () { docBtn.disabled = false; });
    });
  }
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
  // Livsberättelse-länk per deltagare ur kort-kommentar.
  var storyLinks = {};
  (cards || []).forEach(function (c) { storyLinks[c.id] = commentLink(c, STORY_LINK_RES); });
  var GL = STAFF_BOARDS[0];
  function asObj(x) { return (x && typeof x === 'object') ? x : {}; }
  t.getRestApi().getToken().then(function (token) {
    if (!token) { return null; }
    return Promise.all([
      restGet(token, 'members/me/boards?fields=name&filter=open'),
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
          var leaders = (cs || []).map(function (c) { var p = staffPerson(c, GL); return p ? p.name : null; }).filter(Boolean);
          return { leaders: leaders, selStory: selStory, selFollow: selFollow };
        });
      });
    });
  }).then(function (d) {
    if (!d) { return; }
    renderStoryMatrix(key, participants || [], d.leaders, d.selStory, {
      title: 'Livsberättelser → gruppledare', storyLinks: storyLinks, kind: 'livsberattelse',
      note: 'Bocka vilken gruppledare som läser vilken deltagares livsberättelse. Sparas automatiskt.',
    });
    renderStoryMatrix(followKey, participants || [], d.leaders, d.selFollow, {
      title: 'Uppföljningssamtal → gruppledare', storyLinks: {}, kind: 'uppfoljning',
      note: 'Bocka vilken gruppledare som har uppföljningssamtal med vilken deltagare. Sparas automatiskt.',
    });
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

function renderStoryMatrix(key, participants, leaders, sel, opts) {
  opts = opts || {}; sel = sel || {};
  var storyLinks = opts.storyLinks || {};
  var host = vzRegion('below');
  if (!host) { return; }
  var sec = document.createElement('section');
  // Matriserna ligger 2-i-bredd i below-griddet (egen horisontell scroll vid behov).
  sec.className = 'vz-panel vz-panel--below';
  var head = '<div class="vz-panel-title">' + esc(opts.title || 'Matris') + '</div>';
  if (!leaders.length) {
    sec.innerHTML = head + '<div class="vz-panel-empty">Inga gruppledare hittade för kursen (kontrollera Gruppledare-boarden + listnamn).</div>';
    host.appendChild(sec); return;
  }
  function cellKey(pk, ld) { return pk + '||' + ld; }
  function paint() {
    var ths = leaders.map(function (l) { return '<th class="vz-story-leader"><span class="vz-story-leader-label">' + esc(l) + '</span></th>'; }).join('');
    var trs = participants.map(function (p) {
      var cells = leaders.map(function (l) {
        var ck = cellKey(p.key, l);
        return '<td class="vz-story-cell"><input type="checkbox" data-ck="' + esc(ck) + '"' + (sel[ck] ? ' checked' : '') + ' class="vz-story-box"></td>';
      }).join('');
      var lk = storyLinks[p.key];
      var nm = lk ? '<a href="' + esc(lk) + '" target="_blank" rel="noopener" class="vz-tbl-link">' + esc(p.name) + ' <span class="vz-ext">↗</span></a>' : '<span class="vz-tbl-name">' + esc(p.name) + '</span>';
      return '<tr><td class="vz-story-namecell">' + nm + '</td>' + cells + '</tr>';
    }).join('');
    sec.innerHTML = head
      + '<div class="vz-panel-note">' + esc(opts.note || '') + '</div>'
      + '<div class="vz-story-scroll"><table class="vz-tbl vz-story-tbl"><thead><tr><th class="vz-story-corner">Deltagare</th>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table></div>'
      + '<div class="vz-stub-row">'
      + '<button class="vz-btn" id="vz-mail-btn">Skicka mail</button>'
      + '<span class="vz-stub-note">förhandsvisning (dry-run) — inget skickas</span></div>'
      + '<div id="vz-mail-out" class="vz-panel-note" style="display:none;white-space:pre-line"></div>';
    Array.prototype.forEach.call(sec.querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.addEventListener('change', function () { sel[cb.getAttribute('data-ck')] = cb.checked; try { t.set('board', 'shared', key, sel).catch(function () {}); } catch (e) {} });
    });
    var mailBtn = sec.querySelector('#vz-mail-btn');
    var mailOut = sec.querySelector('#vz-mail-out');
    if (mailBtn) {
      mailBtn.addEventListener('click', function () {
        var assignments = buildLeaderAssignments(sel, participants, leaders);
        if (!assignments.length) {
          mailOut.style.display = ''; mailOut.textContent = 'Bocka minst en deltagare per gruppledare först.';
          return;
        }
        mailBtn.disabled = true;
        mailOut.style.display = ''; mailOut.textContent = '⏳ Förhandsvisar…';
        postToGas('sendGroupLeaderMail', { dryRun: true, kind: opts.kind || '', assignments: assignments }).then(function (data) {
          if (!data || data.ok !== true) { mailOut.textContent = '⚠️ ' + ((data && data.error) || 'okänt fel'); return; }
          var lines = (data.preview || []).map(function (p) {
            return '• ' + p.leaderName + ' (' + (p.leaderEmail || 'mejl saknas') + '): ' + p.count + ' st';
          });
          mailOut.textContent = 'Skulle mejla ' + lines.length + ' gruppledare. Inget skickades — bekräfta-steg kommer.\n' + lines.join('\n');
        }).catch(function (err) {
          mailOut.textContent = '⚠️ ' + err.message;
        }).then(function () { mailBtn.disabled = false; });
      });
    }
  }
  paint();
  host.appendChild(sec);
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
    var model = buildCourseModel(res[0], res[1] || []);
    window.CourseView.render(ROOT(), model, handlers);
    loadStaff(res[0]);
    loadHfPanel(res[1] || [], res[0]);
    loadStoryMatrix(res[0], model.participants, res[1] || []);
    loadCourseChecklist(res[0]);
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
