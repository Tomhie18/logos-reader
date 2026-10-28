/* Logos Reader: plain JS, no framework, no build step. Everything is static files under data/. */
"use strict";

/* ------------------------------------------------------------------ helpers */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("lr." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("lr." + k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
};
const memo = new Map();
function jget(path) {
  if (!memo.has(path)) {
    const p = fetch("data/" + path).then((r) => { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });
    memo.set(path, p);
    p.catch(() => memo.delete(path));
  }
  return memo.get(path);
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1800);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const a = document.createElement("textarea"); a.value = text; document.body.append(a); a.select(); document.execCommand("copy"); a.remove(); }
  toast("Copied");
}
const fmtMB = (n) => (n / 1e6 < 10 ? (n / 1e6).toFixed(1) : Math.round(n / 1e6)) + " MB";

/* ------------------------------------------------------------------ state */
const S = {
  books: [], byId: {}, trans: [],
  sel: store.get("sel", ["KJV", "BSB", "GRK"]),
  pos: store.get("pos", { b: "JHN", c: 1, v: null }),
  set: Object.assign({ theme: "black", fs: 19, gtext: "na", inter: false, layout: "auto" }, store.get("set", {})),
  api: store.get("api", []),          // user-added online translations
  marks: store.get("marks", {}),      // "JHN.1.1": {h:1-4, b:1, n:"note"}
  rid: 0, stack: [], vtab: "comm", csrc: "henry", gw: {},
};
const B = (id) => S.byId[id];
const GRK = { id: "GRK", label: "Greek", name: "Greek New Testament (Nestle-Aland / Textus Receptus, STEPBible TAGNT)", nt: true };
const allTrans = () => [...S.trans, GRK, ...S.api.map((a) => ({ id: a.id, label: a.label, name: a.label + " (online)", api: a }))];
const T = (id) => allTrans().find((t) => t.id === id);
const saveSet = () => store.set("set", S.set);

function applySettings() {
  const r = document.documentElement;
  r.dataset.theme = S.set.theme;
  r.style.setProperty("--fs", S.set.fs + "px");
  document.body.classList.toggle("inter", !!S.set.inter);
  const bg = getComputedStyle(r).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]').content = bg;
}

/* ------------------------------------------------------------------ references */
const ALIAS = new Map();
function buildAliases() {
  const add = (k, id) => { k = k.toLowerCase().replace(/[\s.]/g, ""); if (!ALIAS.has(k)) ALIAS.set(k, id); };
  S.books.forEach((b) => { add(b.name, b.id); add(b.id, b.id); add(b.ob, b.id); });
  Object.entries({ psalm: "PSA", ps: "PSA", psa: "PSA", jn: "JHN", mt: "MAT", mk: "MRK", lk: "LUK", songofsongs: "SNG", sos: "SNG", rev: "REV", revelations: "REV", php: "PHP", phil: "PHP", jas: "JAS", jm: "JAS", ex: "EXO", dt: "DEU", jud: "JUD", jude: "JUD", judg: "JDG" }).forEach(([k, v]) => ALIAS.set(k, v));
}
function resolveBook(s) {
  s = s.toLowerCase().replace(/[\s.]/g, "").replace(/^(iii|ii|i)(?=[a-z])/, (m) => m.length);
  if (ALIAS.has(s)) return ALIAS.get(s);
  if (s.length < 2) return null;
  const hit = S.books.find((b) => b.name.toLowerCase().replace(/\s/g, "").startsWith(s));
  return hit ? hit.id : null;
}
function parseRef(str) {
  const m = str.trim().match(/^((?:[1-3]|i{1,3})?\s*[a-z]+(?:\s+of\s+[a-z]+)?)\.?\s*(\d+)?(?:\s*[:.]\s*(\d+))?/i);
  if (!m) return null;
  const b = resolveBook(m[1]); if (!b) return null;
  const maxc = B(b).v.length;
  return { b, c: Math.min(Math.max(+m[2] || 1, 1), maxc), v: m[3] ? +m[3] : null };
}
const refLabel = (b, c, v) => `${B(b).name} ${c}${v ? ":" + v : ""}`;
function parseRange(s) { // "PRO.8.22-PRO.8.30" | "GEN.1.2"
  const [a, z] = s.split("-");
  const p = (x) => { const [b, c, v] = x.split("."); return { b, c: +c, v: +v }; };
  const A = p(a), Z = z ? p(z) : null;
  let label = refLabel(A.b, A.c, A.v);
  if (Z) label += Z.b === A.b && Z.c === A.c ? "–" + Z.v : "–" + (Z.b === A.b ? `${Z.c}:${Z.v}` : refLabel(Z.b, Z.c, Z.v));
  return { A, Z: Z && Z.b === A.b && Z.c === A.c ? Z : null, label };
}

