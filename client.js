/* global TrelloPowerUp, window */
/*
 * Connector-entrypoint. Registrerar capability-callbacks + REST-klient (appKey).
 *
 * Capabilities (måste även bockas i admin-portalen):
 *   - card-buttons        : Kursöversikt (denna kurs)
 *   - card-detail-badges  : Kursöversikt-badge på kortet
 *   - board-buttons       : Kursöversikt (board-brett, list-väljare) + Inställningar
 *
 * Vy2 Kursöversikt (modal, board-brett) är den enda vyn. appKey aktiverar t.getRestApi() för checklist-läsning.
 * Vy1 Deltagarstatus BORTTAGEN 2026-06-17 (Robert) — all funktionalitet ersatt av Kursöversiktens fold-out
 * (klick på en stegcell expanderar deltagarraden med Fas 1/Fas 2 + noteringar). dashboard.*-filerna är döda
 * (kvar tills proof-beroendet städats); registreras ej längre.
 */
'use strict';

var CFG = window.NYA_ZAPIER_CONFIG;
var MARK = CFG.MARK_URL;
var MARK_WHITE = CFG.MARK_WHITE_URL || CFG.MARK_URL;

// ⚙️ ASSET-VERSION — bumpa vid varje deploy. Modal-/iframe-filer (course/dashboard)
// laddas on-demand och cachas annars av webbläsaren (GitHub Pages max-age=600);
// versions-query tvingar färska filer när client.js (board-nivå) laddats om.
var V = '164';
function vurl(p) { return p + (p.indexOf('?') === -1 ? '?' : '&') + 'v=' + V; }

// Suffix " - TEST" i modaltiteln när testläget är på (vz_settings.testMode) — så Malin direkt
// ser att inget går skarpt. Board-shared, fail-soft (saknad/ogiltig → inget suffix).
function resolveTestSuffix(t) {
  return t.get('board', 'shared', 'vz_settings').then(function (s) {
    return (s && s.testMode === true) ? ' - TEST' : '';
  }).catch(function () { return ''; });
}

// Kursöversikt för DENNA deltagares kurs (kortets lista).
function openCourseFromCard(t) {
  return Promise.all([t.card('idList'), resolveTestSuffix(t)]).then(function (r) {
    return t.modal({
      url: vurl('./course.html'), fullscreen: true,
      title: CFG.APP_NAME + ' – Kursöversikt' + r[1], accentColor: '#08445c',
      args: { listId: r[0].idList },
    });
  });
}

// Kursöversikt från board (list-väljare i vyn).
function openCourseFromBoard(t) {
  return resolveTestSuffix(t).then(function (suf) {
    return t.modal({ url: vurl('./course.html'), fullscreen: true, title: CFG.APP_NAME + ' – Kursöversikt' + suf, accentColor: '#08445c' });
  });
}

// Inställningar — konfig som annars vore hårdkodad (läkaradresser per kurs, test-läge…).
// ⚠️ Det finns INGET kugghjul: detta är en BOARD-KNAPP med Vitalisera-loggan som ikon och texten
// "Vitalisera – Inställningar". Kalla den aldrig kugghjul i text Malin läser — hon letar då efter
// en ikon som inte finns (Robert frågade "vilket kugghjul?" 2026-08-29).
function openSettings(t) {
  return resolveTestSuffix(t).then(function (suf) {
    return t.modal({ url: vurl('./settings.html'), fullscreen: true, title: CFG.APP_NAME + ' – Inställningar' + suf, accentColor: '#08445c' });
  });
}

