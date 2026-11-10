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
  // VIT emblem-version — för board-knappens `light`-slot (Trello visar den på MÖRK bakgrund, t.ex. en
  // färgad board-header). Mörka marken var osynlig mot magenta-headern (Robert 2026-06-16).
  MARK_WHITE_URL: 'https://vitalisera.github.io/trello-powerup-connector/icons/vitalisera-mark-white.png',

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
  { key: 'avgift',         phase: 'Förberedelse inför kurs', title: 'Anmälningsavgift – betald',  desc: 'Avgiften betald (label + checklista, ingen automation)', checkItem: 'Anmälningsavgift betald', triggerLabel: 'Anm. avgift betald', implies: ['avgift_faktura'] }, // #15: betald ⇒ faktura var skickad
  { key: 'praktisk',       phase: 'Förberedelse inför kurs', title: 'Praktisk info',             desc: 'Praktisk information skickad (manuell bock)', checkItem: 'Praktisk info skickat' },
  { key: 'steg1',          phase: 'Förberedelse inför kurs', title: 'Steg 1 – formulär',         desc: 'Label triggar nya-zapier som skickar formuläret och kryssar checklistan', checkItem: 'Fått formulär', triggerLabel: 'steg 1 - Skicka formulär till deltagare', automation: 'Steg 1 - Skicka formulär' },
  { key: 'hf_klart',       phase: 'Förberedelse inför kurs', title: 'Hälsoformulär klart',       desc: 'Deltagarens hälsoformulär ifyllt (manuell bock; ska autobockas framöver)', checkItem: 'Hälsoformulär klart' },
  { key: 'livs_klar',      phase: 'Förberedelse inför kurs', title: 'Livsberättelse klar',       desc: 'Deltagarens livsberättelse klar (manuell bock; ska autobockas framöver)', checkItem: 'Levnadsbeskrivning klar' },
  { key: 'hf_delad',       phase: 'Förberedelse inför kurs', title: 'Hälsoformulär → läkare',    desc: 'Bockas manuellt → nya-zapier skapar anonym kopia till läkaren', checkItem: 'Delat Hälsoformulär till läkare/kursledare', automation: 'Kopiera HF till läkare' },
  { key: 'livs_delad',     phase: 'Förberedelse inför kurs', title: 'Livsberättelse → kursledare', desc: 'Livsberättelse delad till kursledare (manuell bock; autobockas när Power-Up-funktionen finns)', checkItem: 'Delat Levnadsbeskrivning till kursledare' },
  // ── Slutbetalning & uppföljning ──
  { key: 'slut_faktura',   phase: 'Slutbetalning & uppföljning', title: 'Slutbetalning – faktura', desc: 'Faktura för slutbetalning skickad (manuell bock)', checkItem: 'Faktura för slutbetalning skickad' },
  { key: 'slut_betald',    phase: 'Slutbetalning & uppföljning', title: 'Slutbetalning – betald',  desc: 'Slutbetalning betald (label + checklista synkas; label-namn ej satt i config än)', checkItem: 'Faktura för slutbetalning betald', implies: ['slut_faktura', 'avgift', 'avgift_faktura'] }, // #15: slutbetalning betald ⇒ faktura skickad + avgifts-stegen ej längre aktuella
  { key: 'uppfoljning',    phase: 'Slutbetalning & uppföljning', title: 'Uppföljningssamtal',      desc: 'Uppföljningssamtal utfört (manuell bock; ev. automatiseras framöver)', checkItem: 'Uppföljningssamtal utfört' },
];

// Default-mallar för gruppledar-mejlen — DELAD källa (course.js genererar, settings.js förifyller rutorna).
// Tokens: {ANTAL} {TILLDELNING} {GRUPPLEDARE} {DELTAGARE} {SAMMANFATTNINGSLÄNK} {DOKTYP}/{DOKTYP_BEST}
// ({DOKTYP}=dok-typ i plural, steg-medveten: livsberättelser/nulägesbeskrivningar/formulär). Signatur ingår; inget
// värdeomdöme om gruppstorlek. {GRUPPLEDARE}/{DELTAGARE} fylls per gruppledare vid utskick;
// {SAMMANFATTNINGSLÄNK} fylls av "Skapa sammanfattningsdok"-knappen.
window.NYA_ZAPIER_TPL = {
  livsAlla:
    'Hej på Er!\n\n'
    + 'Idag är sista inlämningsdag för deltagare att lämna in sina {DOKTYP}. Några är klara, och andra inte. Men jag tänker att jag ger er länkarna till dem oavsett idag, så ni får lite tid på er att börja läsa.\n\n'
    + 'Vi är {ANTAL} denna gång. Vi hoppas kanske på någon till innan kursen startar.\n\n'
    + 'Jag delar upp {DOKTYP_BEST} enligt följande, och skickar länkarna till er enskilt:\n\n'
    + '{TILLDELNING}\n\n'
    + 'Varma hälsningar\nMalin',
  livsEnskild:
    'Hej {GRUPPLEDARE}!\n\n'
    + 'Här kommer länkarna till formulären som du har fått i uppdrag att läsa:\n\n'
    + '{DELTAGARE}\n\n'
    + 'Kram\nMalin',
  uppfoljning:
    'Hej Alla!\n\n'
    + 'Tack för en väldigt fin vecka!\n\n'
    + 'Det är nu dags för uppföljningssamtal. Jag har delat upp deltagarna enligt följande:\n\n'
    + '{TILLDELNING}\n\n'
    + 'Här är länken till dokumentet där ni skriver en sammanfattning:\n{SAMMANFATTNINGSLÄNK}\n\n'
    + 'Försök gärna att hålla tidsspannet att de ska få ett samtal inom cirka tio dagar.\n\n'
    + 'Önskar er en fin helg ❤️\nMalin',
  uppfoljningB:
    'Hej!\n\n'
    + 'Hoppas ni har haft en fin vecka 🌞\n\n'
    + 'Jag har gjort en uppdelning för uppföljningssamtal enligt nedan, och lägger länken till dokumentet där ni skriver in en liten sammanfattning av samtalet.\n\n'
    + '{TILLDELNING}\n\n'
    + 'Länk till uppföljningssamtalen: {SAMMANFATTNINGSLÄNK}\n\n'
    + 'Försök gärna att få till samtalen inom två veckor.\n\n'
    + 'Kram och ha en fin helg!\nMalin',
  // Enskilt kontaktmejl per gruppledare (#10). Tokens: {GRUPPLEDARE}, {DELTAGARKONTAKTER} (namn/tel/epost-block
  // per tilldelad deltagare, fylls vid utskick), {SAMMANFATTNINGSLÄNK}.
  uppfoljningEnskild:
    'Hej {GRUPPLEDARE}!\n\n'
    + 'Här är kontaktuppgifterna till deltagarna du har uppföljningssamtal med:\n\n'
    + '{DELTAGARKONTAKTER}\n\n'
    + 'Här är länken till dokumentet där du skriver en kort sammanfattning:\n{SAMMANFATTNINGSLÄNK}\n\n'
    + 'Kram\nMalin',
  // Matallergi-mejlet till kocken. Tokens: {HÄLSNING} (Hej <kock>, / Hej!), {ANTAL_DELTAGARE}, {ANTAL_PERSONAL},
  // {DELTAGARE} (allergi-sammanställning ur hälsoformulären), {PERSONAL} (personalens allergier).
  kock:
    '{HÄLSNING}\n\n'
    + 'Här kommer en sammanställning av matallergierna inför kursen.\n\n'
    + 'Som det ser ut just nu är det {ANTAL_DELTAGARE} deltagare och {ANTAL_PERSONAL} personal (inklusive dig).\n\n'
    + 'Deltagare (kopierat från hälsoformuläret):\n{DELTAGARE}\n\n'
    + 'Personal:\n{PERSONAL}\n\n'
    + 'Jag återkommer om det blir ändring i antal eller om någon ny allergi dyker upp.',
};