/* ------------------------------------------------------------------ translations / chapters */
const PROVIDERS = {
  apibible: {
    name: "API.Bible",
    async chapter(t, book, ch) {
      const base = t.base || "https://rest.api.bible/v1";
      const q = "content-type=html&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=true";
      const r = await fetch(`${base}/bibles/${t.bibleId}/chapters/${book}.${ch}?${q}`, { headers: { "api-key": t.key } });
      if (!r.ok) throw new Error("API.Bible " + r.status);
      return splitVerseSpans((await r.json()).data.content);
    },
  },
  nlt: {
    name: "NLT API",
    async chapter(t, book, ch) {
      const ref = `${B(book).ob}.${ch}`;
      const r = await fetch(`https://api.nlt.to/api/passages?ref=${encodeURIComponent(ref)}&version=${encodeURIComponent(t.version || "NLT")}&key=${encodeURIComponent(t.key)}`);
      if (!r.ok) throw new Error("NLT API " + r.status);
      const doc = new DOMParser().parseFromString(await r.text(), "text/html");
      const out = [];
      doc.querySelectorAll("verse_export").forEach((el) => {
        el.querySelectorAll(".vn,.tn,.footnote,.bk_ch_vs,a.a-tn").forEach((x) => x.remove());
        const n = +el.getAttribute("vn") || +el.getAttribute("verse");
        if (n) out[n - 1] = ((out[n - 1] || "") + " " + el.textContent).replace(/\s+/g, " ").trim();
      });
      return Array.from(out, (x) => x || "");
    },
  },
};
function splitVerseSpans(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("span.v,[data-number]").forEach((s) => { s.dataset.vn = s.getAttribute("data-number"); s.textContent = ""; });
  const out = []; let cur = 0;
  const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeType === 1) { if (n.dataset && n.dataset.vn) cur = parseInt(n.dataset.vn, 10) || cur; }
    else if (cur) out[cur - 1] = ((out[cur - 1] || "") + n.nodeValue).replace(/\s+/g, " ");
  }
  return Array.from(out, (x) => (x || "").trim());
}
async function apiChapter(t, b, c) {
  const key = `https://local.invalid/api/${t.id}/${b}/${c}`;
  let cache = null;
  try { cache = await caches.open("api-v1"); const hit = await cache.match(key); if (hit) return hit.json(); } catch { /* no Cache API */ }
  const verses = await PROVIDERS[t.api.provider].chapter(t.api, b, c);
  try { cache && (await cache.put(key, new Response(JSON.stringify(verses)))); } catch { /* ignore */ }
  return verses;
}
async function getChapter(id, b, c) {
  try {
    if (id === "GRK") return { k: "g", map: (await jget(`greek/${b}.json`))[c] || {} };
    const t = T(id);
    if (t && t.api) return { k: "t", t, verses: await apiChapter(t, b, c) };
    return { k: "t", t, verses: (await jget(`text/${id}/${b}.json`))[c] || [] };
  } catch (e) {
    return { k: "e", t: T(id), msg: String(e.message || e) };
  }
}
async function localVerses(b, c, v1, v2) { // text for previews: first local translation selected, else KJV
  const id = S.sel.find((x) => S.trans.some((t) => t.id === x)) || "KJV";
  const arr = (await jget(`text/${id}/${b}.json`))[c] || [];
  const out = [];
  for (let v = v1; v <= (v2 || v1) && v < v1 + 5; v++) if (arr[v - 1]) out.push(arr[v - 1]);
  return { id, text: out.join(" ") };
}

