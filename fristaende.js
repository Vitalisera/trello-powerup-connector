/* global window, document, localStorage, location, history, URLSearchParams, setTimeout */
/*
 * Ersättare för Trellos bibliotek när en vy öppnas som egen sida, utanför Trello.
 * Steg 1 (Robert 2026-11-13): obetalda.html. Steg 2 (Robert 2026-11-14 "Jax3"): kurs.html, kursöversikten för att SE.
 * Laddas I STÄLLET FÖR p.trellocdn.com/power-up.min.js. Power-Upen i Trello laddar aldrig den här filen.
 *
 * Sidan som laddar filen kan sätta window.VZ_SIDA FÖRE den här filen:
 *   { titel: 'Kursöversikt', tavla: '<board-id>', lasande: true }
 *   - titel   rubriken på inloggningsrutan (standard "Obetalda fakturor", som i steg 1)
 *   - tavla   tavlan som getContext() svarar med (kursöversikten väljer kurs bland tavlans listor)
 *   - lasande true = SPÄRR: alla skrivningar stoppas i window.fetch. Trello får bara GET, servern bara
 *             åtgärderna i LASATGARDER. Allt annat avvisas med LAS_TEXT innan något lämnar webbläsaren.
 *             Obetalda har inte läsläge, eftersom Släck och Ångra skriver kommentarer på kortet.
 *
 * Inloggning: Trellos vanliga godkännandesida (/1/authorize, callback_method=fragment). Token kommer tillbaka i
 * adressens hash, sparas i den här webbläsaren (localStorage) och hashen tas bort ur adressen och historiken.
 * Token skickas bara till Trello och till vår server. Servern (routeGated_) avgör behörighet.
 *
 * Trellos lagring (t.get/t.getAll) läses via REST (pluginData), fail-soft: fel ger standardvärdet.
 * t.set/t.remove skriver aldrig till Trello härifrån: panelernas ordning och hopfällning sparas i den här
 * webbläsaren, allt annat ignoreras (lyckat svar, ingen ändring).
 *
 * Får ALDRIG kasta vid TrelloPowerUp.iframe(): course.js tömmer då localStorage, och inloggningen försvinner.
 */