/* ── Delade kursdatum-hjälpare (EN källa, används av course.js OCH settings.js) ────────────────
 * Låg 2026-08-29 i course.js, men Inställningar behöver samma logik för att kunna lista kurserna
 * i läkaradress-fältet — och settings.html laddar inte course.js. Duplicering hade varit exakt den
 * literal-läcka spårbarhetsrutinen finns för att förhindra, så koden bor här och course.js läser
 * härifrån. Ändra ALDRIG kursdatum-tolkning på två ställen.
 *
 * courseStartDate: "24 juni - 2 juli 2026 (Steg 1)" → Date(2026-06-24). Kompakt samma-månad-intervall
 *   ("22-30 juli 2026") tar FÖRSTA talet som startdag (buggfix Robert 2026-06-21 — annars blev
 *   slutdagen startdag).
 * courseEndDate: sista dag-månad-paret i namnet. Årskorsande intervall ("28 december 2025 -
 *   4 januari 2026") ger slutåret +1 när slutmånaden är före startmånaden.
 * Båda är RENA funktioner → proof-bara utan Trello. */
/* Uppföljningssamtalen ska hållas inom detta antal dagar efter kursslut.
 *
 * Normen fanns bara som TEXT i mejlmallarna ("inom cirka tio dagar") — Robert påpekade 2026-08-29 att
 * vi redan har en tidsgräns att pröva utskicken mot. Nu bor den här, så varningen om fel skede och
 * mallarnas formulering utgår från samma tal i stället för att glida isär.
 * ⚠️ Ändrar du talet: uppdatera även mall-texterna i NYA_ZAPIER_TPL (uppfoljning / uppfoljningB). */
window.NYA_ZAPIER_FOLLOWUP_WINDOW_DAYS = 10;

window.NYA_ZAPIER_DATE = (function () {
  var MONTHS = { januari: 0, februari: 1, mars: 2, april: 3, maj: 4, juni: 5, juli: 6, augusti: 7, september: 8, oktober: 9, november: 10, december: 11 };
  function norm(s) { return String(s || '').trim().toLowerCase(); }
  function courseStartDate(listName) {
    var s = String(listName || '');
    var rng = s.match(/(\d{1,2})\s*[-–]\s*\d{1,2}\s+([a-zåäö]+).*?(\d{4})/i);
    if (rng && MONTHS[norm(rng[2])] !== undefined) { return new Date(parseInt(rng[3], 10), MONTHS[norm(rng[2])], parseInt(rng[1], 10)); }
    var m = s.match(/(\d{1,2})\s+([a-zåäö]+).*?(\d{4})/i);
    if (!m) { return null; }
    var mon = MONTHS[norm(m[2])];
    if (mon === undefined) { return null; }
    return new Date(parseInt(m[3], 10), mon, parseInt(m[1], 10));
  }
  function courseEndDate(listName) {
    var s = String(listName || '');
    var ym = s.match(/(\d{4})/); if (!ym) { return null; }
    var year = parseInt(ym[1], 10);
    var dm = [], re = /(\d{1,2})\s+([a-zåäö]+)/gi, m;
    while ((m = re.exec(s))) { var mon = MONTHS[norm(m[2])]; if (mon !== undefined) { dm.push({ d: parseInt(m[1], 10), mon: mon }); } }
    if (!dm.length) { return null; }
    var first = dm[0], last = dm[dm.length - 1];
    var endYear = (last.mon < first.mon) ? year + 1 : year;
    return new Date(endYear, last.mon, last.d);
  }
  /* Kurslistor som fortfarande behöver en läkaradress: allt framåt i tiden, plus kurser vars SLUT
   * ligger högst `backDays` dagar bakåt.
   *
   * 🔴 SLUT, inte start. nya-zapier behåller läkarmappen i 30 dagar efter kursslut och slår upp
   * adressen för varje mapp som ännu inte gallrats. En kurs som startade för länge sedan men slutade
   * i förrgår MÅSTE alltså finnas med — filtrerar man på startdatum tappas den, och deras svep får
   * "ingen adress" och stannar. Default 45 dagar = marginal mot deras 30.
   *
   * Odaterade listor (som inte är kurser) faller bort. `today` är en PARAMETER så testerna inte blir
   * tidsberoende. Ren funktion. */
  function needsDoctorEmail(listName, today, backDays) {
    var end = courseEndDate(listName);
    if (!end) { return false; }
    var days = Math.round((today.getTime() - end.getTime()) / 86400000);
    return days <= (backDays === undefined ? 45 : backDays);
  }
  return {
    MONTHS: MONTHS, norm: norm,
    courseStartDate: courseStartDate, courseEndDate: courseEndDate,
    needsDoctorEmail: needsDoctorEmail,
  };
})();

