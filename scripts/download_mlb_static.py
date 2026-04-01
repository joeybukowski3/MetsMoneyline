import urllib.request
import os
import zipfile
import time

TEAM_FILES = {
    109: "ari",
    144: "atl",
    110: "bal",
    111: "bos",
    112: "chc",
    145: "cws",
    113: "cin",
    114: "cle",
    115: "col",
    116: "det",
    117: "hou",
    118: "kc",
    108: "laa",
    119: "lad",
    146: "mia",
    158: "mil",
    142: "min",
    121: "nym",
    147: "nyy",
    133: "ath",
    143: "phi",
    134: "pit",
    135: "sd",
    137: "sf",
    136: "sea",
    138: "stl",
    139: "tb",
    140: "tex",
    141: "tor",
    120: "wsh",
}

TARGET_DIR = os.path.join("public", "logos", "mlb")
os.makedirs(TARGET_DIR, exist_ok=True)
headers = {"User-Agent": "Mozilla/5.0"}

for team_id, filename in TEAM_FILES.items():
    url = f"https://www.mlbstatic.com/team-logos/{team_id}.svg"
    path = os.path.join(TARGET_DIR, f"{filename}.svg")
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as r, open(path, "wb") as f:
            f.write(r.read())
        print(f"OK  {filename}.svg")
    except Exception as e:
        print(f"FAIL {filename}.svg: {e}")
    time.sleep(0.2)

zip_path = "mlb-logos.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for filename in TEAM_FILES.values():
        p = os.path.join(TARGET_DIR, f"{filename}.svg")
        if os.path.exists(p):
            z.write(p, f"{filename}.svg")

print(f"\nDone! {zip_path} created in your current folder.")
