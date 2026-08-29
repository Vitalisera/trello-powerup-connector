# Sjömässan 2028 – konceptwebb (Elmia, Jönköping)

Statisk enkelsidessajt (SPA med tre vyer: Sjömässan / Båtmässan / Marine Business)
för konceptet Sjömässan 2028, 18–27 februari 2028.

**OBS: Detta är inte Vitalisera-kod.** Sajten hör till Elmia-teamets Vercel-konto och
ligger här enbart som säkerhetskopia/versionshistorik tills den får ett eget repo.

## Drift

- Vercel-team: `elmia` · projekt: `sjomassan-2028` (prj_cXFoIucAFqHORrDGivhrzyqE9HN6)
- Produktion: https://sjomassan-2028.vercel.app
- Deploy: `vercel deploy --prod` från denna katalog (kräver Vercel-inloggning i teamet;
  i sandlådemiljö med agentproxy: `NODE_USE_ENV_PROXY=1 vercel deploy --prod`)
- `vercel.json` innehåller rewrites så `/batmassan` och `/marine-business` laddar
  rätt vy (JS:et mappar pathname → vy vid inladdning).

## Innehåll

- `index.html` – hela sajten (CSS/JS inline). Vyer växlas via hash (#home/#boat/#business).
- `assets/` – webboptimerade foton (JPEG, 1100–2000 px) + självhostad Inter Tight (woff2).
- `BILDKREDITER.json` – källa/licens/fotograf per bildfil.

## Bildmaterial – VIKTIGT

Fotona är **platshållare under konceptfasen**: CC-licensierade bilder från Wikimedia
Commons (kreditering i sajtfooten + BILDKREDITER.json) samt två pressbilder
(boot Düsseldorf-hallen i home-hero, e-Propulsion i etech). **Allt ska ersättas med
Elmias eget/licensierade material före skarp lansering.**

## Historik

Sajten byggdes ursprungligen av en ChatGPT-agent som fastnade i teckenkodnings- och
deploystrul (gzip-blob-hack, Lambda-inbäddning, emoji i stället för foton). Den här
versionen rekonstruerades 2026-08-28 från den sista sammanhängande deployen
(dpl_AP1H… – brotli-inbäddad i Lambda-hacket) och förädlades: foton i alla bildytor,
hero-faktakort, Inter Tight-typografi, intressemodal, OG-meta, path-routing, copy-pass.