/* ── Läkaradress PER KURS (vz_settings.doctorEmailByCourse) ───────────────────────────────────
 * EN källa för hela kontraktet: Inställningar bygger sina rader här, och "Dela mapp till läkare"
 * slår upp adressen här. Två implementationer av samma uppslag vore precis det fel som orsakade
 * läckan 22 augusti 2026.
 *
 * 🔴 BAKGRUNDEN, läs innan du ändrar något: koden hade tidigare EN global läkaradress med
 * per-kurs-uppslag som föll tillbaka på den globala när kursen saknades. Augustikursen saknades.
 * Den globala pekade på en KURSDELTAGARE. Mappen med fyra deltagares hälsoformulär delades till
 * henne. Därför: INGEN FALLBACK. Saknas kursens adress ska flödet STANNA, aldrig gissa.
 *
 * Nyckeln är Trello-listans namn EXAKT (bekräftat mot nya-zapiers kod 2026-08-29: läkarmappen heter
 * 'HF till läkare - ' + listnamn, och deras svep skalar av just det prefixet). Vi trimmar vid
 * sparning, de trimmar vid uppslag — båda sidor, så kontraktet inte förutsätter att detta UI är
 * enda skrivaren. */
window.NYA_ZAPIER_DOCTOR = (function () {
  function trim(v) { return String(v == null ? '' : v).trim(); }

  /* Adressen för en kurs. Speglar nya-zapiers doctorEmailFromSettings_: trimmad nyckeljämförelse,
   * INGEN fallback till någon global adress. '' = ingen adress satt → anroparen ska stanna. */
  function lookup(settings, courseName) {
    var by = (settings && settings.doctorEmailByCourse) || {};
    var want = trim(courseName);
    if (!want) { return ''; }                      // tomt kursnamn får ALDRIG plocka en slumpvis nyckel
    var keys = Object.keys(by);
    for (var i = 0; i < keys.length; i++) {
      if (trim(keys[i]) === want) { return trim(by[keys[i]]); }
    }
    return '';
  }

  /* Raderna som Inställningar ska visa.
   *
   * 🔴 UNIONEN ÄR POÄNGEN: fönstrets kurslistor PLUS varje redan sparad nyckel. Panelen sparar hela
   * objektet på en gång, så en sparad adress som INTE renderas skulle raderas tyst första gången
   * Malin rör ett fält. Det gäller särskilt en kurs som döpts om i Trello: mappen bär kvar det gamla
   * namnet, alltså är den gamla nyckeln fortfarande den nya-zapier letar efter — den får inte
   * försvinna bara för att den inte längre matchar någon lista.
   *
   * En sparad nyckel utan matchande kurslista märks `orphan:true` → UI:t varnar om möjligt namnbyte.
   * @returns {Array<{course:string, email:string, orphan:boolean}>} kommande kurser först
   */
  function buildRows(listNames, settings, today, backDays) {
    var D = window.NYA_ZAPIER_DATE;
    var by = (settings && settings.doctorEmailByCourse) || {};
    var rows = [], seen = {};
    (listNames || []).forEach(function (n) {
      var name = trim(n);
      if (!name || seen[name] || !D.needsDoctorEmail(name, today, backDays)) { return; }
      seen[name] = true;
      rows.push({ course: name, email: lookup(settings, name), orphan: false });
    });
    Object.keys(by).forEach(function (k) {
      var name = trim(k);
      if (!name || seen[name]) { return; }
      seen[name] = true;
      rows.push({ course: name, email: trim(by[k]), orphan: true });
    });
    rows.sort(function (a, b) {
      if (a.orphan !== b.orphan) { return a.orphan ? 1 : -1; }      // föräldralösa sist
      var da = D.courseEndDate(a.course), db = D.courseEndDate(b.course);
      if (!da || !db) { return 0; }
      return db.getTime() - da.getTime();                            // senaste slut först
    });
    return rows;
  }

  /* Rader → objektet som sparas. Trimmade nycklar, BARA ifyllda adresser: ett tömt fält betyder
   * "ta bort adressen för den kursen", vilket är den enda raderingsvägen (ingen separat knapp). */
  function toSaved(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      var c = trim(r && r.course), e = trim(r && r.email);
      if (c && e) { out[c] = e; }
    });
    return out;
  }

  /* Sätt/ta bort EN kurs adress i ett befintligt settings-objekt, utan att röra något annat.
   *
   * 🔴 Finns för att HF-panelen i Kursöversikten också ska kunna sätta adressen (Robert 2026-08-29:
   * det är där Malin faktiskt jobbar med läkarmappen). Panelen delar `vz_settings` med Inställningar,
   * och det objektet bär ALLT — mejlmallar, testläge, adminadress, avsändare. En panel som skriver
   * `{doctorEmailByCourse: {...}}` rakt av skulle radera resten. Därför kopieras hela objektet och
   * bara den ena nyckeln ändras.
   *
   * Tom adress = ta bort posten (samma regel som i Inställningar). Nyckeln trimmas, som överallt.
   * Ren funktion → anroparen ansvarar för att LÄSA färskt före och skriva direkt efter, så fönstret
   * för en samtidig skrivning från Inställningar blir så kort som möjligt.
   * @returns {Object} NYTT settings-objekt (indata muteras aldrig)
   */
  function withCourseEmail(settings, courseName, email) {
    var out = {}, src = settings || {};
    Object.keys(src).forEach(function (k) { out[k] = src[k]; });
    var by = {}, prev = src.doctorEmailByCourse || {};
    Object.keys(prev).forEach(function (k) { by[k] = prev[k]; });
    var course = trim(courseName), addr = trim(email);
    if (!course) { return out; }                       // utan kurs vet vi inte vad vi skulle ändra
    Object.keys(by).forEach(function (k) { if (trim(k) === course) { delete by[k]; } });
    if (addr) { by[course] = addr; }
    out.doctorEmailByCourse = by;
    return out;
  }

  /* Tidigare använda läkaradresser, härledda ur de adresser som redan är satta (Robert 2026-08-29:
   * "slipper skriva in den varje gång för hand med risk för felskrivningar").
   *
   * Det är SÄKERHET, inte bekvämlighet. En felskriven adress delar hälsoformulär till fel person —
   * exakt vad som hände 22 augusti 2026. Att välja i stället för att skriva tar bort hela felklassen
   * för återkommande läkare.
   *
   * Härledd, inte lagrad: ingen separat historik-nyckel som kan bli inaktuell eller äta av board-
   * lagringens 8192-teckenbudget. Källan är doctorEmailByCourse, som ändå bevarar alla nycklar.
   *
   * Skiftlägesokänslig dedup — 'Lakare@VC.se' och 'lakare@vc.se' är samma brevlåda och ska inte ge två
   * rader i listan. Den form som senast användes vinner som visningsform.
   * Sorterad med senast använda kurs först, så den mest sannolika ligger överst.
   * @returns {Array<{email:string, courses:string[], label:string}>}
   */
  function knownEmails(settings) {
    var D = window.NYA_ZAPIER_DATE;
    var by = (settings && settings.doctorEmailByCourse) || {};
    var acc = {};
    Object.keys(by).forEach(function (k) {
      var email = trim(by[k]), course = trim(k);
      if (!email || !course) { return; }
      var id = email.toLowerCase();
      if (!acc[id]) { acc[id] = { email: email, courses: [], newest: null }; }
      acc[id].email = email;                                  // senaste stavningen vinner
      acc[id].courses.push(course);
      var end = D.courseEndDate(course);
      if (end && (!acc[id].newest || end.getTime() > acc[id].newest.getTime())) { acc[id].newest = end; }
    });
    return Object.keys(acc).map(function (id) { return acc[id]; })
      .sort(function (a, b) {
        if (a.newest && b.newest) { return b.newest.getTime() - a.newest.getTime(); }
        if (a.newest) { return -1; }
        if (b.newest) { return 1; }
        return 0;
      })
      .map(function (e) {
        return {
          email: e.email, courses: e.courses,
          label: e.courses.length === 1 ? ('användes för ' + e.courses[0]) : ('användes för ' + e.courses.length + ' kurser'),
        };
      });
  }

  return { lookup: lookup, buildRows: buildRows, toSaved: toSaved, withCourseEmail: withCourseEmail, knownEmails: knownEmails };
})();

