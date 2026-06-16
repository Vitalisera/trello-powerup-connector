/* global window */
/*
 * Delad konfiguration för connectorn (laddas i index.html).
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
  // ABSOLUT URL (ej relativ): board-/kort-knapparnas ikon renderas av Trello i trello.com-kontext →
  // en relativ './icons/...' 404:ar där (trasig bild). Absolut funkar både i Trello-chrome och i modalerna.
  MARK_URL: 'https://vitalisera.github.io/trello-powerup-connector/icons/vitalisera-mark.png',

  // ⚠️ FYLL I: Trello API-nyckel för REST-klienten (t.getRestApi).
  //   Genereras i https://trello.com/power-ups/admin → din Power-Up → fliken
  //   "API Key" → "Generate a new API Key". Nyckeln är PUBLIK (klient-app-nyckel,
  //   ej hemlig token) → ok att ligga här. Token hämtas per-användare via authorize().
  APP_KEY: 'cdc7127c27c4442723c2ef5108ee9388',
  APP_AUTHOR: 'Vitalisera',
};

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
// Rälsen täcker ALLA punkter i kortets "Administration"-checklista (Robert 2026-06-15), så varje
// steg motsvarar exakt ett kryss. checkItem = ORDAGRANT som i Trello (krävs för bock/status).
// triggerLabel sätts bara där en label faktiskt finns. Steg utan label = manuella (bara bock).
window.NYA_ZAPIER_FLOW = [
  // ── Anmälan & antagning ──
  { key: 'anmalan',  phase: 'Anmälan & antagning', title: 'Intresseanmälan',   desc: 'Anmälan inkommen via webbformulär', always: true, automation: 'V3 Ny intresseanmälan' },
  { key: 'tack',     phase: 'Anmälan & antagning', title: 'Tack för anmälan',  desc: 'Bekräftelsemejl till deltagaren', checkItem: 'Email-Tack för anmälan skickad', triggerLabel: 'Skicka tack för anmälan', automation: 'Skicka Tack för anmälan' },
  { key: 'antagen',  phase: 'Anmälan & antagning', title: 'Antagen till kurs', desc: '"Du har fått en plats"-mejl; labeln kryssar även checklistan', checkItem: 'Antagen till kurs', triggerLabel: 'Skicka mail - "Du har fått en plats"', automation: 'Skicka Du har fått en plats' },
  // ── Förberedelse inför kurs ──
  { key: 'avgift_faktura', phase: 'Förberedelse inför kurs', title: 'Anmälningsavgift – faktura', desc: 'Faktura för anmälningsavgift skickad (manuell bock)', checkItem: 'Faktura för anmälningsavgift skickad' },
  { key: 'avgift',         phase: 'Förberedelse inför kurs', title: 'Anmälningsavgift – betald',  desc: 'Avgiften betald (label + checklista, ingen automation)', checkItem: 'Anmälningsavgift betald', triggerLabel: 'Anm. avgift betald' },
  { key: 'praktisk',       phase: 'Förberedelse inför kurs', title: 'Praktisk info',             desc: 'Praktisk information skickad (manuell bock)', checkItem: 'Praktisk info skickat' },
  { key: 'steg1',          phase: 'Förberedelse inför kurs', title: 'Steg 1 – formulär',         desc: 'Label triggar nya-zapier som skickar formuläret och kryssar checklistan', checkItem: 'Fått formulär', triggerLabel: 'steg 1 - Skicka formulär till deltagare', automation: 'Steg 1 - Skicka formulär' },
  { key: 'hf_klart',       phase: 'Förberedelse inför kurs', title: 'Hälsoformulär klart',       desc: 'Deltagarens hälsoformulär ifyllt (manuell bock; ska autobockas framöver)', checkItem: 'Hälsoformulär klart' },
  { key: 'livs_klar',      phase: 'Förberedelse inför kurs', title: 'Livsberättelse klar',       desc: 'Deltagarens livsberättelse klar (manuell bock; ska autobockas framöver)', checkItem: 'Levnadsbeskrivning klar' },
  { key: 'hf_delad',       phase: 'Förberedelse inför kurs', title: 'Hälsoformulär → läkare',    desc: 'Bockas manuellt → nya-zapier skapar anonym kopia till läkaren', checkItem: 'Delat Hälsoformulär till läkare/kursledare', automation: 'Kopiera HF till läkare' },
  { key: 'livs_delad',     phase: 'Förberedelse inför kurs', title: 'Livsberättelse → kursledare', desc: 'Livsberättelse delad till kursledare (manuell bock; autobockas när Power-Up-funktionen finns)', checkItem: 'Delat Levnadsbeskrivning till kursledare' },
  // ── Slutbetalning & uppföljning ──
  { key: 'slut_faktura',   phase: 'Slutbetalning & uppföljning', title: 'Slutbetalning – faktura', desc: 'Faktura för slutbetalning skickad (manuell bock)', checkItem: 'Faktura för slutbetalning skickad' },
  { key: 'slut_betald',    phase: 'Slutbetalning & uppföljning', title: 'Slutbetalning – betald',  desc: 'Slutbetalning betald (label + checklista synkas; label-namn ej satt i config än)', checkItem: 'Faktura för slutbetalning betald' },
  { key: 'uppfoljning',    phase: 'Slutbetalning & uppföljning', title: 'Uppföljningssamtal',      desc: 'Uppföljningssamtal utfört (manuell bock; ev. automatiseras framöver)', checkItem: 'Uppföljningssamtal utfört' },
];
