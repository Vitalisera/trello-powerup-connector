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
var V = '99';
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

// Inställningar (kugghjul) — konfig som annars vore hårdkodad (läkar-mejl, test-läge…).
function openSettings(t) {
  return resolveTestSuffix(t).then(function (suf) {
    return t.modal({ url: vurl('./settings.html'), fullscreen: true, title: CFG.APP_NAME + ' – Inställningar' + suf, accentColor: '#08445c' });
  });
}

TrelloPowerUp.initialize({
  'card-buttons': function (t, opts) {
    return [
      { icon: MARK, text: CFG.APP_NAME + ' – Kursöversikt', callback: openCourseFromCard, condition: 'edit' },
    ];
  },

  // Inline-badge på kortet (under labels): Kursöversikt nås direkt här också.
  'card-detail-badges': function (t, opts) {
    return [
      { title: CFG.APP_NAME, text: 'Kursöversikt', color: 'sky', callback: openCourseFromCard },
    ];
  },

  // Board-knappar: Kursöversikt + Inställningar (kugghjul). icon {dark,light}.
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
