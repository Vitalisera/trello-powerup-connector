/* global TrelloPowerUp, window */
/*
 * Connector-entrypoint. Registrerar capability-callbacks.
 *
 * Capabilities (måste även bockas i admin-portalen):
 *   - card-back-section   : deltagar-dashboard (kompakt strip, öppnar fullvy)
 *   - card-buttons        : knapp på kort → öppnar dashboard (t.modal fullskärm)
 *   - card-detail-badges  : status-badge → öppnar dashboard
 *   - board-buttons       : knapp på board → command-palett (board saknar kort)
 *
 * Visionen: en flödesorienterad deltagar-dashboard (status ur labels+checklista
 * +automationer). Dashboarden bor i card-back-section + t.modal (rymliga ytor);
 * kommandopaletten (popup) blir snabbåtgärder.
 */
'use strict';

var CFG = window.NYA_ZAPIER_CONFIG;
var MARK = CFG.MARK_URL;
var BTN_TEXT = CFG.BUTTON_TEXT;

// Öppnar deltagar-dashboarden som fullskärms-modal.
function openDashboard(t) {
  return t.modal({
    url: './dashboard.html',
    fullscreen: true,
    title: CFG.APP_NAME + ' – Deltagarstatus',
    accentColor: '#08445c',
  });
}

// Öppnar command-paletten (snabbåtgärder) som popup.
function openPalette(t) {
  return t.popup({
    title: CFG.APP_NAME + ' – Kommandon',
    url: './popup.html',
    height: 220,
  });
}

TrelloPowerUp.initialize({
  // Alltid synlig dashboard-strip inne på kortet (ovanför bilagor).
  'card-back-section': function (t, opts) {
    return {
      title: CFG.APP_NAME + ' – Deltagarstatus',
      icon: MARK,
      content: {
        type: 'iframe',
        url: t.signUrl('./dashboard.html', { compact: '1' }),
        height: 56,
      },
    };
  },

  // Kort-knapp → öppna fullvy-dashboarden. icon = sträng-URL (emblemet).
  'card-buttons': function (t, opts) {
    return [{ icon: MARK, text: BTN_TEXT, callback: openDashboard, condition: 'edit' }];
  },

  // Detalj-badge → öppna dashboarden.
  'card-detail-badges': function (t, opts) {
    return [{ title: CFG.APP_NAME, text: 'Status', color: 'blue', callback: openDashboard }];
  },

  // Board-knapp: icon {dark,light}. Board saknar kortkontext → command-palett.
  'board-buttons': function (t, opts) {
    return [{ icon: { dark: MARK, light: MARK }, text: BTN_TEXT, callback: openPalette, condition: 'edit' }];
  },
});
