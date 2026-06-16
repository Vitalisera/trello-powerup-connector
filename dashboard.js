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
    // Korten skriver fälten i markdown-fetstil ("**Namn:** …") → strippa * först,
    // annars hamnar ** i nyckeln och uppslag som d['epost'] missar (William-buggen).
    var clean = line.replace(/\*+/g, '').trim();
    var m = clean.match(/^([^:]{2,30}):\s*(.+?)\s*$/);
    if (!m) { return; }
    var val = m[2].trim();
    // Markdown-länk "[text](url)" → visa texten (t.ex. mailto-länkad e-post).
    var link = val.match(/^\[([^\]]+)\]\([^)]*\)$/);
    if (link) { val = link[1].trim(); }
    out[norm(m[1])] = val;
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

  // checkItems per namn → {id, idChecklist, complete}. id behövs för skarp bockning.
  var ciByName = {};
  (card.checklists || []).forEach(function (cl) {
    (cl.checkItems || []).forEach(function (it) {
      ciByName[norm(it.name)] = { id: it.id, idChecklist: cl.id, complete: norm(it.state) === 'complete' };
    });
  });
  var labels = {};
  (card.labels || []).forEach(function (l) { if (l.name) { labels[norm(l.name)] = true; } });

  // Robust matchning: exakt eller delsträng (tål små namnskillnader).
  function findCheckItem(name) {
    if (!name) { return null; }
    var n = norm(name);
    if (ciByName[n]) { return ciByName[n]; }
    var k = Object.keys(ciByName).filter(function (k) { return k.indexOf(n) !== -1 || n.indexOf(k) !== -1; })[0];
    return k ? ciByName[k] : null;
  }

  var flow = (window.NYA_ZAPIER_FLOW || []).map(function (s) {
    var ci = findCheckItem(s.checkItem);
    var checklistDone = !!(ci && ci.complete);
    var labelSet = s.triggerLabel ? !!labels[norm(s.triggerLabel)] : false;
    var status = s.always ? 'done'
      : checklistDone ? 'done'
      : s.triggerLabel ? (labelSet ? 'gap' : 'wait')
      : 'manual';
    return {
      key: s.key, title: s.title, desc: s.desc, status: status,
      automation: s.automation || null, triggerLabel: s.triggerLabel || null,
      labelSet: labelSet, checklistDone: checklistDone,
      checkItemName: s.checkItem || null,
      checkItemId: ci ? ci.id : null, // skarp bockning (PUT checkItem)
      phase: s.phase || 'Steg', events: [],
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

/* ---------- Skarpa åtgärder (gap-stängning) ----------
 * onRunLabel  : sätter triggerlabeln på kortet (POST idLabels) → startar nya-zapier-automationen.
 * onTickChecklist : bockar checklistepunkten (PUT checkItem state=complete).
 * Säkerhet: (1) bekräfta-dialog (t.popup confirm) före varje skrivning, (2) test-läge
 * (vz_settings.testMode) → simulera, skriv ALDRIG skarpt, (3) idempotens (hoppa om redan satt/bockad).
 */
var CARD_ID = null; // sätts av bootFull

function notify(msg, kind) { try { t.alert({ message: msg, duration: 8, display: kind || 'info' }); } catch (e) {} }
function getSettings() { return t.get('board', 'shared', 'vz_settings').then(function (s) { return s || {}; }).catch(function () { return {}; }); }

// Trello-skrivning (POST/PUT) via REST med appKey+token. Returnerar JSON.
function restWrite(method, path) {
  return t.getRestApi().getToken().then(function (token) {
    if (!token) { throw new Error('Ingen Trello-token — anslut Power-Up:en (Kursöversikt → Anslut) först.'); }
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    return fetch('https://api.trello.com/1/' + path + sep + 'key=' + encodeURIComponent(CFG.APP_KEY) + '&token=' + encodeURIComponent(token), { method: method })
      .then(function (r) { if (!r.ok) { throw new Error('Trello ' + r.status); } return r.json(); });
  });
}

function doRunLabel(s) {
  return getSettings().then(function (set) {
    if (set.testMode) { notify('TEST-läge: skulle satt labeln "' + s.triggerLabel + '" (ingen ändring gjordes).', 'info'); return; }
    if (!CARD_ID) { throw new Error('Kort-id saknas.'); }
    return t.board('labels').then(function (b) {
      var lbl = ((b && b.labels) || []).filter(function (l) { return norm(l.name) === norm(s.triggerLabel); })[0];
      if (!lbl) { throw new Error('Hittar ingen label "' + s.triggerLabel + '" på brädan.'); }
      return restWrite('POST', 'cards/' + CARD_ID + '/idLabels?value=' + encodeURIComponent(lbl.id));
    }).then(function () { notify('✓ Satte "' + s.triggerLabel + '" — automationen "' + (s.automation || '') + '" startar.', 'success'); bootFull(); });
  }).catch(function (err) { notify('⚠️ ' + err.message, 'error'); });
}

function doTick(s) {
  return getSettings().then(function (set) {
    if (set.testMode) { notify('TEST-läge: skulle bockat "' + s.checkItemName + '" (ingen ändring gjordes).', 'info'); return; }
    if (!CARD_ID) { throw new Error('Kort-id saknas.'); }
    return restWrite('PUT', 'cards/' + CARD_ID + '/checkItem/' + s.checkItemId + '?state=complete')
      .then(function () { notify('✓ Bockade "' + s.checkItemName + '".', 'success'); bootFull(); });
  }).catch(function (err) { notify('⚠️ ' + err.message, 'error'); });
}

// IN-MODAL bekräftelse — t.popup renderar INTE inifrån en fullscreen t.modal (känd Trello-begränsning;
// gav stum knapp i kursvyns Skicka). Vi äger modalens DOM → en egen overlay-dialog, garanterat synlig.
function inModalConfirm(message, confirmText, onYes) {
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,68,92,.35);display:flex;align-items:center;justify-content:center;font-family:Calibri,system-ui,sans-serif';
  var box = document.createElement('div');
  box.style.cssText = 'background:#fff;max-width:420px;margin:16px;padding:20px 22px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);color:#0d3142';
  var p = document.createElement('div'); p.style.cssText = 'font-size:14.5px;line-height:1.5;margin-bottom:16px'; p.textContent = message;
  var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
  var no = document.createElement('button'); no.textContent = 'Avbryt'; no.style.cssText = 'border:none;cursor:pointer;background:#7a8a91;color:#fff;font-weight:700;padding:8px 16px;border-radius:8px;font-family:inherit';
  var yes = document.createElement('button'); yes.textContent = confirmText || 'Bekräfta'; yes.style.cssText = 'border:none;cursor:pointer;background:#357087;color:#fff;font-weight:700;padding:8px 16px;border-radius:8px;font-family:inherit';
  row.appendChild(no); row.appendChild(yes); box.appendChild(p); box.appendChild(row); ov.appendChild(box);
  (document.body || document.documentElement).appendChild(ov);
  function close() { ov.remove(); }
  no.addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) { close(); } });
  yes.addEventListener('click', function () { close(); onYes(); });
}

