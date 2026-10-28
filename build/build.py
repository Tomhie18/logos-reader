#!/usr/bin/env python3
"""Turn the raw downloads in build/cache into the compact static files the PWA reads (web/data).

Run:  python3 build/fetch.py && python3 build/build.py
Stages can be run alone:  python3 build/build.py text greek lex commentary xrefs similar manifest
"""
import glob, html, json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(__file__))
from books import BOOKS, IDS, NAME, BY_OB, BY_STEP

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(HERE, "..", "web", "data")
os.makedirs(OUT, exist_ok=True)


def dump(obj, rel):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


TAG = re.compile(r"<[^>]+>")


def clean(s):
    return html.unescape(TAG.sub("", s)).strip()


# --------------------------------------------------------------------------- text
TRANSLATIONS = [
    # id, label, long name, source kind
    ("KJV", "KJV", "King James Version (1769)", "sm"),
    ("KJV1611", "KJV 1611", "King James Version, original 1611 spelling", "1611"),
    ("BSB", "BSB", "Berean Standard Bible", "sm"),
    ("ASV", "ASV", "American Standard Version (1901)", "sm"),
    ("YLT", "YLT", "Young's Literal Translation (1898)", "sm"),
    ("NHEB", "NHEB", "New Heart English Bible (WEB family)", "sm"),
]


def chapters_to_obj(chapters):
    """[{chapter, verses:[{verse,text}]}] -> {"1":[text,...]} (verse numbers contiguous from 1)."""
    out = {}
    for c in chapters:
        n = int(c["chapter"])
        verses = {int(v["verse"]): clean(v["text"]) for v in c["verses"]}
        top = max(verses) if verses else 0
        out[str(n)] = [verses.get(i, "") for i in range(1, top + 1)]
    return out


def stage_text():
    counts = {}
    for tid, label, long, kind in TRANSLATIONS:
        if kind == "sm":
            data = json.load(open(os.path.join(CACHE, "text", f"{tid}.json"), encoding="utf-8"))
            assert len(data["books"]) == 66, (tid, len(data["books"]))
            for bid, b in zip(IDS, data["books"]):
                obj = chapters_to_obj(b["chapters"])
                dump(obj, f"text/{tid}/{bid}.json")
                if tid == "KJV":
                    counts[bid] = [len(obj[str(i)]) for i in range(1, len(obj) + 1)]
        else:
            for bid in IDS:
                data = json.load(open(os.path.join(CACHE, "kjv1611", f"{bid}.json"), encoding="utf-8"))
                dump(chapters_to_obj(data["chapters"]), f"text/{tid}/{bid}.json")
    books = []
    for bid, name, ob, step in BOOKS:
        books.append({"id": bid, "name": name, "ob": ob, "step": step,
                      "nt": IDS.index(bid) >= 39, "v": counts[bid]})
    dump({"books": books, "translations": [{"id": t, "label": l, "name": n} for t, l, n, _ in TRANSLATIONS]}, "books.json")
    print("text ok:", sum(map(len, counts.values())), "chapters")


# --------------------------------------------------------------------------- greek + lexicon
WORD = re.compile(r"^(\w+)\.(\d+)\.(\d+)[^#\t]*#(\d+)=(\S+)$")
GREEK = re.compile(r"^(.*?)\s*\((.*)\)\s*$")


def tag_flag(t):
    """0 = in both NA and TR, 1 = NA (Nestle-Aland) only, 2 = TR (KJV Greek) only, None = neither."""
    core = re.sub(r"\([^)]*\)", "", t)
    na = "N" in core or "n" in core
    tr = "K" in core or "k" in core
    if na and tr:
        return 0
    if na:
        return 1
    if tr:
        return 2
    return None


def strong_key(s):
    m = re.match(r"G(\d+)", s or "")
    return "G%04d" % int(m.group(1)) if m else None


