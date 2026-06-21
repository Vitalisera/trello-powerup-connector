/* ============================================================================
 * Vitalisera · Kursöversikt — datadriven vy (produktion)
 *
 * En KURS = en Trello-lista; varje DELTAGARE = ett kort. Den här vyn ger
 * administratören Malin en KONSOLIDERAD MATRIS över alla deltagare och var de
 * är i den administrativa processen — och framför allt board-brett SE LUCKORNA:
 * steg där en label är satt (automationen triggad) men checklistan inte bockad
 * ("borde vara klart men är inte"). Samma flöde som deltagar-dashboarden, nu
 * aggregerat över hela kursen.
 *
 * Publikt API (Robert wirar mot t.cards senare):
 *   window.CourseView.render(rootEl, model, handlers)
 *
 * Ren vanilla JS. Inga nätverksanrop, ingen Trello-SDK. Om
 * window.NYA_ZAPIER_COURSE_MODEL saknas renderas DEMO_MODEL så filen kan
 * förhandsgranskas fristående. Allt scopat under .vz-course.
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------- ikoner (inline SVG) ---------- */
  var ic = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    warn:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    hand:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-7-4l-2.8-5a2 2 0 0 1 3.5-2L7 14"/></svg>',
    search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    sort:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M7 20l-3-3M7 4l3 3M17 4v16M17 4l-3 3M17 20l3-3"/></svg>',
    people:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>'
  };

  var MARK_URL = 'https://vitalisera.github.io/trello-powerup-connector/icons/vitalisera-mark.png';

  /* status → metadata för matriscellen + legend */
  var STATUS = {
    done:   { cls: 'd-done',   word: 'Klar',     icon: ic.check, glyph: '' },
    gap:    { cls: 'd-gap',    word: 'Lucka',    icon: ic.warn,  glyph: '' },
    wait:   { cls: 'd-wait',   word: 'Återstår', icon: null,     glyph: '·' },
    manual: { cls: 'd-manual', word: 'Manuellt', icon: ic.hand,  glyph: '' },
    na:     { cls: 'd-na',     word: 'Ej relevant', icon: null,  glyph: '–' }
  };

  /* ---------- hjälpare ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }
  function meta(status) { return STATUS[status] || STATUS.wait; }
  function pmapFor(phases, key) {
    for (var i = 0; i < phases.length; i++) { if (phases[i].key === key) { return phases[i]; } }
    return null;
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '–';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function safeProgress(p) {
    var pr = p && p.progress ? p.progress : {};
    var total = pr.total != null ? pr.total : 0;
    var done = pr.done != null ? pr.done : 0;
    var pct = pr.pct != null ? pr.pct : (total ? Math.round(done / total * 100) : 0);
    return { done: done, total: total, pct: pct };
  }
  function gapsOf(p, steps) {
    if (p.gapCount != null) return p.gapCount;
    var st = p.status || {};
    return steps.reduce(function (n, s) { return n + (st[s.key] === 'gap' ? 1 : 0); }, 0);
  }

  /* #11: dok-status (HF/livsberättelse-skanning) injiceras i matrisens steg 8/9-celler.
   * course.js fyller DOC_STATUS via CourseView.applyDocStatus → repaint. Keyat på p.key (kort-id). */
  var DOC_STATUS = {};
  var LIVS_LABEL = 'Livsberättelse';   // steg-medveten (sätts i render ur model.steps livs_klar-titel)
  var repaintBodyRef = null;
  var setCellStatusRef = null;   // course.js → uppdatera EN cell efter bock/label utan att rita om modalen
  function docCellBadge(pkey, stepKey) {
    if (stepKey !== 'hf_klart' && stepKey !== 'livs_klar') { return null; }
    var d = DOC_STATUS[pkey];
    if (!d) { return null; }
    var isLivs = stepKey === 'livs_klar';
    var st = isLivs ? d.livs : d.hf;
    if (!st) { return null; }
    if (st.loading) { return { html: '<span class="vz-cv-docpct dp-wait">⏳</span>', title: 'Skannar dokument…' }; }
    if (st.ok !== true) { return null; }
    var cls = st.ready ? 'dp-done' : (st.pct > 0 ? 'dp-part' : 'dp-empty');
    var img = isLivs ? (st.hasImage ? '<i class="dp-img on">●</i>' : '<i class="dp-img">○</i>') : '';
    var title = (isLivs ? LIVS_LABEL : 'Hälsoformulär') + ': ' + st.filled + '/' + st.total + ' besvarat'
      + (st.chars ? ', ' + st.chars + ' tecken' : '')
      + (isLivs ? (st.hasImage ? ', bild ✓' : ', bild saknas') : '')
      + (st.docUpdated ? ' · ändrad ' + st.docUpdated : '');
    return { html: '<span class="vz-cv-docpct ' + cls + '">' + st.pct + '%' + img + '</span>', title: title };
  }
  function applyDocStatus(map) { DOC_STATUS = map || {}; if (repaintBodyRef) { repaintBodyRef(false); } }

  /* ---------- topbar (kurs + datum + dagar till start) ---------- */
  function countdownHtml(daysToStart) {
    if (daysToStart == null) {
      return ''
        + '<div class="vz-cv-countdown is-passed">'
        + '  <span class="num">–</span><span class="unit">startdatum</span>'
        + '</div>';
    }
    if (daysToStart < 0) {
      return ''
        + '<div class="vz-cv-countdown is-passed">'
        + '  <span class="num">' + Math.abs(daysToStart) + '</span><span class="unit">dagar sedan start</span>'
        + '</div>';
    }
    var soon = daysToStart <= 14;
    return ''
      + '<div class="vz-cv-countdown' + (soon ? ' is-soon' : '') + '">'
      + '  <span class="num">' + daysToStart + '</span>'
      + '  <span class="unit">' + (daysToStart === 1 ? 'dag till start' : 'dagar till start') + '</span>'
      + '</div>';
  }

  function topbarHtml(course) {
    course = course || {};
    return ''
      + '<header class="vz-cv-topbar">'
      + '  <div class="vz-cv-brand">'
      + '    <img src="' + MARK_URL + '" alt="Vitalisera">'
      + '    <div class="sep"></div>'
      + '    <div class="crumb">Kursöversikt<b>' + esc(course.name || 'Kurs') + '</b></div>'
      + '  </div>'
      + '  <div class="vz-cv-when">'
      + '    <div class="vz-cv-date">'
      + '      <div class="label">Kursdatum</div>'
      + '      <div class="val">' + esc(course.datum || '–') + '</div>'
      + '    </div>'
      +      countdownHtml(course.daysToStart)
      + '  </div>'
      + '</header>';
  }

  /* ---------- sammanfattning + kontroller ---------- */
  function summaryHtml(summary, course, state) {
    var s = summary || {};
    var allClear = (s.withGaps || 0) === 0;
    var soon = course && course.daysToStart != null && course.daysToStart >= 0 && course.daysToStart <= 14;

    var headHtml = allClear
      ? '<span class="hl">Inga luckor.</span> Allt som triggats är också bockat.'
      : (s.withGaps || 0) + ' deltagare har <a id="vz-cv-closegaps" class="hl" style="cursor:pointer;text-decoration:underline dotted" title="Stäng luckorna — bocka stegen där labeln är satt men checkrutan inte bockad">öppna luckor</a> som väntar på din bock.';
    if (soon && !allClear) {
      headHtml = 'Snart kursstart — fokus skiftar till förberedelse. ' + headHtml;
    } else if (soon && allClear) {
      headHtml = 'Snart kursstart och inga luckor — fint läge.';
    }

    return ''
      + '<section class="vz-cv-summary' + (allClear ? ' all-clear' : '') + '">'
      + '  <div class="vz-cv-stats">'
      + '    <div class="vz-cv-stat is-people">'
      + '      <span class="big" data-count="' + (s.total || 0) + '">0</span>'
      + '      <span class="lbl"><span class="ic">' + ic.people + '</span>Deltagare</span>'
      + '      <span class="vz-cv-gender" id="vz-cv-gender"></span>'
      + '    </div>'
      + '    <div class="vz-cv-stat is-staff">'   // #14: EGEN ruta för personalen (Robert 2026-06-16) — siffra+underkat. fylls async av renderStaffPanel
      + '      <span class="big" id="vz-cv-staff-count">–</span>'
      + '      <span class="lbl"><span class="ic">' + ic.people + '</span>Personal</span>'
      + '      <span class="vz-cv-staff" id="vz-cv-staff"></span>'
      + '    </div>'
      + '    <div class="vz-cv-stat is-gap' + ((s.withGaps || 0) > 0 ? ' has-gaps' : '') + '">'
      + '      <span class="big" data-count="' + (s.withGaps || 0) + '">0</span>'
      + '      <span class="lbl"><span class="ic">' + ic.warn + '</span>Har luckor</span>'
      + '    </div>'
      + '    <div class="vz-cv-stat ' + (allClear ? 'is-clear' : 'is-action') + '">'
      + '      <span class="big" data-count="' + (s.openActions || 0) + '">0</span>'
      + '      <span class="lbl"><span class="ic">' + (allClear ? ic.check : ic.spark) + '</span>Åtgärder väntar</span>'
      + '    </div>'
      + '  </div>'
      + '  <div class="vz-cv-sumside">'
      + '    <div class="head' + (allClear ? ' clear' : '') + '">' + headHtml + '</div>'
      + '    <div class="vz-cv-controls">'
      + '      <div class="vz-cv-search">' + ic.search
      + '        <input type="text" data-cv-search placeholder="Sök deltagare…" aria-label="Sök deltagare" value="' + esc(state.query || '') + '">'
      + '      </div>'
      + '      <div class="vz-cv-seg" role="group" aria-label="Sortering">'
      + '        <button data-sort="gaps" class="' + (state.sort === 'gaps' ? 'active' : '') + '">Flest luckor</button>'
      + '        <button data-sort="progress" class="' + (state.sort === 'progress' ? 'active' : '') + '">Minst klar</button>'
      + '        <button data-sort="name" class="' + (state.sort === 'name' ? 'active' : '') + '">Namn</button>'
      + '      </div>'
      + '      <span class="vz-cv-count" data-cv-count></span>'   // P1.6: "Visar X av Y" vid filtrering
      + '    </div>'
      + '  </div>'
      + '</section>';
  }

  /* ---------- matris-huvud ---------- */
  /* chevron-ikon för foldbar fas-rubrik */
  var icChevron = '<svg class="vz-cv-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  function theadHtml(steps, phases, collapsed) {
    collapsed = collapsed || {};
    // rad 1: fas-rubriker (colspan över sina steg) — klickbara för att fälla in/ut
    var phaseRow = '<tr>'
      + '<th class="vz-cv-corner" rowspan="2">'
      + '  <div class="ct">Deltagare</div>'
      + '  <div class="cn">rad per kort i listan</div>'
      + '</th>';
    var firstPhaseKey = phases.length ? phases[0].key : null;
    phases.forEach(function (ph, i) {
      var isCollapsed = !!collapsed[ph.key];
      // när infälld: en smal kolumn (colspan 1) som visar antal dolda steg
      var span = isCollapsed ? 1 : ph.count;
      phaseRow += '<th class="vz-cv-phasehead' + (i > 0 ? ' phase-2 phase-edge' : '')
        + (isCollapsed ? ' is-collapsed' : '') + '"'
        + ' colspan="' + span + '" data-phase-key="' + esc(ph.key) + '"'
        + ' role="button" tabindex="0"'
        + ' aria-expanded="' + (isCollapsed ? 'false' : 'true') + '"'
        + ' title="' + (isCollapsed ? 'Visa' : 'Dölj') + ' fasens steg">'
        + '<div class="ph-line">' + icChevron
        + '<span class="ph-name">' + esc(ph.title) + '</span>'
        + '<span class="ph-count">' + ph.count + '</span>'
        + '<span class="bar"></span></div>'
        + '</th>';
    });
    phaseRow += '</tr>';

    // rad 2: steg-rubriker
    var stepRow = '<tr>';
    var n = 0;
    var counts = {};
    var placeholderDone = {}; // en infälld fas ger EN platshållar-cell istället för sina steg
    phases.forEach(function (ph) { counts[ph.key] = 0; });
    steps.forEach(function (s) {
      n += 1;
      var pk = s.phase || '_';
      var firstInPhase = counts[pk] === 0;
      var edge = (s.phase && s.phase !== firstPhaseKey && firstInPhase) ? ' phase-edge' : '';
      counts[pk] = (counts[pk] || 0) + 1;
      if (collapsed[pk]) {
        // rendera bara en platshållar-cell för hela den infällda fasen
        if (!placeholderDone[pk]) {
          placeholderDone[pk] = true;
          var phCount = (pmapFor(phases, pk) || { count: 0 }).count;
          stepRow += '<th class="vz-cv-stephead vz-cv-collapsed-head' + edge + '"'
            + ' data-phase-key="' + esc(pk) + '" role="button" tabindex="0"'
            + ' title="Visa fasens ' + phCount + ' steg">'
            + '<span class="cc-label">' + phCount + ' steg</span>'
            + '</th>';
        }
        return;
      }
      // #16: full titel (ej kryptisk s.short) roterad 45° (förebild: gruppledarnamnen,
      // .vz-story-leader-label) → smal kolumn. Badge nederst (horisontell), titel stiger diagonalt.
      // Fallande inline-z (vänster över höger) så en etiketts diagonala svans ej döljs av nästa
      // kolumns opaka th-bakgrund. Inline slår .vz-cv-table thead th{z-index} (specificitet).
      stepRow += '<th class="vz-cv-stephead' + edge + '" data-phase-key="' + esc(pk) + '" data-step-key="' + esc(s.key) + '"'
        + ' style="z-index:' + (40 - n) + '" title="' + esc(s.title) + '">'
        + '<span class="stitle">' + esc(s.title) + '</span>'
        + '<span class="sidx">' + n + '</span>'
        + '</th>';
    });
    stepRow += '</tr>';

    return '<thead>' + phaseRow + stepRow + '</thead>';
  }

  /* ---------- en deltagarrad ---------- */
  function rowHtml(p, steps, idx, firstPhaseKey, collapsed) {
    collapsed = collapsed || {};
    var prog = safeProgress(p);
    var gaps = gapsOf(p, steps);
    var hasGaps = gaps > 0;
    var complete = prog.total > 0 && prog.done >= prog.total;
    var delay = Math.min(idx * 45, 900);

    var cls = 'vz-cv-row'
      + (hasGaps ? ' has-gaps' : '')
      + (complete ? ' is-complete' : '');

    var gapFlag = hasGaps
      ? '<span class="gapflag">' + ic.warn + (gaps) + '</span>'
      : '';

    var cells = '';
    var phaseSeen = {};       // för fas-kant
    var placeholderDone = {}; // EN platshållarcell per infälld fas
    steps.forEach(function (s) {
      var pk = s.phase || '_';
      var firstInPhase = !phaseSeen[pk];
      var edge = (s.phase && s.phase !== firstPhaseKey && firstInPhase) ? ' phase-edge' : '';
      phaseSeen[pk] = true;
      if (collapsed[pk]) {
        // infälld fas: räkna fasens luckor för en kompakt sammanfattning
        if (!placeholderDone[pk]) {
          placeholderDone[pk] = true;
          var phGaps = 0;
          steps.forEach(function (s2) {
            if ((s2.phase || '_') === pk && (p.status && p.status[s2.key]) === 'gap') { phGaps++; }
          });
          cells += '<td class="vz-cv-cell vz-cv-collapsed-cell' + edge + (phGaps ? ' has-gaps' : '') + '"'
            + ' data-phase-key="' + esc(pk) + '"'
            + ' title="' + (phGaps ? phGaps + ' lucka/luckor i denna fas — klicka rubriken för att fälla ut' : 'Inga luckor i denna fas') + '">'
            + (phGaps ? '<span class="cc-gap">' + phGaps + '</span>' : '<span class="cc-dash">·</span>')
            + '</td>';
        }
        return;
      }
      var stcode = (p.status && p.status[s.key]) || 'wait';
      var m = meta(stcode);
      var docB = docCellBadge(p.key, s.key);   // #11: % för steg 8/9 om dok-status finns
      var cellInner = docB ? docB.html : '<span class="vz-cv-dot ' + m.cls + '">' + (m.icon ? m.icon : '<span class="glyph">' + m.glyph + '</span>') + '</span>';
      cells += '<td class="vz-cv-cell' + edge + (stcode === 'gap' && !docB ? ' is-gap' : '') + '"'
        + ' data-step-key="' + esc(s.key) + '" title="' + esc(docB ? docB.title : (s.title + ' — ' + m.word)) + '">'
        + cellInner
        + '</td>';
    });

    return ''
      + '<tr class="' + cls + '" data-pkey="' + esc(p.key) + '" style="animation-delay:' + delay + 'ms" tabindex="0" role="button">'
      + '  <td class="vz-cv-namecell">'
      + '    <div class="vz-cv-avatar">' + esc(initials(p.name)) + '</div>'
      + '    <div class="vz-cv-pinfo">'
      + '      <div class="pname">' + esc(p.name || 'Deltagare') + gapFlag + '</div>'
      + '      <div class="vz-cv-prog">'
      + '        <span class="vz-cv-bar"><span data-pct="' + prog.pct + '"></span></span>'
      + '        <span class="frac">' + prog.done + '/' + prog.total + '</span>'
      + '      </div>'
      + '    </div>'
      + '  </td>'
      +    cells
      + '</tr>';
  }

  function emptyHtml(query) {
    return ''
      + '<tr><td colspan="99">'
      + '  <div class="vz-cv-empty">'
      + '    <div class="em-ic">' + ic.search + '</div>'
      + '    <h3>Ingen deltagare matchar</h3>'
      + '    <p>Inget kort i listan matchar ”' + esc(query) + '”. Rensa sökningen för att se alla.</p>'
      + '  </div>'
      + '</td></tr>';
  }

  /* ---------- footer-legend ---------- */
  function footHtml() {
    return ''
      + '<footer class="vz-cv-foot">'
      + '  <span class="ftitle">Statusnyckel</span>'
      + '  <div class="vz-cv-legend">'
      + '    <span class="vz-cv-lg lg-done"><span class="swab">' + ic.check + '</span>Klar</span>'
      + '    <span class="vz-cv-lg lg-gap"><span class="swab">' + ic.warn + '</span>Lucka — label satt, ej bockad</span>'
      + '    <span class="vz-cv-lg lg-wait"><span class="swab">·</span>Återstår</span>'
      + '    <span class="vz-cv-lg lg-manual"><span class="swab">' + ic.hand + '</span>Manuellt steg</span>'
      + '    <span class="vz-cv-lg lg-na"><span class="swab">–</span>Ej relevant</span>'
      + '  </div>'
      + '</footer>';
  }

  /* ---------- sortering ---------- */
  function sortParticipants(list, steps, mode) {
    var arr = list.slice();
    if (mode === 'name') {
      arr.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'sv'); });
    } else if (mode === 'progress') {
      arr.sort(function (a, b) {
        var pa = safeProgress(a).pct, pb = safeProgress(b).pct;
        if (pa !== pb) return pa - pb;                 // minst klar överst
        return gapsOf(b, steps) - gapsOf(a, steps);
      });
    } else { // 'gaps' (default) — flest luckor överst
      arr.sort(function (a, b) {
        var ga = gapsOf(a, steps), gb = gapsOf(b, steps);
        if (ga !== gb) return gb - ga;
        var pa = safeProgress(a).pct, pb = safeProgress(b).pct;
        if (pa !== pb) return pa - pb;                 // sedan minst klar
        return String(a.name || '').localeCompare(String(b.name || ''), 'sv');
      });
    }
    return arr;
  }

  /* ---------- räkne-upp-animation av siffror ---------- */
  function animateCounts(rootEl) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var nodes = rootEl.querySelectorAll('[data-count]');
    Array.prototype.forEach.call(nodes, function (node) {
      var target = parseInt(node.getAttribute('data-count'), 10) || 0;
      if (reduce || target === 0) { node.textContent = String(target); return; }
      var dur = 700, start = null;
      function tick(ts) {
        if (start == null) start = ts;
        var t = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - t, 3);
        node.textContent = String(Math.round(eased * target));
        if (t < 1) requestAnimationFrame(tick);
        else node.textContent = String(target);
      }
      requestAnimationFrame(tick);
    });
  }

  /* ---------- progress-bar-fyllning ---------- */
  function animateBars(scopeEl) {
    var bars = scopeEl.querySelectorAll('.vz-cv-bar > span[data-pct]');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        Array.prototype.forEach.call(bars, function (b) {
          var pct = parseFloat(b.getAttribute('data-pct')) || 0;
          b.style.width = pct + '%';
        });
      });
    });
  }

  /* ========================================================================
   * RENDER — det publika API:t
   * ====================================================================== */
  function render(rootEl, model, handlers) {
    if (!rootEl) return;
    model = model || {};
    handlers = handlers || {};
    var course = model.course || {};
    var steps = (model.steps || []).slice();
    var participants = (model.participants || []).slice();
    // steg-medveten livs-etikett (tooltip i steg 9): "Du och dina relationer klar" → "Du och dina relationer"
    var _livs = steps.filter(function (s) { return s.key === 'livs_klar'; })[0];
    if (_livs && _livs.title) { LIVS_LABEL = _livs.title.replace(/\s+klar$/i, ''); }

    // härled fas-grupper (i förekommande ordning) för kolumn-grupperingen
    var phases = [];
    var pmap = {};
    steps.forEach(function (s) {
      var key = s.phase || '_';
      if (!pmap[key]) {
        pmap[key] = { key: key, title: phaseTitle(key, s), count: 0 };
        phases.push(pmap[key]);
      }
      pmap[key].count += 1;
    });
    var firstPhaseKey = phases.length ? phases[0].key : null;

    // härled summary om den saknas
    var summary = model.summary;
    if (!summary) {
      var withGaps = 0, openActions = 0;
      participants.forEach(function (p) {
        var g = gapsOf(p, steps);
        if (g > 0) withGaps += 1;
        openActions += g;
      });
      summary = { total: participants.length, withGaps: withGaps, openActions: openActions };
    }

    // interaktivt tillstånd
    var state = {
      sort: 'gaps',     // default: flest luckor överst
      query: '',
      collapsed: loadCollapsed(phases)  // { phaseKey: true } — infällda faser (minns i sessionen)
    };

    // bygg skalet (statiska delar) + namngivna layout-regioner
    //   .vz-region-row : matris (vänster) + aside (höger, Personal)
    //   .vz-region-below : full bredd (HF, checklista, livsberättelser)
    rootEl.innerHTML = '<div class="vz-course"><div class="vz-cv-shell">'
      + topbarHtml(course)
      + '<div data-cv-summary></div>'
      + footHtml()   // #17a: statusnyckel ÖVERST (passar bättre än i botten, Robert 2026-06-16)
      + '<div class="vz-cv-regions">'
      +   '<div class="vz-cv-row-region">'
      +     '<div class="vz-region-matrix">'
      +       '<div class="vz-cv-matrixwrap"><table class="vz-cv-table" data-cv-table>'
      +         '<thead data-cv-head></thead>'
      +         '<tbody data-cv-body></tbody>'
      +       '</table></div>'
      +     '</div>'
      +     '<aside class="vz-region-aside" data-vz-region="aside"></aside>'
      +   '</div>'
      +   '<div class="vz-region-below" data-vz-region="below"></div>'
      + '</div>'
      + '</div></div>';

    var summaryHost = rootEl.querySelector('[data-cv-summary]');
    var body = rootEl.querySelector('[data-cv-body]');
    var head = rootEl.querySelector('[data-cv-head]');

    function paintHead() {
      head.innerHTML = theadHtml(steps, phases, state.collapsed).replace(/^<thead>|<\/thead>$/g, '');
      wireHead();
      syncStickyOffsets();
    }
    // Steg-raden ska frysa UNDER fas-raden vid scroll. Fas-radens höjd är dynamisk (wrap) → mät + sätt
    // stephead/collapsed-head top i px (inline slår base-regelns top:0). Körs efter varje paint + på resize.
    function syncStickyOffsets() {
      var rows = head.querySelectorAll('tr');
      if (rows.length < 2) { return; }
      var ph = Math.round(rows[0].getBoundingClientRect().height) - 1;  // -1: överlappa fas-raden så ingen sub-pixel-glipa
      Array.prototype.forEach.call(head.querySelectorAll('.vz-cv-stephead, .vz-cv-collapsed-head'), function (th) {
        th.style.top = ph + 'px';
      });
    }
    function wireHead() {
      // klick/tangent på fas-rubrik eller dess infällda platshållare → fäll in/ut
      var togglers = head.querySelectorAll('[data-phase-key]');
      Array.prototype.forEach.call(togglers, function (thEl) {
        var pk = thEl.getAttribute('data-phase-key');
        function toggle(e) {
          if (e) { e.preventDefault(); e.stopPropagation(); }
          state.collapsed[pk] = !state.collapsed[pk];
          saveCollapsed(state.collapsed);
          paintHead();
          paintBody(false);
        }
        thEl.addEventListener('click', toggle);
        thEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { toggle(e); }
        });
      });
    }

    function paintSummary() {
      summaryHost.innerHTML = summaryHtml(summary, course, state);
      wireSummary();
      animateCounts(summaryHost);
    }

    function visibleParticipants() {
      var q = state.query.trim().toLowerCase();
      var list = participants;
      if (q) {
        list = list.filter(function (p) {
          return String(p.name || '').toLowerCase().indexOf(q) !== -1;
        });
      }
      return sortParticipants(list, steps, state.sort);
    }

    function paintBody(stagger) {
      var list = visibleParticipants();
      // P1.6: "Visar X av Y" när sökfiltret är aktivt (annars tomt).
      var countEl = rootEl.querySelector('[data-cv-count]');
      if (countEl) {
        countEl.textContent = state.query.trim() ? ('Visar ' + list.length + ' av ' + participants.length) : '';
      }
      if (!list.length) {
        body.innerHTML = emptyHtml(state.query);
        return;
      }
      body.innerHTML = list.map(function (p, i) {
        return rowHtml(p, steps, stagger ? i : 9999, firstPhaseKey, state.collapsed);
      }).join('');
      // vid icke-staggrad ompaint (sortering/sök) → visa direkt utan delay
      if (!stagger) {
        Array.prototype.forEach.call(body.querySelectorAll('.vz-cv-row'), function (r) {
          r.style.animationDelay = '0ms';
        });
      }
      wireRows();
      animateBars(body);
    }

    function wireSummary() {
      var search = summaryHost.querySelector('[data-cv-search]');
      if (search) {
        search.addEventListener('input', function () {
          state.query = search.value || '';
          paintBody(false);
        });
      }
      Array.prototype.forEach.call(summaryHost.querySelectorAll('[data-sort]'), function (btn) {
        btn.addEventListener('click', function () {
          state.sort = btn.getAttribute('data-sort');
          Array.prototype.forEach.call(summaryHost.querySelectorAll('[data-sort]'), function (b) {
            b.classList.toggle('active', b === btn);
          });
          paintBody(false);
        });
      });
    }

    function pByKey(k) {
      return participants.filter(function (p) { return p.key === k; })[0];
    }

    // klick på en matriscell → fäll ut/in en detalj-rad under deltagarraden för det steget.
    // course.js fyller hostDiv (Fas 1/Fas 2 + noteringar) via handlers.onSelectCell. En öppen åt gången.
    function toggleDetail(row, p, stepKey, cell) {
      var next = row.nextSibling;
      var openSame = next && next.nodeType === 1 && next.className && next.className.indexOf('vz-cv-detailrow') !== -1
        && next.getAttribute('data-step') === stepKey && next.getAttribute('data-pkey') === p.key;
      Array.prototype.forEach.call(body.querySelectorAll('.vz-cv-detailrow'), function (d) { d.parentNode.removeChild(d); });
      Array.prototype.forEach.call(body.querySelectorAll('.vz-cv-cell.is-sel'), function (c) { c.classList.remove('is-sel'); });
      Array.prototype.forEach.call(head.querySelectorAll('.vz-cv-stephead.is-active-step'), function (h) { h.classList.remove('is-active-step'); });
      if (openSame) { return; }                                   // toggla av
      if (cell) { cell.classList.add('is-sel'); }
      var hd = head.querySelector('.vz-cv-stephead[data-step-key="' + stepKey + '"]');  // highlighta kolumnrubrikens siffer-cirkel
      if (hd) { hd.classList.add('is-active-step'); }
      var tr = document.createElement('tr');
      tr.className = 'vz-cv-detailrow';
      tr.setAttribute('data-step', stepKey); tr.setAttribute('data-pkey', p.key);
      var td = document.createElement('td'); td.colSpan = 99; td.className = 'vz-cv-detailcell';
      var hostDiv = document.createElement('div'); hostDiv.className = 'vz-cv-detail';
      hostDiv.innerHTML = '<div class="vz-cv-detail-loading">Laddar steg…</div>';
      td.appendChild(hostDiv); tr.appendChild(td);
      row.parentNode.insertBefore(tr, row.nextSibling);
      if (typeof handlers.onSelectCell === 'function') { try { handlers.onSelectCell(p, stepKey, hostDiv); } catch (err) { hostDiv.textContent = 'Kunde inte visa steget.'; } }
    }

    // course.js anropar denna efter en lyckad bock/label → uppdatera cellens prick + modellen, utan omladdning.
    // Steg 8/9 styrs av dok-% (DOC_STATUS) → rör dem ej.
    function setCellStatus(pkey, stepKey, statusCode) {
      if ((stepKey === 'hf_klart' || stepKey === 'livs_klar') && DOC_STATUS[pkey]) { return; }
      var pObj = pByKey(pkey); if (pObj && pObj.status) { pObj.status[stepKey] = statusCode; }
      var row = body.querySelector('.vz-cv-row[data-pkey="' + pkey + '"]');
      if (!row) { return; }
      var cell = row.querySelector('.vz-cv-cell[data-step-key="' + stepKey + '"]');
      if (!cell) { return; }
      var m = meta(statusCode);
      cell.classList.toggle('is-gap', statusCode === 'gap');
      cell.innerHTML = '<span class="vz-cv-dot ' + m.cls + '">' + (m.icon ? m.icon : '<span class="glyph">' + m.glyph + '</span>') + '</span>';
      // uppdatera radens progress (X/total) + bar utifrån modellen
      if (pObj) {
        var done = steps.reduce(function (n, s) { return n + (pObj.status[s.key] === 'done' ? 1 : 0); }, 0);
        var rel = steps.reduce(function (n, s) { return n + (pObj.status[s.key] === 'na' ? 0 : 1); }, 0);
        var frac = row.querySelector('.vz-cv-prog .frac'); if (frac) { frac.textContent = done + '/' + rel; }
        var bar = row.querySelector('.vz-cv-bar > span'); if (bar) { bar.style.width = (rel ? Math.round(done / rel * 100) : 0) + '%'; }
      }
    }

    function wireRows() {
      Array.prototype.forEach.call(body.querySelectorAll('.vz-cv-row'), function (row) {
        var pkey = row.getAttribute('data-pkey');
        var p = pByKey(pkey);

        // klick på cell → expandera raden inline med stegets detalj (stoppa bubbling till onOpenCard)
        Array.prototype.forEach.call(row.querySelectorAll('.vz-cv-cell'), function (cell) {
          cell.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleDetail(row, p, cell.getAttribute('data-step-key'), cell);
          });
        });

        // klick på raden (namn-cell eller övrigt) → öppna kort/dashboard
        var open = function () {
          if (typeof handlers.onOpenCard === 'function') {
            try { handlers.onOpenCard(p); } catch (err) { /* no-op */ }
          } else {
            console.log('[CourseView] onOpenCard', pkey);
          }
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      });
    }

    // initial paint
    repaintBodyRef = paintBody;   // #11: låt applyDocStatus rita om kroppen när dok-status anländer
    setCellStatusRef = setCellStatus;   // course.js → uppdatera cell efter bock/label
    paintSummary();
    paintHead();
    paintBody(true);
  }

  /* ---------- ihågkom infällda faser i sessionen (valfritt, fail-soft) ---------- */
  var COLLAPSE_KEY = 'vz_cv_collapsed_phases';
  function loadCollapsed(phases) {
    var out = {};
    try {
      var raw = window.sessionStorage && window.sessionStorage.getItem(COLLAPSE_KEY);
      if (raw) {
        var saved = JSON.parse(raw) || {};
        // behåll bara nycklar som finns bland aktuella faser
        phases.forEach(function (ph) { if (saved[ph.key]) { out[ph.key] = true; } });
      }
    } catch (e) { /* sessionStorage kan saknas/blockeras i iframe — strunta */ }
    return out;
  }
  function saveCollapsed(map) {
    try {
      if (window.sessionStorage) { window.sessionStorage.setItem(COLLAPSE_KEY, JSON.stringify(map || {})); }
    } catch (e) { /* tyst */ }
  }

  /* ---------- layout-regioner: course.js placerar paneler i rätt region ---------- */
  function region(name) {
    var course = document.querySelector('.vz-course');
    if (!course) { return null; }
    var r = course.querySelector('[data-vz-region="' + name + '"]');
    return r || course;  // fail-soft: faller tillbaka till .vz-course om regionen saknas
  }

  /* fas-titel: använd stegets phase-key för en läsbar rubrik */
  function phaseTitle(key, sampleStep) {
    var map = {
      anmalan: 'Anmälan & antagning',
      forberedelse: 'Förberedelse inför kurs'
    };
    if (map[key]) return map[key];
    if (sampleStep && sampleStep.phaseTitle) return sampleStep.phaseTitle;
    return key === '_' ? 'Steg' : (key.charAt(0).toUpperCase() + key.slice(1));
  }

  /* ========================================================================
   * DEMO_MODEL — ~7 deltagare med varierad status
   * De 8 stegen i 2 faser; key: anmalan,tack,intervju,antagen,avgift,praktisk,steg1,hf
   * ====================================================================== */
  var STEPS = [
    { key: 'anmalan',   title: 'Intresseanmälan',        short: 'Intresse',   phase: 'anmalan' },
    { key: 'tack',      title: 'Tack för anmälan',       short: 'Tack',       phase: 'anmalan' },
    { key: 'intervju',  title: 'Intervju',               short: 'Intervju',   phase: 'anmalan' },
    { key: 'antagen',   title: 'Antagen till kurs',      short: 'Antagen',    phase: 'anmalan' },
    { key: 'avgift',    title: 'Anmälningsavgift',       short: 'Avgift',     phase: 'forberedelse' },
    { key: 'praktisk',  title: 'Praktisk info',          short: 'Praktisk',   phase: 'forberedelse' },
    { key: 'steg1',     title: 'Steg 1-formulär',        short: 'Steg 1',     phase: 'forberedelse' },
    { key: 'hf',        title: 'Hälsoformulär → läkare', short: 'Hälsoform.', phase: 'forberedelse' }
  ];

  function mkParticipant(key, name, statuses) {
    var status = {};
    STEPS.forEach(function (s, i) { status[s.key] = statuses[i] || 'wait'; });
    var done = STEPS.filter(function (s) { return status[s.key] === 'done'; }).length;
    var relevant = STEPS.filter(function (s) { return status[s.key] !== 'na'; }).length;
    var gapCount = STEPS.filter(function (s) { return status[s.key] === 'gap'; }).length;
    return {
      key: key,
      name: name,
      cardUrl: 'https://trello.com/c/' + key,
      status: status,
      progress: { done: done, total: relevant, pct: relevant ? Math.round(done / relevant * 100) : 0 },
      gapCount: gapCount
    };
  }

  var DEMO_PARTICIPANTS = [
    // nästan klar, men en glömd bock kvar (lucka)
    mkParticipant('p1', 'Astrid Lindholm Bergström',
      ['done','done','done','done','done','done','gap','manual']),
    // flera luckor — board-bredd: tre steg triggade men ej bockade
    mkParticipant('p2', 'Bertil Claesson',
      ['done','gap','manual','gap','done','wait','gap','done']),
    // tidig i processen
    mkParticipant('p3', 'Carl Magnus Björk',
      ['done','done','manual','wait','wait','wait','wait','wait']),
    // klar rakt igenom
    mkParticipant('p4', 'Doris Hägg',
      ['done','done','done','done','done','done','done','done']),
    // mitt i, en lucka + ej relevant HF
    mkParticipant('p5', 'Einar Sjöqvist',
      ['done','done','done','gap','done','manual','wait','na']),
    // precis anmäld
    mkParticipant('p6', 'Frida Öberg',
      ['done','gap','wait','wait','wait','wait','wait','wait']),
    // två luckor i förberedelsefasen
    mkParticipant('p7', 'Gunnar Åkerlund',
      ['done','done','done','done','gap','done','gap','wait'])
  ];

  var withGaps = DEMO_PARTICIPANTS.filter(function (p) { return p.gapCount > 0; }).length;
  var openActions = DEMO_PARTICIPANTS.reduce(function (n, p) { return n + p.gapCount; }, 0);

  var DEMO_MODEL = {
    course: {
      name: 'Steg 1 · Mullingstorp 24 juni – 2 juli 2026',
      datum: '24 jun – 2 jul 2026',
      daysToStart: 10            // ≤14 → markerar att fokus skiftar till förberedelse
    },
    steps: STEPS,
    participants: DEMO_PARTICIPANTS,
    summary: {
      total: DEMO_PARTICIPANTS.length,
      withGaps: withGaps,
      openActions: openActions
    }
  };

  /* ---------- expose ---------- */
  window.CourseView = {
    render: render, region: region, DEMO_MODEL: DEMO_MODEL, applyDocStatus: applyDocStatus,
    setCellStatus: function (pkey, stepKey, sc) { if (setCellStatusRef) { setCellStatusRef(pkey, stepKey, sc); } },
  };

  /* ---------- fristående auto-boot ---------- */
  function autoBoot() {
    var root = document.getElementById('root') || document.querySelector('[data-course-root]');
    if (!root) return;
    if (root.getAttribute('data-vz-manual') === '1') return; // app:en wirar själv
    var model = window.NYA_ZAPIER_COURSE_MODEL || DEMO_MODEL;
    render(root, model, {
      onOpenCard: function (p) { console.log('[demo] onOpenCard', p && p.key, p && p.cardUrl); },
      onSelectCell: function (p, stepKey) { console.log('[demo] onSelectCell', p && p.key, stepKey); }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoBoot);
  } else {
    autoBoot();
  }
})();
