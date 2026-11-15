/* Webbappen: Incheckning (Robert 2026-11-14). Laddas BARA av kurs.html, efter course.js och kurs-listor.js.
 * Power-Upen i Trello laddar aldrig filen. Visar och sparar fliken "Incheckning" i kursets Rumsindelning-ark:
 * en bock per person och fälten anhörig, mobil (anhörig), förvaring, lån, anteckningar och registreringsnummer (bil).
 * Listar BARA det som står i arket och försöker inte para ihop raderna med Trello-deltagarna.
 * Servern (gas/Code.gs, incheckning och incheckningSkriv) hittar arket själv på kursnamnet och skriver EN cell åt
 * gången, och läser tillbaka den. Skrivningar skickas med live:true: servern torrkör utan det.
 * Ingenting sparas i webbläsaren (inget localStorage).
 * GLIDNING (väg C): servern stämplar radens namn i kolumn L vid varje skrivning och flaggar rader där stämpeln inte längre
 * stämmer med namnet (rad.flagga). Flaggorna räknas om av servern vid VARJE läsning och cachas aldrig här. Varningen syns
 * bara när den är aktuell: stämmer allt ritas varken ruta, sammanfattning eller knapp.
 * BEGRÄNSNING: värden som skrivits för hand i arket, utan appen, saknar stämpel och kan inte flaggas. */