def stage_greek():
    books = {b: {} for b in IDS if IDS.index(b) >= 39}
    occ = collections.defaultdict(list)  # strong -> refs (NA text only)
    nwords = 0
    for fn in ("tagnt1.txt", "tagnt2.txt"):
        for line in open(os.path.join(CACHE, fn), encoding="utf-8"):
            if "#" not in line[:30]:
                continue
            cols = line.rstrip("\n").split("\t")
            m = WORD.match(cols[0])
            if not m or m.group(1) not in BY_STEP or len(cols) < 5:
                continue
            bid = BY_STEP[m.group(1)]
            ch, vs, typ = int(m.group(2)), int(m.group(3)), m.group(5)
            flag = tag_flag(typ)
            if flag is None:
                continue
            g = GREEK.match(cols[1])
            greek, translit = (g.group(1), g.group(2)) if g else (cols[1], "")
            gloss = cols[2].strip()
            sm = cols[3].split("=", 1)
            strong = sm[0].strip()
            morph = sm[1].strip() if len(sm) > 1 else ""
            lemma = cols[4].split("=", 1)[0].strip()
            sk = strong_key(strong)
            books[bid].setdefault(str(ch), {}).setdefault(str(vs), []).append(
                [greek, translit, gloss, sk or "", morph, lemma, flag])
            if sk and flag in (0, 1):
                occ[sk].append(f"{bid}.{ch}.{vs}")
            nwords += 1
    for bid, chs in books.items():
        dump(chs, f"greek/{bid}.json")
    dump({k: v for k, v in occ.items()}, "_occ.json")  # temporary; consumed by the lexicon stage
    print("greek ok:", nwords, "words;", sum(len(v) for c in books.values() for v in c.values()), "verses")


def fix_def(s):
    s = s.strip()
    s = re.sub(r"<ref='([^']*)'>(.*?)</ref>", lambda m: '<a class="ref" data-r="%s">%s</a>' % (m.group(1).split(",")[0].strip(), m.group(2)), s)
    s = re.sub(r"<BR\s*/?>", "<br>", s, flags=re.I)
    s = re.sub(r"<(?!/?(?:b|i|br|a)(?:\s|>|/))[^>]*>", "", s)  # keep only b, i, br, a (and their closers)
    s = s.replace("__", "&emsp;")  # source marks outline indentation with underscores
    return s