// ── Påminnelsen efter intresseanmälan (mejldelen). Knapparna syns bara när kortet har etiketten "Påminna?".
// Allt avgörs av servern (GAS): läget (test/skarpt), max två påminnelser, dubbelklick. Sms är avstängt (tom krok).
var PAMINN_ETIKETT = 'Påminna?';
function paminnGas(action, payload) {
  return fetch(CFG.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, payload: payload || {} }),
  }).then(function (res) { return res.text(); }).then(function (text) {
    try { return JSON.parse(text); } catch (e) { return { ok: false, skal: 'ogiltigt_svar' }; }
  });
}
var PAMINN_SKAL = {
  ingen_etikett: 'Kortet har ingen påminnelse att skicka (någon hann före).',
  max_nadd: 'Två påminnelser är redan skickade. Fler skickas inte.',
  ingen_paminnelse_vald: 'Det här kortet är markerat som "Ingen påminnelse".',
  sms_avstangt: 'Sms är avstängt tills vidare. Inget skickat.',
  kursval_saknas: 'Kortet saknar kursvecka för Steg 1. Inget skickat.',
  kursval_inte_steg1: 'Kursveckan på kortet gäller inte Steg 1. Inget skickat.',
  kursval_otolkbart: 'Kursveckan på kortet går inte att tolka. Inget skickat.',
  kursen_har_borjat: 'Kursen har redan börjat. Inget skickat.',
  fornamn_saknas: 'Förnamn saknas på kortet. Inget skickat.',
  fornamn_osakert: 'Förnamnet på kortet går inte att avgöra säkert (till exempel efternamn först eller en titel). Inget skickat.',
  epost_flera: 'Kortet har flera e-postadresser. Inget skickat.',
  kursval_flera: 'Kortet har mer än en kursvecka. Inget skickat.',
  adress_redan_paminnd: 'Samma e-postadress har fått en påminnelse från ett annat kort de senaste 14 dagarna. Inget skickat.',
  testlage_bara_provlistan: 'Påminnelsen är i testläge och fungerar bara i listan PROV påminnelse. Inget skickat.',
  fel_lista: 'Kortet ligger inte i listan Inkommet från Intresseanmälan. Inget skickat.',
  lista_ej_last: 'Det gick inte att se vilken lista kortet ligger i. Inget skickat.',
  epost_saknas: 'E-postadress saknas på kortet. Inget skickat.',
  lankkontroll: 'Länkarna i mejlet kunde inte kontrolleras. Inget skickat.',
  mejl_misslyckades: 'Mejlet kunde inte skickas. Inget skickat.'
};
function paminnSvar(t, r, okText) {
  var text = r && r.ok ? okText + (r.testlage ? ' (testläge: mejlet gick till ' + r.till + ')' : '')
    : (PAMINN_SKAL[r && r.skal] || ('Inget skickat (' + ((r && r.skal) || 'okänt fel') + ').'));
  return t.alert({ message: text, duration: 8, display: r && r.ok ? 'success' : 'warning' });
}
function paminnKnapp(text, fn) {
  return { icon: MARK, text: text, condition: 'edit', callback: function (t) {
    return t.card('id').then(function (c) { return fn(c.id); }).then(function (r) { return paminnSvar(t, r.r, r.ok); })
      .catch(function () { return t.alert({ message: 'Det gick inte att nå servern. Inget skickat.', duration: 8, display: 'error' }); });
  } };
}
function paminnKortknappar(t) {
  return t.card('labels').then(function (c) {
    var har = (c.labels || []).some(function (l) { return l && l.name === PAMINN_ETIKETT; });
    if (!har) { return []; }
    return [
      paminnKnapp('Påminn med mejl', function (id) { return paminnGas('paminnSkicka', { cardId: id, kanal: 'mejl' }).then(function (r) { return { r: r, ok: 'Påminnelsen är skickad.' }; }); }),
      paminnKnapp('Påminn med sms', function (id) { return paminnGas('paminnSkicka', { cardId: id, kanal: 'sms' }).then(function (r) { return { r: r, ok: '' }; }); }),
      paminnKnapp('Ingen påminnelse', function (id) { return paminnGas('paminnIngen', { cardId: id }).then(function (r) { return { r: r, ok: 'Markerat: ingen påminnelse.' }; }); })
    ];
  }).catch(function () { return []; });
}

TrelloPowerUp.initialize({
  'card-buttons': function (t, opts) {
    var kurs = { icon: MARK, text: CFG.APP_NAME + ' – Kursöversikt', callback: openCourseFromCard, condition: 'edit' };
    return paminnKortknappar(t).then(function (extra) { return [kurs].concat(extra); });
  },

  // Inline-badge på kortet (under labels): Kursöversikt nås direkt här också.
  'card-detail-badges': function (t, opts) {
    return [
      { title: CFG.APP_NAME, text: 'Kursöversikt', color: 'sky', callback: openCourseFromCard },
    ];
  },

  // Board-knappar: Kursöversikt + Inställningar. icon {dark,light} = Vitalisera-emblemet, ej kugghjul.
  'board-buttons': function (t, opts) {
    return [
      { icon: { dark: MARK, light: MARK_WHITE }, text: CFG.APP_NAME + ' – Kursöversikt', callback: openCourseFromBoard, condition: 'edit' },
      { icon: { dark: MARK, light: MARK_WHITE }, text: CFG.APP_NAME + ' – Inställningar', callback: openSettings, condition: 'edit' },
    ];
  },
}, {
  // REST-klient: krävs för t.getRestApi() (Vy2 checklist-läsning, framtida mutationer).
  appKey: CFG.APP_KEY,
  appName: CFG.APP_NAME,
  appAuthor: CFG.APP_AUTHOR,
});
