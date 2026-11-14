/* Webbappen, läsläget. Laddas BARA av kurs.html, efter course.js. Power-Upen i Trello laddar aldrig filen.
 *
 * 1) Inga skrivningar av sig själv (Robert 2026-11-14, iPhone-provet): kursöversikten frågade "Markera klara?" och
 *    försökte bocka i Trello-korten. Spärren i fristaende.js stoppade det, men kvar blev en felruta. De två
 *    funktioner som bockar AV SIG SJÄLVA stängs därför av här. I Trello bockar de som förut.
 * 2) Deltagarlista i telefonen (Robert 2026-11-14: tabellen "inte så snygg på mobilen"): en rad per deltagare med
 *    namn, hur långt den kommit och luckor; tryck för att se vad som återstår. Bygger på SAMMA modell som tabellen
 *    (buildCourseModel), ingen egen hämtning. Tabellen finns kvar bakom knappen "Visa hela tabellen". Listan syns
 *    bara i telefonbredd (kurs-mobil.css). */
(function () {
  'use strict';
  if (!window.VZ_SIDA || !window.VZ_SIDA.lasande) { return; }

  // course.js anropar båda via sina globala namn (maybeAutoBock rad ~1743, autoTickFollowups_ rad ~3825).
  window.maybeAutoBock = function () { /* läsläge: frågar inte, bockar inte */ };
  window.autoTickFollowups_ = function () { /* läsläge: bockar inte utförda samtal */ };
  window.VZ_LASANDE_AKTIVT = true;

  function escH(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var ORD = { gap: 'Lucka', wait: 'Väntar', manual: 'Manuellt' };

  // En deltagare: sammanfattning (namn, n/total, luckor) och det som återstår, i stegordning.
  function radHtml(p, steps) {
    var st = p.status || {};
    var pr = p.progress || { done: 0, total: 0, pct: 0 };
    var kvar = (steps || []).filter(function (s) { var v = st[s.key]; return v && v !== 'done' && v !== 'na'; });
    var klar = pr.total > 0 && pr.done >= pr.total;
    var lucka = p.gapCount ? '<span class="vz-ml-lucka">' + p.gapCount + (p.gapCount === 1 ? ' lucka' : ' luckor') + '</span>' : '';
    var lista = kvar.length
      ? '<ul class="vz-ml-kvar">' + kvar.map(function (s) {
          var v = st[s.key];
          return '<li class="vz-ml-' + escH(v) + '"><span>' + escH(s.title) + '</span><em>' + escH(ORD[v] || '') + '</em></li>';
        }).join('') + '</ul>'
      : '<p class="vz-ml-allt">Alla steg klara.</p>';
    return '<details class="vz-ml-rad' + (klar ? ' is-klar' : '') + '"><summary>'
      + '<span class="vz-ml-namn">' + escH(p.name) + '</span>' + lucka
      + '<span class="vz-ml-prog"><span class="vz-ml-bar"><i style="width:' + Math.max(0, Math.min(100, Number(pr.pct) || 0)) + '%"></i></span>'
      + escH(pr.done + '/' + pr.total) + '</span>'
      + '</summary>' + lista + '</details>';
  }

  function listaHtml(model) {
    var ps = (model && model.participants) || [];
    var steps = (model && model.steps) || [];
    return '<div class="vz-ml-topp"><h3>Deltagare (' + ps.length + ')</h3>'
      + '<button type="button" class="vz-ml-vaxla" aria-pressed="false">Visa hela tabellen</button></div>'
      + (ps.length ? ps.map(function (p) { return radHtml(p, steps); }).join('') : '<p class="vz-ml-allt">Inga deltagare.</p>');
  }

  function rita(rootEl, model) {
    var host = rootEl && rootEl.querySelector ? rootEl.querySelector('.vz-region-matrix') : null;
    if (!host) { return; }
    var gammal = host.querySelector('#vz-mlista');
    if (gammal) { gammal.parentNode.removeChild(gammal); }
    var el = document.createElement('section');
    el.id = 'vz-mlista';
    el.className = 'vz-mlista';
    el.innerHTML = listaHtml(model);
    host.insertBefore(el, host.firstChild);
    var knapp = el.querySelector('.vz-ml-vaxla');
    var visar = document.documentElement.classList.contains('vz-visa-tabell');
    knapp.textContent = visar ? 'Visa som lista' : 'Visa hela tabellen';
    knapp.setAttribute('aria-pressed', visar ? 'true' : 'false');
    knapp.addEventListener('click', function () {
      var nu = document.documentElement.classList.toggle('vz-visa-tabell');
      knapp.textContent = nu ? 'Visa som lista' : 'Visa hela tabellen';
      knapp.setAttribute('aria-pressed', nu ? 'true' : 'false');
    });
  }

  window.VZ_MLISTA_PROV = { radHtml: radHtml, listaHtml: listaHtml, rita: rita };

  // course.js anropar window.CourseView.render vid varje ritning; omslaget ritar listan efteråt.
  var cv = window.CourseView;
  if (cv && typeof cv.render === 'function') {
    var orig = cv.render;
    cv.render = function (rootEl, model) {
      try { return orig.apply(this, arguments); }
      finally { try { rita(rootEl, model); } catch (e) { /* listan får aldrig fälla sidan */ } }
    };
  }
})();
