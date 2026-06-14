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
            return { cfg: cfg, found: true, list: list.name, people: people };
          });
        }).catch(function () { return { cfg: cfg, found: true, people: [] }; });
      });
      return Promise.all(jobs);
    });
  }).then(function (groups) { if (groups) { renderStaffPanel(groups); } }).catch(function () { /* tyst */ });
}
function renderStaffPanel(groups) {
  var host = document.querySelector('.vz-course') || ROOT();
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.style.cssText = 'max-width:1400px;margin:6px auto 30px;padding:16px 22px;font-family:Calibri,"Segoe UI",system-ui,sans-serif;color:#0d3142';
  var cols = groups.map(function (g) {
    var body;
    if (!g.found) { body = '<div style="font-size:12.5px;color:#8aa3ac">Ingen board hittad</div>'; }
    else if (!g.people.length) { body = '<div style="font-size:12.5px;color:#8aa3ac">' + (g.list ? 'Inga tilldelade än' : 'Ingen kurslista hittad') + '</div>'; }
    else {
      body = g.people.map(function (p) {
        var roleTag = (p.role && p.role !== g.cfg.label) ? '<span style="font-size:11px;color:#5d7c87;margin-left:6px">· ' + esc(p.role) + '</span>' : '';
        return '<div style="font-size:13.5px;padding:3px 0;border-top:1px solid #eef3f4">' + esc(p.name) + roleTag + '</div>';
      }).join('');
    }
    var extra = (g.cfg.key === 'assistenter' && g.people.length)
      ? stubBtn('Alla emailadresser', 'Skulle samla och visa alla assistenters e-postadresser för kursen. Kopplas senare.')
      : '';
    return '<div style="flex:1 1 0;min-width:170px;background:#fff;border:1px solid #cfe0e2;border-radius:12px;padding:12px 14px;box-shadow:0 4px 14px rgba(8,68,92,.08)">'
      + '<div style="font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#357087;margin-bottom:6px">' + esc(g.cfg.label) + (g.people.length ? ' · ' + g.people.length : '') + '</div>'
      + body + extra + '</div>';
  }).join('');
  sec.innerHTML = '<div style="font-family:Fraunces,Georgia,serif;font-size:19px;font-weight:600;margin-bottom:10px;color:#08445c">Personal på kursen</div>'
    + '<div style="display:flex;gap:14px;flex-wrap:wrap">' + cols + '</div>';
  host.appendChild(sec);
  wireStubs(sec);
}

/* ---------- Kursnivå-checklista (#3) — GLOBAL per kurssteg (Malins beslut) ----------
 * Delas över alla kursomgångar; Steg 1/2/3A har varsin lista. Lagras board-shared.
 */
