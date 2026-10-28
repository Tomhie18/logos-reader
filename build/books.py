"""Canonical 66-book table shared by all build scripts.
id   = our id (matches the samueldotj commentary folders)
ob   = OpenBible cross-reference id
step = STEPBible TAGNT id (NT only)
"""
BOOKS = [
 # id, name, openbible, step
 ("GEN","Genesis","Gen",None),("EXO","Exodus","Exod",None),("LEV","Leviticus","Lev",None),
 ("NUM","Numbers","Num",None),("DEU","Deuteronomy","Deut",None),("JOS","Joshua","Josh",None),
 ("JDG","Judges","Judg",None),("RUT","Ruth","Ruth",None),("1SA","1 Samuel","1Sam",None),
 ("2SA","2 Samuel","2Sam",None),("1KI","1 Kings","1Kgs",None),("2KI","2 Kings","2Kgs",None),
 ("1CH","1 Chronicles","1Chr",None),("2CH","2 Chronicles","2Chr",None),("EZR","Ezra","Ezra",None),
 ("NEH","Nehemiah","Neh",None),("EST","Esther","Esth",None),("JOB","Job","Job",None),
 ("PSA","Psalms","Ps",None),("PRO","Proverbs","Prov",None),("ECC","Ecclesiastes","Eccl",None),
 ("SNG","Song of Solomon","Song",None),("ISA","Isaiah","Isa",None),("JER","Jeremiah","Jer",None),
 ("LAM","Lamentations","Lam",None),("EZK","Ezekiel","Ezek",None),("DAN","Daniel","Dan",None),
 ("HOS","Hosea","Hos",None),("JOL","Joel","Joel",None),("AMO","Amos","Amos",None),
 ("OBA","Obadiah","Obad",None),("JON","Jonah","Jonah",None),("MIC","Micah","Mic",None),
 ("NAM","Nahum","Nah",None),("HAB","Habakkuk","Hab",None),("ZEP","Zephaniah","Zeph",None),
 ("HAG","Haggai","Hag",None),("ZEC","Zechariah","Zech",None),("MAL","Malachi","Mal",None),
 ("MAT","Matthew","Matt","Mat"),("MRK","Mark","Mark","Mrk"),("LUK","Luke","Luke","Luk"),
 ("JHN","John","John","Jhn"),("ACT","Acts","Acts","Act"),("ROM","Romans","Rom","Rom"),
 ("1CO","1 Corinthians","1Cor","1Co"),("2CO","2 Corinthians","2Cor","2Co"),("GAL","Galatians","Gal","Gal"),
 ("EPH","Ephesians","Eph","Eph"),("PHP","Philippians","Phil","Php"),("COL","Colossians","Col","Col"),
 ("1TH","1 Thessalonians","1Thess","1Th"),("2TH","2 Thessalonians","2Thess","2Th"),
 ("1TI","1 Timothy","1Tim","1Ti"),("2TI","2 Timothy","2Tim","2Ti"),("TIT","Titus","Titus","Tit"),
 ("PHM","Philemon","Phlm","Phm"),("HEB","Hebrews","Heb","Heb"),("JAS","James","Jas","Jas"),
 ("1PE","1 Peter","1Pet","1Pe"),("2PE","2 Peter","2Pet","2Pe"),("1JN","1 John","1John","1Jn"),
 ("2JN","2 John","2John","2Jn"),("3JN","3 John","3John","3Jn"),("JUD","Jude","Jude","Jud"),
 ("REV","Revelation","Rev","Rev"),
]
assert len(BOOKS) == 66
IDS = [b[0] for b in BOOKS]
NAME = {b[0]: b[1] for b in BOOKS}
BY_OB = {b[2]: b[0] for b in BOOKS}
BY_STEP = {b[3]: b[0] for b in BOOKS if b[3]}
