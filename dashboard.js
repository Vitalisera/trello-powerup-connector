/* global TrelloPowerUp, window, document, location */
/*
 * Vitalisera deltagar-dashboard. Körs i t.modal (full) och card-back-section
 * (kompakt strip via ?compact=1).
 *
 * Status härleds ur kortet (t.card): "Administration"-checklistan = hård klar-
 * markör, labels = triggers (finns label → steget är igång). Se flödesmodellen
 * i config.js (window.NYA_ZAPIER_FLOW).
 *
 * Inga mutationer i denna draft — "Kör"-knappar visar vad de SKULLE göra.
 * (Skarp körning kopplas senare via GAS doPost / Trello-label, server-side.)
 */
'use strict';

var t = TrelloPowerUp.iframe();
var COMPACT = new URLSearchParams(location.search).get('compact') === '1';

// I kompakt-läge (card-back-section) ska iframen hugga innehållet → sizeTo.
// I fullskärms-modal ska iframen behålla modalhöjden och scrolla internt →
// sizeTo skulle tvinga iframen till innehållshöjd och få modalen att klippa.
function fit() { if (COMPACT) { t.sizeTo('body').catch(function () {}); } }

function norm(s) { return String(s || '').trim().toLowerCase(); }

// Plocka deltagarfält ur kortets description ("Namn:", "Epost:", ...).
function parseDesc(desc) {
  var out = {};
  String(desc || '').split('\n').forEach(function (line) {
    var m = line.match(/^\s*([^:]{2,30}):\s*(.+?)\s*$/);
    if (m) { out[norm(m[1])] = m[2]; }
  });
  return out;
}

// Samla alla bockade checkitem-namn + alla labelnamn från kortet.
function collectState(card) {
  var checkedItems = {}; // norm(name) -> true om state==complete
  (card.checklists || []).forEach(function (cl) {
    (cl.checkItems || []).forEach(function (it) {
      if (norm(it.state) === 'complete') { checkedItems[norm(it.name)] = true; }
    });
  });
  var labels = {};
  (card.labels || []).forEach(function (l) { if (l.name) { labels[norm(l.name)] = true; } });
  return { checkedItems: checkedItems, labels: labels };
}

// Härled status för ett steg: 'done' | 'active' | 'wait'.
function stepStatus(step, state) {
  if (step.always) { return 'done'; }
  if (step.checkItem && state.checkedItems[norm(step.checkItem)]) { return 'done'; }
  if (step.triggerLabel && state.labels[norm(step.triggerLabel)]) { return 'active'; }
  return 'wait';
}

function statusText(s) { return s === 'done' ? 'Klar' : s === 'active' ? 'Igång' : 'Väntar'; }
function nodeGlyph(s) { return s === 'done' ? '✓' : s === 'active' ? '•' : ''; }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function computeFlow(card) {
  var state = collectState(card);
  var flow = (window.NYA_ZAPIER_FLOW || []).map(function (step) {
    return { step: step, status: stepStatus(step, state) };
  });
  var doneCount = flow.filter(function (f) { return f.status === 'done'; }).length;
  var pct = flow.length ? Math.round((doneCount / flow.length) * 100) : 0;
  var next = flow.filter(function (f) { return f.status !== 'done'; })[0];
  return { flow: flow, doneCount: doneCount, total: flow.length, pct: pct, next: next };
}

/* ---------- Rendering ---------- */

function ringSvg(pct) {
  var r = 33, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return '<svg width="78" height="78">'
    + '<circle cx="39" cy="39" r="' + r + '" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="7"/>'
    + '<circle cx="39" cy="39" r="' + r + '" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"'
    + ' stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg>';
}

