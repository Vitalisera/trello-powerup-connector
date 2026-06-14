/* ============================================================================
 * Vitalisera · Deltagar-dashboard — datadriven vy (produktion)
 *
 * Förenar två godkända mockups till EN vy:
 *   - mockup B: operativ cockpit — mörk kommandozon "Nästa åtgärd för Malin",
 *     steg-räls till vänster, valt steg uppdelat i Fas 1 (sätt label) → Fas 2
 *     (bocka i checklista) + händelselogg. Detta är pedagogiska kärnan: den
 *     stänger luckan att man glömmer bocka EFTER att labeln triggat automationen.
 *   - mockup A: fas-indelning av steg-rälsen + progressring.
 *
 * Publikt API (Robert wirar mot Trello senare):
 *   window.DashboardView.render(rootEl, model, handlers)
 *
 * Ren vanilla JS. Inga nätverksanrop, ingen Trello-SDK. All rendering,
 * animation och interaktion sker här. Om window.NYA_ZAPIER_MODEL saknas
 * renderas DEMO_MODEL så filen kan förhandsgranskas fristående.
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------- ikoner (inline SVG) ---------- */
  var ic = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-7-4l-2.8-5a2 2 0 0 1 3.5-2L7 14"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    label: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.4 11 12.6 2.2A2 2 0 0 0 11.2 1.6H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.8 8.8a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8ZM6.5 8A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 8Z"/></svg>'
  };

  var MARK_URL = 'https://vitalisera.github.io/trello-powerup-connector/icons/vitalisera-mark.png';

  /* status → metadata för rälsen + badge */
  var STATUS = {
    done:   { cls: 's-done',   badge: 'sb-done',   word: 'Klar',      icon: ic.check },
    gap:    { cls: 's-gap',    badge: 'sb-gap',    word: 'Bocka av',  icon: ic.warn },
    wait:   { cls: 's-wait',   badge: 'sb-wait',   word: 'Återstår',  icon: ic.clock },
    manual: { cls: 's-manual', badge: 'sb-manual', word: 'Manuellt',  icon: ic.hand }
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
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '–';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /* flatten alla steg ur faserna i ordning (rälsen renderar grupperat,
     men logiken behöver en platt sekvens för t.ex. "steg X av N"). */
  function flatSteps(model) {
    var out = [];
    (model.phases || []).forEach(function (ph) {
      (ph.steps || []).forEach(function (s) { out.push(s); });
    });
    return out;
  }

  /* ---------- progressring (lånad från A) ---------- */
  function ringHtml(pct, allClear) {
    var r = 44, c = 2 * Math.PI * r;
    return ''
      + '<div class="vz-ring-wrap">'
      + '  <div class="vz-ring' + (allClear ? ' is-clear' : '') + '">'
      + '    <svg width="104" height="104" viewBox="0 0 104 104">'
      + '      <circle class="ring-bg" cx="52" cy="52" r="' + r + '" fill="none" stroke-width="10"/>'
      // startar tomt (offset = hela omkretsen); fylls upp i en animationsruta
      + '      <circle class="ring-fg" cx="52" cy="52" r="' + r + '" fill="none" stroke-width="10"'
      + '        stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + c.toFixed(1) + '"'
      + '        data-circ="' + c.toFixed(1) + '" data-pct="' + pct + '"/>'
      + '    </svg>'
      + '    <div class="ring-label"><div class="num">' + pct + '%</div><div class="den">Klara</div></div>'
      + '  </div>'
      + '</div>';
  }

  /* ---------- kommandozon (Nästa åtgärd för Malin) ---------- */
  function commandHtml(model) {
    var next = model.next;
    var allClear = !next;

    if (allClear) {
      return ''
        + '<section class="vz-command all-clear">'
        + '  <div class="vz-cmd-left">'
        + '    <span class="vz-cmd-kicker is-clear"><span class="pulse"></span>Inget väntar just nu</span>'
        + '    <h2 class="vz-cmd-title">Allt är <span class="hl" style="color:var(--success)">i fas</span> för ' + esc((model.participant || {}).name || 'deltagaren') + '.</h2>'
        + '    <p class="vz-cmd-sub">Varje steg som kräver en åtgärd är avklarat. Inga checklistor väntar på din bock.</p>'
        + '  </div>'
        + '  <div class="vz-cmd-action">'
        + '    <span class="vz-cmd-hint">Klart läge. Nya åtgärder dyker upp här när ett steg triggas.</span>'
        + '  </div>'
        + ringHtml(model.progress ? model.progress.pct : 100, true)
        + '</section>';
    }

    var m = meta(next.status);
    var isGap = next.status === 'gap';
    var kicker = 'Nästa åtgärd för ' + esc(firstName(model));
    var titleHtml, subHtml, btnLabel, btnIsAccent, hint;

    if (isGap) {
      titleHtml = 'Bocka av <span class="hl">”' + esc(next.title) + '”</span> — automationen är redan klar.';
      subHtml = 'Labeln ' + labelTag(next.triggerLabel)
        + ' triggade automationen och utskicket gick iväg. Nu väntar bara den manuella avbockningen i checklistan så att steget räknas som klart.';
      btnLabel = 'Bocka av i checklistan';
      btnIsAccent = false;
      hint = 'Detta är luckan som lätt glöms: automationen är klar, men bocken sätts av dig.';
    } else if (next.status === 'manual') {
      titleHtml = 'Utför <span class="hl" style="color:var(--accent)">' + esc(next.title) + '</span> — ett manuellt steg.';
      subHtml = esc(next.desc || 'Det här steget har ingen automation. Genomför det och bocka sedan av i checklistan.');
      btnLabel = 'Bocka när utförd';
      btnIsAccent = true;
      hint = 'Inget mejl och inget dokument skapas här — steget bockas av dig.';
    } else { // wait
      titleHtml = 'Sätt igång <span class="hl" style="color:var(--accent)">' + esc(next.title) + '</span>.';
      subHtml = next.triggerLabel
        ? ('Sätt labeln ' + labelTag(next.triggerLabel) + ' så startar automationen för det här steget.')
        : esc(next.desc || 'Påbörja det här steget.');
      btnLabel = next.triggerLabel ? 'Sätt label & starta' : 'Öppna steget';
      btnIsAccent = true;
      hint = next.triggerLabel ? 'När labeln satts skickas utskicket automatiskt.' : 'Detaljerna visas till höger.';
    }

    return ''
      + '<section class="vz-command has-next">'
      + '  <div class="vz-cmd-left">'
      + '    <span class="vz-cmd-kicker"><span class="pulse"></span>' + kicker + '</span>'
      + '    <h2 class="vz-cmd-title">' + titleHtml + '</h2>'
      + '    <p class="vz-cmd-sub">' + subHtml + '</p>'
      + '  </div>'
      + '  <div class="vz-cmd-action">'
      + '    <button class="vz-btn-cmd' + (btnIsAccent ? ' is-accent' : '') + '" data-cmd-btn>'
      +        (isGap ? ic.check : (next.status === 'manual' ? ic.check : ic.arrow))
      + '      ' + esc(btnLabel)
      + '    </button>'
      + '    <span class="vz-cmd-hint">' + esc(hint) + '</span>'
      + '  </div>'
      + ringHtml(model.progress ? model.progress.pct : 0, false)
      + '</section>';
  }

  function firstName(model) {
    var n = (model.participant || {}).name || '';
    return n.split(/\s+/)[0] || 'dig';
  }
  function labelTag(label) {
    if (!label) return '<span class="tag">' + ic.label + 'label</span>';
    return '<span class="tag">' + ic.label + esc(label) + '</span>';
  }

  /* ---------- topbar ---------- */
  function topbarHtml(model) {
    var p = model.participant || {};
    return ''
      + '<header class="vz-topbar">'
      + '  <div class="vz-brand">'
      + '    <img src="' + MARK_URL + '" alt="Vitalisera">'
      + '    <div class="sep"></div>'
      + '    <div class="crumb">Deltagarpanel<b>Kursadministration</b></div>'
      + '  </div>'
      + '  <div class="vz-who">'
      + '    <div class="person">'
      + '      <div class="name">' + esc(p.name || 'Deltagare') + '</div>'
      + '      <div class="meta">' + esc(p.kursvecka || '') + '</div>'
      + '    </div>'
      + '    <div class="vz-avatar">' + esc(initials(p.name)) + '</div>'
      + '  </div>'
      + '</header>';
  }

  /* ---------- rälsen (faser → steg), lånar A:s fas-band ---------- */
  function railMechChips(step) {
    var chips = '';
    if (step.status === 'manual') {
      chips += '<span class="vz-chip-mini">Manuellt</span>';
    } else if (step.triggerLabel) {
      chips += '<span class="vz-chip-mini lbl ' + (step.labelSet ? 'on' : '') + '">Label ' + (step.labelSet ? '✓' : '·') + '</span>';
    } else if (step.automation) {
      // automation utan label (webbformulär, betalning, HF-flöde) — bara "Auto ✓"
      // när den faktiskt körts (klar), annars markeras att den väntar.
      chips += '<span class="vz-chip-mini lbl' + (step.status === 'done' ? ' on' : '') + '">Auto ' + (step.status === 'done' ? '✓' : '·') + '</span>';
    } else {
      chips += '<span class="vz-chip-mini">Återstår</span>';
    }
    if (step.checklistDone) chips += '<span class="vz-chip-mini chk on">Bock ✓</span>';
    else if (step.status === 'gap') chips += '<span class="vz-chip-mini chk off">Bock ⚠</span>';
    else chips += '<span class="vz-chip-mini chk">Bock ·</span>';
    return '<div class="vz-mini-mech">' + chips + '</div>';
  }

  function stepRowHtml(step, n, delay) {
    var m = meta(step.status);
    var glyph = step.status === 'done' ? m.icon : String(n);
    return ''
      + '<div class="vz-step ' + m.cls + '" data-step-key="' + esc(step.key) + '" role="button" tabindex="0"'
      + '     style="animation-delay:' + delay + 'ms">'
      + '  <div class="vz-node">' + glyph + '</div>'
      + '  <div class="vz-step-body">'
      + '    <div class="nm">' + esc(step.title) + '</div>'
      + '    <div class="st"><span class="ic">' + m.icon + '</span>' + m.word + '</div>'
      +      railMechChips(step)
      + '  </div>'
      + '</div>';
  }

  function railHtml(model) {
    var total = flatSteps(model).length;
    var html = ''
      + '<aside class="vz-rail">'
      + '  <div class="vz-rail-head"><h2>Steg-räls</h2><span class="n">' + total + ' steg</span></div>';

    var counter = 0, delay = 0;
    (model.phases || []).forEach(function (ph) {
      html += '<div class="vz-phase-group">'
        + '  <div class="vz-phase-band">'
        + '    <div class="pt">' + esc(ph.title) + (ph.subtitle ? '<small>' + esc(ph.subtitle) + '</small>' : '') + '</div>'
        + '    <div class="pline"></div>'
        + '  </div>'
        + '  <div class="vz-track">';
      (ph.steps || []).forEach(function (s) {
        counter += 1;
        html += stepRowHtml(s, counter, delay);
        delay += 55; // staggrad in-reveal
      });
      html += '  </div></div>';
    });

    html += '</aside>';
    return html;
  }

  /* ---------- detaljpanel: Fas 1 (trigger) → Fas 2 (bock) ---------- */
  function triggerPhaseHtml(step) {
    // manuellt steg: ingen automation
    if (step.status === 'manual' || (!step.triggerLabel && !step.automation)) {
      return ''
        + '<div class="vz-phase is-trigger">'
        + '  <div class="pk"><span class="step-dot">1</span>Fas 1 · Trigger</div>'
        + '  <h3>Ingen automation</h3>'
        + '  <div class="vz-manual-note">' + ic.hand + '<span>Inget mejl, inget dokument. Det här utförs helt manuellt av dig.</span></div>'
        + '  <p class="pdesc">' + esc(step.desc || 'Genomför steget och gå sedan vidare till bocken.') + '</p>'
        + '  <div class="vz-control">'
        + '    <div class="vz-toggle" aria-disabled="true" aria-hidden="true"><span class="knob"></span></div>'
        + '    <div class="ctxt is-off"><span class="state">Ingen automation</span><span class="hint">Hoppa direkt till bocken</span></div>'
        + '  </div>'
        + '</div>';
    }
    // automation utan label (auto-källa: webbformulär, betalning, HF-flöde m.m.)
    if (!step.triggerLabel) {
      return ''
        + '<div class="vz-phase is-trigger fired">'
        + '  <div class="pk"><span class="step-dot">1</span>Fas 1 · Trigger</div>'
        + '  <h3>' + esc(step.automation || 'Automatiskt') + '</h3>'
        + '  <p class="pdesc">Det här steget triggas automatiskt — det krävde ingen label från dig.</p>'
        + '  <div class="vz-control">'
        + '    <div class="vz-toggle on" aria-disabled="true" aria-hidden="true"><span class="knob">' + ic.check + '</span></div>'
        + '    <div class="ctxt is-on"><span class="state">Utförd automatiskt</span><span class="hint">Krävde ingen handling</span></div>'
        + '  </div>'
        + '</div>';
    }
    // label-triggat steg
    var fired = !!step.labelSet;
    return ''
      + '<div class="vz-phase is-trigger ' + (fired ? 'fired' : '') + '">'
      + '  <div class="pk"><span class="step-dot">1</span>Fas 1 · Sätt label (trigger)</div>'
      + '  <h3>' + (fired ? 'Label satt → automation körd' : 'Sätt label för att starta') + '</h3>'
      + '  <div class="vz-label-row"><span class="vz-label-pill"><span class="swatch"></span>' + esc(step.triggerLabel) + '</span></div>'
      + '  <p class="pdesc">' + esc(step.automation
            ? ('Labeln triggar automationen ”' + step.automation + '” som sköter utskick/dokument.')
            : 'När du sätter labeln startar automationen.') + '</p>'
      + '  <div class="vz-control">'
      + '    <div class="vz-toggle ' + (fired ? 'on' : '') + '" data-toggle="label" aria-disabled="' + (fired ? 'true' : 'false') + '"'
      +        (fired ? ' aria-hidden="true"' : ' role="switch" aria-checked="false" tabindex="0"') + '><span class="knob">' + ic.check + '</span></div>'
      + '    <div class="ctxt ' + (fired ? 'is-on' : 'is-off') + '">'
      + '      <span class="state">' + (fired ? 'Label satt — automation körd' : 'Sätt label för att starta') + '</span>'
      + '      <span class="hint">' + (fired ? 'Mejlet/dokumentet är skickat' : 'Inget har skickats ännu') + '</span>'
      + '    </div>'
      + '  </div>'
      + '</div>';
  }

  function checkPhaseHtml(step) {
    var name = step.checkItemName || 'Markera klart i checklistan';
    if (step.checklistDone) {
      return ''
        + '<div class="vz-phase is-check on">'
        + '  <div class="pk"><span class="step-dot">2</span>Fas 2 · Bock i checklista</div>'
        + '  <h3>Markerat klart</h3>'
        + '  <p class="pdesc">' + esc(step.checkItemName ? ('”' + step.checkItemName + '” är bockad — steget räknas som klart.') : 'Checklistan är bockad — steget räknas som klart.') + '</p>'
        + '  <div class="vz-control">'
        + '    <div class="vz-toggle on chk" aria-disabled="true" aria-hidden="true"><span class="knob">' + ic.check + '</span></div>'
        + '    <div class="ctxt is-onchk"><span class="state">Bockad</span><span class="hint">Steget är klart</span></div>'
        + '  </div>'
        + '</div>';
    }
    // gap = label satt men ej bockad → eskalera (amber + puls + "⚠ BOCKA"-flagga)
    var isGap = step.status === 'gap';
    return ''
      + '<div class="vz-phase is-check ' + (isGap ? 'pending' : '') + '">'
      + '  <div class="pk"><span class="step-dot">2</span>Fas 2 · Bock i checklista</div>'
      + '  <h3>' + (isGap ? 'Bocka i checklistan' : 'Bocka när utförd') + '</h3>'
      + '  <p class="pdesc">' + esc(isGap
            ? ('Detta steg bockas INTE av automationen. ' + (step.checkItemName ? ('Bocka ”' + step.checkItemName + '” ') : 'Bocka ') + 'så att steget blir klart.')
            : (step.checkItemName ? ('Sätt bocken ”' + step.checkItemName + '” när steget är utfört.') : 'Sätt bocken i checklistan när steget är utfört.')) + '</p>'
      + '  <div class="vz-control">'
      + '    <div class="vz-toggle ' + (isGap ? 'pending' : '') + '" data-toggle="check" role="switch" aria-checked="false" tabindex="0"><span class="knob">' + ic.check + '</span></div>'
      + '    <div class="ctxt ' + (isGap ? 'is-pending' : 'is-off') + '">'
      + '      <span class="state">' + (isGap ? 'Väntar på din bock' : 'Ej bockad') + '</span>'
      + '      <span class="hint">' + (isGap ? 'Klicka för att markera klart' : 'Görs efter fas 1') + '</span>'
      + '    </div>'
      + '  </div>'
      + '</div>';
  }

  function eventLogHtml(step) {
    var events = step.events || [];
    if (!events.length) {
      return '<div class="vz-log-empty">Inga händelser för det här steget ännu.</div>';
    }
    return '<div class="vz-auto-log">' + events.map(function (e) {
      var kind = e.kind ? ('k-' + e.kind) : '';
      var pend = /vänt|väntar|ej |inte /i.test(e.text || '') ? 'pend' : '';
      return ''
        + '<div class="vz-log-row ' + kind + ' ' + pend + '">'
        + '  <span class="ts">' + esc(e.time || '—') + '</span>'
        + '  <span class="dotline"></span>'
        + '  <span class="tx">' + esc(e.text || '') + '</span>'
        + '</div>';
    }).join('') + '</div>';
  }

  function detailHtml(model, step) {
    var all = flatSteps(model);
    var idx = all.findIndex(function (s) { return s.key === step.key; });
    var n = idx >= 0 ? idx + 1 : 1;
    var total = all.length;
    var m = meta(step.status);
    var p = model.participant || {};

    return ''
      + '<main class="vz-detail swap">'
      + '  <div class="vz-detail-head">'
      + '    <div class="vz-dh-left">'
      + '      <div class="vz-dh-num">' + (step.status === 'done' ? ic.check : n) + '</div>'
      + '      <div>'
      + '        <h1>' + esc(step.title) + '</h1>'
      + '        <div class="sub">Steg ' + n + ' av ' + total + (step.automation ? ' · ' + esc(step.automation) : '') + '</div>'
      + '      </div>'
      + '    </div>'
      + '    <div class="vz-status-badge ' + m.badge + '"><span class="d"></span>' + m.word + '</div>'
      + '  </div>'
      + '  <div class="vz-lead ' + (step.status === 'gap' ? 'is-gap' : '') + '">' + leadText(step) + '</div>'
      + '  <div class="vz-phase-rail">'
      +      triggerPhaseHtml(step)
      + '    <div class="vz-phase-arrow">' + ic.arrow + '<span class="lbl">sedan</span></div>'
      +      checkPhaseHtml(step)
      + '  </div>'
      + '  <div class="vz-detail-foot">'
      + '    <div class="vz-info-card">'
      + '      <h4>Deltagaruppgifter</h4>'
      + '      <div class="vz-kv"><span class="k">Namn</span><span class="v">' + esc(p.name || '–') + '</span></div>'
      + '      <div class="vz-kv"><span class="k">E-post</span><span class="v">' + (p.epost ? '<a href="mailto:' + esc(p.epost) + '">' + esc(p.epost) + '</a>' : '–') + '</span></div>'
      + '      <div class="vz-kv"><span class="k">Telefon</span><span class="v">' + (p.telefon ? '<a href="tel:' + esc(p.telefon) + '">' + esc(p.telefon) + '</a>' : '–') + '</span></div>'
      + '      <div class="vz-kv"><span class="k">Kursvecka</span><span class="v">' + esc(p.kursvecka || '–') + '</span></div>'
      + '    </div>'
      + '    <div class="vz-info-card">'
      + '      <h4>Händelser för detta steg</h4>'
      +        eventLogHtml(step)
      + '    </div>'
      + '  </div>'
      + '</main>';
  }

  function leadText(step) {
    if (step.status === 'gap') {
      return '<b>Luckan här:</b> labeln är satt och automationen har gjort sitt — '
        + 'utskicket/dokumentet är klart. Men checklistan är ännu inte bockad, '
        + 'så steget räknas inte som klart förrän du sätter bocken.';
    }
    if (step.status === 'done') {
      return esc(step.desc || 'Det här steget är klart. Checklistan är bockad.');
    }
    if (step.status === 'manual') {
      return esc(step.desc || 'Genomför det här steget manuellt — det finns ingen automation. Bocka av i checklistan när det är gjort.');
    }
    return esc(step.desc || 'Det här steget väntar på att sättas igång.');
  }

  /* ---------- progressring-animation ---------- */
  function animateRing(rootEl) {
    var fg = rootEl.querySelector('.vz-ring .ring-fg');
    if (!fg) return;
    var circ = parseFloat(fg.getAttribute('data-circ'));
    var pct = parseFloat(fg.getAttribute('data-pct')) || 0;
    var target = circ * (1 - pct / 100);
    // tvinga reflow så transitionen körs från full offset → mål
    // eslint-disable-next-line no-unused-expressions
    fg.getBoundingClientRect();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { fg.style.strokeDashoffset = target.toFixed(1); });
    });
  }

  /* ========================================================================
   * RENDER — det publika API:t
   * ====================================================================== */
  function render(rootEl, model, handlers) {
    if (!rootEl) return;
    model = model || {};
    handlers = handlers || {};
    var all = flatSteps(model);

    // härled progress om den saknas
    if (!model.progress) {
      var done = all.filter(function (s) { return s.status === 'done'; }).length;
      model.progress = { done: done, total: all.length, pct: all.length ? Math.round(done / all.length * 100) : 0 };
    }
    // härled "next" (mest brådskande icke-klara steget) om den saknas
    if (model.next === undefined) {
      model.next = all.filter(function (s) { return s.status !== 'done'; })[0] || null;
    }
    // valt steg
    var selectedKey = model.selectedKey || (model.next ? model.next.key : (all[0] && all[0].key));

    function byKey(k) { return all.filter(function (s) { return s.key === k; })[0]; }

    // bygg skalet
    rootEl.innerHTML = '<div class="vz-dash"><div class="vz-cockpit">'
      + topbarHtml(model)
      + commandHtml(model)
      + '<div class="vz-grid">'
      +   railHtml(model)
      +   '<div data-detail-host></div>'
      + '</div>'
      + '</div></div>';

    var host = rootEl.querySelector('[data-detail-host]');
    var rail = rootEl.querySelector('.vz-rail');

    function paintDetail(step) {
      host.innerHTML = '';
      var node = el(detailHtml(model, step));
      host.appendChild(node);
      wireDetail(node, step);
    }

    function setActive(key) {
      var steps = rail.querySelectorAll('.vz-step');
      Array.prototype.forEach.call(steps, function (s) {
        s.classList.toggle('active', s.getAttribute('data-step-key') === key);
      });
    }

    function select(key) {
      var step = byKey(key);
      if (!step) return;
      selectedKey = key;
      setActive(key);
      paintDetail(step);
      if (typeof handlers.onSelectStep === 'function') {
        try { handlers.onSelectStep(step); } catch (e) { /* no-op */ }
      }
    }

    // wira rälsen
    Array.prototype.forEach.call(rail.querySelectorAll('.vz-step'), function (row) {
      var key = row.getAttribute('data-step-key');
      row.addEventListener('click', function () { select(key); });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(key); }
      });
    });

    // wira kommandozonens knapp → hoppa till "next" + trigga rätt handler
    var cmdBtn = rootEl.querySelector('[data-cmd-btn]');
    if (cmdBtn && model.next) {
      cmdBtn.addEventListener('click', function () {
        select(model.next.key);
        var step = model.next;
        if (step.status === 'gap' || step.status === 'manual') {
          if (typeof handlers.onTickChecklist === 'function') handlers.onTickChecklist(step);
          else console.log('[DashboardView] onTickChecklist', step.key);
        } else if (typeof handlers.onRunLabel === 'function') {
          handlers.onRunLabel(step);
        } else {
          console.log('[DashboardView] onRunLabel', step.key);
        }
      });
    }

    // wira detaljpanelens toggles
    function wireDetail(node, step) {
      // label-toggle (Fas 1) — bara klickbar om ej redan satt
      Array.prototype.forEach.call(node.querySelectorAll('[data-toggle="label"]'), function (tg) {
        if (tg.getAttribute('aria-disabled') === 'true') return;
        var act = function () {
          if (typeof handlers.onRunLabel === 'function') handlers.onRunLabel(step);
          else console.log('[DashboardView] onRunLabel', step.key);
        };
        tg.addEventListener('click', act);
        tg.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); }
        });
      });
      // check-toggle (Fas 2)
      Array.prototype.forEach.call(node.querySelectorAll('[data-toggle="check"]'), function (tg) {
        var act = function () {
          if (typeof handlers.onTickChecklist === 'function') handlers.onTickChecklist(step);
          else console.log('[DashboardView] onTickChecklist', step.key);
        };
        tg.addEventListener('click', act);
        tg.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); }
        });
      });
    }

    // initial paint
    setActive(selectedKey);
    paintDetail(byKey(selectedKey) || all[0]);
    animateRing(rootEl);
  }

  /* ========================================================================
   * DEMO_MODEL — Bertils 8 steg i faser (för fristående förhandsgranskning)
   * ====================================================================== */
  var DEMO_MODEL = {
    participant: {
      name: 'Bertil Claesson',
      kursvecka: '24 juni – 2 juli 2026 (Steg 1)',
      epost: 'bertilc01@gmail.com',
      telefon: '0706033423'
    },
    phases: [
      {
        key: 'anmalan',
        title: 'Anmälan & antagning',
        subtitle: 'Från intresse till antagen plats',
        steps: [
          {
            key: 'intresse', title: 'Intresseanmälan',
            desc: 'Bertil fyllde i intresseanmälan på webben. Kortet skapades automatiskt — inget att göra här.',
            status: 'done', automation: 'V3 Ny intresseanmälan', triggerLabel: null,
            labelSet: false, checklistDone: true, checkItemName: null,
            events: [
              { time: '22 jun', text: 'Webbformulär skapade kortet', kind: 'info' },
              { time: '22 jun', text: 'Checklista bockad automatiskt', kind: 'check' }
            ]
          },
          {
            key: 'tack', title: 'Tack för anmälan',
            desc: 'Labeln är satt och tack-mejlet har skickats automatiskt. Checklistan väntar på din bock.',
            status: 'gap', automation: 'Skicka Tack för anmälan', triggerLabel: 'Skicka tack för anmälan',
            labelSet: true, checklistDone: false, checkItemName: 'Email-Tack för anmälan skickad',
            events: [
              { time: '23 jun', text: 'Label satt', kind: 'label' },
              { time: '23 jun', text: 'Tack-mejl skickat', kind: 'mail' }
            ]
          },
          {
            key: 'intervju', title: 'Intervju',
            desc: 'Boka och genomför intervjun med Bertil. Det här steget har ingen automation — bocka av i checklistan när intervjun är gjord.',
            status: 'manual', automation: null, triggerLabel: null,
            labelSet: false, checklistDone: false, checkItemName: 'Intervju utförd',
            events: []
          },
          {
            key: 'antagen', title: 'Antagen till kurs',
            desc: 'Labeln är satt och antagningsmejlet har gått iväg. Checklistan är inte bockad ännu.',
            status: 'gap', automation: 'Skicka Du har fått en plats', triggerLabel: 'Skicka mail - "Du har fått en plats"',
            labelSet: true, checklistDone: false, checkItemName: 'Antagen till kurs',
            events: [
              { time: '23 jun', text: 'Label satt', kind: 'label' },
              { time: '23 jun', text: 'Mejl ”Du har fått en plats” skickat', kind: 'mail' }
            ]
          }
        ]
      },
      {
        key: 'forberedelse',
        title: 'Förberedelse inför kurs',
        subtitle: 'Avgift, info och formulär',
        steps: [
          {
            key: 'avgift', title: 'Anmälningsavgift',
            desc: 'Anmälningsavgiften är registrerad som betald och checklistan är bockad. Klart.',
            status: 'done', automation: 'Kryssa anm avgift 1', triggerLabel: null,
            labelSet: false, checklistDone: true, checkItemName: 'Anmälningsavgift betald',
            events: [
              { time: '24 jun', text: 'Anmälningsavgift betald', kind: 'info' },
              { time: '24 jun', text: 'Checklista bockad', kind: 'check' }
            ]
          },
          {
            key: 'praktisk', title: 'Praktisk info',
            desc: 'Nästa i kön. Sätt igång den praktiska informationen när tidigare steg är klara.',
            status: 'wait', automation: null, triggerLabel: null,
            labelSet: false, checklistDone: false, checkItemName: 'Praktisk info skickat',
            events: []
          },
          {
            key: 'formular', title: 'Steg 1 – formulär',
            desc: 'Labeln är satt — formuläret har skapats och skickats till Bertil. Checklistan väntar på din bock.',
            status: 'gap', automation: 'Steg 1 - Skicka formulär', triggerLabel: 'steg 1 - Skicka formulär till deltagare',
            labelSet: true, checklistDone: false, checkItemName: null,
            events: [
              { time: '24 jun', text: 'Label satt', kind: 'label' },
              { time: '24 jun', text: 'Formulär skapat och skickat till Bertil', kind: 'mail' }
            ]
          },
          {
            key: 'halsoformular', title: 'Hälsoformulär → läkare',
            desc: 'Hälsoformuläret är hanterat och vidarebefordrat till läkare. Checklistan är bockad — steget är klart.',
            status: 'done', automation: 'Kopiera HF till läkare', triggerLabel: null,
            labelSet: false, checklistDone: true, checkItemName: 'Delat Hälsoformulär till läkare/kursledare',
            events: [
              { time: '25 jun', text: 'Hälsoformulär vidarebefordrat till läkare', kind: 'info' },
              { time: '25 jun', text: 'Checklista bockad', kind: 'check' }
            ]
          }
        ]
      }
    ]
  };
  // härled progress + next + selectedKey för demo
  (function () {
    var all = [];
    DEMO_MODEL.phases.forEach(function (p) { p.steps.forEach(function (s) { all.push(s); }); });
    var done = all.filter(function (s) { return s.status === 'done'; }).length;
    DEMO_MODEL.progress = { done: done, total: all.length, pct: Math.round(done / all.length * 100) };
    DEMO_MODEL.next = all.filter(function (s) { return s.status !== 'done'; })[0] || null;
    DEMO_MODEL.selectedKey = DEMO_MODEL.next ? DEMO_MODEL.next.key : all[0].key;
  })();

  /* ---------- expose ---------- */
  window.DashboardView = { render: render, DEMO_MODEL: DEMO_MODEL };

  /* ---------- fristående auto-boot ---------- */
  // Om sidan har #root och ingen wirar oss, rendera modellen så filen kan
  // förhandsgranskas direkt i webbläsaren.
  function autoBoot() {
    var root = document.getElementById('root') || document.querySelector('[data-dashboard-root]');
    if (!root) return;
    if (root.getAttribute('data-vz-manual') === '1') return; // app:en wirar själv
    var model = window.NYA_ZAPIER_MODEL || DEMO_MODEL;
    render(root, model, {
      onRunLabel: function (s) { console.log('[demo] onRunLabel', s.key, s.triggerLabel); },
      onTickChecklist: function (s) { console.log('[demo] onTickChecklist', s.key, s.checkItemName); },
      onSelectStep: function (s) { console.log('[demo] onSelectStep', s.key); }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoBoot);
  } else {
    autoBoot();
  }
})();