/* ------------------------------------------------------------------ Greek morphology */
const POS = { N: "Noun", V: "Verb", A: "Adjective", T: "Article", P: "Personal pronoun", R: "Relative pronoun", D: "Demonstrative pronoun", C: "Reciprocal pronoun", F: "Reflexive pronoun", I: "Interrogative pronoun", X: "Indefinite pronoun", Q: "Correlative pronoun", S: "Possessive pronoun", K: "Correlative pronoun", PREP: "Preposition", CONJ: "Conjunction", ADV: "Adverb", PRT: "Particle", INJ: "Interjection", COND: "Conditional", HEB: "Hebrew word", ARAM: "Aramaic word" };
const CASE = { N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative" };
const NUM = { S: "singular", P: "plural" }, GEND = { M: "masculine", F: "feminine", N: "neuter" };
const TENSE = { P: "present", I: "imperfect", F: "future", A: "aorist", R: "perfect", L: "pluperfect" };
const VOICE = { A: "active", M: "middle", P: "passive", E: "middle or passive", D: "deponent", N: "middle deponent", O: "passive deponent", Q: "impersonal active" };
const MOOD = { I: "indicative", S: "subjunctive", O: "optative", M: "imperative", N: "infinitive", P: "participle" };
function nominal(s) { // [person] case number gender
  const o = []; let i = 0;
  if (/\d/.test(s[0] || "")) { o.push(["1st", "2nd", "3rd"][s[0] - 1] + " person"); i = 1; }
  if (CASE[s[i]]) o.push(CASE[s[i]]);
  if (NUM[s[i + 1]]) o.push(NUM[s[i + 1]]);
  if (GEND[s[i + 2]]) o.push(GEND[s[i + 2]]);
  return o;
}
function decodeMorph(m) {
  if (!m) return "";
  const p = m.split("-");
  if (!/^[A-Z]$/.test(p[0])) return POS[p[0]] || m;
  const o = [POS[p[0]] || p[0]];
  if (p[0] === "V") {
    let t = p[1] || "", pre = "";
    if (/^[23]/.test(t)) { pre = t[0] === "2" ? "second " : "third "; t = t.slice(1); }
    o.push(pre + (TENSE[t[0]] || ""), VOICE[t[1]] || "", MOOD[t[2]] || "");
    const rest = p[2] || "";
    if (t[2] === "P") o.push(...nominal(rest)); else if (rest) o.push(...nominal(rest.replace(/^(\d)([SP])$/, "$1" + "N$2")).filter((x) => x !== "nominative"));
  } else o.push(...nominal(p[1] || ""));
  if (p[2] === "P" && p[0] !== "V") o.push("proper name");
  return o.filter(Boolean).join(", ");
}

/* ------------------------------------------------------------------ reader */
const trLabel = (id) => (T(id) || { label: id }).label;
function updateBar() {
  const b = B(S.pos.b);
  $("#ref").textContent = `${b.name} ${S.pos.c}`;
  $("#trs").textContent = S.sel.map(trLabel).join(" · ") || "Choose";
}
async function render(scrollTo) {
  const { b, c } = S.pos, book = B(b), id = ++S.rid;
  updateBar();
  store.set("pos", S.pos);
  location.hash = `${b}.${c}${S.pos.v ? "." + S.pos.v : ""}`;
  S.sel = S.sel.filter((x) => T(x));
  const sel = S.sel.filter((x) => x !== "GRK" || book.nt);
  const data = await Promise.all(sel.map((x) => getChapter(x, b, c)));
  if (id !== S.rid) return;
  const multi = sel.length > 1;
  const n = book.v[c - 1];
  const cols = multi && (S.set.layout === "cols" || (S.set.layout === "auto" && innerWidth >= 900));
  document.body.classList.toggle("cols", cols);
  $("#reader").style.setProperty("--n", sel.length);
  S.gw = {};
  let h = `<h1 class="ch-title">${esc(book.name)} ${c}</h1>`;
  if (!sel.length) h += `<p class="note">No translation selected. Tap the chip at the top to choose one.</p>`;
  if (S.sel.includes("GRK") && !book.nt) h += `<p class="note">Greek is available for the New Testament only.</p>`;
  data.forEach((d) => { if (d.k === "e") h += `<p class="err">${esc(d.t ? d.t.label : "?")}: could not load (${esc(d.msg)}). ${d.t && d.t.api ? "Check your key and connection under More → Online translations." : ""}</p>`; });
  for (let v = 1; v <= n; v++) {
    let lines = "";
    data.forEach((d, i) => {
      const lab = multi ? `<span class="lab">${esc(sel[i] === "GRK" ? "GRK" : trLabel(sel[i]))}</span>` : "";
      if (d.k === "g") {
        const ws = (d.map[v] || []).filter((w) => (S.set.gtext === "tr" ? w[6] !== 1 : w[6] !== 2));
        if (!ws.length) return;
        S.gw[v] = ws;
        lines += `<p class="tl gk">${lab}${ws.map((w, k) => `<span class="gw" data-v="${v}" data-i="${k}">${esc(w[0])}${S.set.inter ? `<i>${esc(w[2])}</i>` : ""}</span>`).join(" ")}</p>`;
      } else if (d.k === "t" && d.verses[v - 1]) lines += `<p class="tl">${lab}${esc(d.verses[v - 1])}</p>`;
    });
    const mk = S.marks[`${b}.${c}.${v}`] || {};
    h += `<article class="v${mk.b || mk.n ? " bk" : ""}" id="v${v}" data-v="${v}"${mk.h ? ` data-h="${mk.h}"` : ""}><button class="vn" data-v="${v}" aria-label="Verse ${v} tools">${v}</button><div class="vt">${lines}</div></article>`;
  }
  h += `<div class="nav"><button data-nav="-1">← Previous</button><button data-nav="1">Next →</button></div>`;
  $("#reader").innerHTML = h;
  document.title = `${book.name} ${c} · Logos Reader`;
  if (scrollTo) { const el = $("#v" + scrollTo); if (el) { el.scrollIntoView({ block: "start" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600); } }
  else window.scrollTo(0, 0);
}
function go(b, c, v) { S.pos = { b, c, v: v || null }; closeSheet(); render(v); }
function step(d) {
  let { b, c } = S.pos, i = S.books.findIndex((x) => x.id === b);
  c += d;
  if (c < 1) { if (i === 0) return; i--; c = S.books[i].v.length; }
  else if (c > S.books[i].v.length) { if (i === 65) return; i++; c = 1; }
  go(S.books[i].id, c);
}

/* ------------------------------------------------------------------ sheet */
function closeSheet() { S.stack = []; $("#sheet").hidden = true; $("#scrim").hidden = true; document.body.classList.remove("drawer"); document.querySelectorAll(".gw.on").forEach((x) => x.classList.remove("on")); }
async function show(title, build, replace) {
  if (replace) S.stack.pop();
  S.stack.push({ title, build });
  paintSheet();
}
async function paintSheet() {
  const top = S.stack[S.stack.length - 1];
  if (!top) return closeSheet();
  $("#sheet").hidden = false; $("#scrim").hidden = false; document.body.classList.add("drawer");
  $("#sh-title").textContent = top.title;
  $("#sh-back").hidden = S.stack.length < 2;
  const body = $("#sh-body"); body.innerHTML = `<p class="note">Loading…</p>`;
  try { await top.build(body); } catch (e) { body.innerHTML = `<p class="err">Could not load: ${esc(e.message || e)}</p>`; }
}
$("#sh-close").onclick = closeSheet;
$("#scrim").onclick = closeSheet;
$("#sh-back").onclick = () => { S.stack.pop(); paintSheet(); };

/* ---- generic: list of refs with text previews */
async function previewList(el, refs, per = 30) {
  const parsed = refs.map(parseRange);
  const mk = (p, text, id) => `<button class="item" data-go="${p.A.b}.${p.A.c}.${p.A.v}"><span class="r">${esc(p.label)}</span><div class="t">${esc(text)}</div></button>`;
  const texts = await Promise.all(parsed.slice(0, per).map((p) => localVerses(p.A.b, p.A.c, p.A.v, p.Z ? p.Z.v : p.A.v).catch(() => ({ text: "" }))));
  el.innerHTML = parsed.slice(0, per).map((p, i) => mk(p, texts[i].text)).join("") || `<p class="note">Nothing found.</p>`;
  if (parsed.length > per) {
    const more = document.createElement("button"); more.className = "btn"; more.textContent = `Show ${Math.min(30, parsed.length - per)} more`;
    more.onclick = async () => { more.remove(); const rest = document.createElement("div"); el.append(rest); await previewList(rest, refs.slice(per), 30); };
    el.append(more);
  }
}
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) { const [b, c, v] = g.dataset.go.split("."); go(b, +c, +v); }
  const r = e.target.closest("a.ref[data-r]");
  if (r) { const m = r.dataset.r.match(/^(\w+)\.(\d+)\.(\d+)/); const b = m && S.books.find((x) => x.step === m[1] || x.ob === m[1]); if (b) go(b.id, +m[2], +m[3]); }
});

