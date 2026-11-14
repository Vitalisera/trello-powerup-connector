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

  var sekOppen = false;   // avsnittet Deltagare: infällt tills man trycker på rubriken
  var ORD = { gap: 'Lucka', wait: 'Väntar', manual: 'Manuellt' };

  // Dokumentlänkar för en deltagare (Robert 2026-11-14: "Varför visas inte länken till livsberättelser etc?").
  // Samma källor som Power-Upen: stegets eget dokument (storyLinkForCard, steg-medveten etikett), det medförda
  // dokumentet på steg 2 (carriedLinkForCard) och hälsoformuläret (commentLink + HF_LINK_RES). Bara https-länkar.
  function dokLankar(p) {
    var w = window, out = [];
    var kort = w.COURSE_CARDS_BY_ID && p && w.COURSE_CARDS_BY_ID[p.key];
    if (!kort) { return out; }
    var kurs = w.COURSE_NAME || '';
    function lagg(etikett, url) {
      if (etikett && url && /^https:\/\//i.test(String(url)) && !out.some(function (l) { return l.url === url; })) { out.push({ etikett: etikett, url: String(url) }); }
    }
    try {
      if (typeof w.storyLinkForCard === 'function' && typeof w.livsLabelForCourse === 'function') { lagg(w.livsLabelForCourse(kurs), w.storyLinkForCard(kort, kurs)); }
      var cd = typeof w.carriedDocForCourse === 'function' ? w.carriedDocForCourse(kurs) : null;
      if (cd && typeof w.carriedLinkForCard === 'function') { lagg(cd.label, w.carriedLinkForCard(kort, kurs)); }
      if (typeof w.commentLink === 'function' && w.HF_LINK_RES) { lagg('Hälsoformulär', w.commentLink(kort, w.HF_LINK_RES)); }
    } catch (e) { /* en trasig länk får aldrig fälla listan */ }
    return out;
  }

  function lankarHtml(p) {
    var l = dokLankar(p);
    var kortUrl = p && p.cardUrl && /^https:\/\//i.test(String(p.cardUrl)) ? String(p.cardUrl) : '';
    if (!l.length && !kortUrl) { return ''; }
    return '<div class="vz-ml-lankar">'
      + l.map(function (x) { return '<a class="vz-ml-lank" href="' + escH(x.url) + '" target="_blank" rel="noopener">' + escH(x.etikett) + ' ↗</a>'; }).join('')
      + (l.length ? '' : '<span class="vz-ml-inga">Inga dokument på kortet ännu.</span>')
      + (kortUrl ? '<a class="vz-ml-lank vz-ml-kort" href="' + escH(kortUrl) + '" target="_blank" rel="noopener">Trello-kortet ↗</a>' : '')
      + '</div>';
  }

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
      + '</summary>' + lankarHtml(p) + lista + '</details>';
  }

  function listaHtml(model) {
    var ps = (model && model.participants) || [];
    var steps = (model && model.steps) || [];
    return '<summary class="vz-sek-rub">Deltagare (' + ps.length + ')</summary>'
      + '<div class="vz-ml-topp">'
      + '<button type="button" class="vz-ml-vaxla" aria-pressed="false">Visa hela tabellen</button></div>'
      + (ps.length ? ps.map(function (p) { return radHtml(p, steps); }).join('') : '<p class="vz-ml-allt">Inga deltagare.</p>');
  }

  function rita(rootEl, model) {
    var host = rootEl && rootEl.querySelector ? rootEl.querySelector('.vz-region-matrix') : null;
    if (!host) { return; }
    var gammal = host.querySelector('#vz-mlista');
    if (gammal) { gammal.parentNode.removeChild(gammal); }
    // Infälld från början (Robert 2026-11-14). Läget bevaras när sidan ritas om.
    var el = document.createElement('details');
    el.id = 'vz-mlista';
    el.className = 'vz-mlista vz-sek';
    el.innerHTML = listaHtml(model);
    el.open = sekOppen;
    el.addEventListener('toggle', function () { sekOppen = !!el.open; });
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

  window.VZ_MLISTA_PROV = { radHtml: radHtml, listaHtml: listaHtml, rita: rita, dokLankar: dokLankar };

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
