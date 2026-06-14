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

function statusEl() { return document.getElementById('status'); }

function showStatus(kind, msg) {
  var el = statusEl();
  el.className = 'show ' + kind;
  el.textContent = msg;
  // Justera popup-höjden så hela statusrutan syns (responsivt).
  t.sizeTo('body').catch(function () {});
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

// Visar ett GAS-svar och respekterar data.ok (GAS svarar alltid HTTP 200,
// så fel signaleras i kroppens ok-fält, inte i statuskoden).
function showGasResult(data) {
  if (data && data.ok === false) {
    showStatus('err', '⚠️ GAS svarade med fel:\n' + JSON.stringify(data, null, 2));
  } else {
    showStatus('ok', '✅ Svar från GAS:\n' + JSON.stringify(data, null, 2));
  }
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
    showStatus('pending', '⏳ Anropar GAS …');
    return postToGas(cmd.action, { source: 'palette', cmd: cmd.id })
      .then(function (data) { showGasResult(data); })
      .catch(function (err) {
        showStatus('err', '⚠️ ' + err.message);
      });
  }

  if (cmd.type === 'gasCard') {
    showStatus('pending', '⏳ Läser kort och anropar GAS …');
    // Läs kortkontext. Faller tillbaka till {} om vi inte är i kort-kontext
    // (t.ex. board-knappen) så flödet aldrig bryts.
    return t.card('id', 'name', 'url', 'shortLink')
      .catch(function () { return {}; })
      .then(function (card) {
        return postToGas(cmd.action, {
          source: 'palette',
          cmd: cmd.id,
          card: card,
        });
      })
      .then(function (data) { showGasResult(data); })
      .catch(function (err) {
        showStatus('err', '⚠️ ' + err.message);
      });
  }

  return t.alert({ message: 'Okänd kommandotyp: ' + cmd.type, display: 'error' });
}

// Rendera listan.
function render() {
  var ul = document.getElementById('cmds');
  var cmds = window.NYA_ZAPIER_COMMANDS || [];
  cmds.forEach(function (cmd) {
    var li = document.createElement('li');
    li.className = 'cmd';
    li.tabIndex = 0;
    li.textContent = cmd.text;
    li.addEventListener('click', function () { runCommand(cmd); });
    li.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); runCommand(cmd); }
    });
    ul.appendChild(li);
  });
  t.sizeTo('body').catch(function () {});
}

document.addEventListener('DOMContentLoaded', render);