/* Bokföringsraden (betalstatus): EN ren funktion som både Kursöversikten och Obetalda fakturor använder.
 * rad(sieHamtad, sieSenast, nuMs) -> { text, varning }. varning är '' eller en gul varningstext.
 * Varning när sieHamtad saknas, inte går att tolka, eller är ÄLDRE än 26 timmar (exakt 26 h varnar inte). Tid visas som svensk tid. */
window.NYA_ZAPIER_BOKF = (function () {
  var GRANS_MS = 26 * 3600 * 1000;
  var MAN = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];
  function tid(ms) {
    try {
      var p = {};
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      return parseInt(p.day, 10) + ' ' + MAN[parseInt(p.month, 10) - 1] + ' ' + p.hour + ':' + p.minute;
    } catch (e) { return 'okänd tid'; }
  }
  function datum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (parseInt(m[3], 10) + ' ' + MAN[parseInt(m[2], 10) - 1]) : 'okänd';
  }
  function rad(sieHamtad, sieSenast, nuMs) {
    var ms = Date.parse(sieHamtad || '');
    var nu = typeof nuMs === 'number' ? nuMs : Date.now();
    var ok = !isNaN(ms);
    return {
      text: 'Bokföringen hämtad ' + (ok ? tid(ms) : 'okänd tid') + ', senaste inbetalning i bokföringen ' + datum(sieSenast),
      varning: (!ok || (nu - ms) > GRANS_MS) ? ('Bokföringen är inte hämtad sedan ' + (ok ? tid(ms) : 'okänd tid') + '. Statusen kan vara fel.') : ''
    };
  }
  function tidIso(iso) { var ms = Date.parse(iso || ''); return isNaN(ms) ? 'okänd tid' : tid(ms); }
  return { rad: rad, GRANS_MS: GRANS_MS, tidIso: tidIso };
})();

