/* Webbappen, telefonlistor (Robert 2026-11-14, "Ja" via TESTLEDARE): deltagare och personal med tel-länkar.
 * Laddas BARA av kurs.html, efter course.js. Power-Upen i Trello laddar aldrig filen, och personalrutan där är orörd.
 * Bara namn och nummer: ingen hälsa, ingen kost. Numren läses ur kortbeskrivningen ("Telefonnummer:") med
 * användarens egen Trello-inloggning när sidan visas. Ingenting sparas i webbläsaren eller i någon fil.
 * Deltagarna tas ur korten som kursöversikten redan hämtat (COURSE_CARDS_BY_ID). Personalens beskrivning hämtas
 * med en läsning (GET) per personallista, eftersom personalrutan bara hämtar namn och etiketter. */
(function () {
  'use strict';

  // tel:-adress av ett nummer som det står i kortet. Mellanslag, bindestreck och parenteser tas bort; ett
  // inledande + behålls; 00 blir +. Färre än 6 siffror räknas som inget nummer.
  function telHref(nr) {
    var s = String(nr || '').trim();
    var plus = /^\+/.test(s);
    var d = s.replace(/\D/g, '');
    if (!plus && /^00/.test(d)) { plus = true; d = d.slice(2); }
    if (d.length < 6) { return ''; }
    return 'tel:' + (plus ? '+' : '') + d;
  }

  function escH(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function telefonUr(desc) {
    try { return (window.parseContactFromDesc(desc) || {}).telefon || ''; } catch (e) { return ''; }
  }

  // Deltagarna i listans ordning, med samma namnstädning som kursöversikten ("12 - Anna" → "Anna").
  function deltagare(kortPerId) {
    return Object.keys(kortPerId || {}).map(function (id) {
      var c = kortPerId[id] || {};
      return { namn: String(c.name || '').replace(/^\s*\d+\s*[-–]\s*/, '').trim(), telefon: telefonUr(c.desc) };
    }).filter(function (p) { return p.namn; });
  }

  // Personal ur en grupp från loadStaff: korten hämtas om med beskrivning, rollerna tas ur gruppens egna personer.
  function personalForGrupp(token, g) {
    if (!g || !g.listId) { return Promise.resolve([]); }
    var roll = {};
    (g.people || []).forEach(function (p) { if (p.id) { roll[p.id] = p.role; } });
    return window.restGet(token, 'lists/' + g.listId + '/cards?fields=name,desc,labels').then(function (kort) {
      return (kort || []).map(function (c) {
        var p = window.staffPerson(c, g.cfg);
        return p ? { namn: p.name, roll: roll[c.id] || p.role, telefon: telefonUr(c.desc) } : null;
      }).filter(Boolean);
    }).catch(function () { return []; });
  }

  function kartaHref(ark) {
    if (!ark || !ark.hittat || !ark.arkId || ark.kartaGid == null || ark.kartaGid === '') { return ''; }
    return 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(ark.arkId) + '/export?format=pdf&gid=' +
      encodeURIComponent(ark.kartaGid) + '&portrait=false&fitw=true';
  }

  function rad(p, medRoll) {
    var href = telHref(p.telefon);
    var nr = href
      ? '<a class="vz-tel-nr" href="' + escH(href) + '">' + escH(p.telefon) + '</a>'
      : '<span class="vz-tel-saknas">nummer saknas</span>';
    return '<li><span class="vz-tel-namn">' + escH(p.namn) +
      (medRoll && p.roll ? ' <span class="vz-tel-roll">' + escH(p.roll) + '</span>' : '') +
      (p.kalla ? ' <span class="vz-tel-roll">(' + escH(p.kalla) + ')</span>' : '') + '</span>' + nr + '</li>';
  }

  function html(delt, pers, ark, notis) {
    var karta = kartaHref(ark);
    return '<h3 class="vz-tel-rubrik">Telefonlista</h3>' +
      (karta ? '<a class="vz-tel-karta" href="' + escH(karta) + '" target="_blank" rel="noopener">Rumskarta (pdf)</a>' : '') +
      (notis ? '<p class="vz-tel-notis">' + escH(notis) + '</p>' : '') +
      '<details open><summary>Deltagare (' + delt.length + ')</summary><ul class="vz-tel-lista">' +
      (delt.length ? delt.map(function (p) { return rad(p, false); }).join('') : '<li>Inga deltagare.</li>') +
      '</ul></details>' +
      '<details open><summary>Personal (' + pers.length + ')</summary><ul class="vz-tel-lista">' +
      (pers.length ? pers.map(function (p) { return rad(p, true); }).join('') : '<li>Ingen personal hittad.</li>') +
      '</ul></details>';
  }

  function rita(groups) {
    var delt = deltagare(window.COURSE_CARDS_BY_ID);
    var tp = window.t && window.t.getRestApi ? window.t.getRestApi().getToken() : Promise.resolve('');
    var arkP = Promise.resolve().then(function () {
      if (typeof window.postToGas !== 'function') { throw new Error('ingen serverkoppling'); }
      return window.postToGas('kursark', { listName: window.COURSE_NAME || '' });
    }).catch(function () { return { ok: false }; });
    var trelloP = Promise.resolve(tp).then(function (token) {
      if (!token) { return []; }
      return Promise.all((groups || []).map(function (g) { return personalForGrupp(token, g); }))
        .then(function (lists) { return [].concat.apply([], lists); });
    });
    return Promise.all([arkP, trelloP]).then(function (res) {
      var ark = res[0] || {}, trello = res[1] || [], pers, notis = '';
      if (ark.ok && ark.hittat && (ark.personal || []).length) {
        pers = (ark.personal || []).slice();
        if (ark.kalla === 'narvarande') { notis = 'Nummer ur personalregistret (personallistan i kursarket är inte skapad än).'; }
        if (ark.varning) { notis = (notis ? notis + ' ' : '') + ark.varning; }
      } else {
        notis = !ark.ok ? 'Kunde inte läsa kursarket.' : ark.hittat ? 'Kursarket har ingen personal ännu.' : (ark.meddelande || 'Hittade inget kursark.');
        pers = trello.map(function (p) { return { namn: p.namn, roll: p.roll, telefon: p.telefon, kalla: 'ur Trello' }; });
      }
      return { ark: ark, pers: pers, notis: notis };
    }).then(function (r) {
      var pers = r.pers;
      var gammal = document.getElementById('vz-tel');
      if (gammal && gammal.parentNode) { gammal.parentNode.removeChild(gammal); }
      var el = document.createElement('section');
      el.id = 'vz-tel';
      el.className = 'vz-tel';
      el.innerHTML = html(delt, pers, r.ark, r.notis);
      var mal = window.vzRegion ? window.vzRegion('aside') : document.getElementById('root');
      if (mal) { mal.insertBefore(el, mal.firstChild); }
      return { deltagare: delt.length, personal: pers.length };
    });
  }

  window.VZ_TELLISTA_PROV = { kartaHref: kartaHref, telHref: telHref, deltagare: deltagare, html: html, rita: rita };

  if (!window.VZ_SIDA) { return; }   // bara på den egna sidan
  var orig = window.renderStaffPanel;
  if (typeof orig !== 'function') { return; }
  // loadStaff anropar renderStaffPanel via det globala namnet, så omslaget nås varje gång rutan ritas.
  window.renderStaffPanel = function (groups) {
    try { return orig.apply(this, arguments); }
    finally { try { rita(groups).catch(function () {}); } catch (e) { /* listorna får aldrig fälla sidan */ } }
  };
})();
