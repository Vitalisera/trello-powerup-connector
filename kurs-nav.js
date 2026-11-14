/* Webbappen: snabbnavigering (Robert 2026-11-14). Laddas BARA av kurs.html, sist. Power-Upen i Trello laddar aldrig filen.
 * En rad knappar högst upp, en per avsnitt som faktiskt finns på sidan just nu. Raden byggs om när sidan ritas om
 * (MutationObserver på #root), så listan följer det som ritats och aldrig en fast lista. Ett tryck skrollar till avsnittet.
 * Ändrar inga andra filer: avsnitt utan id får ett id här (bara attributet). */
(function () {
  'use strict';

  // Avsnitten i den ordning de ligger på sidan. sel = första träffen som syns; namn = knapptext.
  var AVSNITT = [
    { id: 'vz-mlista', namn: 'Deltagare', sel: ['#vz-mlista', '.vz-region-matrix'] },
    { id: 'vz-tel', namn: 'Telefonlista', sel: ['#vz-tel'] },
    { id: 'vz-personal', namn: 'Personal', sel: ['#vz-personal', '.vz-panel--aside'] },
    { id: 'vz-ic', namn: 'Incheckning', sel: ['#vz-ic'] }
  ];

  function syns(el) { return !el.getClientRects || el.getClientRects().length > 0; }

  // Hittar de avsnitt som finns och syns. Ger dem id om de saknar. Returnerar [{id, namn, el}].
  function hitta(doc) {
    var ut = [];
    AVSNITT.forEach(function (a) {
      for (var i = 0; i < a.sel.length; i++) {
        var el = doc.querySelector(a.sel[i]);
        if (el && syns(el)) {
          if (!el.id) { el.id = a.id; }
          ut.push({ id: el.id, namn: a.namn, el: el });
          return;
        }
      }
    });
    return ut;
  }

  // Fäller ut ett avsnitt. details-avsnitt (Deltagare, Telefonlista, Incheckning) öppnas med .open;
  // Personal-panelen (course.js, rörs inte) har klassen vz-sek-stangd som tas bort.
  function falUt(el) {
    if (!el) { return; }
    if (el.tagName === 'DETAILS') { el.open = true; return; }
    if (el.classList && el.classList.contains('vz-sek-stangd')) { el.classList.remove('vz-sek-stangd'); sattAria(el, true); }
  }
  function sattAria(panel, oppen) {
    var t = panel.querySelector ? panel.querySelector('.vz-panel-title') : null;
    if (t && t.setAttribute) { t.setAttribute('aria-expanded', oppen ? 'true' : 'false'); }
  }

  // Personal-panelen ritas av course.js och får inte ändras där. Här görs den infälld: rubriken (som får antalet)
  // blir tryckbar och klassen vz-sek-stangd döljer resten via kurs-mobil.css.
  function infall(doc) {
    var paneler = doc.querySelectorAll ? doc.querySelectorAll('.vz-panel--aside') : [];
    [].slice.call(paneler).forEach(function (panel) {
      if (panel.getAttribute('data-vz-sek')) { return; }
      var t = panel.querySelector('.vz-panel-title');
      if (!t) { return; }
      panel.setAttribute('data-vz-sek', '1');
      var antal = panel.querySelectorAll('.vz-staff-row').length;
      if (antal) { t.textContent = t.textContent + ' (' + antal + ')'; }
      t.setAttribute('role', 'button'); t.setAttribute('tabindex', '0'); t.setAttribute('aria-expanded', 'false');
      panel.classList.add('vz-sek-stangd');
      function vaxla() {
        var stangd = panel.classList.toggle('vz-sek-stangd');
        t.setAttribute('aria-expanded', stangd ? 'false' : 'true');
      }
      t.addEventListener('click', vaxla);
      t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vaxla(); } });
    });
  }

  function bygg(doc) {
    infall(doc);
    var mal = hitta(doc);
    var nav = doc.getElementById('vz-nav');
    if (mal.length < 2) {   // ett enda avsnitt behöver ingen navigering
      if (nav && nav.parentNode) { nav.parentNode.removeChild(nav); }
      return 0;
    }
    var sig = mal.map(function (m) { return m.id; }).join('|');
    if (nav && nav.getAttribute('data-sig') === sig) { return mal.length; }
    if (!nav) {
      nav = doc.createElement('nav');
      nav.id = 'vz-nav';
      nav.setAttribute('aria-label', 'Hoppa till avsnitt');
      var root = doc.getElementById('root');
      if (root && root.parentNode) { root.parentNode.insertBefore(nav, root); } else { doc.body.insertBefore(nav, doc.body.firstChild); }
      nav.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('button[data-mal]') : null;
        if (!b) { return; }
        var el = doc.getElementById(b.getAttribute('data-mal'));
        falUt(el);   // avsnittet fälls ut innan vi hoppar dit
        if (el && el.scrollIntoView) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
    }
    nav.setAttribute('data-sig', sig);
    nav.innerHTML = '<div class="vz-nav-rad">' + mal.map(function (m) {
      return '<button type="button" class="vz-nav-knapp" data-mal="' + m.id + '">' + m.namn + '</button>';
    }).join('') + '</div>';
    return mal.length;
  }

  window.VZ_KURSNAV_PROV = { hitta: hitta, bygg: bygg, falUt: falUt, infall: infall, AVSNITT: AVSNITT };

  if (!window.VZ_SIDA) { return; }   // bara på den egna sidan
  var rot = document.getElementById('root');
  var timer = null;
  function planera() { clearTimeout(timer); timer = setTimeout(function () { try { bygg(document); } catch (e) { /* navigeringen får aldrig fälla sidan */ } }, 150); }
  if (rot && window.MutationObserver) { new MutationObserver(planera).observe(rot, { childList: true, subtree: true }); }
  planera();
})();
