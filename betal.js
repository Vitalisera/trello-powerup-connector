/* global TrelloPowerUp, window, document, fetch, URLSearchParams */
/*
 * Obetalda fakturor: samtliga deltagare som inte har betalat enligt förväntan, över alla kurser.
 * Öppnas via board-knappen "Vitalisera – Obetalda fakturor" eller knappen "Visa obetalda" i Kursöversikten.
 *
 * READ-ONLY. GAS (betalOversikt) svarar med kort-id, fakturanr, belopp, förfallodag och status, aldrig med namn.
 * Namn och kurs hämtas här via Trello REST (bara GET) med användarens token. Inget skrivs mot Trello eller Drive.
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
  var bokf = window.NYA_ZAPIER_BOKF.rad(svar.sieHamtad, svar.sieSenast);
  var meta = '<div class="vz-bt-meta"><span>Uppdaterad ' + esc(fmtTid(svar.uppdaterad)) + '</span><span>Bokföringen läst ' + esc(fmtTid(svar.sieHamtad)) + '</span><span>' + esc(bokf.text) + '</span></div>'
    + (bokf.varning ? msgHtml('vz-bt-warn', esc(bokf.varning)) : '');
  var warn = svar.inaktuell
    ? msgHtml('vz-bt-warn', 'Uppgifterna är äldre än tre timmar och kan ha ändrats. Kontrollera i SpeedLedger innan du agerar.') : '';
  var body;
  if (!rader.length) {
    body = msgHtml('vz-bt-empty', 'Inga obetalda fakturor.');
  } else {
    body = '<div class="vz-bt-tablewrap"><table class="vz-bt-table"><thead><tr>'
      + '<th>Deltagare</th><th>Kurs</th><th>Faktura</th><th class="num">Belopp</th><th>Förfallodag</th><th>Status</th><th class="num">Dagar sedan förfallodagen</th>'
      + '</tr></thead><tbody>'
      + rader.map(function (r) {
        var namn = r.namn || 'Okänt kort';
        var deltagare = r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(namn) + '</a>' : esc(namn);
        var dagar = r.dagar == null ? '–' : String(r.dagar);
        return '<tr>'
          + '<td data-label="Deltagare">' + deltagare + '</td>'
          + '<td data-label="Kurs">' + esc(r.kurs || '–') + '</td>'
          + '<td data-label="Faktura">' + esc((r.fakturanr ? r.fakturanr + ' ' : '') + (BETAL_TYP_TEXT[r.typ] || 'Faktura')) + '</td>'
          + '<td data-label="Belopp" class="num">' + esc(fmtBelopp(r.belopp)) + '</td>'
          + '<td data-label="Förfallodag">' + esc(r.forfallodag || '–') + '</td>'
          + '<td data-label="Status"><span class="vz-bt-pill ' + esc(r.status) + '">' + esc(BETAL_STATUS_TEXT[r.status] || r.status) + '</span></td>'
          + '<td data-label="Dagar sedan förfallodagen" class="num">' + esc(dagar) + '</td>'
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
  show(meta + warn + body + utanforHtml + olas);
}

function boot() {
  show(msgHtml('vz-bt-wait', '⏳ Hämtar obetalda fakturor …'));
  var token;
  t.getRestApi().getToken().then(function (tok) {
    token = tok;
    if (!token) { throw new Error('no-token'); }
    return postToGas('betalOversikt', {});
  }).then(function (svar) {
    if (!svar || svar.ok !== true) {
      var kod = svar && svar.error;
      throw new Error('gas:' + (FEL_TEXT[kod] || 'Servern svarade med ett fel. Försök igen om en stund.'));
    }
    var ids = {};
    (svar.rader || []).concat(svar.olasbara || []).forEach(function (r) { ids[r.kortId] = true; });
    return hamtaKortInfo(token, Object.keys(ids)).then(function (info) { renderOversikt(svar, info); });
  }).catch(function (e) {
    var m = String(e && e.message || '');
    var text = m === 'no-token'
      ? 'Trello är inte anslutet. Öppna Kursöversikten, klicka Anslut och kom sedan tillbaka hit.'
      : m.indexOf('gas:') === 0 ? m.slice(4)
      : 'Det gick inte att hämta uppgifterna (' + m + '). Kontrollera nätverket och försök igen.';
    show(msgHtml('vz-bt-err', esc(text) + '<br><button id="vz-bt-retry">Försök igen</button>'));
    var r = document.getElementById('vz-bt-retry');
    if (r) { r.addEventListener('click', boot); }
  });
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { try { t.closeModal(); } catch (_) {} }
});
document.addEventListener('DOMContentLoaded', boot);
