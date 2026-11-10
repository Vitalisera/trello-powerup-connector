/* global TrelloPowerUp, window, document, fetch, URLSearchParams */
/*
 * Obetalda fakturor: samtliga deltagare som inte har betalat enligt förväntan, över alla kurser.
 * Öppnas via board-knappen "Vitalisera – Obetalda fakturor" eller knappen "Visa obetalda" i Kursöversikten.
 *
 * GAS (betalOversikt) är READ-ONLY och svarar med kort-id, fakturanr, belopp, förfallodag och status, aldrig med namn.
 * Namn, kurs och kommentarer hämtas här via Trello REST (GET) med användarens token.
 * Släck-knappen (Robert 2026-11-10): den ENDA skrivningen i filen är restComment, en POST som lägger en kommentar på
 * deltagarkortet (cards/<id>/actions/comments). Kortet är sanningskälla, ingen databas. Format, skäl och tolkning
 * ligger i config.js (NYA_ZAPIER_SLACK). Ingen PUT/DELETE, och GAS får aldrig namn eller fritext.
 */
'use strict';

var CFG = window.NYA_ZAPIER_CONFIG;
var t = TrelloPowerUp.iframe({ appKey: CFG.APP_KEY, appName: CFG.APP_NAME, appAuthor: CFG.APP_AUTHOR });
var BETAL_BOARDS = ['5e3829153e99a8775073f2aa', 'tXFUio8P'];   // Admin, Tidigare kurser
var BETAL_STATUS_TEXT = { forfallen: 'Förfallen', obetald: 'Obetald', delbetald: 'Delbetald', ej_bekraftad: 'Ej bekräftad' };
var BETAL_STATUS_RANK = { forfallen: 0, obetald: 1, delbetald: 2, ej_bekraftad: 3 };
var BETAL_TYP_TEXT = { anmalan: 'Anmälningsavgift', slut: 'Kursavgift', okand: 'Faktura' };
var FROM_COURSE = (new URLSearchParams(location.search)).get('from') === 'course';

function ROOT() { return document.getElementById('root'); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ---------- GAS (samma mönster som course.js: text/plain, ingen preflight) ---------- */
function postToGas(action, payload) {
  var url = CFG.GAS_URL;
  if (!url || url.indexOf('REPLACE_WITH_DEPLOYMENT_ID') !== -1) {
    return Promise.reject(new Error('GAS_URL är inte ifylld i config.js'));
  }
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, payload: payload || {} }),
  }).then(function (res) {
    return res.text().then(function (text) {
      if (!res.ok) { throw new Error('GAS HTTP ' + res.status); }
      try { return JSON.parse(text); } catch (e) { throw new Error('Ogiltigt svar från servern'); }
    });
  });
}

/* ---------- Trello REST (bara GET) ---------- */
function restGet(token, path) {
  var sep = path.indexOf('?') === -1 ? '?' : '&';
  var url = 'https://api.trello.com/1/' + path + sep + 'key=' + encodeURIComponent(CFG.APP_KEY) + '&token=' + encodeURIComponent(token);
  return fetch(url).then(function (r) { if (!r.ok) { throw new Error('Trello ' + r.status); } return r.json(); });
}

/* Den ENDA skrivningen: en kommentar på kortet. Texten kommer färdig från NYA_ZAPIER_SLACK. */
function restComment(token, kortId, text) {
  var url = 'https://api.trello.com/1/cards/' + encodeURIComponent(kortId) + '/actions/comments?text=' + encodeURIComponent(text)
    + '&key=' + encodeURIComponent(CFG.APP_KEY) + '&token=' + encodeURIComponent(token);
  return fetch(url, { method: 'POST' }).then(function (r) { if (!r.ok) { throw new Error('Trello ' + r.status); } return r.json(); });
}

