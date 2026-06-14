/* global TrelloPowerUp, window, document, location */
/*
 * Glue: bygger ett DashboardView-model ur riktig Trello-kortdata och renderar.
 *
 * Datakällor (kort-kontext):
 *   - t.card('name','desc','labels','checklists') — i KORT-kontext returneras
 *     checklists med checkItems+state (docs). name/desc/labels direkt.
 *   - status: checklistan = hård klar-markör; labels = triggers (label satt men
 *     ej bockad = 'gap' = luckan Malin glömmer). Se window.NYA_ZAPIER_FLOW.
 *
 * Kommentarer (mänskliga vs metadata) hämtas via Trello REST (t.getRestApi) och
 * visas i en panel under dashboarden (filtrerar bort faktura-/betalnings-brus).
 * "Kör/Bocka"-knappar är stubbar tills skarp körning är på plats.
 */
'use strict';

var CFG = window.NYA_ZAPIER_CONFIG;
var t = TrelloPowerUp.iframe({ appKey: CFG.APP_KEY, appName: CFG.APP_NAME, appAuthor: CFG.APP_AUTHOR });
var COMPACT = new URLSearchParams(location.search).get('compact') === '1';

function norm(s) { return String(s || '').trim().toLowerCase(); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function parseDesc(desc) {
  var out = {};
  String(desc || '').split('\n').forEach(function (line) {
    var m = line.match(/^\s*([^:]{2,30}):\s*(.+?)\s*$/);
    if (m) { out[norm(m[1])] = m[2]; }
  });
  return out;
}

// Logisk slutledning: om ett steg är 'done' promotas dess implies-steg till 'done'
// (Malin: "antagen ⇒ intervju har undantagslöst skett"). Markeras inferred.
function applyImplications(flow) {
  var byKey = {};
  flow.forEach(function (f) { byKey[f.key] = f; });
  (window.NYA_ZAPIER_FLOW || []).forEach(function (s) {
    if (!s.implies || !byKey[s.key] || byKey[s.key].status !== 'done') { return; }
    s.implies.forEach(function (k) {
      if (byKey[k] && byKey[k].status !== 'done') { byKey[k].status = 'done'; byKey[k].inferred = true; }
    });
  });
}

// Bygg DashboardView-model ur ett Trello-kortobjekt.
function buildModel(card) {
  card = card || {};
  var d = parseDesc(card.desc);

  var checked = {};
  (card.checklists || []).forEach(function (cl) {
    (cl.checkItems || []).forEach(function (it) {
      if (norm(it.state) === 'complete') { checked[norm(it.name)] = true; }
    });
  });
  var labels = {};
  (card.labels || []).forEach(function (l) { if (l.name) { labels[norm(l.name)] = true; } });

  // Robust matchning: exakt eller delsträng (tål små namnskillnader).
  function isChecked(name) {
    if (!name) { return false; }
    var n = norm(name);
    if (checked[n]) { return true; }
    return Object.keys(checked).some(function (k) { return k.indexOf(n) !== -1 || n.indexOf(k) !== -1; });
  }

  var flow = (window.NYA_ZAPIER_FLOW || []).map(function (s) {
    var checklistDone = isChecked(s.checkItem);
    var labelSet = s.triggerLabel ? !!labels[norm(s.triggerLabel)] : false;
    var status = s.always ? 'done'
      : checklistDone ? 'done'
      : s.triggerLabel ? (labelSet ? 'gap' : 'wait')
      : 'manual';
    return {
      key: s.key, title: s.title, desc: s.desc, status: status,
      automation: s.automation || null, triggerLabel: s.triggerLabel || null,
      labelSet: labelSet, checklistDone: checklistDone,
      checkItemName: s.checkItem || null, phase: s.phase || 'Steg', events: [],
    };
  });

  applyImplications(flow);

  var order = [], map = {};
  flow.forEach(function (s) {
    if (!map[s.phase]) {
      map[s.phase] = { key: norm(s.phase).replace(/[^a-z0-9]+/g, '-'), title: s.phase, subtitle: '', steps: [] };
      order.push(s.phase);
    }
    map[s.phase].steps.push(s);
  });
  var phases = order.map(function (p) { return map[p]; });

  var done = flow.filter(function (f) { return f.status === 'done'; }).length;
  var total = flow.length;

  return {
    participant: {
      name: (card.name || '').replace(/^\s*\d+\s*[-–]\s*/, ''),
      kursvecka: d['önskad kursvecka'] || d['onskad kursvecka'] || '',
      epost: d['epost'] || '',
      telefon: d['telefonnummer'] || '',
    },
    phases: phases,
    progress: { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0 },
  };
}

function firstGap(model) {
  var next = null;
  model.phases.forEach(function (p) {
    p.steps.forEach(function (s) { if (!next && s.status !== 'done') { next = s; } });
  });
  return next;
}

// Stubbade åtgärder (skarp server-side-körning kopplas senare).
var handlers = {
  onSelectStep: function () {},
  onRunLabel: function (s) {
    t.alert({
      message: 'Skulle sätta labeln "' + (s.triggerLabel || '') + '" och starta ' + (s.automation || 'steget')
        + '. Skarp körning kopplas server-side.',
      duration: 8, display: 'info',
    });
  },
  onTickChecklist: function (s) {
    t.alert({
      message: 'Skulle bocka av "' + (s.checkItemName || s.title) + '" i checklistan. Skarp körning kopplas server-side.',
      duration: 8, display: 'info',
    });
  },
};

function bootFull() {
  t.card('id', 'name', 'desc', 'labels', 'checklists').then(function (card) {
    var model = buildModel(card || {});
    window.DashboardView.render(document.getElementById('root'), model, handlers);
    if (card && card.id) { loadComments(card.id); }
  }).catch(function (err) {
    document.getElementById('root').innerHTML =
      '<div style="padding:28px;font-family:Calibri,sans-serif;color:#b23a2e">⚠️ Kunde inte läsa kortet: ' + esc(err.message) + '</div>';
  });
}

/* ---------- Kommentarspanel (mänskliga kommentarer, ej metadata) ---------- */
function restGet(token, path) {
  var sep = path.indexOf('?') === -1 ? '?' : '&';
  return fetch('https://api.trello.com/1/' + path + sep + 'key=' + encodeURIComponent(CFG.APP_KEY) + '&token=' + encodeURIComponent(token))
    .then(function (r) { if (!r.ok) { throw new Error('Trello ' + r.status); } return r.json(); });
}
// Metadata-brus att gömma (faktura/betalning) → fram med mänskliga noteringar.
var META_RE = /faktura|betal[dt]|\bfakt\b|\d{3,}\s*kr|\bkr\b/i;
function loadComments(cardId) {
  t.getRestApi().getToken().then(function (token) {
    if (!token) { return null; }
    return restGet(token, 'cards/' + cardId + '/actions?filter=commentCard&limit=40');
  }).then(function (actions) {
    if (!actions) { return; }
    var all = actions.map(function (a) {
      return { text: (a.data && a.data.text) || '', who: (a.memberCreator && a.memberCreator.fullName) || '', date: String(a.date || '').slice(0, 10) };
    }).filter(function (c) { return c.text; });
    var human = all.filter(function (c) { return !META_RE.test(c.text); });
    renderCommentsPanel(human, all.length - human.length);
  }).catch(function () { /* tyst — panel utelämnas om token saknas/fel */ });
}
function renderCommentsPanel(comments, metaCount) {
  var host = document.querySelector('.vz-cockpit');
  if (!host) { return; }
  var sec = document.createElement('section');
  sec.style.cssText = 'background:#fff;border-top:1px solid #cfe0e2;padding:18px 26px;font-family:Calibri,"Segoe UI",system-ui,sans-serif;color:#0d3142';
  var rows = comments.length ? comments.map(function (c) {
    return '<div style="padding:10px 0;border-top:1px solid #eef3f4">'
      + '<div style="font-size:12px;color:#5d7c87;margin-bottom:2px">' + esc(c.who) + (c.date ? ' · ' + esc(c.date) : '') + '</div>'
      + '<div style="font-size:14px;line-height:1.45;white-space:pre-wrap">' + esc(c.text) + '</div></div>';
  }).join('') : '<div style="font-size:13px;color:#5d7c87;padding:6px 0">Inga handskrivna kommentarer om deltagaren ännu.</div>';
  sec.innerHTML = '<div style="font-family:Fraunces,Georgia,serif;font-size:19px;font-weight:600">Kommentarer om deltagaren</div>'
    + '<div style="font-size:12px;color:#5d7c87;margin:3px 0 6px">Mänskliga noteringar' + (metaCount ? ' · ' + metaCount + ' faktura-/betalningsnotis(er) dolda' : '') + '</div>'
    + rows;
  host.appendChild(sec);
}

// Kompakt strip för card-back-section (egen minimal stil, ej .vz-dash).
function bootCompact() {
  // Kompakt strip ska hugga innehållet → höjd auto (full-läget använder 100%).
  document.documentElement.style.height = 'auto';
  document.body.style.height = 'auto';
  t.card('name', 'labels', 'checklists').then(function (card) {
    var model = buildModel(card || {});
    var next = firstGap(model);
    var gaps = 0;
    model.phases.forEach(function (p) { p.steps.forEach(function (s) { if (s.status === 'gap') { gaps++; } }); });
    var pr = model.progress;
    document.getElementById('root').innerHTML =
      '<div style="font-family:Calibri,\'Segoe UI\',system-ui,sans-serif;display:flex;align-items:center;gap:10px;padding:8px 4px;color:#08445c">'
      + '<span style="font-weight:700;font-size:13px">' + pr.done + '/' + pr.total + '</span>'
      + '<div style="flex:1 1 auto;height:8px;border-radius:6px;background:#bcd9db;overflow:hidden"><i style="display:block;height:100%;width:' + pr.pct + '%;background:linear-gradient(90deg,#357087,#1f7a53)"></i></div>'
      + (gaps ? '<span style="font-size:12px;color:#b5710b;font-weight:700;white-space:nowrap">⚠ ' + gaps + ' att bocka</span>' : '')
      + '<span style="font-size:12.5px;color:#4d7c8e;white-space:nowrap">' + (next ? 'Nästa: ' + esc(next.title) : 'Allt klart 🎉') + '</span>'
      + '<button id="vzopen" style="border:none;cursor:pointer;background:#08445c;color:#fff;font-weight:700;font-size:12.5px;padding:6px 12px;border-radius:8px;font-family:inherit;white-space:nowrap">Öppna</button>'
      + '</div>';
    document.getElementById('vzopen').addEventListener('click', function () {
      t.modal({ url: './dashboard.html', fullscreen: true, title: 'Vitalisera – Deltagarstatus', accentColor: '#08445c' });
    });
    t.sizeTo('body').catch(function () {});
  }).catch(function () {});
}

// Esc stänger modalen (fullvy) oavsett fokus. Kompakt strip = ingen modal.
if (!COMPACT) {
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { try { t.closeModal(); } catch (_) {} }
  });
}
document.addEventListener('DOMContentLoaded', function () {
  if (COMPACT) { bootCompact(); } else { bootFull(); }
});
