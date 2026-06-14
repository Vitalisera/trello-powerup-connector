/* global TrelloPowerUp, window, document */
/*
 * Command-palettens logik. Körs i popup-iframen.
 *
 * Renderar kommandona från window.NYA_ZAPIER_COMMANDS och dispatchar dem.
 *
 * 🔑 CORS-DESIGN (kritiskt): GAS-webappen svarar opålitligt på CORS-preflight
 * (OPTIONS). Vi UNDVIKER preflight helt genom att skicka en "simple request":
 *   - method: POST
 *   - Content-Type: text/plain;charset=utf-8  (INTE application/json — det
 *     skulle trigga preflight)
 *   - inga custom headers
 * Kroppen är JSON som en sträng; GAS gör JSON.parse(e.postData.contents).
 * Svaret läses som text och JSON-parsas här. fetch följer GAS 302-redirecten
 * till googleusercontent automatiskt (default redirect: 'follow').
 */
'use strict';

var t = TrelloPowerUp.iframe();

// Anpassa popup-höjden till innehållet (responsivt, undviker tomrum).
function fit() { t.sizeTo('#app').catch(function () {}); }

function statusEl() { return document.getElementById('status'); }

// kind: 'pending' | 'ok' | 'err'. head = rubrikrad, body = monospace-innehåll.
function showStatus(kind, head, body) {
  var el = statusEl();
  el.className = 'show ' + kind;
  var headHtml = (kind === 'pending')
    ? '<span class="dots">' + head + '</span>'
    : head;
  el.innerHTML = '<div class="head">' + headHtml + '</div>'
    + (body ? '<pre></pre>' : '');
  if (body) { el.querySelector('pre').textContent = body; }
  fit();
}

// Visar ett GAS-svar och respekterar data.ok (GAS svarar alltid HTTP 200,
// så fel signaleras i kroppens ok-fält, inte i statuskoden).
function showGasResult(data) {
  var pretty = JSON.stringify(data, null, 2);
  if (data && data.ok === false) {
    showStatus('err', '⚠️ GAS svarade med fel', pretty);
  } else {
    showStatus('ok', '✅ Svar från GAS', pretty);
  }
}

// Skickar en action till GAS doPost utan att trigga CORS-preflight.
function postToGas(action, payload) {
  var url = window.NYA_ZAPIER_CONFIG.GAS_URL;
  if (!url || url.indexOf('REPLACE_WITH_DEPLOYMENT_ID') !== -1) {
    return Promise.reject(new Error('GAS_URL är inte ifylld i config.js'));
  }
  var body = JSON.stringify({ action: action, payload: payload || {} });
  return fetch(url, {
    method: 'POST',
    // text/plain → simple request → ingen OPTIONS-preflight
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body,
  }).then(function (res) {
    return res.text().then(function (text) {
      if (!res.ok) {
        throw new Error('GAS HTTP ' + res.status + ': ' + text.slice(0, 200));
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error('Ogiltigt JSON-svar från GAS: ' + text.slice(0, 200));
      }
    });
  });
}

// Dispatch per kommandotyp.
function runCommand(cmd) {
  if (cmd.type === 'alert') {
    // Ren klient-stub – stäng paletten och visa Trello-alert.
    return t.closePopup().then(function () {
      return t.alert({ message: cmd.message, duration: 6, display: 'info' });
    });
  }

  if (cmd.type === 'gas') {
    showStatus('pending', 'Anropar GAS');
    return postToGas(cmd.action, { source: 'palette', cmd: cmd.id })
      .then(function (data) { showGasResult(data); })
      .catch(function (err) { showStatus('err', '⚠️ ' + err.message); });
  }

  if (cmd.type === 'gasCard') {
    showStatus('pending', 'Läser kort och anropar GAS');
    // Läs kortkontext. Faller tillbaka till {} om vi inte är i kort-kontext
    // (t.ex. board-knappen) så flödet aldrig bryts.
    return t.card('id', 'name', 'url', 'shortLink')
      .catch(function () { return {}; })
      .then(function (card) {
        return postToGas(cmd.action, { source: 'palette', cmd: cmd.id, card: card });
      })
      .then(function (data) { showGasResult(data); })
      .catch(function (err) { showStatus('err', '⚠️ ' + err.message); });
  }

  return t.alert({ message: 'Okänd kommandotyp: ' + cmd.type, display: 'error' });
}

// Bygg en kommandorad.
function buildRow(cmd) {
  var li = document.createElement('li');
  li.className = 'cmd';
  li.tabIndex = 0;

  var tile = document.createElement('div');
  tile.className = 'tile';
  tile.textContent = cmd.icon || '•';

  var body = document.createElement('div');
  body.className = 'body';
  var title = document.createElement('div');
  title.className = 't';
  title.textContent = cmd.title || cmd.text || cmd.id;
  body.appendChild(title);
  if (cmd.desc) {
    var desc = document.createElement('div');
    desc.className = 'd';
    desc.textContent = cmd.desc;
    body.appendChild(desc);
  }

  var kbd = document.createElement('div');
  kbd.className = 'kbd';
  kbd.textContent = '↵';

  li.appendChild(tile);
  li.appendChild(body);
  li.appendChild(kbd);

  li.addEventListener('click', function () { runCommand(cmd); });
  li.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); runCommand(cmd); }
  });
  return li;
}

// Rendera paletten.
function render() {
  var logo = document.getElementById('brandLogo');
  if (logo && window.NYA_ZAPIER_CONFIG.LOGO_URL) {
    logo.src = window.NYA_ZAPIER_CONFIG.LOGO_URL;
  }
  var ul = document.getElementById('cmds');
  (window.NYA_ZAPIER_COMMANDS || []).forEach(function (cmd) {
    ul.appendChild(buildRow(cmd));
  });
  fit();
}

document.addEventListener('DOMContentLoaded', render);