function renderFull(card, model) {
  document.body.className = 'full';
  var d = parseDesc(card.desc);
  var name = (card.name || '').replace(/^\s*\d+\s*[-–]\s*/, ''); // strippa "1774… - "
  var kurs = d['önskad kursvecka'] || d['onskad kursvecka'] || '';
  var mark = (window.NYA_ZAPIER_CONFIG && window.NYA_ZAPIER_CONFIG.MARK_URL) || '';

  var meta = [];
  if (kurs) { meta.push('<span>📅 ' + esc(kurs) + '</span>'); }
  if (d['epost']) { meta.push('<span>✉️ ' + esc(d['epost']) + '</span>'); }
  if (d['telefonnummer']) { meta.push('<span>📞 ' + esc(d['telefonnummer']) + '</span>'); }

  var hero = '<div class="hero"><div class="hero-inner">'
    + (mark ? '<img class="mark" src="' + esc(mark) + '" alt="">' : '')
    + '<div class="who"><h1>' + esc(name || card.name || 'Deltagare') + '</h1>'
    + '<div class="meta">' + meta.join('') + '</div></div>'
    + '<div class="ring">' + ringSvg(model.pct)
    + '<div class="pct"><b>' + model.pct + '%</b><small>' + model.doneCount + '/' + model.total + '</small></div></div>'
    + '</div></div>';

  var nextHtml = model.next
    ? '<div class="nextline">Nästa steg: <b>' + esc(model.next.step.title) + '</b> – ' + esc(model.next.step.desc) + '</div>'
    : '<div class="nextline">🎉 Alla steg klara för den här deltagaren.</div>';

  var steps = model.flow.map(function (f) {
    var s = f.status, st = f.step;
    var runBtn = (s !== 'done' && st.triggerLabel)
      ? '<button class="run" data-label="' + esc(st.triggerLabel) + '" data-auto="' + esc(st.automation || '') + '">Kör</button>'
      : '';
    return '<li class="step ' + s + '"><div class="node">' + nodeGlyph(s) + '</div>'
      + '<div class="card"><div class="top"><div>'
      + '<div class="title">' + esc(st.title) + '</div>'
      + '<div class="desc">' + esc(st.desc) + '</div></div>'
      + '<span class="pill ' + s + '">' + statusText(s) + '</span></div>'
      + '<div class="foot">'
      + (st.automation ? '<span class="auto">⚙ ' + esc(st.automation) + '</span>' : '<span></span>')
      + runBtn + '</div></div></li>';
  }).join('');

  document.getElementById('root').innerHTML = hero
    + '<div class="wrap">' + nextHtml + '<ul class="timeline">' + steps + '</ul></div>';

  Array.prototype.forEach.call(document.querySelectorAll('.run'), function (b) {
    b.addEventListener('click', function () {
      t.alert({
        message: 'Skulle köra: ' + (b.getAttribute('data-auto') || b.getAttribute('data-label'))
          + ' (sätt label "' + b.getAttribute('data-label') + '"). Skarp körning kopplas server-side.',
        duration: 8, display: 'info',
      });
    });
  });
  fit();
}

function renderCompact(model) {
  document.body.className = 'compact';
  var nextTxt = model.next ? 'Nästa: ' + esc(model.next.step.title) : 'Allt klart 🎉';
  document.getElementById('root').innerHTML =
    '<div class="strip">'
    + '<span class="lbl"><b>' + model.doneCount + '/' + model.total + '</b></span>'
    + '<div class="bar"><i style="width:' + model.pct + '%"></i></div>'
    + '<span class="lbl">' + nextTxt + '</span>'
    + '<button class="open">Öppna</button></div>';
  document.querySelector('.open').addEventListener('click', function () {
    t.modal({
      url: './dashboard.html',
      fullscreen: true,
      title: 'Vitalisera – Deltagarstatus',
      accentColor: '#08445c',
    });
  });
  fit();
}

function boot() {
  t.card('name', 'desc', 'labels', 'checklists').then(function (card) {
    var model = computeFlow(card || {});
    if (COMPACT) { renderCompact(model); } else { renderFull(card || {}, model); }
  }).catch(function (err) {
    document.getElementById('root').innerHTML =
      '<div class="wrap"><div class="nextline">⚠️ Kunde inte läsa kortet: ' + esc(err.message) + '</div></div>';
    fit();
  });
}

document.addEventListener('DOMContentLoaded', boot);
