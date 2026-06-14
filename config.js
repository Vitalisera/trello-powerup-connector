/* global window */
/*
 * Delad konfiguration för connectorn (laddas i både index.html och popup.html).
 *
 * ⚠️ FYLL I: GAS_URL — URL:en till din GAS-webapp-deployment (doPost).
 *    Hämtas i Apps Script: Deploy → New deployment → Web app → "Web app URL".
 *    Måste sluta på /exec. Lämna kvar /exec, inte /dev.
 *
 * INGA hemligheter här. Token/Trello-API-nyckel bor SERVER-SIDE i GAS.
 * Connectorn vet bara vart den ska POST:a.
 */
window.NYA_ZAPIER_CONFIG = {
  // Live-deployment (skapad + verifierad 2026-06-14, konto robert.kraft@vitalisera.se)
  // Redeploya: cd gas && npx @google/clasp push && npx @google/clasp create-deployment
  GAS_URL: 'https://script.google.com/macros/s/AKfycbx9d_D8Z0AMA8klYgOq3N9VBMu4Ed_N8oc5jhaRzvF1moF8w9Bmt86Dgf6RGNGO0oF96g/exec',

  // Visningsnamn i UI
  APP_NAME: 'nya-zapier',
};

/*
 * Command-palette-registret.
 *
 * Varje kommando = en rad i popup-menyn. Tre typer demonstreras:
 *   - 'alert'  : ren klient-stub (t.alert), rör aldrig GAS. Bevisar capability-wiring.
 *   - 'gas'    : POST:ar {action} till GAS doPost och visar svaret. Bevisar kedjan.
 *   - 'gasCard': läser kortkontext (t.card) och skickar med den till GAS.
 *
 * Lägg till nya automationer genom att lägga till ett objekt här – ingen knapp
 * per automation behövs, allt samlas i paletten.
 */
window.NYA_ZAPIER_COMMANDS = [
  {
    id: 'hello',
    text: '👋 Hej (klient-test)',
    type: 'alert',
    message: 'Power-Up:en lever! Detta är en ren klient-stub utan GAS-anrop.',
  },
  {
    id: 'ping',
    text: '📡 Ping GAS (echo)',
    type: 'gas',
    action: 'ping',
    // payload byggs i popup.js; GAS svarar med pong + ekat payload
  },
  {
    id: 'card-info',
    text: '🃏 Skicka kortinfo till GAS',
    type: 'gasCard',
    action: 'echo',
  },
];
