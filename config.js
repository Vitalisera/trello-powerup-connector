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
  APP_NAME: 'Vitalisera',
  BUTTON_TEXT: 'Vitalisera Kommandon',

  // Full Vitalisera-logga (emblem + ordmärke) — för ytor med gott om plats.
  LOGO_URL: 'https://mcusercontent.com/415e930e2acb057a5ad12bd07/images/937b7fc2-3389-49b4-8e98-43c261ce33a0.png',
  // Bara emblemet (utan ordmärke) — skarpt i pyttesmå ytor som Trellos knappikon.
  MARK_URL: './icons/vitalisera-mark.png',

  // ⚠️ FYLL I: Trello API-nyckel för REST-klienten (t.getRestApi).
  //   Genereras i https://trello.com/power-ups/admin → din Power-Up → fliken
  //   "API Key" → "Generate a new API Key". Nyckeln är PUBLIK (klient-app-nyckel,
  //   ej hemlig token) → ok att ligga här. Token hämtas per-användare via authorize().
  APP_KEY: 'REPLACE_WITH_TRELLO_APP_KEY',
  APP_AUTHOR: 'Vitalisera',
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
/*
 * FLÖDESMODELL (deltagarresan) — härledd ur datan 2026-06-14:
 *   - status-källa = kortets "Administration"-checklista (hård "klar"-markör)
 *   - labels i nya-zapier är TRIGGERS (lägg label → kör action), inte status —
 *     en label som finns = steget är initierat/på gång
 *   - varje steg pekar på automationen som driver det
 *
 * Status härleds i dashboard.js:
 *   always:true            → klar
 *   checkItem bockad        → klar
 *   annars triggerLabel finns → 'igång'
 *   annars                   → 'väntar'
 *
 * ⚠️ UTKAST att granska mot Bertil-kortet — justera fritt.
 */
window.NYA_ZAPIER_FLOW = [
  { key: 'anmalan',  phase: 'Anmälan & antagning', title: 'Intresseanmälan',        desc: 'Anmälan inkommen via webbformulär',          always: true,                         automation: 'V3 Ny intresseanmälan' },
  { key: 'tack',     phase: 'Anmälan & antagning', title: 'Tack för anmälan',       desc: 'Bekräftelsemejl till deltagaren',            checkItem: 'Email-Tack för anmälan skickad', triggerLabel: 'Skicka tack för anmälan', automation: 'Skicka Tack för anmälan' },
  { key: 'intervju', phase: 'Anmälan & antagning', title: 'Intervju',               desc: 'Intervju med deltagaren utförd',             checkItem: 'Intervju utförd' },
  { key: 'antagen',  phase: 'Anmälan & antagning', title: 'Antagen till kurs',      desc: '"Du har fått en plats"-mejl skickat',        checkItem: 'Antagen till kurs', triggerLabel: 'Skicka mail - "Du har fått en plats"', automation: 'Skicka Du har fått en plats' },
  { key: 'avgift',   phase: 'Förberedelse inför kurs', title: 'Anmälningsavgift',   desc: 'Faktura skickad och avgift betald',          checkItem: 'Anmälningsavgift betald', triggerLabel: 'Anm. avgift betald', automation: 'Kryssa anm avgift 1' },
  { key: 'praktisk', phase: 'Förberedelse inför kurs', title: 'Praktisk info',      desc: 'Praktisk information skickad',                checkItem: 'Praktisk info skickat' },
  { key: 'steg1',    phase: 'Förberedelse inför kurs', title: 'Steg 1 – formulär',  desc: 'Deltagarformulär skapat och skickat',        triggerLabel: 'steg 1 - Skicka formulär till deltagare', automation: 'Steg 1 - Skicka formulär' },
  { key: 'hf',       phase: 'Förberedelse inför kurs', title: 'Hälsoformulär → läkare', desc: 'HF delat till läkare/kursledare',        checkItem: 'Delat Hälsoformulär till läkare/kursledare', automation: 'Kopiera HF till läkare' },
];

window.NYA_ZAPIER_COMMANDS = [
  {
    id: 'hello',
    icon: '👋',
    title: 'Hej',
    desc: 'Klient-test — visar en notis i Trello',
    type: 'alert',
    message: 'Power-Up:en lever! Detta är en ren klient-stub utan GAS-anrop.',
  },
  {
    id: 'ping',
    icon: '📡',
    title: 'Ping GAS',
    desc: 'Testa anslutningen till servern',
    type: 'gas',
    action: 'ping',
    // payload byggs i popup.js; GAS svarar med pong + ekat payload
  },
  {
    id: 'card-info',
    icon: '🃏',
    title: 'Skicka kortinfo',
    desc: 'Skicka kortets data till GAS',
    type: 'gasCard',
    action: 'echo',
  },
];