def stage_lex():
    occ = json.load(open(os.path.join(OUT, "_occ.json")))
    lex = {}
    for line in open(os.path.join(CACHE, "tbesg.txt"), encoding="utf-8"):
        if not re.match(r"^G\d", line):
            continue
        c = line.rstrip("\n").split("\t")
        if len(c) < 8:
            continue
        keys = {strong_key(c[0])}
        keys.add(c[1].split()[0] if c[1].split() else c[0])
        entry = [c[3], c[4], c[5].replace("G:", ""), c[6], fix_def(c[7])]
        for k in keys:
            if k and k not in lex:
                lex[k] = entry
    shards = collections.defaultdict(dict)
    used = 0
    for sk, refs in occ.items():
        if sk not in lex:
            continue
        e = list(lex[sk])
        e.append(len(refs))
        e.append(refs if len(refs) <= 400 else [])
        shards[int(sk[1:]) // 500][sk] = e
        used += 1
    for n, d in shards.items():
        dump(d, f"lex/{n}.json")
    os.remove(os.path.join(OUT, "_occ.json"))
    missing = [k for k in occ if k not in lex]
    print("lex ok:", used, "entries used; missing:", len(missing), missing[:8])


# --------------------------------------------------------------------------- commentary
def stage_commentary():
    root = os.path.join(CACHE, "commentaries", "en")
    for src in ("henry", "spurgeon"):
        n = 0
        for bdir in sorted(glob.glob(os.path.join(root, src, "*"))):
            bid = os.path.basename(bdir)
            if bid not in IDS:
                print("skip", src, bid)
                continue
            for f in glob.glob(os.path.join(bdir, "*.json")):
                d = json.load(open(f, encoding="utf-8"))
                ch = os.path.basename(f)[:-5]
                units = []
                for u in d["units"]:
                    rng = u["range"]
                    parts = rng.split(".", 2)
                    if u["kind"] == "book":
                        r = "book"
                    elif u["kind"] == "chapter":
                        r = ""
                    else:
                        r = parts[2] if len(parts) > 2 else ""
                    paras = []
                    for p in u["paragraphs"]:
                        t = clean(p["text"])
                        if t:
                            paras.append([p.get("section") or "", t])
                    if paras:
                        units.append([r, u.get("title", ""), paras])
                if units:
                    dump(units, f"commentary/{src}/{bid}/{'intro' if ch == 'intro' else ch}.json")
                    n += 1
        print("commentary", src, n, "files")


# --------------------------------------------------------------------------- cross references
def ob_ref(s):
    """'Prov.8.22' -> 'PRO.8.22'"""
    b, c, v = s.split(".")
    return f"{BY_OB[b]}.{c}.{v}"


def stage_xrefs():
    per = collections.defaultdict(lambda: collections.defaultdict(list))
    for line in open(os.path.join(CACHE, "xrefs.txt"), encoding="utf-8"):
        c = line.rstrip("\n").split("\t")
        if len(c) < 3 or c[0].startswith("From"):
            continue
        try:
            votes = int(c[2])
            if votes < 1:
                continue
            a = ob_ref(c[0])
            parts = c[1].split("-")
            to = "-".join(ob_ref(p) for p in parts)
        except (ValueError, KeyError):
            continue
        bid, ch, v = a.split(".")
        per[bid][f"{ch}:{v}"].append((votes, to))
    total = 0
    for bid, d in per.items():
        out = {}
        for k, lst in d.items():
            lst.sort(key=lambda x: -x[0])
            out[k] = [t for _, t in lst[:12]]
            total += len(out[k])
        dump(out, f"xrefs/{bid}.json")
    print("xrefs ok:", total, "links")


# --------------------------------------------------------------------------- similar verses
def stage_similar():
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.decomposition import TruncatedSVD
    from sklearn.preprocessing import normalize

    refs, texts = [], []
    for bid in IDS:
        # BSB for modern wording, KJV for the classic wording: both help the match
        bsb = json.load(open(os.path.join(OUT, "text", "BSB", f"{bid}.json"), encoding="utf-8"))
        kjv = json.load(open(os.path.join(OUT, "text", "KJV", f"{bid}.json"), encoding="utf-8"))
        for ch in sorted(kjv, key=int):
            for i, t in enumerate(kjv[ch]):
                b = bsb.get(ch, [])
                refs.append((bid, int(ch), i + 1))
                texts.append((t + " " + (b[i] if i < len(b) else "")).strip())
    n = len(texts)
    print("similar: vectorising", n, "verses")
    vec = TfidfVectorizer(stop_words="english", sublinear_tf=True, min_df=2, max_df=0.2,
                          ngram_range=(1, 2), token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z']+\b")
    X = vec.fit_transform(texts)
    print("similar: tfidf", X.shape)
    svd = TruncatedSVD(n_components=160, random_state=1)
    Z = normalize(svd.fit_transform(X)).astype(np.float32)
    Xn = normalize(X).tocsr()
    nn = np.zeros((n, 8), dtype=np.int32)
    book_of = np.array([IDS.index(r[0]) for r in refs])
    chap_of = np.array([r[1] for r in refs])
    verse_of = np.array([r[2] for r in refs])
    step = 1500
    for s in range(0, n, step):
        e = min(n, s + step)
        sc = 0.5 * (Xn[s:e] @ Xn.T).toarray() + 0.5 * (Z[s:e] @ Z.T)
        for i in range(s, e):
            row = sc[i - s]
            row[i] = -1
            near = (book_of == book_of[i]) & (chap_of == chap_of[i]) & (np.abs(verse_of - verse_of[i]) <= 1)
            row[near] = -1  # neighbours in the same passage are not "similar verses"
        idx = np.argpartition(-sc, 8, axis=1)[:, :8]
        for i in range(e - s):
            order = idx[i][np.argsort(-sc[i, idx[i]])]
            nn[s + i] = order
        print("  ", e, "/", n)
    by_book = collections.defaultdict(dict)
    for i, (bid, ch, v) in enumerate(refs):
        by_book[bid][f"{ch}:{v}"] = [f"{refs[j][0]}.{refs[j][1]}.{refs[j][2]}" for j in nn[i]]
    for bid, d in by_book.items():
        dump(d, f"similar/{bid}.json")
    print("similar ok")


# --------------------------------------------------------------------------- manifest
def stage_manifest():
    files = []
    for p in sorted(glob.glob(os.path.join(OUT, "**", "*.json"), recursive=True)):
        rel = os.path.relpath(p, OUT).replace(os.sep, "/")
        if rel == "manifest.json":
            continue
        files.append([rel, os.path.getsize(p)])
    dump({"files": files}, "manifest.json")
    print("manifest ok:", len(files), "files,", round(sum(s for _, s in files) / 1e6, 1), "MB")


STAGES = {"text": stage_text, "greek": stage_greek, "lex": stage_lex, "commentary": stage_commentary,
          "xrefs": stage_xrefs, "similar": stage_similar, "manifest": stage_manifest}

if __name__ == "__main__":
    for s in (sys.argv[1:] or list(STAGES)):
        print("==", s)
        STAGES[s]()