/* Fakturadetaljen under en betalcell (Kursöversikten) eller en fakturarad (Obetalda fakturor): EN delad renderare så att de två vyerna
 * inte glider isär (Robert 2026-11-10). Ren HTML-funktion + en laddare. Inga namn eller e-postadresser kommer från GAS:
 * e-postadressen läses ur kortbeskrivningen av vyn (användarens Trello-token). Allt som skrivs ut escapas här.
 *   rader(gasRader, roll, oppna, slackOk) -> modellrader (GAS-raderna för rollen, släckläge hämtat ur vyns öppna fakturor)
 *   html(m)  m = { titel, rader, meta, epost, bilagor, detaljFel, forklaring }
 *   visa(host, o) visar ⏳, hämtar detalj + e-post + bilagor parallellt (fail-soft var för sig) och ritar EN gång
 *   epost(desc)   e-postadressen ur en kortbeskrivning ('' när den saknas) */
/* Fakturarollernas namn, EN källa (Robert 2026-11-10: "Kursavgift överallt, eftersom det står så på fakturan"). Kolumnrubrik, hovertexter,
 * Obetalda och fakturadetaljen går alla via NAMN. okand ska aldrig stå utan skäl: skalOkand(rad, antalFakturorPaKortet) ger det.
 * Skälet kommer ur filen (oklartSkal) när Actions-lib har skrivit ett. Typen härleds ALDRIG ur beloppet här. */
window.NYA_ZAPIER_BETALROLL = (function () {
  var NAMN = { anmalan: 'Anmälningsavgift', slut: 'Kursavgift', okand: 'Faktura' };
  function namn(k) { return NAMN[k] || NAMN.okand; }
  function skalOkand(rad, antal) {
    var s = rad && typeof rad.oklartSkal === 'string' ? rad.oklartSkal.trim() : '';
    if (s) { return s; }
    if (antal > 2) { return 'Kortet har ' + antal + ' fakturor, så det går inte att avgöra vilken som är anmälningsavgift och vilken som är kursavgift.'; }
    return 'Det går inte att avgöra om fakturan är anmälningsavgift eller kursavgift.';
  }
  /* Raden är oklar när rollen (för gamla svar utan roll: typen) är okand. */
  function arOkand(rad) { return !!rad && (rad.roll || rad.typ || 'okand') === 'okand'; }
  return { NAMN: NAMN, namn: namn, skalOkand: skalOkand, arOkand: arOkand };
})();

