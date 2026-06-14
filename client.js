/* global TrelloPowerUp, window */
/*
 * Connector-entrypoint. Registrerar capability-callbacks.
 *
 * Capabilities (måste även bockas i admin-portalen):
 *   - card-buttons        : EN knapp på kort → öppnar command-paletten
 *   - board-buttons       : EN knapp på board → öppnar command-paletten
 *   - card-detail-badges  : statusbadge på kortets baksida
 *
 * UX-beslut (Robert godkände autonomi): EN knapp som öppnar en t.popup-palett,
 * inte en knapp per automation. Paletten (popup.html) listar alla kommandon.
 */
'use strict';

var GRAY_ICON = './icons/bolt-gray.svg';
var WHITE_ICON = './icons/bolt-white.svg';

// Öppnar command-paletten som iframe-popup (url-form av t.popup).
function openPalette(t) {
  return t.popup({
    title: window.NYA_ZAPIER_CONFIG.APP_NAME + ' – kommandon',
    url: './popup.html',
    height: 240, // initial höjd; popup.js kallar t.sizeTo() vid behov
  });
}

TrelloPowerUp.initialize({
  // Kort-knapp: icon är en sträng-URL (Trello lägger till ?color=).
  'card-buttons': function (t, opts) {
    return [
      {
        icon: GRAY_ICON,
        text: window.NYA_ZAPIER_CONFIG.APP_NAME,
        callback: openPalette,
        condition: 'edit',
      },
    ];
  },

  // Board-knapp: icon är ett objekt {dark, light} för ljus/mörk bakgrund.
  'board-buttons': function (t, opts) {
    return [
      {
        icon: { dark: WHITE_ICON, light: GRAY_ICON },
        text: window.NYA_ZAPIER_CONFIG.APP_NAME,
        callback: openPalette,
        condition: 'edit',
      },
    ];
  },

  // Detalj-badge: visar att Power-Up:en är aktiv på kortet.
  'card-detail-badges': function (t, opts) {
    return [
      {
        title: window.NYA_ZAPIER_CONFIG.APP_NAME,
        text: 'Kommandon',
        color: 'blue',
        callback: openPalette,
      },
    ];
  },
});
