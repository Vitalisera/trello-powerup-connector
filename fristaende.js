/* global window, document, localStorage, location, history, URLSearchParams */
/*
 * Ersättare för Trellos bibliotek när en vy öppnas som egen sida, utanför Trello (webbappsprovet steg 1, Robert 2026-11-13).
 * Laddas I STÄLLET FÖR p.trellocdn.com/power-up.min.js av obetalda.html. Inga befintliga filer ändras.
 *
 * Inloggning: Trellos vanliga godkännandesida (/1/authorize, callback_method=fragment). Token kommer tillbaka i
 * adressens hash, sparas i den här webbläsaren (localStorage) och hashen tas bort ur adressen och historiken.
 * Token skickas bara till Trello och till vår server, precis som i Power-Upen. Servern (routeGated_) avgör behörighet.
 *
 * Saknas token visas en inloggningsknapp och vyns getToken() väntar (löses aldrig), så att vyn inte visar
 * Power-Upens text "Öppna Kursöversikten och klicka Anslut", som inte gäller här.
 */
(function () {
  'use strict';
  var NYCKEL = 'vz_fristaende_token';

  function las() { try { return localStorage.getItem(NYCKEL) || ''; } catch (e) { return ''; } }
  function spara(v) { try { localStorage.setItem(NYCKEL, v); } catch (e) { /* privat läge: gäller bara denna visning */ } }
  function glom() { try { localStorage.removeItem(NYCKEL); } catch (e) { /* inget att glömma */ } }

  // 1. Token tillbaka från Trello i hashen: #token=...  (eller #error=... om man nekade)
  var MINNE = '';
  var NEKAD = false;
  (function () {
    var h = String(location.hash || '').replace(/^#/, '');
    if (!h) { return; }
    var p = new URLSearchParams(h);
    var tok = p.get('token');
    if (tok && /^[A-Za-z0-9]{32,128}$/.test(tok)) { MINNE = tok; spara(tok); }
    if (p.get('error')) { NEKAD = true; }
    if (tok || p.get('error')) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
    }
  })();

  function token() { return MINNE || las(); }

  function appKey() {
    var c = window.NYA_ZAPIER_CONFIG;
    return (c && c.APP_KEY) || '';
  }

  function authorize() {
    var c = window.NYA_ZAPIER_CONFIG || {};
    var ret = location.origin + location.pathname + location.search;
    location.href = 'https://trello.com/1/authorize?key=' + encodeURIComponent(appKey())
      + '&name=' + encodeURIComponent(c.APP_NAME || 'Vitalisera')
      + '&scope=read,write&expiration=never&response_type=token&callback_method=fragment'
      + '&return_url=' + encodeURIComponent(ret);
  }

  function inloggning() {
    var root = document.getElementById('root');
    if (!root) { return; }
    root.innerHTML = '<div class="vz-bt"><div class="vz-bt-head"><h1>Obetalda fakturor</h1></div>'
      + '<div class="vz-bt-wait">'
      + (NEKAD ? '<p>Trello gav inte tillgång. Försök igen om det var ett misstag.</p>' : '')
      + '<p>Logga in med ditt Trello-konto för att se sidan. Webbläsaren minns inloggningen tills du väljer Glöm den här enheten.</p>'
      + '<button id="vz-fr-login">Logga in med Trello</button></div></div>';
    var b = document.getElementById('vz-fr-login');
    if (b) { b.addEventListener('click', authorize); }
  }

  function glomKnapp() {
    var a = document.createElement('button');
    a.id = 'vz-fr-glom';
    a.textContent = 'Glöm den här enheten';
    a.title = 'Tar bort inloggningen från den här webbläsaren. Nästa gång behöver du logga in igen.';
    a.style.cssText = 'position:fixed;bottom:6px;left:8px;z-index:99999;font:600 12px/1 Calibri,system-ui,sans-serif;'
      + 'color:#5d7c87;background:rgba(255,255,255,.9);border:1px solid #c9d6db;padding:5px 9px;border-radius:6px;cursor:pointer';
    a.addEventListener('click', function () { glom(); MINNE = ''; location.reload(); });
    document.body.appendChild(a);
  }

  var VANTA = new Promise(function () { /* löses aldrig: inloggningen visas i stället */ });

  var restApi = {
    getToken: function () { var v = token(); return v ? Promise.resolve(v) : VANTA; },
    isAuthorized: function () { return Promise.resolve(!!token()); },
    authorize: function () { authorize(); return VANTA; },
    clearToken: function () { glom(); MINNE = ''; return Promise.resolve(); }
  };

  var t = {
    getRestApi: function () { return restApi; },
    closeModal: function () { /* egen sida: inget att stänga */ },
    alert: function (o) { if (o && o.message) { window.console && console.log(o.message); } return Promise.resolve(); },
    sizeTo: function () { return Promise.resolve(); }
  };

  window.TrelloPowerUp = { iframe: function () { return t; } };
  window.VZ_FRISTAENDE = true;

  // Registreras före vyns egen DOMContentLoaded-lyssnare (det här skriptet laddas först).
  document.addEventListener('DOMContentLoaded', function () {
    if (token()) { glomKnapp(); return; }
    // Vyns boot() ritar "Hämtar …" och väntar sedan på getToken(); vi ritar inloggningen efter den.
    setTimeout(inloggning, 0);
  });
})();
