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

var LOGO = window.NYA_ZAPIER_CONFIG.LOGO_URL;
var BTN_TEXT = window.NYA_ZAPIER_CONFIG.BUTTON_TEXT;

// Öppnar command-paletten som iframe-popup (url-form av t.popup).
function openPalette(t) {
  return t.popup({
    title: window.NYA_ZAPIER_CONFIG.APP_NAME + ' – Kommandon',
    url: './popup.html',
    height: 220, // initial höjd; popup.js kallar t.sizeTo() vid behov
  });
}

TrelloPowerUp.initialize({
  // Kort-knapp: icon är en sträng-URL (Trello lägger till ?color=).
  'card-buttons': function (t, opts) {
    return [
      {
        icon: LOGO,
        text: BTN_TEXT,
        callback: openPalette,
        condition: 'edit',
      },
    ];
  },

  // Board-knapp: icon är ett objekt {dark, light} för ljus/mörk bakgrund.
  // Logo:n är fullfärg → samma bild på båda bakgrunderna.
  'board-buttons': function (t, opts) {
    return [
      {
        icon: { dark: LOGO, light: LOGO },
        text: BTN_TEXT,
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
