# Logos Reader

A personal Bible app that runs as an offline-first PWA: plain HTML/CSS/JS, no framework, no server.
Parallel translations, tap-a-word Greek study, Matthew Henry and Spurgeon commentary, cross-references
and "similar verses".

## Why it is light on battery
- Nothing runs in the background: no server, no polling, no animations.
- A service worker caches every file after first use, so reading never touches the network.
- One small JSON file per book or chapter is loaded, never a database or a big bundle.
- True-black theme (OLED pixels off). System fonts only.
- All heavy work (similar verses, parsing, indexing) is done once, at build time.

## Get it running
```bash
python3 build/fetch.py     # downloads sources from GitHub into build/cache (a few minutes)
python3 build/build.py     # writes web/data (about 93 MB of small JSON files)
./serve.sh                 # http://localhost:8000
```
`build/build.py` also takes stage names (`text greek lex commentary xrefs similar manifest`).
The `similar` stage needs `pip install scikit-learn numpy`.

## Put it on your phone
A PWA must be served over HTTPS to be installable. Upload the `web/` folder to any static host
(Cloudflare Pages, Netlify, GitHub Pages), open the URL in Chrome on your phone, then
menu → *Install app* / *Add to Home Screen*. Then open More → *Download for offline* once on Wi-Fi.
Bump `VERSION` in `web/sw.js` whenever you change app files, so phones pick up the update.
Hosting notes: the Greek data is CC BY 4.0 (STEPBible / Tyndale House) and the cross-references are CC BY,
so keep the credits in More → Sources. STEPBible asks that people link to their repo rather than re-host
their data, so an unlisted URL for your own use is the polite option.

## Publishing on GitHub Pages
The repo ignores `web/data/` (it is rebuilt, not stored). `.github/workflows/deploy.yml` downloads the sources,
runs the build and publishes `web/` on every push to `main`. One-time setup: repo **Settings → Pages → Source:
GitHub Actions**. The first run takes several minutes.

## What is in it
| Feature | Source |
|---|---|
| KJV (1769), ASV, YLT, NHEB (WEB family), BSB | scrollmapper/bible_databases |
| KJV 1611 (original spelling, 66 canonical books) | aruljohn/Bible-kjv-1611 |
| Greek NT, word parsing, Strong's | STEPBible TAGNT (NA and TR readings switchable) |
| Lexicon | STEPBible TBESG (Abbott-Smith) |
| Cross-references | OpenBible.info (top 12 per verse by votes) |
| Commentary | Matthew Henry (all books), Spurgeon's *Treasury of David* (Psalms only), via samueldotj/bible-commentaries |
| Similar verses | Built here: TF-IDF + LSA over KJV+BSB text, 8 nearest verses per verse |

Notes: WEB itself was not in the source repo, so NHEB (a close relative) is bundled. The 1611 text keeps its
Apocrypha out of the reader. Spurgeon's *Treasury of David* covers the Psalms only; his other works are not in
a usable machine-readable form.

## Copyrighted translations (NASB, AMP, NLT, NIV, RSV)
These cannot be bundled. Tap the translation chip → *Add online translation* and enter your own free key:
- **API.Bible** (scripture.api.bible): *Find versions for my key* lists what your key can read, then pick one.
- **NLT API** (api.nlt.to): enter the key and it adds the NLT.
Chapters you open are cached on the device. These two connectors are written against the services'
documented formats but could not be tested without keys, so if one misbehaves, the fix is in
`PROVIDERS` near the top of `web/app.js`. Check each service's terms for personal use and caching.

## Using it
- Tap the book name to jump (type "rom 8:28", or pick a book). Swipe left/right or use the arrows for chapters.
- Tap a **Greek word** for lemma, parsing, Strong's number, the full lexicon entry and other verses using it.
- Tap a **verse number** for commentary, cross-references, similar verses, highlight, bookmark, note, copy.
- Speech bubble icon: commentary for the whole chapter. Magnifier: search the first selected translation.
- More: theme, text size, interlinear glosses, NA/TR Greek, bookmarks, offline download.

## Extending
- Add a public-domain translation: add it to `TRANSLATIONS` and `fetch.py` (scrollmapper has about 140).
- Hebrew for the OT: STEPBible's TAHOT and TBESH files are in the same repo and follow the same format as TAGNT.