/* ---- navigator */
function navSheet() {
  show("Go to", async (body) => {
    body.innerHTML = `<input type="search" id="gt" placeholder="Type a reference, e.g. Rom 8:28" autocomplete="off" enterkeyhint="go"><div id="gtb"></div>`;
    const draw = (bid) => {
      const box = $("#gtb", body);
      if (!bid) {
        const grp = (title, list) => `<h3 class="sec">${title}</h3><div class="grid books">${list.map((b) => `<button data-b="${b.id}" class="${b.id === S.pos.b ? "on" : ""}">${esc(b.name)}</button>`).join("")}</div>`;
        box.innerHTML = grp("Old Testament", S.books.filter((b) => !b.nt)) + grp("New Testament", S.books.filter((b) => b.nt));
      } else {
        const b = B(bid);
        box.innerHTML = `<h3 class="sec">${esc(b.name)}</h3><div class="grid">${b.v.map((_, i) => `<button data-c="${i + 1}" class="${bid === S.pos.b && i + 1 === S.pos.c ? "on" : ""}">${i + 1}</button>`).join("")}</div><div class="row"><button class="btn" data-all>← All books</button></div>`;
      }
    };
    let cur = null; draw(null);
    body.onclick = (e) => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.b) { cur = t.dataset.b; draw(cur); body.scrollTop = 0; }
      else if (t.dataset.c) go(cur, +t.dataset.c);
      else if ("all" in t.dataset) { cur = null; draw(null); }
    };
    $("#gt", body).onkeydown = (e) => { if (e.key === "Enter") { const r = parseRef(e.target.value); if (r) go(r.b, r.c, r.v); else toast("Reference not recognised"); } };
    if (innerWidth > 900) $("#gt", body).focus();
  });
}

/* ---- translations picker */
function transSheet() {
  show("Translations", async (body) => {
    const draw = () => {
      const order = [...S.sel, ...allTrans().map((t) => t.id).filter((x) => !S.sel.includes(x))];
      body.innerHTML = `<p class="note">Tick the ones you want to read side by side. Use the arrows to reorder.</p><div class="sel-list">${order.map((id) => {
        const t = T(id), on = S.sel.includes(id);
        return `<label><input type="checkbox" data-id="${id}" ${on ? "checked" : ""}><span>${esc(t.label)}<small class="note" style="display:block">${esc(t.name)}</small></span>${on ? `<span class="mv"><button data-up="${id}" aria-label="Move up">↑</button><button data-dn="${id}" aria-label="Move down">↓</button></span>` : ""}</label>`;
      }).join("")}</div><div class="row"><button class="btn" id="addapi">+ Add online translation (NIV, NASB, AMP, NLT, RSV…)</button></div>`;
      $("#addapi", body).onclick = apiSheet;
    };
    draw();
    const commit = () => { store.set("sel", S.sel); updateBar(); render(S.pos.v); };
    body.onchange = (e) => { const id = e.target.dataset.id; if (!id) return; S.sel = e.target.checked ? [...S.sel, id] : S.sel.filter((x) => x !== id); draw(); commit(); };
    body.onclick = (e) => {
      const u = e.target.dataset.up, d = e.target.dataset.dn, id = u || d; if (!id) return;
      const i = S.sel.indexOf(id), j = u ? i - 1 : i + 1; if (j < 0 || j >= S.sel.length) return;
      [S.sel[i], S.sel[j]] = [S.sel[j], S.sel[i]]; draw(); commit();
    };
  });
}

