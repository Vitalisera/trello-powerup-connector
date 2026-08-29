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

  return { lookup: lookup, buildRows: buildRows, toSaved: toSaved, withCourseEmail: withCourseEmail };
})();