(function () {
  'use strict';
  var NYCKEL = 'vz_fristaende_token';
  var SIDA = window.VZ_SIDA || {};
  var LAS_TEXT = 'Den här sidan visar mest. Incheckningen kan ändras här, allt annat ändras i Trello.';
  // Serveråtgärder som bara läser (genomgångna i gas/Code.gs och gas/Assistent.gs 2026-11-14).
  var LASATGARDER = ['ping', 'courseAllergies', 'courseGenderSplit', 'courseDocStatus', 'courseFollowupStatus',
    'courseBetalstatus', 'courseBetalDetalj', 'betalOversikt', 'assistStatus', 'findCarriedDocs', 'kursark', 'incheckning'];
  // Robert 2026-11-14: incheckningen i Rumsindelning-arket är det enda som får skrivas från webbappen. Skriver EN cell;
  // servern tillåter bara fälten kryssruta, anhörig, mobil, förvaring, lån och anteckningar. Allt annat stoppas som förut.
  var SKRIVUNDANTAG = ['incheckningSkriv'];
  var LOKALA_NYCKLAR = { vz_panel_layout: true, vz_panel_collapsed: true };

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

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function inloggning() {
    var root = document.getElementById('root');
    if (!root) { return; }
    root.innerHTML = '<div class="vz-bt"><div class="vz-bt-head"><h1>' + escHtml(SIDA.titel || 'Obetalda fakturor') + '</h1></div>'
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
    a.style.cssText = 'position:fixed;bottom:calc(6px + env(safe-area-inset-bottom,0px));left:calc(8px + env(safe-area-inset-left,0px));z-index:99999;font:600 12px/1 Calibri,system-ui,sans-serif;'
      + 'color:#5d7c87;background:rgba(255,255,255,.9);border:1px solid #c9d6db;padding:5px 9px;border-radius:6px;cursor:pointer';
    a.addEventListener('click', function () { glom(); MINNE = ''; location.reload(); });
    document.body.appendChild(a);
  }

  // Kort meddelande längst ned (ersätter t.alert, som i Trello visas som en ruta).
  var toastTimer = null;
  function visaMeddelande(text) {
    if (!text || !document.body) { return; }
    var el = document.getElementById('vz-fr-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vz-fr-toast';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:calc(40px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:100000;max-width:min(92vw,520px);'
        + 'font:600 14px/1.4 Calibri,system-ui,sans-serif;color:#fff;background:#08445c;padding:10px 14px;border-radius:9px;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,.2)';
      document.body.appendChild(el);
    }
    el.textContent = String(text);
    el.hidden = false;
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { el.hidden = true; }, 6000);
  }

  // Felrad överst (k11, Robert 2026-11-14): ett fel som annars ger en tom eller halv sida visas som en begriplig rad med
  // "Försök igen". kod = teknisk kod i liten text (aldrig namn, e-post eller annat om en person). Får ALDRIG kasta,
  // eftersom den körs i felvägar. Går att anropa flera gånger: raden uppdateras i stället för att dubbleras.
  function visaFel(text, kod, forsok) {
    try {
      if (!document.body || !document.createElement) { return null; }
      var el = document.getElementById ? document.getElementById('vz-fel') : null;
      if (!el) {
        el = document.createElement('div');
        el.id = 'vz-fel';
        el.setAttribute('role', 'alert');
        el.style.cssText = 'box-sizing:border-box;margin:0;padding:12px 16px;background:#fdecea;border-bottom:2px solid #b23a2e;color:#7a1f14;'
          + 'font:600 15px/1.4 Calibri,system-ui,sans-serif';
        if (document.body.firstChild && document.body.insertBefore) { document.body.insertBefore(el, document.body.firstChild); }
        else { document.body.appendChild(el); }
      }
      while (el.firstChild) { el.removeChild(el.firstChild); }
      var rad = document.createElement('div');
      rad.textContent = String(text || 'Något gick fel.');
      el.appendChild(rad);
      if (kod) {
        var liten = document.createElement('div');
        liten.style.cssText = 'margin-top:2px;font:400 12px/1.3 Calibri,system-ui,sans-serif;color:#8a4a42';
        liten.textContent = 'Felkod: ' + String(kod).slice(0, 120);
        el.appendChild(liten);
      }
      var kn = document.createElement('button');
      kn.type = 'button';
      kn.textContent = 'Försök igen';
      kn.style.cssText = 'margin-top:8px;min-height:44px;padding:10px 16px;border:0;border-radius:10px;background:#08445c;color:#fff;'
        + 'font:700 14px/1.2 Calibri,system-ui,sans-serif;cursor:pointer';
      kn.addEventListener('click', function () { if (typeof forsok === 'function') { forsok(); } else { location.reload(); } });
      el.appendChild(kn);
      el.hidden = false;
      return el;
    } catch (e) { return null; }   // felraden själv får aldrig fälla något
  }

  // Webbappen (SIDA.lasande): vakter mot en tom sida. (1) Ett skript som inte går att hämta (nätet föll bort, cachad
  // fil saknas) ger annars en tom vit sida utan förklaring. (2) Om #root fortfarande är tomt efter 15 s har ingen
  // vy ritat något. Gäller bara kurs.html; obetalda.html har sina egna meddelanden och rörs inte.
  if (SIDA.lasande) {
    try {
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('error', function (e) {
          var el = e && e.target;
          if (!el || el === window || String(el.tagName || '').toUpperCase() !== 'SCRIPT' || !el.src) { return; }
          var fil = String(el.src).split('?')[0].split('/').pop();
          visaFel('Sidan kunde inte laddas helt. Kontrollera nätet.', 'skript ' + fil);
        }, true);
      }
    } catch (e) { /* ingen vakt tillgänglig i den här webbläsaren: sidan fungerar som förut */ }
  }

  var VANTA = new Promise(function () { /* löses aldrig: inloggningen visas i stället */ });

  var restApi = {
    getToken: function () { var v = token(); return v ? Promise.resolve(v) : VANTA; },
    isAuthorized: function () { return Promise.resolve(!!token()); },
    authorize: function () { authorize(); return VANTA; },
    clearToken: function () { glom(); MINNE = ''; return Promise.resolve(); }
  };

  /* ---------- Trellos lagring, bara läsning ---------- */
  var origFetch = (typeof window.fetch === 'function') ? window.fetch.bind(window) : null;
  var lagringsCache = {};
  // Alla vz_-nycklar i modellens pluginData (board eller kort). Fel eller ingen token → tomt objekt.
  function lasLagring(modell) {
    var tok = token();
    if (!tok || !origFetch) { return Promise.resolve({}); }
    var id = (modell === 'board') ? SIDA.tavla : modell;
    if (!id) { return Promise.resolve({}); }
    var vag = (modell === 'board' ? 'boards/' : 'cards/') + encodeURIComponent(id) + '/pluginData';
    if (!lagringsCache[vag]) {
      lagringsCache[vag] = origFetch('https://api.trello.com/1/' + vag + '?key=' + encodeURIComponent(appKey()) + '&token=' + encodeURIComponent(tok))
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (arr) {
          var ut = {};
          (Array.isArray(arr) ? arr : []).forEach(function (pd) {
            if (!pd || (pd.access && pd.access !== 'shared')) { return; }
            var v; try { v = JSON.parse(pd.value); } catch (e) { return; }   // tyst: en trasig rad hoppas över, övriga läses
            if (!v || typeof v !== 'object') { return; }
            Object.keys(v).forEach(function (k) { if (k.indexOf('vz_') === 0) { ut[k] = v[k]; } });
          });
          return ut;
        })
        // TYST med avsikt (k11-genomgång): pluginData bär bara panelernas ordning och hopfällning. Faller hämtningen ger det
        // standardlayouten, inte en tom sida; ett riktigt nätfel visar course.js själv i sin egen hämtning.
        .catch(function () { return {}; });
    }
    return lagringsCache[vag];
  }
  function lokal(k) {
    // tyst: privat läge eller trasigt värde ger standardlayouten
    try { var s = localStorage.getItem('vz_fr_' + k); return s ? JSON.parse(s) : undefined; } catch (e) { return undefined; }
  }

  var t = {
    getRestApi: function () { return restApi; },
    closeModal: function () { /* egen sida: inget att stänga */ },
    alert: function (o) { if (o && o.message) { visaMeddelande(o.message); } return Promise.resolve(); },
    sizeTo: function () { return Promise.resolve(); },
    getContext: function () { return SIDA.tavla ? { board: SIDA.tavla } : {}; },
    arg: function () { return null; },
    // Används bara för att sätta etiketter (som startar automationer). Aldrig på en egen sida.
    board: function () { return Promise.reject(new Error(LAS_TEXT)); },
    popup: function (o) { if (o && /authorize/.test(String(o.url || ''))) { authorize(); } return Promise.resolve(); },
    closePopup: function () { return Promise.resolve(); },
    get: function (modell, synlighet, nyckel, standard) {
      if (synlighet !== 'shared') { return Promise.resolve(standard); }
      if (modell === 'board' && LOKALA_NYCKLAR[nyckel]) {
        var l = lokal(nyckel);
        if (l !== undefined) { return Promise.resolve(l); }
      }
      return lasLagring(modell).then(function (o) { return (o[nyckel] === undefined) ? standard : o[nyckel]; });
    },
    getAll: function () {
      return lasLagring('board').then(function (o) { return { board: { shared: o } }; });
    },
    set: function (modell, synlighet, nyckel, varde) {
      if (modell === 'board' && LOKALA_NYCKLAR[nyckel]) {
        try { localStorage.setItem('vz_fr_' + nyckel, JSON.stringify(varde)); } catch (e) { /* bara denna visning */ }
      }
      return Promise.resolve();   // ingenting skrivs till Trello härifrån
    },
    remove: function () { return Promise.resolve(); }
  };

  /* ---------- Läsläge: spärr i window.fetch ---------- */
  function atgard(body) {
    if (typeof body !== 'string') { return ''; }
    // tyst: oläsbar kropp ger '' och stoppas av spärren (avsiktligt, fail-closed)
    try { var j = JSON.parse(body); return (j && typeof j.action === 'string') ? j.action : ''; } catch (e) { return ''; }
  }
  // Ren funktion (provas i proof.js): null = släpp igenom, annars skälet att stoppa.
  function sparrSkal(url, metod, body, gasUrl) {
    url = String(url || '');
    metod = String(metod || 'GET').toUpperCase();
    if (gasUrl && url.indexOf(gasUrl) === 0) {
      var a = atgard(body);
      return (LASATGARDER.indexOf(a) !== -1 || SKRIVUNDANTAG.indexOf(a) !== -1) ? null : 'serveråtgärd utanför läslistan';
    }
    if (metod !== 'GET' && metod !== 'HEAD') { return 'skrivning (' + metod + ')'; }
    return null;
  }
  if (SIDA.lasande && origFetch) {
    window.fetch = function (input, init) {
      var url = (input && typeof input === 'object' && typeof input.url === 'string') ? input.url : String(input || '');   // sträng, URL-objekt eller Request
      var metod = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
      var body = init && init.body;
      var gas = (window.NYA_ZAPIER_CONFIG && window.NYA_ZAPIER_CONFIG.GAS_URL) || '';
      var skal = sparrSkal(url, metod, body, gas);
      if (skal) {
        if (window.console) { console.warn('[läsläge] stoppat: ' + skal); }
        return Promise.reject(new Error(LAS_TEXT));
      }
      return origFetch(input, init);
    };
    document.documentElement.classList.add('vz-lasande');
  }

  // "Visa obetalda" i kursöversikten går till betal.html, som laddar Trellos bibliotek. Här: obetalda.html.
  function tillObetalda(e) {
    var b = e.target && e.target.closest ? e.target.closest('#vz-cv-betalbtn') : null;
    if (!b) { return; }
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') { return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    var v = (new URLSearchParams(location.search)).get('v') || '';
    location.href = './obetalda.html?from=kurs' + (v ? '&v=' + encodeURIComponent(v) : '');
  }
  document.addEventListener('click', tillObetalda, true);
  document.addEventListener('keydown', tillObetalda, true);

  window.TrelloPowerUp = { iframe: function () { return t; } };
  window.VZ_FRISTAENDE = true;
  window.VZ_VISA_FEL = visaFel;
  window.VZ_FRISTAENDE_PROV = { visaFel: visaFel, sparrSkal: sparrSkal, LASATGARDER: LASATGARDER, LAS_TEXT: LAS_TEXT, t: t };

  // Registreras före vyns egen DOMContentLoaded-lyssnare (det här skriptet laddas först).
  document.addEventListener('DOMContentLoaded', function () {
    if (SIDA.lasande && document.body) { document.body.classList.add('vz-lasande'); }
    if (SIDA.lasande) {
      // Täcker bara fallet att inget skript ritade något alls; en hämtning som hänger på "Hämtar …" fångas inte (k12).
      setTimeout(function () {
        var r = document.getElementById('root');
        if (r && !String(r.innerHTML || '').replace(/\s+/g, '')) { visaFel('Sidan kunde inte laddas. Kontrollera nätet.', 'tom sida efter 15 s'); }
      }, 15000);
    }
    if (token()) { glomKnapp(); return; }
    // Vyns boot() ritar "Hämtar …"/"Anslut" och väntar på getToken(); vi ritar inloggningen efter den.
    setTimeout(inloggning, 0);
  });
})();