/* ---- online translations (API.Bible / NLT API) */
function apiSheet() {
  show("Online translations", async (body) => {
    const list = S.api.map((a) => `<div class="sw"><span>${esc(a.label)}<small>${esc(PROVIDERS[a.provider].name)}${a.bibleId ? " · " + esc(a.bibleId) : ""}</small></span><button class="btn" data-del="${a.id}">Remove</button></div>`).join("");
    body.innerHTML = `<p class="note">NIV, NASB, AMP, NLT and RSV are copyrighted, so they are not bundled. Add them here with your own free API key. Chapters you open are cached on this device, so they work offline afterwards. Check each service's terms for personal use.</p>
      ${list ? `<h3 class="sec">Added</h3>${list}` : ""}
      <h3 class="sec">Add one</h3>
      <div class="row"><select id="prov"><option value="apibible">API.Bible (many versions: scripture.api.bible)</option><option value="nlt">NLT API (api.nlt.to)</option></select></div>
      <div class="row"><input type="password" id="key" placeholder="API key" autocomplete="off"></div>
      <div id="pf"></div>`;
    const pf = $("#pf", body);
    const drawForm = () => {
      if ($("#prov", body).value === "nlt") {
        pf.innerHTML = `<div class="row"><input type="text" id="lab" value="NLT" placeholder="Label"></div><div class="row"><button class="btn pri" id="add">Add NLT</button></div>`;
        $("#add", pf).onclick = () => addApi({ provider: "nlt", label: $("#lab", pf).value || "NLT", version: "NLT", key: $("#key", body).value.trim() });
      } else {
        pf.innerHTML = `<div class="row"><button class="btn" id="find2">Find versions for my key</button></div><div class="row"><input type="search" id="q" placeholder="Filter, e.g. NASB, NIV, AMP, RSV"></div><div id="found"></div>
          <details><summary>Or enter a Bible ID by hand</summary><div class="row"><input type="text" id="bid" placeholder="Bible ID"></div><div class="row"><input type="text" id="lab" placeholder="Label, e.g. NASB"></div><div class="row"><button class="btn" id="addm">Add</button></div></details>`;
        let all = [];
        const filt = () => {
          const q = $("#q", pf).value.toLowerCase();
          $("#found", pf).innerHTML = all.filter((x) => !q || (x.name + x.abbreviationLocal + x.abbreviation).toLowerCase().includes(q)).slice(0, 40).map((x) => `<button class="item" data-bid="${x.id}" data-lab="${esc(x.abbreviationLocal || x.abbreviation || x.name)}"><span class="r">${esc(x.abbreviationLocal || x.abbreviation)}</span><div class="t">${esc(x.name)}</div></button>`).join("") || `<p class="note">No versions listed.</p>`;
        };
        $("#find2", pf).onclick = async () => {
          const key = $("#key", body).value.trim(); if (!key) return toast("Enter your key first");
          $("#found", pf).innerHTML = `<p class="note">Loading…</p>`;
          try {
            const r = await fetch("https://rest.api.bible/v1/bibles?language=eng", { headers: { "api-key": key } });
            if (!r.ok) throw new Error(r.status);
            all = (await r.json()).data; filt();
          } catch (e) { $("#found", pf).innerHTML = `<p class="err">Could not list versions (${esc(e.message)}). Check the key, or enter a Bible ID by hand below.</p>`; }
        };
        $("#q", pf).oninput = filt;
        $("#found", pf).onclick = (e) => { const t = e.target.closest("[data-bid]"); if (t) addApi({ provider: "apibible", label: t.dataset.lab, bibleId: t.dataset.bid, key: $("#key", body).value.trim() }); };
        $("#addm", pf).onclick = () => addApi({ provider: "apibible", label: $("#lab", pf).value, bibleId: $("#bid", pf).value.trim(), key: $("#key", body).value.trim() });
      }
    };
    $("#prov", body).onchange = drawForm; drawForm();
    body.onclick = (e) => { const d = e.target.dataset.del; if (d) { S.api = S.api.filter((a) => a.id !== d); S.sel = S.sel.filter((x) => x !== d); store.set("api", S.api); store.set("sel", S.sel); updateBar(); apiSheet(); } };
  });
}
function addApi(a) {
  if (!a.key || !a.label || (a.provider === "apibible" && !a.bibleId)) return toast("Fill in key and label");
  a.id = "api" + Date.now().toString(36);
  S.api.push(a); S.sel.push(a.id);
  store.set("api", S.api); store.set("sel", S.sel);
  toast(a.label + " added"); closeSheet(); render(S.pos.v);
}

/* ---- Greek word */
async function wordSheet(v, i) {
  const w = S.gw[v] && S.gw[v][i]; if (!w) return;
  document.querySelectorAll(".gw.on").forEach((x) => x.classList.remove("on"));
  const el = document.querySelector(`.gw[data-v="${v}"][data-i="${i}"]`); el && el.classList.add("on");
  show(w[0].replace(/[,.;·]+$/, ""), async (body) => {
    const sk = w[3];
    body.innerHTML = `<div><span class="big">${esc(w[5] || w[0])}</span><span class="tr">${esc(w[1])}</span></div>
      <dl class="kv"><dt>In this verse</dt><dd>${esc(w[0])} <span class="note">“${esc(w[2])}”</span></dd>
      <dt>Parsing</dt><dd>${esc(decodeMorph(w[4])) || "—"} <span class="note">${esc(w[4])}</span></dd>
      ${sk ? `<dt>Strong’s</dt><dd>${esc(sk.replace(/^G0*/, "G"))}</dd>` : ""}</dl><div id="lx"><p class="note">Loading lexicon…</p></div>`;
    if (!sk) return;
    const shard = await jget(`lex/${Math.floor(+sk.slice(1) / 500)}.json`);
    const e = shard[sk]; const lx = $("#lx", body);
    if (!e) { lx.innerHTML = `<p class="note">No lexicon entry.</p>`; return; }
    lx.innerHTML = `<dl class="kv"><dt>Lemma</dt><dd>${esc(e[0])} (${esc(e[1])})</dd><dt>Type</dt><dd>${esc(e[2])}</dd><dt>Gloss</dt><dd>${esc(e[3])}</dd></dl>
      <h3 class="sec">Definition (Abbott-Smith)</h3><div class="def">${e[4]}</div>
      <h3 class="sec">Other verses with this word <span class="note">(${e[5]} in the NT)</span></h3><div id="occ"></div>`;
    const refs = e[6].filter((r) => r !== `${S.pos.b}.${S.pos.c}.${v}`);
    if (refs.length) await previewList($("#occ", lx), refs, 12);
    else $("#occ", lx).innerHTML = `<p class="note">${e[5] > 400 ? "A very common word, so the list is left out." : "Only occurrence."}</p>`;
  });
}