function courseKey(name) {
  var m = String(name || '').match(/steg\s*([0-9a-zåäö]+)/i);
  var steg = m ? norm(m[1]) : 'global';
  return 'vz_chk_steg_' + steg;
}
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
  var host = document.querySelector('.vz-course') || ROOT();
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.style.cssText = 'max-width:1400px;margin:6px auto 34px;padding:16px 22px;font-family:Calibri,"Segoe UI",system-ui,sans-serif;color:#0d3142';
  function paint() {
    var done = items.filter(function (i) { return i.done; }).length;
    var rows = items.map(function (it, idx) {
      return '<label data-i="' + idx + '" class="vzchk-row" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #eef3f4;cursor:pointer">'
        + '<input type="checkbox" data-i="' + idx + '"' + (it.done ? ' checked' : '') + ' style="width:17px;height:17px;accent-color:#1f7a53;flex:none">'
        + '<span style="flex:1 1 auto;font-size:14px;' + (it.done ? 'text-decoration:line-through;color:#8aa3ac' : '') + '">' + esc(it.text) + '</span>'
        + '<button data-del="' + idx + '" title="Ta bort" style="border:none;background:none;cursor:pointer;color:#b23a2e;font-size:15px;padding:2px 6px">✕</button>'
        + '</label>';
    }).join('');
    sec.innerHTML = '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px">'
      + '<div style="font-family:Fraunces,Georgia,serif;font-size:19px;font-weight:600;color:#08445c">Kurschecklista</div>'
      + '<div style="font-size:12.5px;color:#5d7c87">' + done + '/' + items.length + ' klara · sparas automatiskt</div></div>'
      + rows
      + '<div style="display:flex;gap:8px;margin-top:12px;border-top:1px solid #eef3f4;padding-top:12px">'
      + '<input id="vzchk-new" placeholder="Lägg till uppgift på kursnivå…" style="flex:1 1 auto;font-family:inherit;font-size:14px;padding:8px 10px;border:1px solid #cfe0e2;border-radius:8px">'
      + '<button id="vzchk-add" style="border:none;cursor:pointer;background:#357087;color:#fff;font-weight:700;font-size:13.5px;padding:8px 14px;border-radius:8px;font-family:inherit">Lägg till</button></div>';
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
function loadHfPanel(cards) {
  var rows = (cards || []).map(function (c) {
    var hf = hfDoneForCard(c);
    return { name: (c.name || '').replace(/^\s*\d+\s*[-–]\s*/, ''), exists: hf.exists, done: hf.done };
  });
  renderHfPanel(rows);
}
function renderHfPanel(rows) {
  var host = document.querySelector('.vz-course') || ROOT();
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.style.cssText = 'max-width:1400px;margin:6px auto 30px;padding:16px 22px;font-family:Calibri,"Segoe UI",system-ui,sans-serif;color:#0d3142';
  var done = rows.filter(function (r) { return r.done; }).length;
  var body = rows.map(function (r) {
    var mark = r.done ? '<span style="color:#1f7a53;font-weight:700">✓ Skickat</span>'
      : (r.exists ? '<span style="color:#b5710b;font-weight:700">○ Ej skickat</span>'
        : '<span style="color:#8aa3ac">– saknas i checklista</span>');
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid #eef3f4">'
      + '<span style="font-size:14px">' + esc(r.name) + '</span>' + mark + '</div>';
  }).join('') || '<div style="font-size:13px;color:#8aa3ac">Inga deltagare.</div>';
  sec.innerHTML = '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px">'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:19px;font-weight:600;color:#08445c">Hälsoformulär till läkare</div>'
    + '<div style="font-size:12.5px;color:#5d7c87">' + done + '/' + rows.length + ' skickade</div></div>'
    + '<div style="font-size:12.5px;color:#5d7c87;margin-bottom:4px">Speglar checklistpunkten "Delat Hälsoformulär till läkare/kursledare" på varje kort. Av-/påbockning härifrån kopplas senare.</div>'
    + body
    + stubBtn('Skicka till läkare', 'Skulle skicka ' + done + ' hälsoformulär till läkaren för bedömning. Kopplas server-side (med bekräftelse) senare.');
  host.appendChild(sec);
  wireStubs(sec);
}

// Åtgärdsknapp-stub: visar vad den SKULLE göra (mejl/sidoeffekter kopplas server-side).
function stubBtn(label, msgText) {
  return '<div style="margin-top:12px;border-top:1px solid #eef3f4;padding-top:12px">'
    + '<button class="vz-stub" data-msg="' + esc(msgText) + '" style="border:none;cursor:pointer;background:#357087;color:#fff;font-weight:700;font-size:13.5px;padding:9px 16px;border-radius:9px;font-family:inherit">' + esc(label) + '</button>'
    + '<span style="font-size:11.5px;color:#8aa3ac;margin-left:10px">stub — kopplas senare</span></div>';
}
function wireStubs(scope) {
  Array.prototype.forEach.call(scope.querySelectorAll('.vz-stub'), function (b) {
    b.addEventListener('click', function () { t.alert({ message: b.getAttribute('data-msg'), duration: 8, display: 'info' }); });
  });
}

/* ---------- Livsberättelse-matris (#3): deltagare × gruppledare ---------- */
function loadStoryMatrix(courseName, participants) {
  var key = 'vz_story_' + norm(courseName).replace(/[^a-z0-9]+/g, '_');
  t.getRestApi().getToken().then(function (token) {
    if (!token) { return null; }
    return Promise.all([
      restGet(token, 'members/me/boards?fields=name&filter=open'),
      t.get('board', 'shared', key).catch(function () { return {}; }),
    ]).then(function (r) {
      var boards = r[0] || [], sel = (r[1] && typeof r[1] === 'object') ? r[1] : {};
      var b = boards.filter(function (bd) { return /gruppled|ledare/i.test(bd.name || ''); })[0];
      if (!b) { return { leaders: [], sel: sel }; }
      return restGet(token, 'boards/' + b.id + '/lists?fields=name').then(function (lists) {
        var list = (lists || []).filter(function (l) { return sameCourse(l.name, courseName); })[0];
        if (!list) { return { leaders: [], sel: sel }; }
        return restGet(token, 'lists/' + list.id + '/cards?fields=name').then(function (cards) {
          return { leaders: (cards || []).map(function (c) { return cleanStaffName(c.name); }).filter(Boolean), sel: sel };
        });
      });
    });
  }).then(function (d) { if (d) { renderStoryMatrix(key, participants || [], d.leaders, d.sel); } }).catch(function () {});
}
function renderStoryMatrix(key, participants, leaders, sel) {
  var host = document.querySelector('.vz-course') || ROOT();
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.style.cssText = 'max-width:1400px;margin:6px auto 34px;padding:16px 22px;font-family:Calibri,"Segoe UI",system-ui,sans-serif;color:#0d3142;overflow-x:auto';
  var head = '<div style="font-family:Fraunces,Georgia,serif;font-size:19px;font-weight:600;color:#08445c;margin-bottom:6px">Livsberättelser → gruppledare</div>';
  if (!leaders.length) {
    sec.innerHTML = head + '<div style="font-size:13px;color:#8aa3ac">Inga gruppledare hittade för kursen (kontrollera Gruppledare-boarden + listnamn).</div>';
    host.appendChild(sec); return;
  }
  function cellKey(pk, ld) { return pk + '||' + ld; }
  function paint() {
    var ths = leaders.map(function (l) { return '<th style="font-size:11.5px;font-weight:700;color:#357087;padding:6px 8px;white-space:nowrap;writing-mode:vertical-rl;transform:rotate(180deg);max-height:120px">' + esc(l) + '</th>'; }).join('');
    var trs = participants.map(function (p) {
      var cells = leaders.map(function (l) {
        var ck = cellKey(p.key, l);
        return '<td style="text-align:center;padding:4px 8px;border-top:1px solid #eef3f4"><input type="checkbox" data-ck="' + esc(ck) + '"' + (sel[ck] ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:#1f7a53"></td>';
      }).join('');
      return '<tr><td style="font-size:13.5px;padding:4px 10px 4px 0;white-space:nowrap;border-top:1px solid #eef3f4">' + esc(p.name) + '</td>' + cells + '</tr>';
    }).join('');
    sec.innerHTML = head
      + '<div style="font-size:12.5px;color:#5d7c87;margin-bottom:8px">Bocka vilken gruppledare som läser vilken deltagares livsberättelse. Sparas automatiskt.</div>'
      + '<table style="border-collapse:collapse"><thead><tr><th></th>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table>'
      + stubBtn('Skicka mail', 'Skulle mejla varje gruppledare vilka livsberättelser hen ska läsa. Kopplas server-side (med bekräftelse) senare.');
    Array.prototype.forEach.call(sec.querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.addEventListener('change', function () { sel[cb.getAttribute('data-ck')] = cb.checked; try { t.set('board', 'shared', key, sel).catch(function () {}); } catch (e) {} });
    });
    wireStubs(sec);
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
    var cardsP = restGet(token, 'lists/' + listId + '/cards?fields=name,desc,labels,idList,url&checklists=all&checklist_fields=name&checkItem_fields=name,state');
    return Promise.all([nameP, cardsP]);
  }).then(function (res) {
    var model = buildCourseModel(res[0], res[1] || []);
    window.CourseView.render(ROOT(), model, handlers);
    loadStaff(res[0]);
    loadHfPanel(res[1] || []);
    loadStoryMatrix(res[0], model.participants);
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

document.addEventListener('DOMContentLoaded', boot);
