/**
 * Sjömässan 2028 – mottagare för intresseanmälningar.
 * Tar emot POST från sajtens formulär, loggar i Google Sheetet och
 * mejlar en avisering till kontot som äger skriptet.
 *
 * INSTALLATION (görs i Google Sheetet "Sjömässan 2028 – Intresseanmälningar"):
 *   1. Öppna arket → Tillägg → Apps Script.
 *   2. Klistra in hela denna fil i Code.gs, spara.
 *   3. Distribuera → Ny distribution → typ "Webbapp".
 *        - Kör som: Mig
 *        - Vem har åtkomst: Alla
 *   4. Kopiera webbappens URL (slutar på /exec) och ge den till Claude,
 *      som fyller i VZ_ENDPOINT i sajtens index.html och deployar.
 */
function doPost(e) {
  var data = {};
  try { data = JSON.parse(e.postData.contents); } catch (err) { data = e.parameter || {}; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Tid', 'Roll', 'Namn', 'E-post', 'Meddelande', 'Källa']);
  }
  sh.appendRow([new Date(), data.roll || '', data.namn || '', data.epost || '',
                data.meddelande || '', (data.kalla || '') + ' ' + (data.sida || '')]);

  // Avisering till kontot som äger skriptet – byt till annan adress vid behov.
  var till = Session.getEffectiveUser().getEmail();
  if (till) {
    MailApp.sendEmail(till,
      'Sjömässan 2028 – ny intresseanmälan (' + (data.roll || 'okänd roll') + ')',
      'Namn: ' + (data.namn || '-') +
      '\nE-post: ' + (data.epost || '-') +
      '\nRoll: ' + (data.roll || '-') +
      '\nMeddelande: ' + (data.meddelande || '-') +
      '\nKälla: ' + (data.kalla || '-') +
      '\n\nAlla anmälningar: ' + ss.getUrl());
  }
  return ContentService.createTextOutput('ok');
}