/* ---- commentary */
const SEC = { exposition: "Exposition", notes: "Explanatory notes", hints: "Hints to preachers", overview: "Overview" };
const SOURCES = { henry: "Matthew Henry", spurgeon: "Spurgeon" };
function renderParas(paras) {
  let last = "", h = "";
  for (const [s, t] of paras) { if (s && s !== last) h += `<div class="s">${SEC[s] || s}</div>`; last = s; h += `<p>${esc(t)}</p>`; }
  return h;
}
const covers = (r, v) => { const m = r.match(/^(\d+)(?:-(?:\d+\.)?(\d+))?$/); if (!m) return false; const a = +m[1], z = r.includes(".") ? 999 : +(m[2] || m[1]); return v >= a && v <= z; };
async function commentaryHTML(src, b, c, v) {
  let units;
  try { units = await jget(`commentary/${src}/${b}/${c}.json`); } catch { return `<p class="note">${SOURCES[src]} has no commentary on this chapter${src === "spurgeon" ? " (the Treasury of David covers the Psalms only)" : ""}.</p>`; }
  const chap = units.filter((u) => u[0] === ""), pass = units.filter((u) => u[0] && u[0] !== "book");
  let h = "";
  const here = v ? pass.filter((u) => covers(u[0], v)) : [];
  if (here.length) h += here.map((u) => `<h4>Verse${u[0].includes("-") ? "s" : ""} ${esc(u[0])}</h4><div class="cm">${renderParas(u[2])}</div>`).join("");
  else if (v) h += `<p class="note">No note on verse ${v} in ${SOURCES[src]}.</p>`;
  chap.forEach((u) => (h += `<details ${v ? "" : "open"}><summary>Chapter overview</summary><div class="cm">${renderParas(u[2])}</div></details>`));
  const others = pass.filter((u) => !here.includes(u));
  if (others.length) h += `<h3 class="sec">${v ? "Other passages in this chapter" : "By passage"}</h3>` + others.map((u) => `<details><summary>Verse${u[0].includes("-") ? "s" : ""} ${esc(u[0])}</summary><div class="cm">${renderParas(u[2])}</div></details>`).join("");
  return h || `<p class="note">Nothing here.</p>`;
}
function srcChips(b) {
  const list = b === "PSA" ? ["henry", "spurgeon"] : ["henry"];
  if (!list.includes(S.csrc)) S.csrc = "henry";
  if (list.length < 2) return `<h3 class="sec" style="margin-top:6px">${SOURCES[list[0]]}</h3>`;
  return `<div class="tabs">${list.map((k) => `<button class="tab ${S.csrc === k ? "on" : ""}" data-src="${k}">${SOURCES[k]}</button>`).join("")}</div>`;
}
function chapterCommentary() {
  const { b, c } = S.pos;
  show(`Commentary · ${refLabel(b, c)}`, async (body) => {
    const draw = async () => {
      body.innerHTML = srcChips(b) + `<div id="cb"><p class="note">Loading…</p></div>`;
      $("#cb", body).innerHTML = await commentaryHTML(S.csrc, b, c, null);
      const intro = await jget(`commentary/${S.csrc}/${b}/intro.json`).catch(() => null);
      if (intro) $("#cb", body).insertAdjacentHTML("beforeend", `<details><summary>Introduction to ${esc(B(b).name)}</summary><div class="cm">${intro.map((u) => renderParas(u[2])).join("")}</div></details>`);
    };
    body.onclick = (e) => { const s = e.target.dataset.src; if (s) { S.csrc = s; draw(); } };
    await draw();
  });
}

/* ---- verse tools */
function verseSheet(v, tab) {
  const { b, c } = S.pos; S.vtab = tab || S.vtab;
  show(refLabel(b, c, v), async (body) => {
    const key = `${b}.${c}.${v}`;
    const tabs = [["comm", "Commentary"], ["xref", "Cross-refs"], ["sim", "Similar"], ["mark", "Mark"]];
    const head = `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${S.vtab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>`;
    body.innerHTML = head + `<div id="tb"><p class="note">Loading…</p></div>`;
    const tb = $("#tb", body);
    body.onclick = (e) => {
      const t = e.target.dataset.tab; if (t) { S.vtab = t; verseSheet(v, t); S.stack.splice(-2, 1); return; }
      const s = e.target.dataset.src; if (s) { S.csrc = s; verseSheet(v, "comm"); S.stack.splice(-2, 1); }
    };
    if (S.vtab === "comm") tb.innerHTML = srcChips(b) + (await commentaryHTML(S.csrc, b, c, v));
    else if (S.vtab === "xref") {
      const x = ((await jget(`xrefs/${b}.json`).catch(() => ({})))[`${c}:${v}`]) || [];
      tb.innerHTML = `<p class="note">Curated cross-references from OpenBible.info, most-voted first.</p><div id="pl"></div>`;
      x.length ? await previewList($("#pl", tb), x, 12) : ($("#pl", tb).innerHTML = `<p class="note">None listed for this verse.</p>`);
    } else if (S.vtab === "sim") {
      const x = ((await jget(`similar/${b}.json`).catch(() => ({})))[`${c}:${v}`]) || [];
      tb.innerHTML = `<p class="note">Verses closest in wording and theme, found by comparing the text of the whole Bible (computed on your build machine, so reading costs no battery).</p><div id="pl"></div>`;
      x.length ? await previewList($("#pl", tb), x, 12) : ($("#pl", tb).innerHTML = `<p class="note">Run the build’s “similar” stage to enable this.</p>`);
    } else {
      const m = S.marks[key] || {};
      const texts = await Promise.all(S.sel.filter((id) => id !== "GRK" || B(b).nt).map(async (id) => { const d = await getChapter(id, b, c); return d.k === "t" ? `${d.t.label}: ${d.verses[v - 1] || ""}` : d.k === "g" ? `Greek: ${(d.map[v] || []).filter((w) => (S.set.gtext === "tr" ? w[6] !== 1 : w[6] !== 2)).map((w) => w[0]).join(" ")}` : ""; }));
      tb.innerHTML = `<h3 class="sec">Highlight</h3><div class="dots">${[1, 2, 3, 4].map((i) => `<button class="dot c${i} ${m.h === i ? "on" : ""}" data-h="${i}" aria-label="Colour ${i}"></button>`).join("")}<button class="btn" data-h="0">Clear</button></div>
        <div class="row"><button class="btn ${m.b ? "pri" : ""}" id="bk">${m.b ? "★ Bookmarked" : "☆ Bookmark"}</button></div>
        <h3 class="sec">Note</h3><textarea id="note" placeholder="Your note on this verse…">${esc(m.n || "")}</textarea>
        <h3 class="sec">Copy</h3><div class="row"><button class="btn" id="c1">First translation</button><button class="btn" id="c2">All selected</button><button class="btn" id="c3">Link</button></div>`;
      const save = (patch) => {
        const n = Object.assign({}, S.marks[key], patch);
        if (!n.h) delete n.h; if (!n.b) delete n.b; if (!n.n) delete n.n;
        Object.keys(n).length ? (S.marks[key] = n) : delete S.marks[key];
        store.set("marks", S.marks);
        const el = $("#v" + v); if (el) { el.dataset.h = n.h || ""; if (!n.h) el.removeAttribute("data-h"); el.classList.toggle("bk", !!(n.b || n.n)); }
      };
      tb.onclick = (e) => {
        const h = e.target.dataset.h; if (h !== undefined) { save({ h: +h }); verseSheet(v, "mark"); S.stack.splice(-2, 1); }
      };
      $("#bk", tb).onclick = () => { save({ b: m.b ? 0 : 1 }); verseSheet(v, "mark"); S.stack.splice(-2, 1); };
      $("#note", tb).onchange = (e) => save({ n: e.target.value.trim() });
      const ref = refLabel(b, c, v);
      $("#c1", tb).onclick = () => copy(`${texts[0] || ""}\n— ${ref}`.replace(/^[A-Za-z0-9 ]+: /, "").replace("\n— ", ` (${ref})\n`).trim());
      $("#c2", tb).onclick = () => copy(`${ref}\n${texts.join("\n")}`);
      $("#c3", tb).onclick = () => copy(location.href.split("#")[0] + `#${b}.${c}.${v}`);
    }
  });
}