/* ---------- Släckta fakturor (läget hålls här, kommentarerna på korten är sanningen) ---------- */
var TOKEN = '';
var NAMN = '';            // inloggad användares fullName (hämtas en gång per vy)
var SLACK_OK = false;     // sant när kommentarerna och namnet kunde läsas: först då visas Släck-knappar
var SLACK_FEL = false;    // sant när de inte kunde läsas: vyn visar alla fakturor och säger det
var SLACK = {};           // kortId|fakturanr -> { slackt, av, skal, datum }
var RADER_BY_KEY = {};
var CUR = null;           // { svar, info } för omritning på plats
var SLACKTA_OPEN = false;
function radKey(kortId, nr) { return kortId + '|' + nr; }

function hamtaSlack(token, svar, info) {
  SLACK_OK = false; SLACK_FEL = false; SLACK = {}; NAMN = '';
  var rader = (svar.rader || []).filter(function (r) { var k = info[r.kortId] || {}; return r.fakturanr && arDateradKurs(k.kurs); });
  var ids = rader.map(function (r) { return r.kortId; });
  return Promise.all([
    window.NYA_ZAPIER_SLACK.laddaKommentarer(function (path) { return restGet(token, path); }, ids),
    restGet(token, 'members/me?fields=fullName')
  ]).then(function (res) {
    var namn = res[1] && res[1].fullName;
    if (!namn) { throw new Error('namn saknas'); }
    rader.forEach(function (r) { SLACK[radKey(r.kortId, r.fakturanr)] = window.NYA_ZAPIER_SLACK.tolka(res[0][r.kortId], r.fakturanr); });
    NAMN = String(namn);
    SLACK_OK = true;
  }).catch(function () { SLACK_OK = false; SLACK_FEL = true; SLACK = {}; });
}