(function () {
  'use strict';

  var FALT = [
    { key: 'anhorig', etikett: 'Närmast anhörig', typ: 'text' },
    { key: 'mobil', etikett: 'Mobil (anhörig)', typ: 'tel' },
    { key: 'forvaring', etikett: 'Förvaring', typ: 'text' },
    { key: 'lan', etikett: 'Lån', typ: 'text' },
    { key: 'anteckningar', etikett: 'Anteckningar', typ: 'area' },
    { key: 'regnr', etikett: 'Registreringsnummer (bil)', typ: 'text' }
  ];
  var MAX = 500;
  var icOppen = false;   // sektionen Incheckning: infälld tills man trycker på rubriken

  function escH(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Felkoder från servern (tekniska) → klartext på svenska.
  function felText(kod) {
    var k = String(kod || '');
    if (k === 'ej_behorig') { return 'Ditt konto har inte behörighet att spara här.'; }
    if (k === 'namn_hittas_inte') { return 'Namnet finns inte längre i arket. Ladda om sidan.'; }
    if (k === 'namn_flera') { return 'Namnet står flera gånger i arket, så det går inte att spara säkert.'; }
    if (k === 'tillbakalasning_avviker') { return 'Arket visade något annat än det som skickades. Kontrollera i arket.'; }
    if (k === 'flera_kursark') { return 'Flera kursark matchar kursen. Inget sparades. Be någon städa bland arken.'; }
    if (k === 'rad_flaggad') { return 'Raden är flyttad i arket. Rätta uppgifterna i arket först.'; }
    if (k === 'ej_flaggad') { return 'Raden har ingen varning längre. Ladda om sidan.'; }
    if (k === 'varde_for_langt') { return 'Texten är för lång (högst ' + MAX + ' tecken).'; }
    return 'Kunde inte spara. Försök igen.';
  }

  function andrad(rad, falt, varde) { return String(rad[falt] == null ? '' : rad[falt]) !== String(varde == null ? '' : varde).trim(); }

  // Skickar EN skrivning. Löser alltid, med {ok:true, sparat} eller {ok:false, fel:<klartext>}.
  function skrivEn(post, listName, namn, falt, varde) {
    return Promise.resolve().then(function () {
      return post('incheckningSkriv', { listName: listName, namn: namn, falt: falt, varde: varde, live: true });
    }).then(function (r) {
      if (r && r.ok === true && !r.torrkorning) { return { ok: true, sparat: r.sparat, varning: r.varning || '' }; }
      var kod = (r && r.error) ? String(r.error) : (r && r.torrkorning ? 'torrkorning' : 'okant_svar');
      return { ok: false, fel: felMedKod(kod), kod: kod };
    }, function (e) {
      var kod = 'natfel: ' + String((e && e.message) || e || '').slice(0, 60);
      return { ok: false, fel: felMedKod(kod), kod: kod };
    });
  }

  var BESTAMDA_FEL = ['ej_behorig', 'namn_hittas_inte', 'namn_flera', 'tillbakalasning_avviker', 'flera_kursark', 'rad_flaggad', 'ej_flaggad', 'varde_for_langt', 'torrkorning'];

  // Klartext + felkoden, så att den som ser felet kan återge exakt vad som hände (TL 2026-11-14).
  function felMedKod(kod) { return felText(kod) + ' (felkod: ' + (kod || 'okänd') + ')'; }

  // Efter ett misslyckat sparande: läs om listan från servern. Uppdaterar bockarna (och därmed räknaren) på
  // rader som inte håller på att sparas. Löser med serverns rad för `rad` (matchad på radnummer + namn), eller null.
  // Bara rader som varken sparade när omläsningen startade eller har börjat spara sedan dess (versionen _v) får arkets läge.
  function lasOmEfterFel(post, listName, rad, rader) {
    var fore = (rader || []).filter(function (x) { return x !== rad && !(x.status && x.status.typ === 'sparar'); })
      .map(function (x) { return { x: x, v: x._v || 0 }; });
    return Promise.resolve().then(function () { return post('incheckning', { listName: listName }); })
      .then(function (r) {
        if (!r || r.ok !== true || !r.hittat || !Array.isArray(r.rader)) { return null; }
        var karta = {};
        r.rader.forEach(function (x) { karta[x.rad + '|' + x.namn] = x; });
        fore.forEach(function (f) {
          var s = karta[f.x.rad + '|' + f.x.namn];
          if (s && (f.x._v || 0) === f.v && !(f.x.status && f.x.status.typ === 'sparar')) { f.x.incheckad = s.incheckad === true; }
        });
        return karta[rad.rad + '|' + rad.namn] || null;
      }, function () { return null; });
  }

  // Bocken: ritas om direkt (visa) och sparas. Vid fel läses arket om (TL 2026-11-14, Amanda 22:45: servern hade
  // sparat men svaret nådde inte appen). Ligger bocken ändå i arket visas raden som sparad; annars visas arkets läge
  // och felet med felkod. Går omläsningen inte heller sätts det gamla läget tillbaka och man uppmanas ladda om.
  function skrivBock(post, listName, rad, nytt, visa, rader) {
    if (rad.flagga) { return Promise.resolve({ ok: false, fel: felText('rad_flaggad') }); }
    var gammal = rad.incheckad === true;
    rad._v = (rad._v || 0) + 1;
    rad.incheckad = nytt;
    rad.status = { typ: 'sparar', text: 'Sparar…' };
    visa();
    return skrivEn(post, listName, rad.namn, 'incheckad', nytt).then(function (r) {
      if (r.ok) { rad.status = { typ: 'ok', text: 'Sparat' }; rad.varning = r.varning || ''; visa(); return r; }
      // Ett bestämt svar från servern (behörighet, flaggad rad, avvikande tillbakaläsning …) gäller: ingen omläsning
      // som kan överrösta det. Omläsning bara när svaret är okänt: nätfel, oklart svar eller ett oväntat serverfel.
      if (BESTAMDA_FEL.indexOf(r.kod) !== -1) { rad.incheckad = gammal; rad.status = { typ: 'fel', text: r.fel }; visa(); return r; }
      rad.status = { typ: 'sparar', text: 'Kontrollerar i arket…' };
      visa();
      return lasOmEfterFel(post, listName, rad, rader).then(function (s) {
        if (s && (s.incheckad === true) === nytt) {
          rad.incheckad = nytt;
          rad.status = { typ: 'ok', text: 'Sparat' };
          visa();
          return { ok: true, efterKontroll: true };
        }
        if (s) { rad.incheckad = s.incheckad === true; rad.status = { typ: 'fel', text: r.fel }; }
        else { rad.incheckad = gammal; rad.status = { typ: 'fel', text: r.fel + ' Ladda om sidan för att se vad som står i arket.' }; }
        visa();
        return r;
      });
    });
  }

  // Sparar de fält som ändrats, ett i taget (en cell per anrop). Stannar vid första felet.
  function skrivFalt(post, listName, rad, varden, visa) {
    if (rad.flagga) { return Promise.resolve({ ok: false, fel: felText('rad_flaggad') }); }
    var att = FALT.filter(function (f) { return andrad(rad, f.key, varden[f.key]); });
    if (!att.length) { rad.status = { typ: 'ok', text: 'Inget att spara' }; visa(); return Promise.resolve({ ok: true, antal: 0 }); }
    rad.status = { typ: 'sparar', text: 'Sparar…' };
    visa();
    var kedja = Promise.resolve({ ok: true });
    var sparade = 0;
    att.forEach(function (f) {
      kedja = kedja.then(function (fore) {
        if (!fore.ok) { return fore; }
        var v = String(varden[f.key] == null ? '' : varden[f.key]).trim();
        return skrivEn(post, listName, rad.namn, f.key, v).then(function (r) {
          if (r.ok) { rad[f.key] = (r.sparat == null ? '' : String(r.sparat)); sparade++; if (r.varning) { rad.varning = r.varning; } }
          return r;
        });
      });
    });
    return kedja.then(function (r) {
      rad.status = r.ok ? { typ: 'ok', text: 'Sparat' } : { typ: 'fel', text: r.fel + (sparade ? ' (' + sparade + ' av ' + att.length + ' fält sparades)' : '') };
      visa();
      return r.ok ? { ok: true, antal: sparade } : r;
    });
  }

  // Kvittering: någon har rättat i arket (eller bekräftat att uppgifterna är rätt). Servern sätter stämpeln L = namnet.
  function skrivKvittera(post, listName, rad, visa, laddaOm) {
    rad.status = { typ: 'sparar', text: 'Tar bort varningen…' };
    visa();
    return Promise.resolve().then(function () {
      return post('incheckningSkriv', { listName: listName, namn: rad.namn, falt: 'kvittera', live: true });
    }).then(function (r) {
      if (r && r.ok === true && !r.torrkorning) { return { ok: true }; }
      return { ok: false, fel: felMedKod((r && r.error) ? String(r.error) : 'okant_svar') };
    }, function (e) { return { ok: false, fel: felMedKod('natfel: ' + String((e && e.message) || e || '').slice(0, 60)) }; }).then(function (r) {
      if (r.ok) { return Promise.resolve(laddaOm ? laddaOm() : null).then(function () { return r; }); }
      rad.status = { typ: 'fel', text: r.fel };
      visa();
      return r;
    });
  }

  function flaggText(f) {
    if (!f) { return ''; }
    if (f.typ === 'fel_person') { return '⚠ Uppgifterna på den här raden skrevs för ' + f.gallde + '. Namnlistan i arket har flyttat sig. Flytta uppgifterna till rätt person i arket.'; }
    return '⚠ Dina uppgifter står på en annan rad i arket (rad ' + f.rad + ').';
  }

  function statusHtml(rad) {
    var s = rad.status;
    // Serverns varning (t.ex. att kolumn L inte kunde döljas) visas som en diskret rad, och bara när den finns.
    return (s ? '<span class="vz-ic-status vz-ic-' + escH(s.typ) + '" role="status">' + escH(s.text) + '</span>' : '')
      + (rad.varning ? '<span class="vz-ic-lagvarning">' + escH(rad.varning) + '</span>' : '');
  }

  function faltHtml(rad, i) {
    var las = rad.flagga ? ' disabled' : '';
    return FALT.map(function (f) {
      var id = 'vz-ic-' + i + '-' + f.key;
      var v = escH(rad[f.key]);
      var falt = f.typ === 'area'
        ? '<textarea id="' + id + '" data-falt="' + f.key + '" maxlength="' + MAX + '" rows="3"' + las + '>' + v + '</textarea>'
        : '<input id="' + id + '" data-falt="' + f.key + '" maxlength="' + MAX + '" type="' + (f.typ === 'tel' ? 'tel" inputmode="tel' : 'text') + '"' + (f.key === 'regnr' ? ' autocapitalize="characters" autocorrect="off" autocomplete="off" spellcheck="false"' : '') + ' value="' + v + '"' + las + '>';
      return '<label class="vz-ic-falt" for="' + id + '"><span>' + escH(f.etikett) + '</span>' + falt + '</label>';
    }).join('');
  }

  // Rutan för en rad där stämpeln inte längre stämmer. Finns bara för sådana rader.
  function rutaHtml(rad, i, bekraftar) {
    var f = rad.flagga;
    if (!f) { return ''; }
    var s = '<div class="vz-ic-ruta" role="alert">' + escH(flaggText(f)) + '</div>';
    if (f.typ !== 'fel_person') { return s; }
    if (bekraftar) {
      return s + '<div class="vz-ic-dialog" role="alertdialog" aria-label="Ta bort varningen">'
        + '<p>Har du flyttat uppgifterna till rätt person i arket, eller kontrollerat att de stämmer här? Då tas varningen bort.</p>'
        + '<button type="button" class="vz-ic-ja" data-kvitt-ja="' + i + '">Ja, ta bort varningen</button>'
        + '<button type="button" class="vz-ic-nej" data-kvitt-nej="' + i + '">Avbryt</button></div>';
    }
    return s + '<button type="button" class="vz-ic-kvitt" data-kvitt="' + i + '">Uppgifterna är rättade, ta bort varningen</button>';
  }

  function radHtml(rad, i, oppen, bekraftar) {
    var rum = rad.rum ? escH(rad.rum) : '<i>Inget rum</i>';
    var namn = rad.namn;
    var las = rad.flagga ? ' disabled' : '';
    return '<div class="vz-ic-rad' + (rad.incheckad ? ' is-incheckad' : '') + (rad.flagga ? ' vz-ic-avviker' : '') + '" data-i="' + i + '">'
      + '<div class="vz-ic-huvud">'
      + '<button type="button" class="vz-ic-bock" data-bock="' + i + '" role="checkbox" aria-checked="' + (rad.incheckad ? 'true' : 'false') + '" aria-label="Incheckad: ' + escH(namn) + '"' + las + '>' + (rad.incheckad ? '✓' : '') + '</button>'
      + '<button type="button" class="vz-ic-namn" data-vaxla="' + i + '" aria-expanded="' + (oppen ? 'true' : 'false') + '"><span class="vz-ic-n">' + escH(namn) + '</span><span class="vz-ic-rum">' + rum + '</span></button>'
      + '</div>'
      + rutaHtml(rad, i, bekraftar)
      + '<div class="vz-ic-status-rad">' + statusHtml(rad) + '</div>'
      + '<div class="vz-ic-falten"' + (oppen ? '' : ' hidden') + '>' + faltHtml(rad, i)
      + (rad.flagga ? '' : '<button type="button" class="vz-ic-spara" data-spara="' + i + '">Spara</button>') + '</div>'
      + '</div>';
  }

  function raknare(rader) {
    var klara = rader.filter(function (r) { return r.incheckad === true; }).length;
    return 'Incheckade ' + klara + ' av ' + rader.length;
  }

  // Antal rader som behöver rättas. Räknas om vid varje ritning ur det servern just läst, aldrig lagrat.
  function antalAvvikande(rader) { return rader.filter(function (r) { return !!r.flagga; }).length; }

  function html(rader, notis, oppnade, bekraftar) {
    oppnade = oppnade || {}; bekraftar = bekraftar || {};
    var n = antalAvvikande(rader);
    return '<summary class="vz-sek-rub">Incheckning' + (rader.length ? ' (' + rader.length + ')' : '') + '</summary>'
      + (notis ? '<p class="vz-ic-notis">' + escH(notis) + '</p>' : '')
      + (n > 0 ? '<p class="vz-ic-summa" role="status">' + n + (n === 1 ? ' rad behöver' : ' rader behöver') + ' rättas i arket</p>' : '')
      + (rader.length
        ? '<p class="vz-ic-raknare" id="vz-ic-raknare">' + escH(raknare(rader)) + '</p>'
          + rader.map(function (r, i) { return radHtml(r, i, !!oppnade[i], !!bekraftar[i]); }).join('')
        : (notis ? '' : '<p class="vz-ic-notis">Inga personer i incheckningslistan.</p>'));
  }

  // Ritar sektionen i host och kopplar knapparna. post(action, payload) = window.postToGas.
  function montera(host, rader, notis, listName, post, laddaOm) {
    var oppnade = {}, bekraftar = {};
    function ritaOm() {
      // Det som skrivits i fälten bevaras när bara bocken eller statusen ritas om.
      var inmatat = {};
      [].slice.call(host.querySelectorAll ? host.querySelectorAll('[data-falt]') : []).forEach(function (el) {
        var rad = el.closest && el.closest('[data-i]');
        if (rad) { (inmatat[rad.getAttribute('data-i')] = inmatat[rad.getAttribute('data-i')] || {})[el.getAttribute('data-falt')] = el.value; }
      });
      host.innerHTML = html(rader, notis, oppnade, bekraftar);
      Object.keys(inmatat).forEach(function (i) {
        Object.keys(inmatat[i]).forEach(function (k) {
          var el = host.querySelector('#vz-ic-' + i + '-' + k);
          if (el) { el.value = inmatat[i][k]; }
        });
      });
    }
    function varden(i) {
      var o = {};
      FALT.forEach(function (f) { var el = host.querySelector('#vz-ic-' + i + '-' + f.key); o[f.key] = el ? el.value : rader[i][f.key]; });
      return o;
    }
    host.addEventListener('click', function (ev) {
      var mal = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!mal) { return; }
      var b = mal.getAttribute('data-bock'), v = mal.getAttribute('data-vaxla'), s = mal.getAttribute('data-spara');
      var kv = mal.getAttribute('data-kvitt'), kja = mal.getAttribute('data-kvitt-ja'), knej = mal.getAttribute('data-kvitt-nej');
      if (kv !== null && rader[kv] && rader[kv].flagga) { bekraftar[kv] = true; ritaOm(); return; }
      if (knej !== null) { bekraftar[knej] = false; ritaOm(); return; }
      if (kja !== null && rader[kja] && rader[kja].flagga) {
        if (rader[kja].status && rader[kja].status.typ === 'sparar') { return; }
        bekraftar[kja] = false;
        skrivKvittera(post, listName, rader[kja], ritaOm, laddaOm);
        return;
      }
      if (b !== null && rader[b] && !rader[b].flagga) {
        if (rader[b].status && rader[b].status.typ === 'sparar') { return; }
        skrivBock(post, listName, rader[b], !rader[b].incheckad, ritaOm, rader);
      } else if (v !== null && rader[v]) {
        oppnade[v] = !oppnade[v];
        ritaOm();
      } else if (s !== null && rader[s] && !rader[s].flagga) {
        if (rader[s].status && rader[s].status.typ === 'sparar') { return; }
        var vals = varden(s);
        oppnade[s] = true;
        skrivFalt(post, listName, rader[s], vals, ritaOm);
      }
    });
    ritaOm();
  }

  // Hämtar raderna och ritar sektionen. Löser med antal rader (eller -1 om arket inte kunde läsas).
  function rita(post, listName) {
    var mal = window.vzRegion ? window.vzRegion('aside') : document.getElementById('root');
    return Promise.resolve().then(function () { return post('incheckning', { listName: listName }); })
      .catch(function () { return { ok: false }; })
      .then(function (r) {
        r = r || {};
        var rader = [], notis = '';
        if (r.ok && r.hittat) { rader = r.rader || []; if (r.varning) { notis = r.varning; } }
        else if (r.ok) { notis = r.meddelande || 'Hittade ingen incheckningslista.'; }
        else { notis = 'Kunde inte läsa incheckningen.'; }
        var gammal = document.getElementById('vz-ic');
        if (gammal && gammal.parentNode) { gammal.parentNode.removeChild(gammal); }
        // Infälld från början (Robert 2026-11-14). Läget bevaras när sektionen ritas om (efter en kvittering).
        var el = document.createElement('details');
        el.id = 'vz-ic';
        el.className = 'vz-ic vz-sek';
        el.open = icOppen;
        el.addEventListener('toggle', function () { icOppen = !!el.open; });
        if (mal) { mal.appendChild(el); }
        montera(el, rader, notis, listName, post, function () { return rita(post, listName); });
        return rader.length;
      });
  }

  window.VZ_INCHECKNING_PROV = { html: html, radHtml: radHtml, raknare: raknare, felText: felText, felMedKod: felMedKod, lasOmEfterFel: lasOmEfterFel, skrivEn: skrivEn, skrivBock: skrivBock, skrivFalt: skrivFalt, skrivKvittera: skrivKvittera, flaggText: flaggText, antalAvvikande: antalAvvikande, montera: montera, rita: rita };

  if (!window.VZ_SIDA) { return; }   // bara på den egna sidan
  var orig = window.renderStaffPanel;
  if (typeof orig !== 'function') { return; }
  var ritadFor = null;   // en gång per kurs: ritas panelen om ska inte det man håller på att skriva försvinna
  window.renderStaffPanel = function () {
    try { return orig.apply(this, arguments); }
    finally {
      try {
        var kurs = window.COURSE_NAME || '';
        if (kurs && ritadFor !== kurs && typeof window.postToGas === 'function') {
          ritadFor = kurs;
          rita(window.postToGas, kurs).catch(function () { ritadFor = null; });
        }
      } catch (e) { /* incheckningen får aldrig fälla sidan */ }
    }
  };
})();