/* ---- search */
function searchSheet() {
  show("Search", async (body) => {
    const id = S.sel.find((x) => S.trans.some((t) => t.id === x)) || "KJV";
    body.innerHTML = `<input type="search" id="q" placeholder="Words to find in ${esc(trLabel(id))}…" enterkeyhint="search"><p class="note" id="st">All words must appear in the verse. Searches the whole Bible in ${esc(trLabel(id))} (first use downloads it once).</p><div id="res"></div>`;
    $("#q", body).onkeydown = async (e) => {
      if (e.key !== "Enter") return;
      const words = e.target.value.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return;
      $("#st", body).textContent = "Searching…";
      const hits = [];
      for (const bk of S.books) {
        const data = await jget(`text/${id}/${bk.id}.json`);
        for (const ch in data) data[ch].forEach((t, i) => { const l = t.toLowerCase(); if (words.every((w) => l.includes(w))) hits.push([bk.id, +ch, i + 1, t]); });
      }
      $("#st", body).textContent = `${hits.length} verse${hits.length === 1 ? "" : "s"}${hits.length > 150 ? " (showing the first 150)" : ""}`;
      const re = new RegExp("(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
      $("#res", body).innerHTML = hits.slice(0, 150).map(([b, c, v, t]) => `<button class="item" data-go="${b}.${c}.${v}"><span class="r">${esc(refLabel(b, c, v))}</span><div class="t">${esc(t).replace(re, "<mark>$1</mark>")}</div></button>`).join("");
    };
    $("#q", body).focus();
  });
}

/* ---- bookmarks & notes */
function marksSheet() {
  show("Bookmarks & notes", async (body) => {
    const keys = Object.keys(S.marks);
    if (!keys.length) { body.innerHTML = `<p class="note">Nothing yet. Tap a verse number, then “Mark”.</p>`; return; }
    body.innerHTML = keys.map((k) => { const [b, c, v] = k.split("."), m = S.marks[k]; return `<button class="item" data-go="${k}"><span class="r">${m.b ? "★ " : ""}${esc(refLabel(b, +c, +v))}</span>${m.n ? `<div class="t">${esc(m.n)}</div>` : ""}</button>`; }).join("");
  });
}

/* ---- offline download */
function offlineSheet() {
  show("Download for offline", async (body) => {
    const man = await fetch("data/manifest.json").then((r) => r.json());
    const groups = [
      ...S.trans.map((t) => ["text/" + t.id + "/", t.label + " text"]),
      ["greek/|lex/", "Greek text + lexicon"], ["commentary/henry/", "Matthew Henry"], ["commentary/spurgeon/", "Spurgeon (Psalms)"],
      ["xrefs/", "Cross-references"], ["similar/", "Similar verses"],
    ].map(([p, l]) => { const pre = p.split("|"); const f = man.files.filter(([n]) => pre.some((x) => n.startsWith(x))); return { l, f, size: f.reduce((s, [, z]) => s + z, 0) }; }).filter((g) => g.f.length);
    body.innerHTML = `<p class="note">Everything you open is already cached as you read. Use this to fetch whole sets in advance, on Wi-Fi.</p><div class="sel-list">${groups.map((g, i) => `<label><input type="checkbox" data-i="${i}" ${/^(KJV|BSB|Greek)/.test(g.l) ? "checked" : ""}><span>${esc(g.l)}</span><span class="note" style="margin-left:auto">${fmtMB(g.size)}</span></label>`).join("")}</div>
      <div class="bar"><i id="pg"></i></div><p class="note" id="ps"></p><div class="row"><button class="btn pri" id="dl">Download selected</button></div>`;
    $("#dl", body).onclick = async () => {
      const files = groups.filter((_, i) => $(`input[data-i="${i}"]`, body).checked).flatMap((g) => g.f);
      if (!files.length) return;
      try { await navigator.storage?.persist?.(); } catch { /* optional */ }
      let done = 0, fail = 0; const q = [...files];
      const worker = async () => { for (let f; (f = q.shift());) { try { const r = await fetch("data/" + f[0]); if (!r.ok) throw 0; await r.arrayBuffer(); } catch { fail++; } done++; $("#pg", body).style.width = (100 * done / files.length) + "%"; $("#ps", body).textContent = `${done} / ${files.length} files`; } };
      $("#dl", body).disabled = true;
      await Promise.all(Array.from({ length: 6 }, worker));
      $("#ps", body).textContent = fail ? `Done, ${fail} file(s) failed. Try again.` : "All saved on this device.";
      $("#dl", body).disabled = false;
    };
  });
}

/* ---- settings */
function settingsSheet() {
  show("More", async (body) => {
    const seg = (key, opts) => `<div class="tabs" style="margin:0">${opts.map(([v, l]) => `<button class="tab ${S.set[key] === v ? "on" : ""}" data-k="${key}" data-v="${v}">${l}</button>`).join("")}</div>`;
    body.innerHTML = `<h3 class="sec">Appearance</h3>
      <div class="sw"><span>Theme<small>True black saves battery on OLED screens</small></span>${seg("theme", [["black", "Black"], ["dark", "Dark"], ["sepia", "Sepia"], ["light", "Light"]])}</div>
      <div class="sw"><span>Text size</span><input type="range" min="15" max="28" value="${S.set.fs}" id="fs" style="max-width:55%"></div>
      <div class="sw"><span>Layout<small>Side-by-side columns need a wide screen</small></span>${seg("layout", [["auto", "Auto"], ["stack", "Stacked"], ["cols", "Columns"]])}</div>
      <h3 class="sec">Greek</h3>
      <div class="sw"><span>Text<small>Nestle-Aland (modern) or Textus Receptus (KJV’s Greek)</small></span>${seg("gtext", [["na", "NA"], ["tr", "TR"]])}</div>
      <div class="sw"><span>Interlinear<small>Show an English gloss under every Greek word</small></span>${seg("inter", [[false, "Off"], [true, "On"]])}</div>
      <h3 class="sec">Library</h3>
      <div class="row"><button class="btn" data-a="marks">Bookmarks &amp; notes</button><button class="btn" data-a="api">Online translations</button><button class="btn" data-a="off">Download for offline</button></div>
      <h3 class="sec">Sources</h3><p class="note">KJV 1769, ASV, YLT, NHEB, BSB: public domain / open licence (scrollmapper/bible_databases). KJV 1611: aruljohn/Bible-kjv-1611. Greek text, parsing and lexicon: STEPBible / Tyndale House (CC BY 4.0), Abbott-Smith. Cross-references: OpenBible.info (CC BY). Commentary: Matthew Henry and Spurgeon’s Treasury of David, public domain, via samueldotj/bible-commentaries.</p>`;
    body.onclick = (e) => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.k) { const raw = t.dataset.v; S.set[t.dataset.k] = raw === "true" ? true : raw === "false" ? false : raw; saveSet(); applySettings(); render(S.pos.v); settingsSheet(); S.stack.splice(-2, 1); }
      if (t.dataset.a === "marks") marksSheet(); if (t.dataset.a === "api") apiSheet(); if (t.dataset.a === "off") offlineSheet();
    };
    $("#fs", body).oninput = (e) => { S.set.fs = +e.target.value; saveSet(); applySettings(); };
  });
}

