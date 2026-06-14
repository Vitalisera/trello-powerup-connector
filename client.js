/* global TrelloPowerUp, window */
/*
 * Connector-entrypoint. Registrerar capability-callbacks + REST-klient (appKey).
 *
 * Capabilities (måste även bockas i admin-portalen):
 *   - card-back-section   : deltagar-dashboard (kompakt strip, öppnar fullvy)
 *   - card-buttons        : Deltagarstatus (dashboard) + Kursöversikt (denna kurs)
 *   - card-detail-badges  : status-badge → öppnar dashboard
 *   - board-buttons       : Kursöversikt (board-brett, list-väljare)
 *
 * Vyer: Vy1 deltagar-dashboard (card-back-section + modal), Vy2 kursöversikt
 * (modal, board-brett). appKey aktiverar t.getRestApi() för Vy2:s checklist-läsning.
 */
'use strict';

var CFG = window.NYA_ZAPIER_CONFIG;
var MARK = CFG.MARK_URL;

// ⚙️ ASSET-VERSION — bumpa vid varje deploy. Modal-/iframe-filer (course/dashboard)
// laddas on-demand och cachas annars av webbläsaren (GitHub Pages max-age=600);
// versions-query tvingar färska filer när client.js (board-nivå) laddats om.
var V = '24';
function vurl(p) { return p + (p.indexOf('?') === -1 ? '?' : '&') + 'v=' + V; }

function openDashboard(t) {
  return t.modal({ url: vurl('./dashboard.html'), fullscreen: true, title: CFG.APP_NAME + ' – Deltagarstatus', accentColor: '#08445c' });
}

// Kursöversikt för DENNA deltagares kurs (kortets lista).
function openCourseFromCard(t) {
  return t.card('idList').then(function (c) {
    return t.modal({
      url: vurl('./course.html'), fullscreen: true,
      title: CFG.APP_NAME + ' – Kursöversikt', accentColor: '#08445c',
      args: { listId: c.idList },
    });
  });
}

// Kursöversikt från board (list-väljare i vyn).
function openCourseFromBoard(t) {
  return t.modal({ url: vurl('./course.html'), fullscreen: true, title: CFG.APP_NAME + ' – Kursöversikt', accentColor: '#08445c' });
}

TrelloPowerUp.initialize({
  'card-back-section': function (t, opts) {
    return {
      title: CFG.APP_NAME + ' – Deltagarstatus',
      icon: MARK,
      content: { type: 'iframe', url: t.signUrl('./dashboard.html', { compact: '1', v: V }), height: 56 },
    };
  },

  'card-buttons': function (t, opts) {
    return [
      { icon: MARK, text: CFG.APP_NAME + ' – Deltagarstatus', callback: openDashboard, condition: 'edit' },
      { icon: MARK, text: CFG.APP_NAME + ' – Kursöversikt', callback: openCourseFromCard, condition: 'edit' },
    ];
  },

  // Inline-badges på kortet (under labels): båda vyerna nås direkt här också.
  'card-detail-badges': function (t, opts) {
    return [
      { title: CFG.APP_NAME, text: 'Deltagarstatus', color: 'blue', callback: openDashboard },
      { title: CFG.APP_NAME, text: 'Kursöversikt', color: 'sky', callback: openCourseFromCard },
    ];
  },

  // Board-knapp: icon {dark,light}. Board-brett → kursöversikt med list-väljare.
  'board-buttons': function (t, opts) {
    return [{ icon: { dark: MARK, light: MARK }, text: CFG.APP_NAME + ' – Kursöversikt', callback: openCourseFromBoard, condition: 'edit' }];
  },
}, {
  // REST-klient: krävs för t.getRestApi() (Vy2 checklist-läsning, framtida mutationer).
  appKey: CFG.APP_KEY,
  appName: CFG.APP_NAME,
  appAuthor: CFG.APP_AUTHOR,
});