var handlers = {
  onSelectStep: function () {},
  onRunLabel: function (s) {
    if (!s.triggerLabel) { return; }
    if (s.labelSet) { notify('Labeln "' + s.triggerLabel + '" är redan satt.', 'info'); return; }
    inModalConfirm('Sätter labeln "' + s.triggerLabel + '" på kortet, vilket startar automationen "' + (s.automation || '') + '" (kan skicka mejl till deltagaren). Fortsätt?', 'Sätt label', function () { doRunLabel(s); });
  },
  onTickChecklist: function (s) {
    if (!s.checkItemName) { notify('Det här steget har ingen checklistepunkt.', 'info'); return; }
    if (s.checklistDone) { notify('"' + s.checkItemName + '" är redan bockad.', 'info'); return; }
    if (!s.checkItemId) { notify('Hittar inte checklistepunktens id — bocka i kortet manuellt.', 'error'); return; }
    inModalConfirm('Bockar av "' + s.checkItemName + '" i kortets checklista. Fortsätt?', 'Bocka av', function () { doTick(s); });
  },
};

// checkItem-states är OPÅLITLIGA via t.card('checklists') (Trello-begränsning, jfr Vy2 som
// därför läser REST). Hämta checklistorna via REST → korrekta states + pålitliga checkItem-id.
// Fallback: ingen token/fel → behåll t.card-checklistorna (best effort).
function fetchChecklistsREST(cardId) {
  if (!cardId) { return Promise.resolve(null); }
  return t.getRestApi().getToken().then(function (token) {
    if (!token) { return null; }
    return restGet(token, 'cards/' + cardId + '/checklists?checkItems=all&checkItem_fields=name,state&fields=name');
  }).catch(function () { return null; });
}

function bootFull() {
  t.card('id', 'name', 'desc', 'labels', 'checklists').then(function (card) {
    card = card || {};
    CARD_ID = card.id || null; // för skarpa skrivningar (label/checkItem)
    return Promise.all([
      fetchChecklistsREST(card.id),
      t.list('name').catch(function () { return null; }), // för kursvecka-fallback (= kurslistans namn)
    ]).then(function (r) {
      if (r[0]) { card.checklists = r[0]; } // REST (pålitligt) ersätter t.card; annars best effort
      var model = buildModel(card);
      // Kursvecka: deltagarens önskemål ur beskrivningen, annars kurslistans namn (= faktisk kurs).
      if (!model.participant.kursvecka && r[1] && r[1].name) { model.participant.kursvecka = r[1].name; }
      window.DashboardView.render(document.getElementById('root'), model, handlers);
      if (card.id) { loadComments(card.id); }
    });
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
// Metadata-brus att gömma → fram med mänskliga noteringar. Inkluderar bot-postade länk-kommentarer
// ("Länk till mappen/Hälsoformuläret/Livsberättelsen/Nulägesbeskrivningen") som EJ är mänskliga (#12, Robert 2026-06-16).
var META_RE = /faktura|betal[dt]|\bfakt\b|\d{3,}\s*kr|\bkr\b|l[äa]nk till (mappen|h[äa]lsoformul|livsber|nul[äa]gesbeskriv)/i;
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
  t.card('id', 'name', 'labels', 'checklists').then(function (card) {
    card = card || {};
    return fetchChecklistsREST(card.id).then(function (cls) {
    if (cls) { card.checklists = cls; } // pålitliga states (annars t.card best effort)
    var model = buildModel(card);
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
    });
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