/* ------------------------------------------------------------------ wiring */
$("#ref").onclick = navSheet;
$("#trs").onclick = transSheet;
$("#find").onclick = searchSheet;
$("#comm").onclick = chapterCommentary;
$("#menu").onclick = settingsSheet;
$("#reader").addEventListener("click", (e) => {
  const n = e.target.closest(".vn"); if (n) return verseSheet(+n.dataset.v);
  const w = e.target.closest(".gw"); if (w) return wordSheet(+w.dataset.v, +w.dataset.i);
  const nv = e.target.closest("[data-nav]"); if (nv) step(+nv.dataset.nav);
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !$("#sheet").hidden) return;
  if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1);
});
let tx = 0, ty = 0;
$("#reader").addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
$("#reader").addEventListener("touchend", (e) => { const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; if (Math.abs(dx) > 110 && Math.abs(dy) < 45) step(dx < 0 ? 1 : -1); }, { passive: true });
addEventListener("hashchange", () => { const m = location.hash.match(/^#(\w{3})\.(\d+)(?:\.(\d+))?$/); if (m && B(m[1]) && (m[1] !== S.pos.b || +m[2] !== S.pos.c)) { S.pos = { b: m[1], c: +m[2], v: m[3] ? +m[3] : null }; render(S.pos.v); } });
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => S.books.length && render(S.pos.v), 250); });

(async function init() {
  applySettings();
  try {
    const d = await jget("books.json");
    S.books = d.books; S.trans = d.translations; S.books.forEach((b) => (S.byId[b.id] = b));
  } catch (e) { $("#reader").innerHTML = `<p class="err">Could not load data/books.json. Run the build first (see README). ${esc(e.message)}</p>`; return; }
  buildAliases();
  const m = location.hash.match(/^#(\w{3})\.(\d+)(?:\.(\d+))?$/);
  if (m && B(m[1])) S.pos = { b: m[1], c: Math.min(+m[2], B(m[1]).v.length), v: m[3] ? +m[3] : null };
  if (!B(S.pos.b)) S.pos = { b: "JHN", c: 1, v: null };
  render(S.pos.v);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
