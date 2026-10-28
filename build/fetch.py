#!/usr/bin/env python3
"""Download all raw source data into build/cache (skips files already present).
Everything comes from GitHub, so it works even on restricted networks."""
import os, subprocess, sys, urllib.parse, urllib.request, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(__file__))
from books import NAME, IDS

CACHE = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE, exist_ok=True)

SM = "https://raw.githubusercontent.com/scrollmapper/bible_databases/master"
STEP = "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master"
K1611 = "https://raw.githubusercontent.com/aruljohn/Bible-kjv-1611/master"

def get(url, dest):
    dest = os.path.join(CACHE, dest)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(urllib.parse.quote(url, safe=":/%"), headers={"User-Agent": "bible-pwa-build"})
    with urllib.request.urlopen(req, timeout=180) as r, open(dest + ".part", "wb") as f:
        f.write(r.read())
    os.replace(dest + ".part", dest)
    print("got", dest)

jobs = []
for t in ["KJV", "BSB", "ASV", "YLT", "NHEB"]:
    jobs.append((f"{SM}/formats/json/{t}.json", f"text/{t}.json"))
jobs.append((f"{SM}/sources/extras/cross_references.txt", "xrefs.txt"))
for i in IDS:
    jobs.append((f"{K1611}/{NAME[i]}.json", f"kjv1611/{i}.json"))
jobs += [
    (f"{STEP}/Translators Amalgamated OT+NT/TAGNT Mat-Jhn - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt", "tagnt1.txt"),
    (f"{STEP}/Translators Amalgamated OT+NT/TAGNT Act-Rev - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt", "tagnt2.txt"),
    (f"{STEP}/Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt", "tbesg.txt"),
]
# 1611 file for the NT books may not exist under every name; tolerate failures there
def run(j):
    try:
        get(*j)
    except Exception as e:
        print("FAILED", j[1], e)
        return j[1]
with cf.ThreadPoolExecutor(8) as ex:
    failed = [x for x in ex.map(run, jobs) if x]

# Commentaries (Matthew Henry, Spurgeon's Treasury of David): sparse clone, per-chapter JSON
repo = os.path.join(CACHE, "commentaries")
if not os.path.isdir(os.path.join(repo, "en", "henry")):
    if not os.path.isdir(repo):
        subprocess.check_call(["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", "-q",
                               "https://github.com/samueldotj/bible-commentaries", repo])
    subprocess.check_call(["git", "-C", repo, "sparse-checkout", "set", "en/henry", "en/spurgeon"])
print("failed:", failed)