/* ---------- Formatering ---------- */
function fmtBelopp(n) {
  if (typeof n !== 'number' || !isFinite(n)) { return '–'; }
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' kr';
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtTid(iso) {
  var d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) { return 'okänt'; }
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
// Dagar sedan förfallodagen (kalenderdagar, lokal tid). Före förfallodagen blir det negativt. Saknas datum: null.
function dagarSedan(forfallodag, nu) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(forfallodag || ''));
  if (!m) { return null; }
  var d0 = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  var d1 = Date.UTC(nu.getFullYear(), nu.getMonth(), nu.getDate());
  return Math.round((d1 - d0) / 86400000);
}
function safeUrl(u) { return /^https:\/\/trello\.com\//.test(String(u || '')) ? String(u) : ''; }

/* ---------- Namn och kurs ---------- */
// Returnerar { kortId: { namn, kurs, url } }. Kort som inte finns bland tavlornas öppna kort hämtas för sig.
function hamtaKortInfo(token, kortIds) {
  var info = {};
  var listNamn = {};
  function boardPart(b) {
    return Promise.all([
      restGet(token, 'boards/' + b + '/cards?fields=name,idList,url').catch(function () { return []; }),
      restGet(token, 'boards/' + b + '/lists?fields=name').catch(function () { return []; }),
    ]).then(function (r) {
      (r[1] || []).forEach(function (l) { if (l && l.id) { listNamn[l.id] = l.name || ''; } });
      return r[0] || [];
    });
  }
  return Promise.all(BETAL_BOARDS.map(boardPart)).then(function (res) {
    var kortById = {};
    res.forEach(function (cards) { cards.forEach(function (c) { if (c && c.id) { kortById[c.id] = c; } }); });
    var saknas = [];
    kortIds.forEach(function (id) {
      var c = kortById[id];
      if (c) { info[id] = { namn: c.name || '', idList: c.idList, url: c.url || '' }; } else { saknas.push(id); }
    });
    // Enskilda uppslag, åtta i taget.
    var steg = Promise.resolve();
    for (var i = 0; i < saknas.length; i += 8) {
      (function (grupp) {
        steg = steg.then(function () {
          return Promise.all(grupp.map(function (id) {
            return restGet(token, 'cards/' + encodeURIComponent(id) + '?fields=name,idList,url').then(function (c) {
              info[id] = { namn: c.name || '', idList: c.idList, url: c.url || '' };
            }).catch(function () { /* kortet finns inte längre: raden visas utan namn */ });
          }));
        });
      })(saknas.slice(i, i + 8));
    }
    return steg;
  }).then(function () {
    var okanda = {};
    Object.keys(info).forEach(function (id) { var l = info[id].idList; if (l && listNamn[l] === undefined) { okanda[l] = true; } });
    var ids = Object.keys(okanda), steg = Promise.resolve();
    for (var i = 0; i < ids.length; i += 8) {
      (function (grupp) {
        steg = steg.then(function () {
          return Promise.all(grupp.map(function (l) {
            return restGet(token, 'lists/' + encodeURIComponent(l) + '?fields=name').then(function (x) { listNamn[l] = x.name || ''; })
              .catch(function () { listNamn[l] = ''; });
          }));
        });
      })(ids.slice(i, i + 8));
    }
    return steg;
  }).then(function () {
    Object.keys(info).forEach(function (id) { info[id].kurs = listNamn[info[id].idList] || ''; });
    return info;
  });
}

/* ---------- Rendering ---------- */
function arDateradKurs(listnamn) {
  return !!(listnamn && window.NYA_ZAPIER_DATE && window.NYA_ZAPIER_DATE.courseStartDate(listnamn));
}

function msgHtml(cls, html) { return '<div class="' + cls + '">' + html + '</div>'; }

function shell(inner) {
  return '<div class="vz-bt">'
    + '<div class="vz-bt-head"><img src="' + esc(CFG.MARK_URL) + '" alt=""><h1>Obetalda fakturor</h1></div>'
    + (FROM_COURSE ? '<a class="vz-bt-back" id="vz-bt-back">← Tillbaka till kursöversikten</a>' : '')
    + inner + '</div>';
}
function bindBack() {
  var b = document.getElementById('vz-bt-back');
  if (b) { b.addEventListener('click', function (e) { e.preventDefault(); history.back(); }); }
}
function show(inner) { ROOT().innerHTML = shell(inner); bindBack(); }

var FEL_TEXT = {
  fil_saknas: 'Betalstatus finns inte ännu. Jobbet som läser bokföringen har inte skrivit någon fil.',
  fil_ogiltig: 'Betalstatusfilen går inte att läsa just nu. Försök igen om en stund.'
};

function sorteraRader(rader) {
  return rader.slice().sort(function (a, b) {
    var ra = BETAL_STATUS_RANK[a.status], rb = BETAL_STATUS_RANK[b.status];
    var fa = a.status === 'forfallen' ? 0 : 1, fb = b.status === 'forfallen' ? 0 : 1;
    if (fa !== fb) { return fa - fb; }
    var da = a.dagar == null ? -Infinity : a.dagar, db = b.dagar == null ? -Infinity : b.dagar;
    if (da !== db) { return db - da; }
    return (ra - rb) || String(a.fakturanr).localeCompare(String(b.fakturanr));
  });
}

function renderOversikt(svar, info) {
  var nu = new Date();
  CUR = { svar: svar, info: info };
  RADER_BY_KEY = {};
  var rader = (svar.rader || []).map(function (r) {
    var k = info[r.kortId] || {};
    return { kortId: r.kortId, namn: k.namn || '', kurs: k.kurs || '', url: safeUrl(k.url),
      typ: r.typ, fakturanr: r.fakturanr || '', belopp: r.belopp, forfallodag: r.forfallodag || '', status: r.status,
      dagar: dagarSedan(r.forfallodag, nu) };
  });
  // Robert 2026-11-10: bara kort i en daterad kurslista (kursstarten går att räkna ut). Övriga kurser har inte
  // genomförts, och deras fakturor ska inte drivas in. En sådan rad som ändå har en betalning pekar på ett felplacerat kort.
  var utanfor = rader.filter(function (r) { return !arDateradKurs(r.kurs); });
  rader = sorteraRader(rader.filter(function (r) { return arDateradKurs(r.kurs); }));
  var slacktaRader = [];
  if (SLACK_OK) {
    rader.forEach(function (r) {
      r.slack = r.fakturanr ? SLACK[radKey(r.kortId, r.fakturanr)] : null;
      if (r.fakturanr) { RADER_BY_KEY[radKey(r.kortId, r.fakturanr)] = r; }
    });
    slacktaRader = rader.filter(function (r) { return r.slack && r.slack.slackt; });
    rader = rader.filter(function (r) { return !(r.slack && r.slack.slackt); });
  }
  var bokf = window.NYA_ZAPIER_BOKF.rad(svar.sieHamtad, svar.sieSenast);
  var meta = '<div class="vz-bt-meta"><span>Uppdaterad ' + esc(fmtTid(svar.uppdaterad)) + '</span><span>Bokföringen läst ' + esc(fmtTid(svar.sieHamtad)) + '</span><span>' + esc(bokf.text) + '</span></div>'
    + (bokf.varning ? msgHtml('vz-bt-warn', esc(bokf.varning)) : '');
  var warn = svar.inaktuell
    ? msgHtml('vz-bt-warn', 'Uppgifterna är äldre än tre timmar och kan ha ändrats. Kontrollera i SpeedLedger innan du agerar.') : '';
  var slackWarn = SLACK_FEL
    ? msgHtml('vz-bt-warn', 'Det gick inte att läsa kommentarerna på korten, så Släck-knapparna är avstängda och släckta fakturor visas som vanligt. Ladda om vyn för att försöka igen.') : '';
  var body;
  if (!rader.length) {
    body = msgHtml('vz-bt-empty', 'Inga obetalda fakturor.');
  } else {
    body = '<div class="vz-bt-tablewrap"><table class="vz-bt-table"><thead><tr>'
      + '<th>Deltagare</th><th>Kurs</th><th>Faktura</th><th class="num">Belopp</th><th>Förfallodag</th><th>Status</th><th class="num">Dagar sedan förfallodagen</th>'
      + (SLACK_OK ? '<th>Åtgärd</th>' : '')
      + '</tr></thead><tbody>'
      + rader.map(function (r) {
        var namn = r.namn || 'Okänt kort';
        var deltagare = r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(namn) + '</a>' : esc(namn);
        var dagar = r.dagar == null ? '–' : String(r.dagar);
        return '<tr data-rad="' + esc(radKey(r.kortId, r.fakturanr)) + '" class="vz-bt-klickrad" title="Klicka för att se fakturans detaljer.">'
          + '<td data-label="Deltagare">' + deltagare + '</td>'
          + '<td data-label="Kurs">' + esc(r.kurs || '–') + '</td>'
          + '<td data-label="Faktura">' + esc((r.fakturanr ? r.fakturanr + ' ' : '') + (BETAL_TYP_TEXT[r.typ] || 'Faktura')) + '</td>'
          + '<td data-label="Belopp" class="num">' + esc(fmtBelopp(r.belopp)) + '</td>'
          + '<td data-label="Förfallodag">' + esc(r.forfallodag || '–') + '</td>'
          + '<td data-label="Status"><span class="vz-bt-pill ' + esc(r.status) + '">' + esc(BETAL_STATUS_TEXT[r.status] || r.status) + '</span></td>'
          + '<td data-label="Dagar sedan förfallodagen" class="num">' + esc(dagar) + '</td>'
          + (SLACK_OK ? '<td data-label="Åtgärd">' + (r.fakturanr
            ? '<button type="button" class="vz-bt-slackbtn" data-slack="' + esc(radKey(r.kortId, r.fakturanr)) + '" title="' + tip('slack') + '">Släck</button>' : '') + '</td>' : '')
          + '</tr>';
      }).join('')
      + '</tbody></table></div>'
      + '<p class="vz-bt-note">Ej bekräftad: förfallodagen har passerat, men bokföringen var inte uppdaterad fram till den dagen när den lästes.</p>';
  }
  var olas = '';
  if ((svar.olasbara || []).length) {
    olas = '<div class="vz-bt-sec"><h2>Kunde inte läsas</h2><ul>'
      + svar.olasbara.map(function (o) {
        var k = info[o.kortId] || {}, url = safeUrl(k.url), namn = k.namn || 'Okänt kort';
        var lank = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(namn) + '</a>' : esc(namn);
        return '<li>' + lank + (k.kurs ? ' (' + esc(k.kurs) + ')' : '') + (o.fakturanr ? ', faktura ' + esc(o.fakturanr) : '') + '</li>';
      }).join('') + '</ul></div>';
  }
  var felkort = utanfor.filter(function (r) { return r.status === 'delbetald'; });
  var utanforHtml = '';
  if (felkort.length) {
    utanforHtml = '<div class="vz-bt-sec"><h2>Betalning på kort utanför kurslistorna</h2>'
      + '<p class="vz-bt-note">Fakturan har en betalning men kortet ligger inte i en kurslista. Troligen ligger fakturan på fel kort.</p><ul>'
      + felkort.map(function (r) {
        var namn = r.namn || 'Okänt kort';
        var lank = r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(namn) + '</a>' : esc(namn);
        return '<li>' + lank + (r.kurs ? ' (' + esc(r.kurs) + ')' : '') + (r.fakturanr ? ', faktura ' + esc(r.fakturanr) : '') + '</li>';
      }).join('') + '</ul></div>';
  }
  if (utanfor.length) {
    utanforHtml += '<p class="vz-bt-note">' + utanfor.length + ' faktur' + (utanfor.length === 1 ? 'a' : 'or')
      + ' på kort utanför de daterade kurslistorna visas inte.</p>';
  }
  var slacktaHtml = '';
  if (SLACK_OK && slacktaRader.length) {
    slacktaHtml = '<details class="vz-bt-sec vz-bt-slackta" id="vz-bt-slackta"' + (SLACKTA_OPEN ? ' open' : '') + '><summary>Släckta (' + slacktaRader.length + ')</summary>'
      + '<table class="vz-bt-slacktabell"><tbody>'
      + slacktaRader.map(function (r) {
        var namn = r.namn || 'Okänt kort';
        var lank = r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(namn) + '</a>' : esc(namn);
        return '<tr class="vz-bt-slackrad vz-bt-klickrad" data-rad="' + esc(radKey(r.kortId, r.fakturanr)) + '" title="Klicka för att se fakturans detaljer eller ångra släckningen.">'
          + '<td class="vz-bt-slackinfo"><b>' + lank + '</b>' + (r.kurs ? ' (' + esc(r.kurs) + ')' : '')
          + ', faktura ' + esc(r.fakturanr + ' ' + (BETAL_TYP_TEXT[r.typ] || 'Faktura'))
          + '<br><span class="vz-bt-slackskal">Släckt: ' + esc(r.slack.skal || 'skäl okänt') + '. Av ' + esc(r.slack.av || 'okänd') + ', ' + esc(fmtTid(r.slack.datum)) + '.</span></td>'
          + '<td class="vz-bt-slackakt"><button type="button" class="vz-bt-angrabtn" data-angra="' + esc(radKey(r.kortId, r.fakturanr)) + '" title="' + tip('angra') + '">Ångra</button></td>'
          + '</tr>';
      }).join('') + '</tbody></table></details>';
  }
  var y = 0; try { y = (document.scrollingElement || document.documentElement).scrollTop || 0; } catch (_) {}
  show(meta + warn + slackWarn + body + slacktaHtml + utanforHtml + olas);
  try { (document.scrollingElement || document.documentElement).scrollTop = y; } catch (_) {}
}

/* ---------- Släck och Ångra: formulärrad under raden (inga webbläsardialoger) ---------- */
function nearest(n, attr) {
  while (n && n !== document) { if (n.getAttribute && n.getAttribute(attr) !== null && n.getAttribute(attr) !== undefined) { return n; } n = n.parentNode; }
  return null;
}
function KOLS() { return SLACK_OK ? 8 : 7; }
function tip(k) { var S = window.NYA_ZAPIER_SLACK; return esc((S && S.TIPS && S.TIPS[k]) || ''); }
function stangFormer() {
  Array.prototype.forEach.call(ROOT().querySelectorAll('.vz-bt-formrow'), function (f) { f.parentNode.removeChild(f); });
}
function oppnaForm(knapp, mode, keyIn) {
  var key = keyIn || knapp.getAttribute(mode === 'angra' ? 'data-angra' : 'data-slack');
  var rad = RADER_BY_KEY[key];
  var anchor = keyIn ? ROOT().querySelector('tr[data-rad="' + key.replace(/"/g, '') + '"]') : nearest(knapp, 'data-rad');
  if (!rad || !anchor || !window.NYA_ZAPIER_SLACK) { return; }
  var gamla = ROOT().querySelectorAll('.vz-bt-formrow');
  var samma = false;
  Array.prototype.forEach.call(gamla, function (f) { if (f.getAttribute('data-key') === key && f.getAttribute('data-mode') === mode) { samma = true; } });
  stangFormer();
  if (samma) { return; }   // klick på samma knapp igen stänger formuläret
  var host = document.createElement('div');
  var wrap = document.createElement(anchor.tagName === 'TR' ? 'tr' : 'div');
  wrap.className = 'vz-bt-formrow';
  wrap.setAttribute('data-key', key); wrap.setAttribute('data-mode', mode);
  if (anchor.tagName === 'TR') {
    var td = document.createElement('td'); td.colSpan = (anchor.children && anchor.children.length) || KOLS(); td.appendChild(host); wrap.appendChild(td);
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
  } else {
    wrap.appendChild(host); anchor.appendChild(wrap);
  }
  window.NYA_ZAPIER_SLACK.bindForm(host, {
    mode: mode, nr: rad.fakturanr, kortNamn: rad.namn || 'okänt kort', namn: NAMN,
    onSubmit: function (kod, fri, text) { return restComment(TOKEN, rad.kortId, text); },
    onDone: function (kod, fri) {
      SLACK[key] = mode === 'angra' ? { slackt: false, av: NAMN, skal: '', datum: new Date().toISOString() }
        : { slackt: true, av: NAMN, skal: window.NYA_ZAPIER_SLACK.skalText(kod, fri), datum: new Date().toISOString() };
      if (CUR) { renderOversikt(CUR.svar, CUR.info); }   // flyttar raden på plats, ingen omladdning
    },
    onCancel: stangFormer
  });
}
/* ---------- Fakturadetalj: klick på en rad fäller ut samma detaljrad som i Kursöversikten (NYA_ZAPIER_BETALDET i config.js) ---------- */
function stangDetaljer() {
  Array.prototype.forEach.call(ROOT().querySelectorAll('.vz-bt-detailrow'), function (d) { d.parentNode.removeChild(d); });
}
function toggleDetalj(tr) {
  var key = tr.getAttribute('data-rad'), rad = RADER_BY_KEY[key], BD = window.NYA_ZAPIER_BETALDET;
  var next = tr.nextSibling;
  var samma = !!(next && next.nodeType === 1 && next.className && next.className.indexOf('vz-bt-detailrow') !== -1 && next.getAttribute('data-key') === key);
  stangDetaljer(); stangFormer();
  if (samma || !rad || !BD) { return; }
  var dr = document.createElement('tr'); dr.className = 'vz-bt-detailrow'; dr.setAttribute('data-key', key);
  var td = document.createElement('td'); td.colSpan = (tr.children && tr.children.length) || KOLS();
  var host = document.createElement('div'); td.appendChild(host); dr.appendChild(td);
  tr.parentNode.insertBefore(dr, tr.nextSibling);
  BD.visa(host, {
    aktiv: function () { return !!dr.parentNode; },
    detalj: function () {
      return postToGas('courseBetalDetalj', { kortIds: [rad.kortId] }).then(function (d) { if (!d || d.ok !== true) { throw new Error('detalj'); } return d; });
    },
    // E-post läses ur kortbeskrivningen med användarens token, aldrig från GAS.
    epost: function () { return restGet(TOKEN, 'cards/' + encodeURIComponent(rad.kortId) + '?fields=desc').then(function (c) { return BD.epost(c && c.desc); }); },
    bilagor: function () { return restGet(TOKEN, 'cards/' + encodeURIComponent(rad.kortId) + '/attachments?fields=name,url'); },
    modell: function (x) {
      var sl = SLACK[key] || null;
      var oppna = [{ fakturanr: rad.fakturanr, belopp: rad.belopp, status: rad.status, forfallodag: rad.forfallodag, slack: sl }];
      var meta = x.detalj ? x.detalj.meta : { sieHamtad: CUR && CUR.svar.sieHamtad, bankHamtad: CUR && CUR.svar.bankHamtad, uppdaterad: CUR && CUR.svar.uppdaterad };
      var gas = x.detalj ? (x.detalj.rader || []).filter(function (g) { return g.kortId === rad.kortId; }) : null;
      return { titel: (BD.TITEL[rad.typ] || 'Faktura') + ', ' + (rad.namn || 'okänt kort'), rader: BD.rader(gas, rad.typ, oppna, SLACK_OK), meta: meta, epost: x.epost, bilagor: x.bilagor, detaljFel: x.detaljFel };
    }
  });
  host.addEventListener('click', function (e) {
    var b = nearest(e.target, 'data-bd-slack');
    if (b) { oppnaForm(b, 'slack', radKey(rad.kortId, b.getAttribute('data-bd-slack'))); return; }
    b = nearest(e.target, 'data-bd-angra');
    if (b) { oppnaForm(b, 'angra', radKey(rad.kortId, b.getAttribute('data-bd-angra'))); }
  });
}
var ROOT_BOUND = false;
function bindRoot() {
  if (ROOT_BOUND || !ROOT() || !ROOT().addEventListener) { return; }
  ROOT_BOUND = true;
  ROOT().addEventListener('click', function (e) {
    if (nearest(e.target, 'data-bd-slack') || nearest(e.target, 'data-bd-angra')) { return; }   // hanteras i detaljraden
    var b = nearest(e.target, 'data-slack');
    if (b) { oppnaForm(b, 'slack'); return; }
    b = nearest(e.target, 'data-angra');
    if (b) { oppnaForm(b, 'angra'); return; }
    // klick på en tabellrad (ej länk, knapp eller något i en detalj- eller formulärrad) fäller ut fakturadetaljen; kortet öppnas aldrig
    var n = e.target;
    while (n && n !== document) { if (/^(a|button|input)$/.test(String(n.tagName || '').toLowerCase())) { return; } if (n.className && /vz-bt-(detailrow|formrow)/.test(String(n.className))) { return; } n = n.parentNode; }
    var tr = nearest(e.target, 'data-rad');
    if (tr && tr.tagName === 'TR') { toggleDetalj(tr); }
  });
  ROOT().addEventListener('toggle', function (e) {
    if (e.target && e.target.id === 'vz-bt-slackta') { SLACKTA_OPEN = !!e.target.open; }
  }, true);
}

function boot() {
  bindRoot();
  show(msgHtml('vz-bt-wait', '⏳ Hämtar obetalda fakturor …'));
  var token;
  t.getRestApi().getToken().then(function (tok) {
    token = tok; TOKEN = tok || '';
    if (!token) { throw new Error('no-token'); }
    return postToGas('betalOversikt', {});
  }).then(function (svar) {
    if (!svar || svar.ok !== true) {
      var kod = svar && svar.error;
      throw new Error('gas:' + (FEL_TEXT[kod] || 'Servern svarade med ett fel. Försök igen om en stund.'));
    }
    var ids = {};
    (svar.rader || []).concat(svar.olasbara || []).forEach(function (r) { ids[r.kortId] = true; });
    return hamtaKortInfo(token, Object.keys(ids)).then(function (info) {
      return hamtaSlack(token, svar, info).then(function () { renderOversikt(svar, info); });
    });
  }).catch(function (e) {
    var m = String(e && e.message || '');
    var text = m === 'no-token'
      ? 'Trello är inte anslutet. Öppna Kursöversikten, klicka Anslut och kom sedan tillbaka hit.'
      : m.indexOf('gas:') === 0 ? m.slice(4)
      : 'Det gick inte att hämta uppgifterna (' + m + '). Kontrollera nätverket och försök igen.';
    show(msgHtml('vz-bt-err', esc(text) + '<br><button id="vz-bt-retry" title="Hämtar uppgifterna igen.">Försök igen</button>'));
    var r = document.getElementById('vz-bt-retry');
    if (r) { r.addEventListener('click', boot); }
  });
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { try { t.closeModal(); } catch (_) {} }
});
document.addEventListener('DOMContentLoaded', boot);
