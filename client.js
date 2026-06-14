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

// Knappikon = bara emblemet (skarpt vid ~20px; full logga blir oläslig så liten).
var MARK = window.NYA_ZAPIER_CONFIG.MARK_URL;
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
        icon: MARK,
        text: BTN_TEXT,
        callback: openPalette,
        condition: 'edit',
      },
    ];
  },

  // Board-knapp: icon är ett objekt {dark, light} för ljus/mörk bakgrund.
  // Emblemet är teal → samma bild på båda bakgrunderna.
  'board-buttons': function (t, opts) {
    return [
      {
        icon: { dark: MARK, light: MARK },
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
