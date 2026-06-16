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
// Kursens startdatum ur listnamnet (ex "24 juni - 2 juli 2026 (Steg 1)") → Date, eller null. Ren funktion.
function courseStartDate(listName) {
  var m = String(listName || '').match(/(\d{1,2})\s+([a-zåäö]+).*?(\d{4})/i);
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
  // #19: deadline-dagar (board-shared per kursinstans) → visa deadline-DATUM ur kursens startdatum.
  var ddKey = 'vz_deadline_days_' + courseSlug(courseName || '');
  var deadlineDays = '';
  // Ladda ev. sparat deadline-värde (board-shared) → fyll input + datum när det kommit.
  t.get('board', 'shared', ddKey).then(function (v) {
    if (v != null && v !== '') {
      deadlineDays = String(v);
      var inp = sec.querySelector('#vzchk-dd'), out = sec.querySelector('#vzchk-dd-out');
      if (inp) { inp.value = deadlineDays; } if (out) { out.innerHTML = ddOutHtml(); }
    }
  }).catch(function () {});
  function ddOutHtml() {
    var ddStr = deadlineDateStr(courseName, deadlineDays);
    if (ddStr) { return '→ <strong>' + esc(ddStr) + '</strong>'; }
    return (deadlineDays !== '' && courseName) ? '<span class="vz-stub-note">(kunde ej tolka kursdatum)</span>' : '';
  }
  function paint() {
    var done = items.filter(function (i) { return i.done; }).length;
    var deadlineRow = '<div class="vzchk-deadline">'
      + '<label for="vzchk-dd">Deadline: lämna in senast </label>'
      + '<input id="vzchk-dd" type="number" min="0" class="vz-input" style="width:64px;display:inline-block" value="' + esc(deadlineDays) + '" placeholder="dagar"> dagar innan kursstart'
      + ' <span id="vzchk-dd-out">' + ddOutHtml() + '</span>'
      + '</div>';
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
      + deadlineRow
      + '<div class="vzchk-list">' + rows + '</div>'
      + '<div class="vzchk-add-row">'
      + '<input id="vzchk-new" placeholder="Lägg till uppgift på kursnivå…" class="vz-input">'
      + '<button id="vzchk-add" class="vz-btn">Lägg till</button></div>';
    // #19 deadline-input: uppdatera datumvisning live (utan re-paint → behåll fokus), persist på change.
    var ddInp = sec.querySelector('#vzchk-dd');
    var ddOut = sec.querySelector('#vzchk-dd-out');
    if (ddInp) {
      // Live: uppdatera bara datum-spanet (ingen re-paint → behåll fokus/cursor). Persist på change (blur).
      ddInp.addEventListener('input', function () { deadlineDays = ddInp.value; if (ddOut) { ddOut.innerHTML = ddOutHtml(); } });
      ddInp.addEventListener('change', function () { persistText(ddKey, String(deadlineDays || '')); });
    }
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
    + '<div class="vz-allergi-actions"><button class="vz-btn" id="vz-allergi-btn">Sammanställ matallergier</button>'
    + '<button class="vz-btn" id="vz-allergi-kock">Skicka till kock</button>'
    + '<span class="vz-stub-note">läser hälsoformulär + assistentkort anonymiserat (koder, ej namn)</span></div>'
    + '<div id="vz-allergi-info" class="vz-panel-note" style="display:none;margin-top:6px;color:#8a5a00"></div>'
    + '<div id="vz-allergi-kock-out" class="vz-panel-note" style="display:none"></div></div>';
  host.appendChild(sec);

  // ── Matallergier: skicka BARA koder + HF-länkar (inga namn) till GAS,
  //    ersätt koderna med riktiga namn lokalt i svaret.
  var allergiBtn = sec.querySelector('#vz-allergi-btn');
  var allergiOut = sec.querySelector('#vz-allergi');
  var allergiInfo = sec.querySelector('#vz-allergi-info');
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
          var mejl = greeting + '\n\n'
            + 'Här kommer en sammanställning av matallergierna inför kursen.\n\n'
            + 'Som det ser ut just nu är det ' + dCount + ' deltagare och ' + pCount + ' personal (inklusive dig).\n\n'
            + 'Deltagare (kopierat från hälsoformuläret):\n' + deltBody + '\n\n'
            + 'Personal:\n' + persBody + '\n\n'
            + 'Jag återkommer om det blir ändring i antal eller om någon ny allergi dyker upp.';
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
  var kockBtn = sec.querySelector('#vz-allergi-kock');
  var kockOut = sec.querySelector('#vz-allergi-kock-out');
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
  var docBtn = sec.querySelector('#vz-hf-doctor');
  var docOut = sec.querySelector('#vz-hf-doctor-out');
  if (docBtn) {
    docBtn.addEventListener('click', function () {
      // Modell (ur nya-zapiers Actions_CopyHealthFormToDoctor): när checklistpunkten
      // "Delat Hälsoformulär till läkare/kursledare" är IKRYSSAD finns redan en anonymiserad
      // kopia i mappen "HF till läkare - Kursnamn". DE IKRYSSADE är alltså de som ska till
      // läkaren. (Urkryssad = kopian borttagen.)
      var ready = rows.filter(function (r) { return r.done; });
      var notYet = rows.filter(function (r) { return r.link && !r.done; }).length;
      var noForm = rows.filter(function (r) { return !r.link; }).length;
      docOut.style.display = '';
      if (!ready.length) {
        docOut.textContent = 'Inga ikryssade deltagare än → ingen anonymiserad kopia finns att skicka. '
          + notYet + ' har hälsoformulär men är inte ikryssade än, ' + noForm + ' saknar HF-länk.';
        return;
      }
      docOut.textContent = ready.length + ' anonymiserade hälsoformulär (de ikryssade) ligger i mappen '
        + '"HF till läkare" och är de som ska till läkaren. ' + notYet + ' har HF men är inte ikryssade än, '
        + noForm + ' saknar HF-länk. Skarp delning till läkaren kopplas härnäst.';
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
  // Livsberättelse-länk per deltagare ur kort-kommentar + kontaktuppgifter ur kort-desc (#10 uppf-enskild).
  var storyLinks = {}, contactByKey = {};
  (cards || []).forEach(function (c) { storyLinks[c.id] = commentLink(c, STORY_LINK_RES); contactByKey[c.id] = parseContactFromDesc(c.desc); });
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
      title: 'Livsberättelser → gruppledare', storyLinks: storyLinks, kind: 'livsberattelse',
      note: 'Bocka vilken gruppledare som läser vilken deltagares livsberättelse. Sparas automatiskt.',
    });
    renderStoryMatrix(followKey, participants || [], d.leaders, d.selFollow, {
      title: 'Uppföljningssamtal → gruppledare', storyLinks: {}, kind: 'uppfoljning', courseName: courseName, contacts: contactByKey,
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
    docBtn.addEventListener('click', function () {
      docBtn.disabled = true; note.textContent = '⏳ Skapar dokument…';
      postToGas('createSummaryDoc', { dryRun: false, courseName: docCfg.courseName, groups: docCfg.getGroups ? docCfg.getGroups() : [] }).then(function (res) {
        if (res && res.ok && res.url) {
          // Etiketterad markdown-länk → blir en snygg <a> i mejlet (plainToHtml), inte en rå URL.
          var mdLink = '[länk till sammanfattningsdokumentet](' + res.url + ')';
          if (ta.value.indexOf('{SAMMANFATTNINGSLÄNK}') !== -1) { ta.value = ta.value.replace(/\{SAMMANFATTNINGSLÄNK\}/g, mdLink); }
          else { ta.value = ta.value + '\n\n' + mdLink; }
          if (pkey) { persistText(pkey, ta.value); }
          fit();
          note.textContent = res.existed ? '✓ Länk infogad (dokumentet fanns redan)' : '✓ Dokument skapat + länk infogad';
        } else {
          var err = (res && res.error) || 'kunde ej skapa dokument';
          var msg = err === 'course_folder_not_found' ? 'Hittar ingen kursmapp för "' + docCfg.courseName + '".'
            : err === 'no_assignments' ? 'Bocka minst en deltagare per gruppledare i matrisen först.'
            : err;
          if (res && res.detail) { msg += ' — ' + res.detail; }   // #7: visa det faktiska felet för felsökning
          note.textContent = '⚠️ ' + msg;
        }
        docBtn.disabled = false;
      }).catch(function (e) { note.textContent = '⚠️ ' + e.message; docBtn.disabled = false; });
    });
    row.appendChild(docBtn);
  }
  row.appendChild(note);
  wrap.appendChild(lbl); wrap.appendChild(ta); wrap.appendChild(row);
  function fit() { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 4) + 'px'; }
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
    return restGet(token, 'members/me/boards?fields=name&filter=open').then(function (boards) {
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
    return restGet(token, 'members/me/boards?fields=name&filter=open').then(function (boards) {
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
  var head = '<div class="vz-panel-title">' + esc(opts.title || 'Matris') + '</div>';
  if (!leaders.length) {
    sec.innerHTML = head + '<div class="vz-panel-empty">Inga gruppledare hittade för kursen (kontrollera Gruppledare-boarden + listnamn).</div>';
    host.appendChild(sec); return;
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
      + '<button class="vz-btn" id="vz-mail-btn">Skapa mejltext</button>'
      + '<span class="vz-stub-note">genererar redigerbar text — du granskar och skickar själv</span></div>'
      + '<div id="vz-mail-warn" class="vz-panel-note" style="color:#b5710b"></div>'
      + '<div id="vz-mail-out"></div>';
    Array.prototype.forEach.call(sec.querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.addEventListener('change', function () { sel[cb.getAttribute('data-ck')] = cb.checked; try { t.set('board', 'shared', key, sel).catch(function () {}); } catch (e) {} });
    });
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
  host.appendChild(sec);
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
    return restGet(token, 'members/me/boards?fields=name&filter=open').then(function (boards) {
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
    var model = buildCourseModel(res[0], res[1] || []);
    window.CourseView.render(ROOT(), model, handlers);
    loadGenderSplit(model.participants);
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
