"""Check every link in links.json and report the ones that are dead.

Run weekly by .github/workflows/check-links.yml, which opens (or updates) one GitHub
issue listing broken links and closes it once they're all fixed.

Many sites block scripts (403, 429, a "checking your browser" page), so only clear signs
count as broken: the domain no longer exists, the server can't be reached, or the page is
gone (404 / 410). Anything else is listed as "couldn't check", not as broken.

Writes report.md (the issue body) and prints a summary. Exit code is always 0; the
workflow reads broken.txt (one count) to decide whether to open or close the issue.
"""

import concurrent.futures
import json
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
GONE = {404, 410}


def check(url):
    """Returns (state, detail, final_url). state: ok / broken / unsure."""
    last = None
    for method in ("HEAD", "GET"):  # some servers reject HEAD, so try GET too
        req = urllib.request.Request(url, method=method, headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return "ok", str(r.status), r.geturl()
        except urllib.error.HTTPError as e:
            last = ("broken" if e.code in GONE else "unsure", f"HTTP {e.code}", e.geturl() or url)
            if e.code in GONE and method == "GET":
                return last
        except urllib.error.URLError as e:
            reason = e.reason
            if isinstance(reason, socket.gaierror):
                return "broken", "domain not found", url
            if isinstance(reason, ConnectionRefusedError):
                return "broken", "connection refused", url
            if isinstance(reason, ssl.SSLCertVerificationError):
                return "broken", "bad security certificate", url
            last = ("unsure", str(reason)[:80], url)
        except (TimeoutError, socket.timeout):
            last = ("unsure", "timed out", url)
        except Exception as e:  # odd servers: never crash the whole check
            last = ("unsure", type(e).__name__, url)
    return last


def host(u):
    h = urllib.parse.urlsplit(u).hostname or ""
    return h[4:] if h.startswith("www.") else h


def main():
    data = json.loads((ROOT / "links.json").read_text())
    links = [(sec["name"], l) for sec in data["sections"] for l in sec["links"]]

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda gl: (gl[0], gl[1], *check(gl[1]["url"])), links))

    broken = [r for r in results if r[2] == "broken"]
    unsure = [r for r in results if r[2] == "unsure"]
    # Works, but ends up on another domain: the site probably moved (worth updating).
    moved = [r for r in results if r[2] == "ok" and host(r[4]).split(".")[-2:] != host(r[1]["url"]).split(".")[-2:]]

    lines = [f"Checked {len(results)} links.", ""]
    if broken:
        lines += ["### Broken", "", "| Link | Group | URL | Problem |", "|---|---|---|---|"]
        lines += [f"| {l['name']} | {g} | {l['url']} | {d} |" for g, l, _, d, _ in broken]
        lines += ["", "Fix or remove them in **Manage Groups & Links**. This issue closes itself on the next check once they all work.", ""]
    if moved:
        lines += ["### Moved to another address", "", "These still work but redirect, so the saved URL is out of date.", "",
                  "| Link | Saved URL | Now at |", "|---|---|---|"]
        lines += [f"| {l['name']} | {l['url']} | {final} |" for g, l, _, _, final in moved]
        lines.append("")
    if unsure:
        lines += ["<details><summary>Couldn't check " + str(len(unsure)) + " (usually bot protection, not a real problem)</summary>", "",
                  "| Link | URL | Answer |", "|---|---|---|"]
        lines += [f"| {l['name']} | {l['url']} | {d} |" for g, l, _, d, _ in unsure]
        lines += ["", "</details>"]

    (ROOT / "report.md").write_text("\n".join(lines) + "\n")
    (ROOT / "broken.txt").write_text(str(len(broken)))
    print(f"{len(results)} checked: {len(broken)} broken, {len(moved)} moved, {len(unsure)} couldn't check")
    for g, l, state, d, final in results:
        if state != "ok" or final != l["url"]:
            print(f"  {state:7} {l['name']}: {d}  {l['url']} -> {final}")


if __name__ == "__main__":
    main()
