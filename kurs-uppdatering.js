/* Webbappen: uppdateringsbanderoll och installationsguide (k11, Robert 2026-11-14). Laddas BARA av kurs.html, sist.
 * Power-Upen i Trello laddar aldrig filen.
 *
 * 1) Uppdateringsbanderoll: GitHub Pages cachar kurs.html i upp till 10 minuter (max-age=600), så telefonen kunde visa en
 *    gammal version en stund efter en release. Sidan hämtar därför kurs-version.json (aldrig cachad) vid start och när
 *    den blir synlig igen, och jämför med versionen den själv körs med. Skiljer de sig visas en rad med "Ladda om".
 *    Aldrig en banderoll om hämtningen misslyckas, och högst en kontroll per 60 s. Inloggningen ligger i localStorage
 *    och berörs inte av omladdningen.
 * 2) Installationsguide: visas EN gång i en telefon som öppnar sidan i webbläsaren (inte som hemskärmsapp).
 *    Flaggan sparas i localStorage; kan den inte läsas visas inget (hellre ingen guide än en som upprepas). */
(function () {
  'use strict';

  var INTERVALL_MS = 60000;
  var GUIDE_NYCKEL = 'vz_kurs_guide_sedd';
  var senast = 0;
  var visad = false;

  // Ren funktion (provas): ska banderollen visas? lokal = versionen sidan kör med, ny = svaret ur kurs-version.json.
  function skiljer(lokal, ny) {
    return typeof ny === 'string' && /^[A-Za-z0-9._-]{1,20}$/.test(ny) && String(lokal || '') !== ny;
  }

  // Sidans EGEN version (VZ_KURS_V i kurs.html), aldrig ?v ur adressen: ?v är bara cachebrytare och kan vara vad som helst
  // (en gammal länk med ?v=176 fick annars banderollen att stå kvar för alltid och märket visa fel).
  function lokalVersion() {
    return window.VZ_KURS_V || '';
  }

  // Ren funktion (provas): adressen "Ladda om" går till. Behåller övriga parametrar, sätter ?v=<ny> och en cachebrytare
  // så att den cachade kurs.html inte används igen. Hashen lämnas (den bär aldrig något efter inloggningen).
  function laddaOmUrl(nuvarande, ny, nu) {
    var u = new URL(nuvarande);
    u.searchParams.delete('v');   // sidan väljer själv sin version (VZ_KURS_V); ett ?v i adressen får aldrig styra css och js
    u.searchParams.set('_', String(nu));
    return u.pathname + u.search;
  }

  function visaBanderoll(ny) {
    if (visad || !document.body) { return; }
    visad = true;
    var el = document.createElement('div');
    el.id = 'vz-uppd';
    el.setAttribute('role', 'status');
    var t = document.createElement('span');
    t.textContent = 'Det finns en ny version av Kursöversikt.';
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Ladda om';
    b.addEventListener('click', function () {
      try { location.replace(laddaOmUrl(location.href, ny, Date.now())); } catch (e) { location.reload(); }
    });
    el.appendChild(t);
    el.appendChild(b);
    document.body.insertBefore(el, document.body.firstChild);
  }

  /* En omladdning kräver att inloggningen överlever: utan fungerande localStorage (Safari privat, token bara i minnet) vore
   * "Ladda om" en väg till utloggning. Då visas ingen banderoll alls. */
  function lagringFungerar() {
    try { var k = 'vz_lagringstest'; localStorage.setItem(k, '1'); var ok = localStorage.getItem(k) === '1'; localStorage.removeItem(k); return ok; } catch (e) { return false; }
  }

  function kolla() {
    var nu = Date.now();
    if (visad || nu - senast < INTERVALL_MS) { return; }
    if (!lagringFungerar()) { return; }
    senast = nu;
    if (typeof window.fetch !== 'function') { return; }
    try {
      window.fetch('kurs-version.json?t=' + nu, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && skiljer(lokalVersion(), j.v)) { visaBanderoll(j.v); } })
        // TYST med avsikt: nätfel, 404 eller trasig JSON ska aldrig ge en banderoll. Nästa kontroll tar det.
        .catch(function () { });
    } catch (e) { /* TYST med avsikt: en kontroll som inte kan starta får inte stoppa sidan eller guiden */ }
  }

  /* ---------- Installationsguide ---------- */

  function arApp() {
    try {
      if (navigator.standalone) { return true; }
      return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch (e) { return false; }   // osäkert: räkna som webbläsare (guiden visas högst en gång)
  }

  // 'iphone' | 'android' | '' (dator och övrigt). iPad som utger sig för Mac känns igen på pekskärmen.
  function enhet(nav) {
    var ua = String((nav && nav.userAgent) || '');
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1)) { return 'iphone'; }
    if (/Android/.test(ua)) { return 'android'; }
    return '';
  }

  var GUIDE_TEXT = {
    iphone: 'Lägg Kursöversikt på hemskärmen: tryck på Dela och sedan Lägg till på hemskärmen.',
    android: 'Lägg Kursöversikt på hemskärmen: öppna menyn ⋮ och välj Lägg till på startskärmen.'
  };

  // Ren funktion (provas): vilken guide ska visas, eller '' om ingen. Alla villkor in som argument.
  function guideFor(o) {
    if (!o.enhet || o.app || !o.toppen || o.sedd !== false) { return ''; }
    return o.enhet;
  }

  function guideSedd() {
    try { return localStorage.getItem(GUIDE_NYCKEL) === '1'; } catch (e) { return null; }   // null = kan inte läsas
  }

  function visaGuide() {
    var sedd = guideSedd();
    var vilken = guideFor({ enhet: enhet(navigator), app: arApp(), toppen: window.top === window, sedd: sedd === null ? true : sedd });
    if (!vilken || !document.body) { return; }
    var ov = document.createElement('div');
    ov.id = 'vz-guide';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    var kort = document.createElement('div');
    kort.className = 'vz-guide-kort';
    var p = document.createElement('p');
    p.textContent = GUIDE_TEXT[vilken];
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Jag förstår';
    b.addEventListener('click', function () {
      try { localStorage.setItem(GUIDE_NYCKEL, '1'); } catch (e) { /* privat läge: guiden kan visas igen, ofarligt */ }
      if (ov.parentNode) { ov.parentNode.removeChild(ov); }
    });
    kort.appendChild(p);
    kort.appendChild(b);
    ov.appendChild(kort);
    document.body.appendChild(ov);
  }

  window.VZ_UPPDATERING_PROV = { skiljer: skiljer, laddaOmUrl: laddaOmUrl, kolla: kolla, guideFor: guideFor, enhet: enhet, visaGuide: visaGuide, lokalVersion: lokalVersion, lagringFungerar: lagringFungerar };

  function start() {
    kolla();
    try { visaGuide(); } catch (e) { /* guiden är en hjälp, aldrig ett krav */ }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { kolla(); } });
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start); } else { start(); }
})();