window.NYA_ZAPIER_BETALDET = (function () {
  var STATUS = { betald: 'Betald', betald_avviker: 'Betald, men något avviker', obetald: 'Obetald', forfallen: 'Förfallen', ej_bekraftad: 'Ej bekräftad',
    delbetald: 'Delbetald', oklart: 'Oklart', kunde_inte_lasas: 'Kunde inte läsas', saknas: 'Saknas (uppgiften är okänd eller inaktuell)', ingen_faktura: 'Ingen faktura' };
  var TITEL = window.NYA_ZAPIER_BETALROLL.NAMN;
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function belopp(n) { return (typeof n !== 'number' || !isFinite(n)) ? '–' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' kr'; }
  function dag(iso) { var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso || '')); return m ? m[1] : ''; }
  function tid(iso) { return window.NYA_ZAPIER_BOKF ? window.NYA_ZAPIER_BOKF.tidIso(iso) : 'okänd tid'; }
  function safeUrl(u) { u = String(u || ''); return (u.indexOf('https://trello.com/') === 0 || u.indexOf('https://trello-attachments.s3.amazonaws.com/') === 0) ? u : ''; }
  /* Samma regel som parseContactFromDesc i course.js: raden "Epost: x" (även E-post, fetstil och markdown-länk), annars första adressen i texten. */
  function epost(desc) {
    var s = String(desc || ''), hit = '';
    s.split('\n').forEach(function (line) {
      if (hit) { return; }
      var m = line.replace(/\*+/g, '').trim().match(/^([^:]{2,30}):\s*(.+?)\s*$/);
      if (!m || m[1].toLowerCase().replace(/[^a-zåäö]/g, '') !== 'epost') { return; }
      var val = m[2].trim(), link = val.match(/^\[([^\]]+)\]\([^)]*\)$/);
      hit = (link ? link[1] : val).trim();
    });
    if (hit) { return hit; }
    var f = s.match(/[\w.\-+]+@[\w.\-]+\.\w+/);
    return f ? f[0].trim() : '';
  }
  /* rollen = fakturarollen raderna hör till (anmalan, slut eller okand), jämförd med radens roll (gamla svar utan roll: typ). */
  function rader(gas, roll, oppna, slackOk) {
    oppna = oppna || [];
    var ut = [], sedda = {};
    function slackdel(nr) {
      var op = nr ? oppna.filter(function (o) { return o.fakturanr === nr; })[0] : null;
      return { op: op, slack: (op && op.slack) || null, knapp: (slackOk && op && nr) ? ((op.slack && op.slack.slackt) ? 'angra' : 'slack') : '' };
    }
    (Array.isArray(gas) ? gas : []).filter(function (r) { return r && (r.roll || r.typ) === roll; }).forEach(function (r) {
      var d = slackdel(r.fakturanr || ''); sedda[r.fakturanr || ''] = true;
      ut.push({ fakturanr: r.fakturanr || '', belopp: r.belopp, status: r.status, forfallodag: r.forfallodag, betaldDatum: r.betaldDatum, notering: r.notering, slack: d.slack, knapp: d.knapp });
    });
    oppna.forEach(function (o) {   // öppna fakturor som GAS-svaret saknade (eller hela svaret föll bort): visa dem ändå, med släckläget
      if (o.fakturanr && sedda[o.fakturanr]) { return; }
      var d = slackdel(o.fakturanr || '');
      ut.push({ fakturanr: o.fakturanr || '', belopp: o.belopp, status: o.status, forfallodag: o.forfallodag, betaldDatum: '', notering: '', slack: o.slack || null, knapp: d.knapp });
    });
    return ut;
  }
  function pdfRad(nr, bilagor) {
    if (!bilagor || !nr) { return ''; }
    var v;
    if (bilagor.loading) { v = '⏳ letar …'; }
    else if (bilagor.fel) { v = 'kunde inte hämtas'; }
    else {
      var hit = (bilagor.lista || []).filter(function (b) { return b && String(b.name || '').toLowerCase() === (nr + '.pdf').toLowerCase(); })[0];
      v = !hit ? 'ingen PDF med det numret på kortet'
        : safeUrl(hit.url) ? '<a href="' + esc(safeUrl(hit.url)) + '" target="_blank" rel="noopener" title="Öppnar fakturans PDF i en ny flik.">' + esc(hit.name) + '</a>'
        : esc(hit.name) + ' (länken kan inte öppnas härifrån)';
    }
    return '<dt>Fakturans PDF</dt><dd>' + v + '</dd>';
  }
  function tips() { return (window.NYA_ZAPIER_SLACK && window.NYA_ZAPIER_SLACK.TIPS) || { slack: '', angra: '' }; }
  function html(m) {
    m = m || {};
    var meta = m.meta || {};
    var out = '<div class="vz-bd"><div class="vz-bd-head"><b' + (m.skal ? ' title="' + esc(m.skal) + '"' : '') + '>' + esc(m.titel || 'Faktura') + '</b></div>';
    if (m.skal) { out += '<p class="vz-bd-forkl">' + esc(m.skal) + '</p>'; }
    if (m.detaljFel) { out += '<p class="vz-bd-warn">Detaljerna kunde inte hämtas. Det som visas är det som redan var laddat.</p>'; }
    if (m.forklaring && !(m.rader || []).length) { out += '<p class="vz-bd-forkl">' + esc(m.forklaring) + '</p>'; }
    (m.rader || []).forEach(function (r) {
      var nr = r.fakturanr || '', sl = r.slack && r.slack.slackt ? r.slack : null;
      out += '<div class="vz-bd-item" data-bd-rad="' + esc(nr) + '"><div class="vz-bd-top"><b>' + esc(nr ? 'Faktura ' + nr : 'Faktura utan nummer') + '</b>'
        + '<span class="vz-bd-status vz-bd-s-' + esc(r.status) + '">' + esc(STATUS[r.status] || r.status || 'Okänd') + '</span>'
        + (sl ? '<span class="vz-bd-slackt">Släckt</span>' : '') + '</div>'
        + '<dl class="vz-bd-dl"><dt>Belopp</dt><dd>' + esc(belopp(r.belopp)) + '</dd>'
        + '<dt>Förfallodag</dt><dd>' + esc(dag(r.forfallodag) || '–') + '</dd>'
        + '<dt>Betald</dt><dd>' + esc(dag(r.betaldDatum) || '–') + '</dd>'
        + (r.notering ? '<dt>Notering</dt><dd>' + esc(r.notering) + '</dd>' : '')
        + (sl ? '<dt>Släckt</dt><dd>' + esc(sl.skal || 'skäl okänt') + '. Av ' + esc(sl.av || 'okänd') + ', ' + esc(dag(sl.datum) || '–') + '</dd>' : '')
        + pdfRad(nr, m.bilagor) + '</dl>'
        + (r.knapp === 'slack' ? '<button type="button" class="vz-bd-btn" data-bd-slack="' + esc(nr) + '" title="' + esc(tips().slack) + '">Släck</button>' : '')
        + (r.knapp === 'angra' ? '<button type="button" class="vz-bd-btn" data-bd-angra="' + esc(nr) + '" title="' + esc(tips().angra) + '">Ångra</button>' : '')
        + '</div>';
    });
    var ep = String(m.epost || '').trim();
    out += '<div class="vz-bd-foot"><div><b>Källa:</b> Bokföringen (SpeedLedger) hämtad ' + esc(tid(meta.sieHamtad)) + '. Banken hämtad ' + esc(tid(meta.bankHamtad)) + '.</div>'
      + '<div>Statusen uppdaterad ' + esc(tid(meta.uppdaterad)) + '.</div>'
      + '<div><b>E-post på kortet:</b> ' + (!ep ? 'saknas' : /^[^\s<>"'@]+@[^\s<>"'@]+$/.test(ep) ? '<a href="mailto:' + esc(ep) + '" title="Öppnar ett nytt mejl till adressen i din mejlklient.">' + esc(ep) + '</a>' : esc(ep)) + '</div></div></div>';
    return out;
  }
  function visa(host, o) {
    host.innerHTML = '<div class="vz-bd"><div class="vz-bd-loading">⏳ Hämtar fakturadetaljer …</div></div>';
    function fs(f) { try { return Promise.resolve(f ? f() : null).then(function (v) { return { ok: true, v: v }; }, function () { return { ok: false }; }); } catch (e) { return Promise.resolve({ ok: false }); } }
    return Promise.all([fs(o.detalj), fs(o.epost), fs(o.bilagor)]).then(function (r) {
      if (o.aktiv && !o.aktiv()) { return; }
      var det = r[0].ok && r[0].v && r[0].v.ok === true ? r[0].v : null;
      host.innerHTML = html(o.modell({ detalj: det, detaljFel: !det, epost: r[1].ok ? String(r[1].v || '') : '', bilagor: r[2].ok ? { lista: Array.isArray(r[2].v) ? r[2].v : [] } : { fel: true } }));
    });
  }
  return { STATUS: STATUS, TITEL: TITEL, rader: rader, html: html, visa: visa, epost: epost, safeUrl: safeUrl };
})();

/* Släck-knappen (Robert 2026-11-10): en obetald faktura kan släckas med ett skäl. Allt sparas som en KOMMENTAR på
 * deltagarkortet i Trello (kortet är sanningskälla, ingen databas). EN delad källa för kommentarsformatet, skälen,
 * tolkningen, ordningen för "mest varnande" status och själva formuläret. Varken Obetalda fakturor (betal.js) eller
 * Kursöversikten (course.js, course-view.js) får ha egna literaler för prefixet: grinden i proof.js vaktar det.
 *   slackText(nr, namn, skalKod, fritext) -> kommentarstext, eller null när fritext saknas vid "annat"
 *   angraText(nr, namn)                   -> kommentarstext för återställning
 *   tolka(actions, nr)                    -> { slackt, av, skal, datum }; SENASTE kommentaren för numret vinner
 *   cellStatus(status, rader)             -> { status, slackt, rader } för en cell i kursöversikten
 *   bindForm(host, o)                     -> ritar och styr formuläret (släck eller ångra) i host */
window.NYA_ZAPIER_SLACK = (function () {
  var PREFIX = 'Betalstatus: faktura ';
  var SKAL = [
    { kod: 'betald', text: 'betald', etikett: 'Betald' },
    { kod: 'ersatt', text: 'ersatt av nyare faktura', etikett: 'Ersatt av nyare faktura' },
    { kod: 'inte_av', text: 'kursen blev inte av', etikett: 'Kursen blev inte av' },
    { kod: 'annat', text: 'annat', etikett: 'Annat' }
  ];
  // Samma ordning som GAS BETAL_VARNING_: den mest varnande kvarvarande statusen vinner.
  var VARNING = ['forfallen', 'obetald', 'ej_bekraftad', 'delbetald'];
  var MAX_FRI = 200;

  function enRad(s) { return String(s == null ? '' : s).replace(/\s*[\r\n]+\s*/g, ' ').trim(); }
  function fritext(s) { return enRad(s).slice(0, MAX_FRI).trim(); }
  function skalPost(kod) { for (var i = 0; i < SKAL.length; i++) { if (SKAL[i].kod === kod) { return SKAL[i]; } } return null; }
  /* Skälet som det står i kommentaren: "betald", ..., "annat: <fritext>". null = ogiltigt skäl eller fritext saknas. */
  function skalText(kod, fri) {
    var s = skalPost(kod);
    if (!s) { return null; }
    if (kod === 'annat') { var f = fritext(fri); return f ? ('annat: ' + f) : null; }
    return s.text;
  }
  function slackText(nr, namn, kod, fri) {
    var skal = skalText(kod, fri);
    if (skal == null) { return null; }
    return PREFIX + enRad(nr) + ' släckt av ' + enRad(namn) + ', ' + skal;
  }
  /* Tooltip-texterna för alla Släck-, Ångra- och Avbryt-knappar i båda vyerna (Robert 2026-11-10): EN källa. */
  var TIPS = {
    slack: 'Markera fakturan som hanterad (t.ex. betald på annat sätt eller ersatt). Skriver en kommentar på kortet. Kan ångras.',
    angra: 'Gör fakturan obetald igen. Skriver en ny kommentar på kortet.',
    avbryt: 'Stäng utan att ändra något.'
  };
  function angraText(nr, namn) { return PREFIX + enRad(nr) + ' återställd av ' + enRad(namn); }

  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /* actions: Trello commentCard-actions ({ type, date, data: { text } }) i valfri ordning. */
  function tolka(actions, nr) {
    var n = enRad(nr);
    var out = { slackt: false, av: '', skal: '', datum: '' };
    if (!n) { return out; }
    // Numret som helt ord: efter numret kommer alltid ett mellanslag, så 1650 matchar aldrig 16500.
    var re = new RegExp('^' + reEsc(PREFIX) + reEsc(n) + ' (släckt|återställd) av ');
    var reSlack = new RegExp('^' + reEsc(PREFIX) + reEsc(n) + ' släckt av (.*?), (betald|ersatt av nyare faktura|kursen blev inte av|annat: .*)$');
    var reAngra = new RegExp('^' + reEsc(PREFIX) + reEsc(n) + ' återställd av (.*)$');
    var bast = null, bastMs = -Infinity;
    (actions || []).forEach(function (a) {
      var tx = a && a.data && typeof a.data.text === 'string' ? a.data.text.trim() : '';
      if (!tx || !re.test(tx)) { return; }
      var ms = Date.parse(a.date || '');
      if (isNaN(ms)) { ms = -Infinity; }
      if (bast === null || ms > bastMs) { bast = { tx: tx, date: a.date || '' }; bastMs = ms; }   // lika datum: den som kom först i listan
    });
    if (!bast) { return out; }
    out.datum = bast.date;
    var m = reSlack.exec(bast.tx);
    if (bast.tx.indexOf(PREFIX + n + ' släckt av ') === 0) {
      out.slackt = true;
      if (m) { out.av = m[1]; out.skal = m[2]; }
      return out;
    }
    m = reAngra.exec(bast.tx);
    if (m) { out.av = m[1]; }
    return out;
  }

  /* Cellens status för en roll. rader = öppna och släckta fakturor för rollen ({ status, slack: { slackt } }).
   * Bara obetalda statusar påverkas: betald och betald_avviker (och allt annat) går ALLTID före släckt. */
  function cellStatus(status, rader) {
    var st = String(status || '');
    var lista = rader || [];
    if (VARNING.indexOf(st) === -1 || !lista.length) { return { status: st, slackt: false }; }
    var kvar = lista.filter(function (r) { return !(r && r.slack && r.slack.slackt); });
    if (!kvar.length) { return { status: st, slackt: true }; }
    var bast = null;
    kvar.forEach(function (r) {
      var i = VARNING.indexOf(r.status);
      if (i !== -1 && (bast === null || i < bast)) { bast = i; }
    });
    return { status: bast === null ? st : VARNING[bast], slackt: false };
  }

  /* Kommentarerna för ett antal kort, ~6 åt gången. Avvisar om NÅGON hämtning felar (då vet vi inte vad som är släckt). */
  function laddaKommentarer(restGetFn, kortIds) {
    var ids = [], seen = {};
    (kortIds || []).forEach(function (id) { if (id && !seen[id]) { seen[id] = true; ids.push(id); } });
    var out = {}, steg = Promise.resolve();
    for (var i = 0; i < ids.length; i += 6) {
      (function (grupp) {
        steg = steg.then(function () {
          return Promise.all(grupp.map(function (id) {
            return restGetFn('cards/' + encodeURIComponent(id) + '/actions?filter=commentCard&limit=1000').then(function (a) { out[id] = a || []; });
          }));
        });
      })(ids.slice(i, i + 6));
    }
    return steg.then(function () { return out; });
  }

  /* ---------- formuläret (delas av Obetalda fakturor och Kursöversikten) ---------- */
  function escH(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var uid = 0;
  function formHtml(o) {
    var angra = o.mode === 'angra';
    var nm = 'slack-skal-' + (++uid);
    return '<div class="vz-slack-form">'
      + '<div class="vz-slack-title">' + (angra ? 'Ångra släckningen av faktura ' : 'Släck faktura ') + escH(o.nr) + '</div>'
      + (angra ? '' :
          '<div class="vz-slack-skal">' + SKAL.map(function (s) {
            return '<label><input type="radio" name="' + nm + '" value="' + s.kod + '"> ' + escH(s.etikett) + '</label>';
          }).join('') + '</div>'
          + '<input type="text" class="vz-slack-fri" data-slack-fri maxlength="' + MAX_FRI + '" placeholder="Förklaring (krävs vid Annat)" aria-label="Förklaring, krävs vid Annat">')
      + '<p class="vz-slack-prev" data-slack-prev></p>'
      + '<p class="vz-slack-err" data-slack-err style="display:none"></p>'
      + '<div class="vz-slack-btns">'
      + '<button type="button" class="vz-slack-ok" data-slack-ok title="' + escH(angra ? TIPS.angra : TIPS.slack) + '">' + (angra ? 'Ångra släckningen' : 'Släck') + '</button>'
      + '<button type="button" class="vz-slack-avbryt" data-slack-avbryt title="' + escH(TIPS.avbryt) + '">Avbryt</button>'
      + '</div></div>';
  }

  /* o = { mode: 'slack'|'angra', nr, kortNamn, namn, onSubmit(kod, fri, text) -> Promise, onDone(kod, fri, text), onCancel() }
   * Knappen spärras medan skrivningen pågår (dubbelklick ger aldrig två kommentarer). Fel: tydligt meddelande, inget ändras. */
  function bindForm(host, o) {
    var angra = o.mode === 'angra';
    var st = { kod: '', fri: '', busy: false };
    host.innerHTML = formHtml(o);
    function q(attr) { return host.querySelector('[' + attr + ']'); }
    function text() { return angra ? angraText(o.nr, o.namn) : slackText(o.nr, o.namn, st.kod, st.fri); }
    function visaFel(msg) { var e = q('data-slack-err'); if (e) { e.textContent = msg || ''; e.style.display = msg ? '' : 'none'; } }
    function paintPrev() {
      var p = q('data-slack-prev'); if (!p) { return; }
      var tx = text();
      p.textContent = tx
        ? ('Skriver en kommentar på kortet ' + enRad(o.kortNamn) + ': ' + tx + '. ' + (angra ? 'Fakturan räknas då som obetald igen.' : 'Ångra skriver en ny kommentar.'))
        : (st.kod === 'annat' ? 'Skriv en förklaring för att se kommentaren.' : 'Välj ett skäl för att se kommentaren.');
    }
    function hit(e, attr) {
      var n = e && e.target;
      while (n && n !== host) { if (n.getAttribute && n.getAttribute(attr) !== null && n.getAttribute(attr) !== undefined) { return n; } n = n.parentNode; }
      return null;
    }
    function onInput(e) {
      var tg = e && e.target; if (!tg) { return; }
      if (tg.type === 'radio') { st.kod = String(tg.value || ''); }
      else if (tg.type === 'text') { st.fri = String(tg.value || ''); }
      else { return; }
      visaFel(''); paintPrev();
    }
    host.addEventListener('change', onInput);
    host.addEventListener('input', onInput);
    host.addEventListener('click', function (e) {
      if (hit(e, 'data-slack-avbryt')) { if (!st.busy && typeof o.onCancel === 'function') { o.onCancel(); } return; }
      if (!hit(e, 'data-slack-ok') || st.busy) { return; }
      var tx = text();
      if (!tx) { visaFel(st.kod === 'annat' ? 'Skriv en förklaring vid Annat.' : 'Välj ett skäl.'); return; }
      st.busy = true; visaFel('');
      var ok = q('data-slack-ok');
      if (ok) { ok.disabled = true; ok.textContent = '⏳ Skriver …'; }
      var p; try { p = Promise.resolve(o.onSubmit(st.kod, st.fri, tx)); } catch (err) { p = Promise.reject(err); }
      p.then(function () { if (typeof o.onDone === 'function') { o.onDone(st.kod, st.fri, tx); } }, function (err) {
        st.busy = false;
        if (ok) { ok.disabled = false; ok.textContent = angra ? 'Ångra släckningen' : 'Släck'; }
        visaFel('Kunde inte skriva kommentaren på kortet (' + enRad(err && err.message || 'okänt fel') + '). Inget har ändrats. Försök igen.');
      });
    });
    paintPrev();
  }

  return { PREFIX: PREFIX, SKAL: SKAL, VARNING: VARNING, MAX_FRI: MAX_FRI, TIPS: TIPS, skalText: skalText, slackText: slackText, angraText: angraText,
    tolka: tolka, cellStatus: cellStatus, laddaKommentarer: laddaKommentarer, formHtml: formHtml, bindForm: bindForm };
})();
