// Reads links.json and draws the dashboard. No libraries, no build step.
// Changes are saved by committing links.json to the GitHub repo through the
// GitHub API; the normal deploy then publishes them to every device.

const $ = (sel, root = document) => root.querySelector(sel);

const REPO = "tanishqharit/Personal-Browser-Dashboard";
const BRANCH = "main";
const API = `https://api.github.com/repos/${REPO}/contents/`;
// Files committed seconds ago are on raw.githubusercontent before Pages redeploys.
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
// Replaced with the commit id on deploy (see deploy.yml), so browsers fetch changed
// icons and wallpapers right away instead of reusing a cached copy for ~10 minutes.
const VERSION = "?v=dev";

let data = null;
const freshIcons = new Map(); // slug → data URL of icons uploaded in this tab
const loadedIcons = new Set(); // slugs whose icons/<slug>.png exists

// "YouTube Music" → "youtube-music". Used for icon files and URL hashes.
// Must match slug() in scripts/fetch_icons.py.
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const isLocalPath = (icon) => typeof icon === "string" && !icon.startsWith("http");
const clone = (x) => JSON.parse(JSON.stringify(x));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function normalizeUrl(raw) {
  let u = (raw || "").trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes(".") ? parsed.href : null;
  } catch {
    return null;
  }
}

/* Smart add: a name guessed from the address ("music.youtube.com" → "YouTube Music").
   Only a starting point; the name field stays editable. Web pages can't read another
   site's real title (the browser blocks it), so this works from the address alone. */
const KNOWN_NAMES = {
  youtube: "YouTube", github: "GitHub", gitlab: "GitLab", paypal: "PayPal", linkedin: "LinkedIn", chatgpt: "ChatGPT",
  openai: "OpenAI", imdb: "IMDb", tiktok: "TikTok", whatsapp: "WhatsApp", icloud: "iCloud", ebay: "eBay", hm: "H&M",
  bestbuy: "Best Buy", stubhub: "StubHub", seatgeek: "SeatGeek", tickpick: "TickPick", doordash: "DoorDash",
  ubereats: "Uber Eats", airbnb: "Airbnb", hbomax: "HBO Max", primevideo: "Prime Video", disneyplus: "Disney+",
  duckduckgo: "DuckDuckGo", soundcloud: "SoundCloud", stackoverflow: "Stack Overflow", wellsfargo: "Wells Fargo",
  bankofamerica: "Bank of America", americanexpress: "American Express", capitalone: "Capital One",
  creditkarma: "Credit Karma", notebooklm: "NotebookLM", myunidays: "UNiDAYS", rocketmoney: "Rocket Money",
  amctheatres: "AMC Theatres", regmovies: "Regal", playstation: "PlayStation", underarmour: "Under Armour",
  thenorthface: "The North Face", bathandbodyworks: "Bath & Body Works", x: "X", ra: "Resident Advisor", dice: "DICE",
};
const GOOGLE_APPS = {
  mail: "Gmail", drive: "Google Drive", docs: "Google Docs", sheets: "Google Sheets", slides: "Google Slides",
  calendar: "Google Calendar", photos: "Google Photos", maps: "Google Maps", meet: "Google Meet", keep: "Google Keep",
  news: "Google News", translate: "Google Translate", gemini: "Gemini", myaccount: "Google Account", notebooklm: "NotebookLM",
};
const PRODUCT_SUBDOMAINS = new Set(["music", "tv", "studio", "maps", "news", "cloud", "pay", "photos"]);

function guessName(raw) {
  const url = normalizeUrl(raw);
  if (!url) return "";
  const labels = new URL(url).hostname.toLowerCase().replace(/^www\d*\./, "").split(".");
  // "bbc.co.uk": the name is the label before "co.uk", not "co"
  const twoPart = labels.length > 2 && labels.at(-1).length === 2 && ["co", "com", "org", "net", "gov", "ac"].includes(labels.at(-2));
  const at = labels.length - (twoPart ? 3 : 2);
  const label = labels[Math.max(0, at)];
  const sub = at > 0 ? labels[at - 1] : "";
  if (label === "google" && GOOGLE_APPS[sub]) return GOOGLE_APPS[sub];
  const brand = KNOWN_NAMES[label] || label.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return PRODUCT_SUBDOMAINS.has(sub) ? `${brand} ${sub.charAt(0).toUpperCase() + sub.slice(1)}` : brand;
}

// A site's own small icon from Google's favicon service: shown for a new link until the
// deploy has downloaded its proper icon (about a minute).
const faviconUrl = (url) => {
  try { return `https://www.google.com/s2/favicons?sz=128&domain=${new URL(url).hostname}`; } catch { return ""; }
};
const pendingFavicons = new Map(); // slug → URL of links added in this tab, until their icon exists

function svg(paths) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = paths;
  return el;
}
const ICON = {
  grip: '<path d="M5 8h14M5 12h14M5 16h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

// First character the user sees (an emoji can be several code points).
function firstGrapheme(text) {
  const t = (text || "").trim();
  if (!t) return "";
  if (typeof Intl !== "undefined" && Intl.Segmenter) return new Intl.Segmenter().segment(t)[Symbol.iterator]().next().value.segment;
  return [...t][0];
}

function iconButton(name, label, onClick, extra = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `icon-btn ${extra}`.trim();
  b.title = label;
  b.setAttribute("aria-label", label);
  b.append(svg(ICON[name]));
  b.onclick = onClick;
  return b;
}

/* ---------- Drawing the dashboard ---------- */

// Icon style: "light" (original icons) or "dark" (graphite versions). Dark by default.
// A viewing preference, so it's saved per browser rather than in the repo.
const ICON_MODES = ["light", "dark"];
let iconMode = (() => { try { return localStorage.getItem("icon-theme"); } catch { return null; } })();
if (!ICON_MODES.includes(iconMode)) iconMode = "dark";
const useDarkIcons = () => iconMode === "dark";

// Open links in this tab (a start page) or a new one. Also per browser.
let linkTarget = (() => { try { return localStorage.getItem("link-target"); } catch { return null; } })();
if (linkTarget !== "new") linkTarget = "same";

// Icon priority: icon uploaded this session → local "icon" path or icons/<slug>.png
// → same file on raw.githubusercontent (just committed) → colored letter tile.
// (An "icon" URL in links.json is only a download source for scripts/fetch_icons.py.)
function iconBox(link) {
  const box = document.createElement("span");
  box.className = "icon";

  const s = slug(link.name);
  const path = isLocalPath(link.icon) ? link.icon : `icons/${s}.png`;
  // Dark mode: the iOS-style dark version from scripts/dark_icons.py, if it exists yet.
  const darkPath = path.replace(/^icons\//, "icons/dark/");
  const local = useDarkIcons() && darkPath !== path ? [darkPath, path] : [path];
  const sources = freshIcons.has(s) ? [freshIcons.get(s)] : [...local, ...local.map((p) => RAW + p)].map((u) => u + VERSION);

  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => { if (path === `icons/${s}.png`) loadedIcons.add(s); };
  img.onerror = () => {
    sources.shift();
    if (sources.length) { img.src = sources[0]; return; }
    if (pendingFavicons.has(s)) return void box.replaceWith(faviconBox(pendingFavicons.get(s), link.name));
    setLetter(box, link.name);
  };
  img.src = sources[0];
  box.append(img);
  return box;
}

function setLetter(box, name) {
  const s = document.createElement("span");
  s.className = "letter";
  s.textContent = (name.trim()[0] || "?").toUpperCase();
  box.replaceChildren(s);
  box.style.background = colorFor(name || "?");
}

function letterBox(name) {
  const box = document.createElement("span");
  box.className = "icon";
  setLetter(box, name);
  return box;
}

// The favicon sits small on a white tile, like the real icons do; letter tile if it fails.
function faviconBox(url, name) {
  const box = document.createElement("span");
  box.className = "icon favicon";
  const img = new Image();
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => { box.classList.remove("favicon"); setLetter(box, name || "?"); };
  img.src = faviconUrl(url);
  box.append(img);
  return box;
}

function imageBox(src) {
  const box = document.createElement("span");
  box.className = "icon";
  const img = new Image();
  img.src = src;
  box.append(img);
  return box;
}

function wrapIcon(box) {
  const wrap = document.createElement("span");
  wrap.className = "icon-wrap";
  wrap.append(box);
  return wrap;
}

// Same name always gets the same color.
function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}

function linkTile(link) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = link.url;
  a.rel = "noreferrer";
  a.dataset.link = slug(link.name);
  if (linkTarget === "new") a.target = "_blank";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = link.name;
  // List view also shows where the link goes (hidden in icon view).
  const host = document.createElement("span");
  host.className = "host";
  try { host.textContent = new URL(link.url).hostname.replace(/^www\./, ""); } catch {}
  const text = document.createElement("span");
  text.className = "tile-text";
  text.append(label, host);
  a.append(wrapIcon(iconBox(link)), text);
  return a;
}

function render() {
  document.title = data.title || "Dashboard";

  $("#sections").replaceChildren(...data.sections.map((sec) => {
    const section = document.createElement("section");
    section.dataset.slug = slug(sec.name);
    section.setAttribute("aria-label", sec.name); // the sidebar shows the name, so no visible heading
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.append(...sec.links.map(linkTile));
    if (!sec.links.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No links yet.";
      grid.append(empty);
    }
    section.append(grid);
    return section;
  }));

  $("#groups").replaceChildren(...data.sections.map((sec, i) => {
    const a = document.createElement("a");
    a.href = `#${slug(sec.name)}`;
    a.dataset.slug = slug(sec.name);
    if (i < 9) a.title = `${sec.name} (${i + 1})`; // number keys switch groups
    if (sec.emoji) {
      const e = document.createElement("span");
      e.className = "g-emoji";
      e.setAttribute("aria-hidden", "true");
      e.textContent = sec.emoji;
      a.append(e);
    }
    a.append(sec.name);
    return a;
  }));

  show();
  applyWallpaper();
}

// Shows the group named in the URL hash; no hash (or unknown) → the first group.
function show() {
  const want = location.hash.slice(1);
  const known = data.sections.some((s) => slug(s.name) === want);
  const current = known ? want : slug(data.sections[0]?.name || "");

  for (const s of document.querySelectorAll("#sections section")) {
    s.classList.toggle("hidden", s.dataset.slug !== current);
  }
  for (const a of document.querySelectorAll("#groups a")) {
    const on = a.dataset.slug === current;
    a.classList.toggle("active", on);
    if (on) {
      a.setAttribute("aria-current", "page");
      a.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else {
      a.removeAttribute("aria-current");
    }
  }
}
window.addEventListener("hashchange", show);

/* ---------- links.json helpers ---------- */

const findGroup = (d, groupSlug) => d.sections.find((s) => slug(s.name) === groupSlug);

function findLink(d, linkSlug) {
  for (const section of d.sections) {
    const i = section.links.findIndex((l) => slug(l.name) === linkSlug);
    if (i >= 0) return { section, index: i, link: section.links[i] };
  }
  return null;
}

// Same layout as the hand-written file: one link per line.
function serialize(d) {
  const lines = ["{", `  "title": ${JSON.stringify(d.title)},`];
  if (d.wallpaper) lines.push(`  "wallpaper": ${JSON.stringify(d.wallpaper)},`);
  if (d.wallpaper && d.wallpaperDim !== undefined) lines.push(`  "wallpaperDim": ${JSON.stringify(d.wallpaperDim)},`);
  if (d.wallpaper && d.wallpaperBlur) lines.push(`  "wallpaperBlur": ${JSON.stringify(d.wallpaperBlur)},`);
  lines.push('  "sections": [');
  d.sections.forEach((s, si) => {
    lines.push("    {", `      "name": ${JSON.stringify(s.name)},`);
    if (s.emoji) lines.push(`      "emoji": ${JSON.stringify(s.emoji)},`);
    lines.push('      "links": [');
    s.links.forEach((l, li) => {
      const fields = Object.entries(l).map(([k, v]) =>
        `${JSON.stringify(k)}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(v)}`);
      lines.push(`        {${fields.join(", ")}}${li < s.links.length - 1 ? "," : ""}`);
    });
    lines.push("      ]", `    }${si < d.sections.length - 1 ? "," : ""}`);
  });
  lines.push("  ]", "}");
  return lines.join("\n") + "\n";
}

/* ---------- GitHub ---------- */

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  remove: (k) => { try { localStorage.removeItem(k); } catch {} },
};
const token = {
  get: () => store.get("gh-token"),
  login: () => store.get("gh-login"),
  set: (t, login) => { store.set("gh-token", t); store.set("gh-login", login || ""); store.remove("gh-invalid"); },
  clear: () => { for (const k of ["gh-token", "gh-login", "gh-expiry", "gh-invalid"]) store.remove(k); },
  // GitHub doesn't let web pages read a token's expiry, so it's the date typed in when connecting.
  expiry: () => store.get("gh-expiry") || "",
  setExpiry: (d) => (d ? store.set("gh-expiry", d) : store.remove("gh-expiry")),
};

// Whole days from today until the token's expiry date (negative once it's past), or null.
function daysLeft() {
  const d = token.expiry();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, m, day] = d.split("-").map(Number);
  const today = new Date();
  return Math.round((new Date(y, m - 1, day) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
}

// "off" (no token), "bad" (rejected or expired), "warn" (expires within a week) or "on".
function tokenHealth() {
  if (!token.get()) return "off";
  const left = daysLeft();
  if (store.get("gh-invalid") || (left !== null && left < 0)) return "bad";
  if (left !== null && left <= 7) return "warn";
  return "on";
}

async function ghFetch(url, options = {}, tok = token.get()) {
  const r = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (r.ok) return r.json();
  if (r.status === 404 && (options.method || "GET") === "GET") return null;
  if (r.status === 401) {
    if (tok && tok === token.get()) { store.set("gh-invalid", "1"); updateDot(); }
    throw new Error("The GitHub token is invalid or expired. Update it in GitHub Connection.");
  }
  if (r.status === 403 || r.status === 404) throw new Error("This token can't write to the repo. It needs Contents: Read and write on Personal-Browser-Dashboard.");
  if (r.status === 409) throw Object.assign(new Error("Someone else saved at the same time."), { conflict: true });
  throw new Error(`GitHub returned an error (${r.status}).`);
}
const gh = (path, options, tok) => ghFetch(API + path, options, tok);

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function readRemote() {
  const file = await gh(`links.json?ref=${BRANCH}`);
  if (!file) throw new Error("links.json wasn't found in the repo.");
  return { json: JSON.parse(fromBase64(file.content)), sha: file.sha };
}

async function putFile(path, base64, message) {
  const existing = await gh(`${path}?ref=${BRANCH}`);
  await gh(path, {
    method: "PUT",
    body: JSON.stringify({ message, content: base64, branch: BRANCH, ...(existing ? { sha: existing.sha } : {}) }),
  });
}

// Best effort: a leftover file is harmless, so failures are ignored.
async function deleteFile(path, message) {
  try {
    const existing = await gh(`${path}?ref=${BRANCH}`);
    if (existing) await gh(path, { method: "DELETE", body: JSON.stringify({ message, sha: existing.sha, branch: BRANCH }) });
  } catch {}
}

const putLinks = (json, sha, message) => gh("links.json", {
  method: "PUT",
  body: JSON.stringify({ message, content: toBase64(new TextEncoder().encode(serialize(json))), sha, branch: BRANCH }),
});

function requireConnection() {
  if (token.get()) return;
  openGithub("Connect GitHub to save changes from this browser.");
  throw new Error("Connect GitHub first, then try again.");
}

// Applies `change` to the latest links.json on GitHub and commits it.
// Starting from the remote copy means edits from another device are never lost.
async function save(change, message, icon) {
  requireConnection();
  if (icon) await putFile(icon.path, icon.base64, `Upload icon: ${icon.path}`);
  for (let attempt = 0; ; attempt++) {
    const { json, sha } = await readRemote();
    change(json);
    try {
      await putLinks(json, sha, message);
      data = json;
      render();
      return;
    } catch (err) {
      if (!err.conflict || attempt >= 2) throw err;
    }
  }
}

/* ---------- Icon upload: resize to a 256px PNG in the browser ---------- */

async function iconFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 256, h = img.naturalHeight || 256;

    // Look at the image small to decide: full-bleed icon, or logo that needs a tile.
    const probe = document.createElement("canvas");
    probe.width = probe.height = 48;
    const pc = probe.getContext("2d", { willReadFrequently: true });
    const ps = Math.min(48 / w, 48 / h);
    pc.drawImage(img, (48 - w * ps) / 2, (48 - h * ps) / 2, w * ps, h * ps);
    const px = pc.getImageData(0, 0, 48, 48).data;
    let clear = 0, lum = 0, solid = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) { clear++; continue; }
      solid++;
      lum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }

    const S = 256;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";

    if (clear / (48 * 48) < 0.03) {
      // Opaque: crop to a square and fill.
      const side = Math.min(w, h);
      ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, S, S);
    } else {
      // Transparent logo: solid tile it shows up on, logo padded in the middle.
      ctx.fillStyle = solid && lum / solid > 200 ? "#1c1c1e" : "#ffffff";
      ctx.fillRect(0, 0, S, S);
      const inner = S * 0.62, s = Math.min(inner / w, inner / h);
      ctx.drawImage(img, (S - w * s) / 2, (S - h * s) / 2, w * s, h * s);
    }
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- Toast ---------- */

let toastTimer;
// A popover sits in the top layer, so the toast shows above open dialogs too.
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  try { el.hidePopover(); el.showPopover(); } catch {}
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    toastTimer = setTimeout(() => { try { el.hidePopover(); } catch {} }, 250);
  }, 2800);
}

function setDisabled(root, on) {
  for (const el of root.querySelectorAll("button, input, select")) el.disabled = on;
}

/* ---------- Manage Groups & Links ---------- */
// Edits a working copy; nothing is written until "Save Changes", which makes one commit.

const manager = $("#manager");
const mgr = {
  base: null, // links.json as it was when the panel opened
  work: null, // the copy being edited
  selected: 0, // index of the group shown on the right
  icons: new Map(), // link object → data URL of a new icon
  origName: new WeakMap(), // link object → its name when the panel opened
  confirming: false, // showing the "delete group?" bar
  iconTarget: null, // link whose icon is being picked
  refetch: new Set(), // links whose icon is deleted on save, so the deploy downloads it again
  picked: new Set(), // ticked links in the shown group, for moving or deleting several at once
  autoNamed: new WeakSet(), // new links whose name was guessed from the address (replaced as the address changes)
};

const looksLikeUrl = (text) => /^(https?:\/\/)?[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text.trim());

function startEditing(json) {
  mgr.base = clone(json);
  mgr.work = clone(json);
  mgr.icons.clear();
  mgr.refetch.clear();
  mgr.picked.clear();
  mgr.autoNamed = new WeakSet();
  mgr.origName = new WeakMap();
  for (const g of mgr.work.sections) for (const l of g.links) mgr.origName.set(l, l.name);
  mgr.selected = Math.max(0, Math.min(mgr.selected, mgr.work.sections.length - 1));
  mgr.confirming = false;
  setStatus("");
}

function openManager() {
  mgr.selected = Math.max(0, data.sections.findIndex((s) => slug(s.name) === location.hash.slice(1)));
  startEditing(data);
  renderManager();
  manager.showModal();
}

const isDirty = () => mgr.icons.size > 0 || mgr.refetch.size > 0 || serialize(mgr.work) !== serialize(mgr.base);

function setStatus(message, sticky = false) {
  const status = $("#mgr-status");
  status.textContent = message;
  if (sticky) status.dataset.sticky = "1";
  else delete status.dataset.sticky;
}

function updateFooter() {
  const dirty = isDirty();
  $("#mgr-save").disabled = !dirty;
  $("#mgr-discard").disabled = !dirty;
  const status = $("#mgr-status");
  if (!status.dataset.sticky) status.textContent = dirty ? "Unsaved changes" : "";
  status.classList.toggle("dirty", dirty && !status.dataset.sticky);
}

// Any edit clears an old error in the footer.
function touched() {
  delete $("#mgr-status").dataset.sticky;
  updateFooter();
}

function renderManager() {
  delete $("#mgr-status").dataset.sticky;
  renderGroupList();
  renderGroupPane();
  updateFooter();
}

function renderGroupList() {
  $("#mgr-group-list").replaceChildren(...mgr.work.sections.map((g, i) => {
    const li = document.createElement("li");
    li.className = "group-row" + (i === mgr.selected ? " selected" : "");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "group-item";
    const name = document.createElement("span");
    name.textContent = `${g.emoji ? g.emoji + " " : ""}${g.name || "Untitled group"}`;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = g.links.length;
    b.append(name, count);
    b.onclick = () => { mgr.selected = i; mgr.confirming = false; mgr.picked.clear(); renderManager(); };
    li.append(b, gripButton(`Reorder ${g.name || "group"}`));
    return li;
  }));
}

makeSortable($("#mgr-group-list"), "#mgr-group-list", (from, to) => {
  const s = mgr.work.sections;
  const selected = s[mgr.selected];
  s.splice(to, 0, ...s.splice(from, 1));
  mgr.selected = s.indexOf(selected);
  renderManager();
});

function renderGroupPane() {
  const pane = $("#mgr-group-pane");
  const groups = mgr.work.sections;
  const g = groups[mgr.selected];
  if (!g) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<strong>No groups yet</strong><p>Create one with the ＋ next to “Groups”.</p>";
    pane.replaceChildren(empty);
    return;
  }

  // Header: emoji + editable group name + delete
  const head = document.createElement("div");
  head.className = "pane-head";
  const emoji = document.createElement("input");
  emoji.className = "emoji-input";
  emoji.value = g.emoji || "";
  emoji.placeholder = "☺";
  emoji.title = "Emoji shown next to the group in the sidebar (optional)";
  emoji.setAttribute("aria-label", "Group emoji (optional)");
  emoji.oninput = () => {
    const e = firstGrapheme(emoji.value);
    if (e) g.emoji = e;
    else delete g.emoji;
    emoji.value = e;
    renderGroupList();
    touched();
  };
  const title = document.createElement("input");
  title.className = "title-input";
  title.value = g.name;
  title.maxLength = 30;
  title.setAttribute("aria-label", "Group name");
  title.oninput = () => { g.name = title.value; renderGroupList(); touched(); };
  const tools = document.createElement("div");
  tools.className = "tools";
  tools.append(iconButton("trash", "Delete group", () => { mgr.confirming = true; renderGroupPane(); }, "danger"));
  head.append(emoji, title, tools);

  const parts = [head];
  if (mgr.confirming) parts.push(deleteGroupBar(g));
  const bulk = document.createElement("div");
  bulk.id = "bulk-slot";
  parts.push(bulk);

  const list = document.createElement("ul");
  list.className = "link-list";
  list.append(...g.links.map((l, i) => linkRow(g, l, i)));
  makeSortable(list, "#mgr-group-pane .link-list", (from, to) => {
    g.links.splice(to, 0, ...g.links.splice(from, 1));
    renderManager();
  });
  if (!g.links.length) {
    const li = document.createElement("li");
    li.className = "empty-row";
    li.textContent = "No links in this group.";
    list.append(li);
  }
  parts.push(list);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "add-row";
  add.append(svg(ICON.plus), "Add link");
  add.onclick = () => {
    g.links.push({ name: "", url: "" });
    renderManager();
    $("#mgr-group-pane .link-row:last-child .row-name").focus();
  };
  parts.push(add);
  pane.replaceChildren(...parts);
  renderBulkBar();
}

// Shown while links are ticked: move them all to another group, or delete them.
function renderBulkBar() {
  const slot = $("#bulk-slot");
  const g = mgr.work.sections[mgr.selected];
  if (!slot || !g) return;
  for (const l of mgr.picked) if (!g.links.includes(l)) mgr.picked.delete(l);
  const n = mgr.picked.size;
  if (!n) return void slot.replaceChildren();

  const bar = document.createElement("div");
  bar.className = "bulk-bar";
  const count = document.createElement("strong");
  count.textContent = `${n} selected`;
  const all = document.createElement("button");
  all.type = "button";
  all.className = "linklike";
  const everything = n === g.links.length;
  all.textContent = everything ? "Select none" : "Select all";
  all.onclick = () => {
    if (everything) mgr.picked.clear();
    else for (const l of g.links) mgr.picked.add(l);
    renderGroupPane();
  };
  const others = mgr.work.sections.filter((s) => s !== g);
  const move = document.createElement("select");
  move.setAttribute("aria-label", "Move selected links to");
  move.append(new Option("Move to…", ""), ...others.map((s, i) => new Option(s.name || "Untitled group", String(i))));
  move.disabled = !others.length;
  move.onchange = () => {
    if (move.value === "") return;
    const target = others[Number(move.value)];
    const moving = g.links.filter((l) => mgr.picked.has(l)); // keeps their order
    g.links = g.links.filter((l) => !mgr.picked.has(l));
    target.links.push(...moving);
    mgr.picked.clear();
    renderManager();
    toast(`Moved ${plural(moving.length, "link")} to ${target.name}. Save to apply.`);
  };
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn danger";
  del.textContent = "Delete";
  del.onclick = () => {
    for (const l of mgr.picked) { mgr.icons.delete(l); mgr.refetch.delete(l); }
    g.links = g.links.filter((l) => !mgr.picked.has(l));
    mgr.picked.clear();
    renderManager();
  };
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  bar.append(count, all, spacer, move, del, iconButton("close", "Clear selection", () => { mgr.picked.clear(); renderGroupPane(); }));
  slot.replaceChildren(bar);
}

function deleteGroupBar(g) {
  const bar = document.createElement("div");
  bar.className = "confirm-bar";
  const label = g.name || "Untitled group";
  const others = mgr.work.sections.filter((s) => s !== g);
  const text = document.createElement("span");
  let choice = null;
  if (g.links.length) {
    text.textContent = `Delete “${label}”? Its ${plural(g.links.length, "link")}:`;
    choice = document.createElement("select");
    choice.setAttribute("aria-label", "What happens to its links");
    choice.append(
      ...others.map((s, i) => new Option(`Move to ${s.name || "Untitled group"}`, String(i))),
      new Option("Delete them too", "delete"),
    );
  } else {
    text.textContent = `Delete the empty group “${label}”?`;
  }
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  cancel.onclick = () => { mgr.confirming = false; renderGroupPane(); };
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "btn danger-fill";
  ok.textContent = "Delete Group";
  ok.onclick = () => {
    if (choice && choice.value !== "delete") others[Number(choice.value)].links.push(...g.links);
    else for (const l of g.links) { mgr.icons.delete(l); mgr.refetch.delete(l); }
    mgr.work.sections.splice(mgr.work.sections.indexOf(g), 1);
    mgr.selected = Math.max(0, Math.min(mgr.selected, mgr.work.sections.length - 1));
    mgr.confirming = false;
    renderManager();
  };
  bar.append(text, ...(choice ? [choice] : []), cancel, ok);
  return bar;
}

function linkRow(g, link, i) {
  const li = document.createElement("li");
  li.className = "link-row" + (mgr.refetch.has(link) ? " refetching" : "") + (mgr.picked.has(link) ? " picked" : "");

  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "row-check";
  check.checked = mgr.picked.has(link);
  check.setAttribute("aria-label", `Select ${link.name || "new link"}`);
  check.onchange = () => {
    if (check.checked) mgr.picked.add(link);
    else mgr.picked.delete(link);
    li.classList.toggle("picked", check.checked);
    renderBulkBar();
  };

  const iconBtn = document.createElement("button");
  iconBtn.type = "button";
  iconBtn.className = "row-icon";
  iconBtn.title = "Change icon";
  iconBtn.setAttribute("aria-label", `Change icon for ${link.name || "new link"}`);
  const orig = mgr.origName.get(link);
  // A new link previews the site's own icon as soon as its address is valid.
  const newLinkBox = () => (normalizeUrl(link.url) ? faviconBox(normalizeUrl(link.url), link.name) : letterBox(link.name || "?"));
  const box = mgr.icons.has(link) ? imageBox(mgr.icons.get(link))
    : orig !== undefined ? iconBox({ ...link, name: orig })
    : newLinkBox();
  iconBtn.append(wrapIcon(box));
  let previewTimer;
  const refreshPreview = () => {
    if (orig !== undefined || mgr.icons.has(link)) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => iconBtn.querySelector(".icon-wrap").replaceWith(wrapIcon(newLinkBox())), 350);
  };
  iconBtn.onclick = () => { mgr.iconTarget = link; $("#mgr-file").click(); };
  if (mgr.refetch.has(link)) {
    iconBtn.title = "Icon will be downloaded again after saving";
    const badge = document.createElement("span");
    badge.className = "refetch-badge";
    badge.append(svg(ICON.refresh));
    iconBtn.append(badge);
  }

  const fields = document.createElement("div");
  fields.className = "row-fields";
  const name = document.createElement("input");
  name.className = "row-name";
  name.placeholder = orig === undefined ? "Name, or paste a link" : "Name";
  name.value = link.name;
  name.maxLength = 40;
  name.setAttribute("aria-label", "Link name");
  name.oninput = () => {
    // A link pasted into the name box goes where it belongs, and the name is filled in.
    if (orig === undefined && !link.url.trim() && looksLikeUrl(name.value)) {
      link.url = url.value = name.value.trim();
      link.name = name.value = guessName(link.url);
      mgr.autoNamed.add(link);
      name.select();
      refreshPreview();
    } else {
      link.name = name.value;
      mgr.autoNamed.delete(link); // typed by hand: keep it
    }
    touched();
  };
  const url = document.createElement("input");
  url.className = "row-url";
  url.placeholder = "https://";
  url.value = link.url;
  url.inputMode = "url";
  url.autocapitalize = "off";
  url.spellcheck = false;
  url.setAttribute("aria-label", "Link URL");
  url.oninput = () => {
    link.url = url.value;
    if (orig === undefined && (!link.name.trim() || mgr.autoNamed.has(link))) {
      link.name = name.value = guessName(url.value);
      mgr.autoNamed.add(link);
    }
    refreshPreview();
    touched();
  };
  fields.append(name, url);

  const move = document.createElement("select");
  move.className = "row-group";
  move.setAttribute("aria-label", "Group");
  move.append(...mgr.work.sections.map((s, si) => new Option(s.name || "Untitled group", String(si), false, s === g)));
  move.onchange = () => {
    const target = mgr.work.sections[Number(move.value)];
    g.links.splice(g.links.indexOf(link), 1);
    target.links.push(link);
    renderManager();
    toast(`Moved to ${target.name}. Save to apply.`);
  };

  const tools = document.createElement("div");
  tools.className = "tools";
  // Only saved links have an icon to download again.
  if (mgr.origName.has(link)) {
    const on = mgr.refetch.has(link);
    const again = iconButton("refresh", on ? "Keep the current icon" : "Download the icon again", () => {
      if (mgr.refetch.has(link)) mgr.refetch.delete(link);
      else { mgr.refetch.add(link); mgr.icons.delete(link); }
      renderManager();
    }, on ? "active" : "");
    again.setAttribute("aria-pressed", on);
    tools.append(again);
  }
  tools.append(iconButton("trash", "Delete link", () => {
    g.links.splice(g.links.indexOf(link), 1);
    mgr.icons.delete(link);
    mgr.refetch.delete(link);
    mgr.picked.delete(link);
    renderManager();
  }, "danger"), gripButton(`Reorder ${link.name || "link"}`));

  li.append(check, iconBtn, fields, move, tools);
  return li;
}

function gripButton(label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "grip";
  b.title = "Drag to reorder";
  b.setAttribute("aria-label", `${label} (drag, or use arrow keys)`);
  b.append(svg(ICON.grip));
  return b;
}

/* Drag to reorder, iPhone style: grab an item's ≡ handle and it lifts and follows the
   pointer (mouse, trackpad or finger) while its neighbours slide out of the way.
   Built on pointer events because HTML drag-and-drop doesn't work on touch screens.
   The handle also works from the keyboard with the arrow keys.
   onMove(from, to) updates the data; `selector` finds the list again after a re-render. */
function makeSortable(list, selector, onMove) {
  const items = (l = list) => [...l.children].filter((el) => el.querySelector(".grip"));
  const isRow = () => {
    const cs = getComputedStyle(list);
    return cs.display.includes("flex") && cs.flexDirection.startsWith("row");
  };

  list.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".grip");
    if (!grip || e.button > 0) return;
    e.preventDefault();
    const item = grip.closest("li");
    const horizontal = isRow();
    const axis = horizontal ? "X" : "Y";
    const pos = (ev) => (horizontal ? ev.clientX : ev.clientY);
    const offset = (el) => (horizontal ? el.offsetLeft : el.offsetTop);
    const size = (el) => (horizontal ? el.offsetWidth : el.offsetHeight);
    const from = items().indexOf(item);
    let start = pos(e);
    let last = e; // latest pointer position, for auto-scroll

    // Nearest scrollable box along the drag axis (the panel, or the phone's group strip).
    let scroller = list;
    while (scroller && !(horizontal ? scroller.scrollWidth > scroller.clientWidth && /auto|scroll/.test(getComputedStyle(scroller).overflowX)
                                    : scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
      scroller = scroller.parentElement;
    }

    // Animate a neighbour from where it was to its new slot.
    const slide = (el, delta) => {
      el.style.transition = "none";
      el.style.transform = `translate${axis}(${delta}px)`;
      el.getBoundingClientRect();
      el.style.transition = "transform .18s ease";
      el.style.transform = "";
    };

    const move = (ev) => {
      last = ev;
      const all = items();
      const i = all.indexOf(item);
      const next = all[i + 1], prev = all[i - 1];
      const d = pos(ev) - start;
      // Swap once the item has travelled past the middle of its neighbour. The neighbour is
      // what moves in the DOM: moving the dragged item itself would drop its pointer capture.
      for (const [other, passed, place] of [[next, d > (next ? size(next) / 2 : Infinity), "before"], [prev, d < (prev ? -size(prev) / 2 : -Infinity), "after"]]) {
        if (!other || !passed) continue;
        const itemWas = offset(item), otherWas = offset(other);
        item[place](other);
        start += offset(item) - itemWas;
        slide(other, otherWas - offset(other));
        break;
      }
      item.style.transform = `translate${axis}(${pos(ev) - start}px)`;
    };

    // Holding the item near the edge of a long list scrolls it, like iOS.
    let raf = 0;
    const autoScroll = () => {
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const lo = horizontal ? r.left : r.top, hi = horizontal ? r.right : r.bottom;
        const p = pos(last), edge = 48;
        const speed = p < lo + edge ? -Math.ceil((lo + edge - p) / 4) : p > hi - edge ? Math.ceil((p - (hi - edge)) / 4) : 0;
        if (speed) {
          const prop = horizontal ? "scrollLeft" : "scrollTop";
          const was = scroller[prop];
          scroller[prop] += speed;
          start -= scroller[prop] - was; // the list moved under the pointer
          move(last);
        }
      }
      raf = requestAnimationFrame(autoScroll);
    };

    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
      grip.removeEventListener("lostpointercapture", end);
      item.style.transition = "transform .15s ease";
      item.style.transform = "";
      const to = items().indexOf(item);
      setTimeout(() => {
        item.classList.remove("dragging");
        item.style.transition = "";
        if (to !== from) onMove(from, to);
      }, 160);
    };

    item.classList.add("dragging");
    grip.setPointerCapture(e.pointerId);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    grip.addEventListener("lostpointercapture", end);
    raf = requestAnimationFrame(autoScroll);
  });

  list.addEventListener("keydown", (e) => {
    const grip = e.target.closest(".grip");
    if (!grip) return;
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const from = items().indexOf(grip.closest("li"));
    const to = from + step;
    if (to < 0 || to >= items().length) return;
    onMove(from, to);
    const fresh = document.querySelector(selector);
    if (fresh) items(fresh)[to]?.querySelector(".grip").focus();
  });
}

$("#mgr-add-group").addEventListener("click", () => {
  const taken = new Set(mgr.work.sections.map((s) => slug(s.name)));
  let name = "New Group";
  for (let n = 2; taken.has(slug(name)); n++) name = `New Group ${n}`;
  mgr.work.sections.push({ name, links: [] });
  mgr.selected = mgr.work.sections.length - 1;
  mgr.confirming = false;
  renderManager();
  const title = $("#mgr-group-pane .title-input");
  title.focus();
  title.select();
});

$("#mgr-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !mgr.iconTarget) return;
  try {
    mgr.icons.set(mgr.iconTarget, await iconFromFile(file));
    mgr.refetch.delete(mgr.iconTarget);
    renderManager();
  } catch {
    toast("Couldn't read that image. Try a PNG, JPG or SVG.");
  }
});

// Tidies names/URLs in place. Returns an error message (and selects that group), or null.
function validate(work) {
  const groupSlugs = new Set(), linkSlugs = new Set();
  for (const [gi, g] of work.sections.entries()) {
    const fail = (msg) => { mgr.selected = gi; mgr.confirming = false; return msg; };
    g.name = g.name.trim();
    const gs = slug(g.name);
    if (!gs.replace(/-/g, "")) return fail("Every group needs a name.");
    if (groupSlugs.has(gs)) return fail(`Two groups are called “${g.name}”.`);
    groupSlugs.add(gs);
    for (const l of g.links) {
      l.name = l.name.trim();
      const ls = slug(l.name);
      if (!ls.replace(/-/g, "")) return fail(`A link in “${g.name}” has no name.`);
      if (linkSlugs.has(ls)) return fail(`Two links are called “${l.name}”.`);
      linkSlugs.add(ls);
      if (!normalizeUrl(l.url)) return fail(`“${l.name}” has a URL that doesn't look right.`);
      // Leave full URLs exactly as typed; only fill in "https://" when it's missing.
      l.url = /^https?:\/\//i.test(l.url.trim()) ? l.url.trim() : normalizeUrl(l.url);
    }
  }
  return null;
}

$("#mgr-save").addEventListener("click", async () => {
  const work = mgr.work;
  const error = validate(work);
  if (error) {
    renderManager();
    setStatus(error, true);
    return;
  }
  try {
    requireConnection();
  } catch (err) {
    setStatus(err.message, true);
    return;
  }

  // Uploaded icons are stored under the link's final name; renamed links keep their old icon file.
  const uploads = [];
  const stale = new Set(); // icon files to delete so the deploy fetches them again
  for (const g of work.sections) for (const l of g.links) {
    const orig = mgr.origName.get(l);
    if (mgr.icons.has(l)) {
      delete l.icon;
      uploads.push({ link: l, url: mgr.icons.get(l) });
    } else if (mgr.refetch.has(l)) {
      for (const p of [`icons/${slug(l.name)}.png`, `icons/${slug(orig)}.png`, isLocalPath(l.icon) ? l.icon : null]) {
        if (p) stale.add(p).add(p.replace(/^icons\//, "icons/dark/"));
      }
      if (isLocalPath(l.icon)) delete l.icon; // an "icon" URL stays: it's where the download comes from
      freshIcons.delete(slug(l.name));
      loadedIcons.delete(slug(l.name));
    } else if (orig !== undefined && slug(orig) !== slug(l.name) && !l.icon && loadedIcons.has(slug(orig))) {
      l.icon = `icons/${slug(orig)}.png`;
    }
  }

  setDisabled(manager, true);
  setStatus("Saving…", true);
  let saved = false;
  try {
    const { json: remote, sha } = await readRemote();
    if (serialize(remote) !== serialize(mgr.base)) {
      showConflict(remote);
      return;
    }
    for (const u of uploads) await putFile(`icons/${slug(u.link.name)}.png`, u.url.split(",")[1], `Upload icon: ${u.link.name}`);
    await putLinks(work, sha, "Update groups and links");
    for (const p of stale) await deleteFile(p, `Re-download icon: ${p}`);
    for (const u of uploads) freshIcons.set(slug(u.link.name), u.url);
    for (const g of work.sections) for (const l of g.links) {
      if (mgr.origName.get(l) === undefined && !mgr.icons.has(l)) pendingFavicons.set(slug(l.name), l.url);
    }
    data = clone(work);
    render();
    startEditing(data);
    saved = true;
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    setDisabled(manager, false);
    updateFooter();
  }
  if (saved) {
    manager.close();
    toast(stale.size ? "Saved. New icons appear after the deploy, in about a minute." : "Changes saved. Other devices update in about a minute.");
  }
});

// Another device saved since the panel opened: never overwrite it silently.
function showConflict(remote) {
  setStatus("This dashboard changed on another device since you opened this panel. ", true);
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "linklike";
  reload.textContent = "Load latest (discards your edits here)";
  reload.onclick = () => {
    data = remote;
    render();
    startEditing(data);
    renderManager();
  };
  $("#mgr-status").append(reload);
}

function closeManager() {
  if (isDirty() && !confirm("Discard unsaved changes?")) return;
  setStatus("");
  manager.close();
}

$("#mgr-close").addEventListener("click", closeManager);
$("#mgr-discard").addEventListener("click", () => {
  if (!confirm("Discard all unsaved changes?")) return;
  startEditing(mgr.base);
  renderManager();
});
// Escape key. (A file picker closing also fires "cancel", which bubbles up from the input.)
manager.addEventListener("cancel", (e) => {
  if (e.target !== manager) return;
  e.preventDefault();
  closeManager();
});
manager.addEventListener("click", (e) => { if (e.target === manager) closeManager(); });

/* ---------- History: every commit of links.json, and restoring one ---------- */
// Git already keeps every save. This lists them and puts an old version's groups and
// links back as a new commit (nothing is erased, so a restore can be undone the same way).

const historyDialog = $("#history-dialog");
const hist = { commits: [], picked: -1, version: null, loading: 0 };

const relTime = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3600], ["minute", 60]]) {
    if (s >= size) return fmt.format(-Math.floor(s / size), unit);
  }
  return "just now";
};

async function openHistory() {
  if (isDirty() && !confirm("Restoring replaces your unsaved changes in this panel. Continue?")) return;
  hist.picked = -1;
  hist.version = null;
  $("#hist-all").href = `https://github.com/${REPO}/commits/${BRANCH}/links.json`;
  $("#hist-restore").disabled = true;
  $("#hist-list").replaceChildren();
  $("#hist-status").textContent = "Loading…";
  historyDialog.showModal();
  try {
    // Public repo: works without a token too (GitHub allows 60 of these an hour per network).
    const list = await ghFetch(`https://api.github.com/repos/${REPO}/commits?path=links.json&sha=${BRANCH}&per_page=30`);
    hist.commits = (list || []).map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0],
      date: c.commit.committer?.date || c.commit.author?.date,
    }));
    $("#hist-status").textContent = hist.commits.length ? "" : "No saves found.";
    renderHistory();
  } catch (err) {
    // Without a token GitHub allows 60 requests an hour, and answers 403 past that.
    $("#hist-status").textContent = err.message.startsWith("This token can't write")
      ? "GitHub is limiting requests right now. Try again later, or connect GitHub." : err.message;
  }
}

function renderHistory() {
  $("#hist-list").replaceChildren(...hist.commits.map((c, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hist-item" + (i === hist.picked ? " selected" : "");
    b.setAttribute("aria-pressed", i === hist.picked);
    const top = document.createElement("span");
    top.className = "hist-msg";
    top.textContent = i === 0 ? `${c.message} · current` : c.message;
    const when = document.createElement("span");
    when.className = "hist-when";
    when.textContent = relTime(c.date);
    when.title = new Date(c.date).toLocaleString();
    b.append(top, when);
    b.onclick = () => pickVersion(i);
    li.append(b);
    if (i === hist.picked) {
      const detail = document.createElement("div");
      detail.className = "hist-detail";
      detail.id = "hist-detail";
      li.append(detail);
    }
    return li;
  }));
}

async function pickVersion(i) {
  hist.picked = i;
  hist.version = null;
  const ticket = ++hist.loading;
  $("#hist-restore").disabled = true;
  renderHistory();
  const detail = $("#hist-detail");
  if (i === 0) return void (detail.textContent = "This is what the dashboard shows now.");
  detail.textContent = "Comparing…";
  try {
    // raw.githubusercontent serves any old version of a file without using the API limit.
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${hist.commits[i].sha}/links.json`, { cache: "force-cache" });
    if (!r.ok) throw new Error();
    const old = await r.json();
    if (ticket !== hist.loading) return;
    hist.version = old;
    const changes = describeRestore(data, old);
    detail.replaceChildren(...(changes.length ? changes : ["Same groups and links as now."]).map((t) => {
      const p = document.createElement("p");
      p.textContent = t;
      return p;
    }));
    $("#hist-restore").disabled = !changes.length;
  } catch {
    if (ticket === hist.loading) detail.textContent = "Couldn't load that version.";
  }
}

// What restoring `old` would do to `now`, in plain words.
function describeRestore(now, old) {
  const where = (d) => new Map(d.sections.flatMap((s) => s.links.map((l) => [slug(l.name), { name: l.name, group: s.name }])));
  const a = where(now), b = where(old);
  const names = (list) => list.slice(0, 6).join(", ") + (list.length > 6 ? ` and ${list.length - 6} more` : "");
  const out = [];
  const back = [...b.keys()].filter((k) => !a.has(k)).map((k) => b.get(k).name);
  const gone = [...a.keys()].filter((k) => !b.has(k)).map((k) => a.get(k).name);
  const moved = [...b.keys()].filter((k) => a.has(k) && a.get(k).group !== b.get(k).group).map((k) => `${b.get(k).name} → ${b.get(k).group}`);
  const groupsNow = new Set(now.sections.map((s) => s.name)), groupsOld = new Set(old.sections.map((s) => s.name));
  const gBack = [...groupsOld].filter((g) => !groupsNow.has(g)), gGone = [...groupsNow].filter((g) => !groupsOld.has(g));
  if (back.length) out.push(`Brings back ${plural(back.length, "link")}: ${names(back)}`);
  if (gone.length) out.push(`Removes ${plural(gone.length, "link")}: ${names(gone)}`);
  if (moved.length) out.push(`Moves ${plural(moved.length, "link")}: ${names(moved)}`);
  if (gBack.length) out.push(`Groups back: ${names(gBack)}`);
  if (gGone.length) out.push(`Groups removed: ${names(gGone)}`);
  if (!out.length && JSON.stringify(now.sections) !== JSON.stringify(old.sections)) out.push("Changes order, names, addresses or emoji.");
  return out;
}

$("#hist-restore").addEventListener("click", async () => {
  const c = hist.commits[hist.picked], old = hist.version;
  if (!c || !old) return;
  const btn = $("#hist-restore");
  setDisabled(historyDialog, true);
  $("#hist-status").textContent = "Restoring…";
  try {
    const when = new Date(c.date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    await save((d) => { d.sections = old.sections; }, `Restore groups and links from ${when}`);
    startEditing(data);
    renderManager();
    historyDialog.close();
    toast("Restored. Other devices update in about a minute.");
  } catch (err) {
    $("#hist-status").textContent = err.message;
  } finally {
    setDisabled(historyDialog, false);
    btn.disabled = !hist.version;
  }
});

$("#mgr-history").addEventListener("click", openHistory);

/* ---------- GitHub Connection ---------- */

const githubDialog = $("#github-dialog");

// The dot's colour and the words for it, from tokenHealth().
function healthText() {
  const left = daysLeft();
  const when = left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`;
  switch (tokenHealth()) {
    case "off": return ["Not connected", "Connect to add and manage links from this browser. Viewing the dashboard doesn't need this."];
    case "bad": return [left !== null && left < 0 ? "Token expired" : "Token rejected",
      "GitHub no longer accepts this token. Make a new one, then Disconnect and connect with it."];
    case "warn": return [`Token expires ${when}`, "Make a new token before then, then Disconnect and connect with it."];
    default: return ["Connected", left === null ? "Adding and managing links is enabled in this browser."
      : `Adding and managing links is enabled in this browser. The token expires ${when}.`];
  }
}

function setDotState(el) {
  const h = tokenHealth();
  for (const c of ["on", "warn", "bad"]) el.classList.toggle(c, h === c);
}

function renderGithub() {
  const t = token.get();
  const on = !!t;
  setDotState($("#gh-card-dot"));
  const [state, detail] = healthText();
  $("#gh-state").textContent = state;
  $("#gh-detail").textContent = detail;
  $("#gh-expiry").hidden = !on;
  $("#gh-expiry").value = token.expiry();
  $("#gh-expiry-none").hidden = on;
  const repo = $("#gh-repo");
  repo.href = `https://github.com/${REPO}`;
  repo.textContent = REPO;
  $("#gh-branch").textContent = BRANCH;
  $("#gh-account").textContent = on && token.login() ? `@${token.login()}` : "—";
  $("#gh-token-mask").textContent = on ? `${t.slice(0, 11)}…${t.slice(-4)}` : "—";
  $("#gh-form").hidden = on;
  $("#gh-connect").hidden = on;
  $("#gh-test").hidden = !on;
  $("#gh-disconnect").hidden = !on;
  updateDot();
}

function updateDot() {
  setDotState($("#gh-dot"));
  $("#github-btn").title = `GitHub: ${healthText()[0].toLowerCase()}`;
}

$("#gh-expiry").addEventListener("change", (e) => {
  token.setExpiry(e.target.value);
  renderGithub();
});

function openGithub(message = "") {
  renderGithub();
  $("#f-token").value = "";
  $("#f-expiry").value = "";
  $("#gh-status").textContent = message;
  $("#gh-checks").hidden = true;
  githubDialog.showModal();
  if (!token.get()) $("#f-token").focus();
}

// Checks a token: who it belongs to, and that it can read the repo.
async function checkToken(t) {
  const started = performance.now();
  const user = await ghFetch("https://api.github.com/user", {}, t);
  const file = await gh(`links.json?ref=${BRANCH}`, {}, t);
  if (!file) throw new Error("This token can't see the Personal-Browser-Dashboard repo.");
  return { login: user?.login || "", ms: Math.round(performance.now() - started) };
}

function showChecks(items) {
  const list = $("#gh-checks");
  list.replaceChildren(...items.map(([ok, text]) => {
    const li = document.createElement("li");
    li.className = ok === true ? "ok" : ok === false ? "bad" : "info";
    li.textContent = text;
    return li;
  }));
  list.hidden = false;
}

$("#gh-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = $("#f-token").value.trim();
  const status = $("#gh-status");
  if (!t) return void (status.textContent = "Paste a token first.");
  status.textContent = "Checking…";
  setDisabled(githubDialog, true);
  try {
    const { login } = await checkToken(t);
    token.set(t, login);
    token.setExpiry($("#f-expiry").value);
    status.textContent = "";
    renderGithub();
    toast(login ? `Connected as @${login}` : "Connected");
  } catch (err) {
    status.textContent = err.message;
  } finally {
    setDisabled(githubDialog, false);
  }
});

$("#gh-test").addEventListener("click", async () => {
  $("#gh-status").textContent = "Testing…";
  setDisabled(githubDialog, true);
  try {
    const { login, ms } = await checkToken(token.get());
    token.set(token.get(), login || token.login());
    renderGithub();
    showChecks([
      [true, `Token is valid${login ? ` (@${login})` : ""}`],
      [true, `Repository is reachable (${ms} ms)`],
      [null, "Write access is confirmed the first time you save."],
    ]);
  } catch (err) {
    showChecks([[false, err.message]]);
  } finally {
    $("#gh-status").textContent = "";
    setDisabled(githubDialog, false);
  }
});

$("#gh-disconnect").addEventListener("click", () => {
  if (!confirm("Disconnect GitHub in this browser? You can reconnect any time.")) return;
  token.clear();
  $("#gh-checks").hidden = true;
  renderGithub();
  toast("Disconnected");
});

/* ---------- Wallpaper ---------- */
// links.json "wallpaper" is either a file in the repo (wallpapers/…jpg, uploaded from a device)
// or an image URL on another site. Stored in the repo, so it's the same on every device.

const wallpaperDialog = $("#wallpaper-dialog");
let freshWallpaper = null; // { path, url }: a file uploaded in this tab, shown before Pages redeploys
let pendingWallpaper = null; // { kind: "file", dataUrl } or { kind: "url", url }

function wallpaperSources(src) {
  if (freshWallpaper?.path === src) return [freshWallpaper.url];
  return src.startsWith("http") ? [src] : [src + VERSION, RAW + src + VERSION];
}

// The wallpaper is painted on <html> (the page canvas), not on a fixed layer: iOS Safari
// draws the canvas under its status bar and toolbar, but clips fixed elements above them.
const themeColor = document.querySelector('meta[name="theme-color"]');
let wallpaperShown = "";

function setWallpaperLayer(url) {
  const root = document.documentElement;
  const on = Boolean(url);
  root.classList.toggle("has-wallpaper", on);
  document.body.classList.toggle("has-wallpaper", on);
  if (on) root.style.setProperty("--wallpaper", `url("${url.replace(/"/g, "%22")}")`);
  else root.style.removeProperty("--wallpaper");
  // A theme-color makes Safari paint a solid bar over the wallpaper.
  if (on) themeColor.remove();
  else if (!themeColor.isConnected) document.head.append(themeColor);
}

/* Dim and blur, saved in links.json with the wallpaper ("wallpaperDim" 0–80, "wallpaperBlur" 0–20).
   Dim is the dark layer over the photo; 30 is the default. CSS can't blur the page canvas the
   wallpaper is painted on, so blur makes a blurred copy of the image in the browser instead. */
const DEFAULT_DIM = 30;
const wallpaperLook = (d = data) => ({ dim: d.wallpaperDim ?? DEFAULT_DIM, blur: d.wallpaperBlur ?? 0 });
const blurCache = new Map(); // "src|blur" → blurred image (data URL), or null if the site doesn't allow it

// Shrinks the image by halves, then grows it back the same way: a smooth blur that works in
// every browser (Safari has no canvas blur filter).
async function blurredWallpaper(src, blur) {
  const key = `${src}|${blur}`;
  if (blurCache.has(key)) return blurCache.get(key);
  let result = null;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous"; // without this the browser won't let us read the pixels back
    img.src = src;
    await img.decode();
    const scale = Math.min(1, 1600 / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = (cw, ch) => Object.assign(document.createElement("canvas"), { width: Math.max(1, cw), height: Math.max(1, ch) });
    let cur = canvas(w, h);
    cur.getContext("2d").drawImage(img, 0, 0, w, h);
    const steps = Math.max(1, Math.round(Math.log2(blur * (w / 1440)) + 1));
    const sizes = [];
    for (let i = 0; i < steps; i++) {
      sizes.push([cur.width, cur.height]);
      const next = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
      const ctx = next.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cur, 0, 0, next.width, next.height);
      cur = next;
    }
    for (const [cw, ch] of sizes.reverse()) {
      const next = canvas(cw, ch);
      const ctx = next.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cur, 0, 0, cw, ch);
      cur = next;
    }
    result = cur.toDataURL("image/jpeg", 0.85);
  } catch {
    result = null; // another site's image that doesn't allow reading (CORS)
  }
  blurCache.set(key, result);
  return result;
}

let blurBlocked = false; // the shown picture is from a site that doesn't allow blurring it

// `look` overrides the saved dim/blur, for the live preview while the dialog is open.
// Resolves once the picture is on screen.
function applyWallpaper(look = wallpaperLook(), src = data.wallpaper) {
  document.documentElement.style.setProperty("--wp-dim", look.dim / 100);
  if (!src) {
    wallpaperShown = "";
    setWallpaperLayer(null);
    return Promise.resolve();
  }
  const key = `${src}|${look.blur}`;
  if (wallpaperShown === key) return Promise.resolve(); // already showing it
  wallpaperShown = key;
  return new Promise((resolve) => {
    // Load it first, so a broken URL never leaves light text on a blank page.
    const sources = wallpaperSources(src);
    const probe = new Image();
    probe.referrerPolicy = "no-referrer";
    probe.onload = async () => {
      if (wallpaperShown !== key) return resolve();
      const blurred = look.blur ? await blurredWallpaper(probe.src, look.blur) : null;
      if (wallpaperShown === key) {
        blurBlocked = Boolean(look.blur) && !blurred;
        setWallpaperLayer(blurred || probe.src);
      }
      resolve();
    };
    probe.onerror = () => {
      sources.shift();
      if (sources.length) return void (probe.src = sources[0]);
      if (wallpaperShown === key) setWallpaperLayer(null);
      resolve();
    };
    probe.src = sources[0];
  });
}

// Big photos are scaled down to 2560px on the long side and saved as JPEG.
async function wallpaperFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error("no size");
    const scale = Math.min(1, 2560 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Checks that a URL really is an image the browser can show.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    const timer = setTimeout(() => reject(new Error("timeout")), 15000);
    img.onload = () => { clearTimeout(timer); resolve(); };
    img.onerror = () => { clearTimeout(timer); reject(new Error("not an image")); };
    img.src = src;
  });
}

function showPreview(src) {
  const box = $("#wp-preview");
  $("#wp-adjust").hidden = !src;
  box.replaceChildren();
  box.style.backgroundImage = "";
  if (src) {
    const img = new Image();
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.src = src;
    box.append(img);
  } else {
    const empty = document.createElement("span");
    empty.textContent = "No wallpaper";
    box.append(empty);
  }
}

function setTab(tab) {
  const device = tab === "device";
  $("#wp-tab-device").setAttribute("aria-selected", device);
  $("#wp-tab-url").setAttribute("aria-selected", !device);
  $("#wp-device-pane").hidden = !device;
  $("#wp-url-pane").hidden = device;
  if (!device) $("#wp-url").focus();
}

// The sliders preview on the small picture right away, and on the page itself behind the dialog.
let look = { dim: DEFAULT_DIM, blur: 0 };

function showLook() {
  $("#wp-dim").value = look.dim;
  $("#wp-blur").value = look.blur;
  $("#wp-dim-out").textContent = `${look.dim}%`;
  $("#wp-blur-out").textContent = look.blur ? String(look.blur) : "Off";
  const box = $("#wp-preview");
  box.style.setProperty("--wp-dim", look.dim / 100);
  box.style.setProperty("--wp-blur", `${(look.blur * box.clientWidth) / 1440}px`);
}

const lookChanged = () => {
  const saved = wallpaperLook();
  return look.dim !== saved.dim || look.blur !== saved.blur;
};
function updateWpSave() {
  $("#wp-save").disabled = !pendingWallpaper && !lookChanged();
  $("#wp-save").textContent = pendingWallpaper || !data.wallpaper ? "Set Wallpaper" : "Save";
}

async function previewLookOnPage() {
  const src = pendingWallpaper?.kind === "file" ? pendingWallpaper.dataUrl : pendingWallpaper?.url || data.wallpaper;
  if (!src) return;
  if (pendingWallpaper) {
    // A new picture isn't saved yet: paint it straight on the page for the preview.
    document.documentElement.style.setProperty("--wp-dim", look.dim / 100);
    const blurred = look.blur ? await blurredWallpaper(src, look.blur) : null;
    blurBlocked = Boolean(look.blur) && !blurred;
    wallpaperShown = "";
    setWallpaperLayer(blurred || src);
  } else {
    await applyWallpaper(look);
  }
  $("#wp-blur-note").hidden = !blurBlocked;
}

for (const [id, key] of [["#wp-dim", "dim"], ["#wp-blur", "blur"]]) {
  $(id).addEventListener("input", (e) => {
    look[key] = Number(e.target.value);
    showLook();
    updateWpSave();
    if (key === "dim") document.documentElement.style.setProperty("--wp-dim", look.dim / 100);
  });
  $(id).addEventListener("change", previewLookOnPage); // blur is heavier: redo the page when the slider is let go
}

// Closing without saving puts the page back the way it was.
wallpaperDialog.addEventListener("close", () => {
  wallpaperShown = "";
  if (data) applyWallpaper();
});

function openWallpaper() {
  look = wallpaperLook();
  pendingWallpaper = null;
  $("#wp-file").value = "";
  $("#wp-url").value = "";
  $("#wp-status").textContent = "";
  $("#wp-save").disabled = true;
  $("#wp-remove").hidden = !data.wallpaper;
  $("#wp-blur-note").hidden = true;
  showPreview(data.wallpaper ? wallpaperSources(data.wallpaper)[0] : null);
  setTab("device");
  updateWpSave();
  wallpaperDialog.showModal();
  showLook();
}

async function pickWallpaperFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return void ($("#wp-status").textContent = "That file isn't an image.");
  $("#wp-status").textContent = "Preparing…";
  try {
    const dataUrl = await wallpaperFromFile(file);
    pendingWallpaper = { kind: "file", dataUrl };
    showPreview(dataUrl);
    showLook();
    $("#wp-status").textContent = `Ready · ${Math.round((dataUrl.length * 3) / 4 / 1024)} KB`;
    updateWpSave();
  } catch {
    $("#wp-status").textContent = "Couldn't read that image. Try a JPG or PNG.";
  }
}

async function previewWallpaperUrl() {
  const url = normalizeUrl($("#wp-url").value);
  if (!url) return void ($("#wp-status").textContent = "That URL doesn't look right.");
  $("#wp-status").textContent = "Loading…";
  $("#wp-save").disabled = true;
  try {
    await loadImage(url);
    pendingWallpaper = { kind: "url", url };
    showPreview(url);
    showLook();
    $("#wp-status").textContent = "Ready";
    updateWpSave();
  } catch {
    pendingWallpaper = null;
    $("#wp-status").textContent = "Couldn't load an image from that URL. Use a direct link to the image file.";
  }
}

$("#wp-tab-device").addEventListener("click", () => setTab("device"));
$("#wp-tab-url").addEventListener("click", () => setTab("url"));
$("#wp-file").addEventListener("change", (e) => pickWallpaperFile(e.target.files[0]));
const drop = $("#wp-drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  pickWallpaperFile(e.dataTransfer.files[0]);
});
$("#wp-load").addEventListener("click", previewWallpaperUrl);
$("#wp-url").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); previewWallpaperUrl(); } });

$("#wp-save").addEventListener("click", async () => {
  if (!pendingWallpaper && !lookChanged()) return;
  const status = $("#wp-status");
  const old = data.wallpaper;
  setDisabled(wallpaperDialog, true);
  status.textContent = "Saving…";
  try {
    requireConnection();
    let value = old;
    if (pendingWallpaper?.kind === "file") {
      value = `wallpapers/wallpaper-${Date.now()}.jpg`;
      await putFile(value, pendingWallpaper.dataUrl.split(",")[1], "Upload wallpaper");
      freshWallpaper = { path: value, url: pendingWallpaper.dataUrl };
    } else if (pendingWallpaper) {
      value = pendingWallpaper.url;
    }
    const setLook = (d) => {
      if (look.dim === DEFAULT_DIM) delete d.wallpaperDim; else d.wallpaperDim = look.dim;
      if (look.blur) d.wallpaperBlur = look.blur; else delete d.wallpaperBlur;
    };
    await save((d) => { d.wallpaper = value; setLook(d); }, pendingWallpaper ? "Change wallpaper" : "Adjust wallpaper dim and blur");
    if (old && !old.startsWith("http") && old !== value) deleteFile(old, "Remove old wallpaper");
    const changedPicture = Boolean(pendingWallpaper);
    pendingWallpaper = null;
    wallpaperDialog.close();
    toast(changedPicture ? "Wallpaper set" : "Wallpaper updated");
  } catch (err) {
    status.textContent = err.message;
  } finally {
    setDisabled(wallpaperDialog, false);
    updateWpSave();
  }
});

$("#wp-remove").addEventListener("click", async () => {
  if (!confirm("Remove the wallpaper on all devices?")) return;
  const old = data.wallpaper;
  setDisabled(wallpaperDialog, true);
  $("#wp-status").textContent = "Removing…";
  try {
    requireConnection();
    await save((d) => { delete d.wallpaper; delete d.wallpaperDim; delete d.wallpaperBlur; }, "Remove wallpaper");
    if (old && !old.startsWith("http")) deleteFile(old, "Remove old wallpaper");
    wallpaperDialog.close();
    toast("Wallpaper removed");
  } catch (err) {
    $("#wp-status").textContent = err.message;
  } finally {
    setDisabled(wallpaperDialog, false);
  }
});

/* ---------- Sidebar, dialogs ---------- */

$("#manage-btn").addEventListener("click", openManager);
$("#wallpaper-btn").addEventListener("click", openWallpaper);

const MODE_ICON = {
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
};
const MODE_NAME = { light: "Light", dark: "Dark" };

function updateIconsBtn() {
  $("#icons-btn-svg").innerHTML = MODE_ICON[iconMode];
  $("#icons-btn-label").textContent = `Icons: ${MODE_NAME[iconMode]}`;
  const label = `Icon style: ${MODE_NAME[iconMode]}. Click for ${MODE_NAME[iconMode === "dark" ? "light" : "dark"]}.`;
  $("#icons-btn").setAttribute("aria-label", label);
  $("#icons-btn").title = label;
}

$("#icons-btn").addEventListener("click", () => {
  iconMode = ICON_MODES[(ICON_MODES.indexOf(iconMode) + 1) % ICON_MODES.length];
  try { localStorage.setItem("icon-theme", iconMode); } catch {}
  updateIconsBtn();
  if (data) render();
  toast(`${MODE_NAME[iconMode]} icons`);
});
updateIconsBtn();

// View: "icons" (home-screen grid) or "list" (rows with name + address). Saved per browser.
const VIEW_ICON = {
  icons: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  list: '<rect x="4" y="5" width="4" height="4" rx="1"/><rect x="4" y="15" width="4" height="4" rx="1"/><path d="M11 7h9M11 17h9"/>',
};
let viewMode = (() => { try { return localStorage.getItem("view-mode"); } catch { return null; } })();
if (!(viewMode in VIEW_ICON)) viewMode = "icons";

function applyView() {
  document.body.classList.toggle("list-view", viewMode === "list");
  const name = viewMode === "list" ? "List" : "Icons";
  $("#view-btn-svg").innerHTML = VIEW_ICON[viewMode];
  $("#view-btn-label").textContent = `View: ${name}`;
  const label = `View: ${name}. Click for ${viewMode === "list" ? "icons" : "list"}.`;
  $("#view-btn").setAttribute("aria-label", label);
  $("#view-btn").title = label;
}

$("#view-btn").addEventListener("click", () => {
  viewMode = viewMode === "list" ? "icons" : "list";
  try { localStorage.setItem("view-mode", viewMode); } catch {}
  applyView();
  toast(viewMode === "list" ? "List view" : "Icon view");
});
applyView();

// Open links: in this tab (start page) or a new tab. Saved per browser.
const TAB_ICON = {
  same: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h7M12 9l3 3-3 3"/>',
  new: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

function applyTarget() {
  const name = linkTarget === "new" ? "New tab" : "Same tab";
  $("#tab-btn-svg").innerHTML = TAB_ICON[linkTarget];
  $("#tab-btn-label").textContent = `Open: ${name}`;
  const label = `Links open in ${linkTarget === "new" ? "a new tab" : "this tab"}. Click to change.`;
  $("#tab-btn").setAttribute("aria-label", label);
  $("#tab-btn").title = label;
  for (const a of document.querySelectorAll("#sections .tile")) {
    if (linkTarget === "new") a.target = "_blank";
    else a.removeAttribute("target");
  }
  $("#launch-alt").textContent = linkTarget === "new" ? "this tab" : "new tab";
}

$("#tab-btn").addEventListener("click", () => {
  linkTarget = linkTarget === "new" ? "same" : "new";
  store.set("link-target", linkTarget);
  applyTarget();
  toast(linkTarget === "new" ? "Links open in a new tab" : "Links open in this tab");
});
applyTarget();

$("#github-btn").addEventListener("click", () => openGithub());

for (const dialog of [githubDialog, wallpaperDialog, historyDialog]) {
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });
}

/* ---------- Tile menu: right-click or long-press a tile ---------- */
// Each action saves straight away (one commit), unlike the Manage panel's staged edits.

const tileMenu = $("#tile-menu");
let menuFor = null; // slug of the link the menu was opened on

function openTileMenu(tile, x, y) {
  if (arranging || tileMenu.matches(":popover-open")) return;
  menuFor = tile.dataset.link;
  $("#menu-open-label").textContent = linkTarget === "new" ? "Open in This Tab" : "Open in New Tab";
  tileMenu.showPopover();
  // Next to the pointer, flipped up or left when it would run off the screen.
  const { width, height } = tileMenu.getBoundingClientRect();
  const left = x + width > innerWidth - 8 ? x - width : x;
  const top = y + height > innerHeight - 8 ? y - height : y;
  tileMenu.style.left = `${Math.max(8, left)}px`;
  tileMenu.style.top = `${Math.max(8, top)}px`;
  tileMenu.querySelector("button").focus({ preventScroll: true });
}

// Closed by hand: the browser's own "click outside" would also fire on the release of the
// right-click that opened it.
const closeTileMenu = () => { if (tileMenu.matches(":popover-open")) tileMenu.hidePopover(); };
window.addEventListener("pointerdown", (e) => { if (!tileMenu.contains(e.target)) closeTileMenu(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tileMenu.matches(":popover-open")) { e.preventDefault(); closeTileMenu(); } }, true);
for (const ev of ["resize", "blur"]) window.addEventListener(ev, closeTileMenu);
document.addEventListener("scroll", closeTileMenu, true);
// Arrow keys walk the menu
tileMenu.addEventListener("keydown", (e) => {
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const items = [...tileMenu.querySelectorAll("button")];
  items[(items.indexOf(document.activeElement) + step + items.length) % items.length].focus();
});

$("#sections").addEventListener("contextmenu", (e) => {
  const tile = e.target.closest(".tile");
  if (!tile || arranging) return;
  e.preventDefault();
  const r = tile.getBoundingClientRect();
  const keyboard = !e.clientX && !e.clientY; // the Menu key / Shift+F10
  openTileMenu(tile, keyboard ? r.left + r.width / 2 : e.clientX, keyboard ? r.bottom : e.clientY);
});

// Touch: hold a tile for half a second. (iOS doesn't fire "contextmenu" for links.)
let pressTimer = 0;
let swallowClick = false; // the finger lifting after a long-press mustn't open the link
$("#sections").addEventListener("pointerdown", (e) => {
  swallowClick = false;
  const tile = e.target.closest(".tile");
  if (!tile || e.pointerType === "mouse" || arranging) return;
  const x0 = e.clientX, y0 = e.clientY;
  const stop = () => {
    clearTimeout(pressTimer);
    for (const t of ["pointermove", "pointerup", "pointercancel"]) window.removeEventListener(t, watch);
  };
  const watch = (ev) => { if (ev.type !== "pointermove" || Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) stop(); };
  for (const t of ["pointermove", "pointerup", "pointercancel"]) window.addEventListener(t, watch);
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    stop();
    swallowClick = true;
    navigator.vibrate?.(10);
    const r = tile.getBoundingClientRect();
    openTileMenu(tile, r.left, r.bottom + 6);
  }, 500);
});
$("#sections").addEventListener("click", (e) => {
  if (!swallowClick && !arranging) return;
  e.preventDefault();
  swallowClick = false;
}, true);

// Saves a change made from the menu, with the result as a toast.
async function quickSave(change, message, done, icon) {
  try {
    await save(change, message, icon);
    if (done) toast(done);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

const gone = () => new Error("That link was changed on another device. Try again.");

tileMenu.addEventListener("click", async (e) => {
  const act = e.target.closest("button[data-act]")?.dataset.act;
  if (!act) return;
  closeTileMenu();
  const link = findLink(data, menuFor)?.link;
  if (!link) return;
  if (act === "open") {
    if (linkTarget === "new") location.href = link.url;
    else window.open(link.url, "_blank", "noopener,noreferrer");
  } else if (act === "copy") {
    try { await navigator.clipboard.writeText(link.url); toast("Link copied"); } catch { toast("Couldn't copy the link"); }
  } else if (act === "edit") {
    openEdit(link);
  } else if (act === "refetch") {
    refetchIcon(link);
  } else if (act === "arrange") {
    startArrange();
  } else if (act === "delete") {
    if (!confirm(`Delete “${link.name}”?`)) return;
    const s = slug(link.name);
    quickSave((d) => {
      const f = findLink(d, s);
      if (!f) throw gone();
      f.section.links.splice(f.index, 1);
    }, `Delete ${link.name}`, `Deleted ${link.name}`);
  }
});

// Deletes the icon files so the next deploy downloads the icon again.
async function refetchIcon(link) {
  const s = slug(link.name);
  const paths = new Set([`icons/${s}.png`, isLocalPath(link.icon) ? link.icon : null].filter(Boolean));
  for (const p of [...paths]) paths.add(p.replace(/^icons\//, "icons/dark/"));
  try {
    requireConnection();
    toast("Re-downloading…");
    if (isLocalPath(link.icon)) {
      await save((d) => { const f = findLink(d, s); if (f) delete f.link.icon; }, `Re-download icon: ${link.name}`);
    }
    for (const p of paths) await deleteFile(p, `Re-download icon: ${link.name}`);
    freshIcons.delete(s);
    toast("The new icon appears after the deploy, in about a minute.");
  } catch (err) {
    toast(err.message);
  }
}

/* Edit one link: name, address, group, icon */

const editDialog = $("#edit-dialog");
const editing = { slug: null, icon: null };
editDialog.addEventListener("click", (e) => {
  if (e.target === editDialog || e.target.closest("[data-close]")) editDialog.close();
});

function openEdit(link) {
  const found = findLink(data, slug(link.name));
  editing.slug = slug(link.name);
  editing.icon = null;
  $("#edit-name").value = link.name;
  $("#edit-url").value = link.url;
  $("#edit-group").replaceChildren(...data.sections.map((s) => new Option(s.name, slug(s.name), false, s === found.section)));
  $("#edit-icon").replaceChildren(wrapIcon(iconBox(link)));
  $("#edit-status").textContent = "";
  editDialog.showModal();
}

$("#edit-icon").addEventListener("click", () => $("#edit-file").click());
$("#edit-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    editing.icon = await iconFromFile(file);
    $("#edit-icon").replaceChildren(wrapIcon(imageBox(editing.icon)));
  } catch {
    toast("Couldn't read that image. Try a PNG, JPG or SVG.");
  }
});

$("#edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("#edit-status");
  const name = $("#edit-name").value.trim();
  const raw = $("#edit-url").value.trim();
  const url = /^https?:\/\//i.test(raw) ? raw : normalizeUrl(raw);
  const groupSlug = $("#edit-group").value;
  if (!slug(name).replace(/-/g, "")) return void (status.textContent = "Give it a name.");
  if (!normalizeUrl(raw)) return void (status.textContent = "That URL doesn't look right.");
  const from = editing.slug, to = slug(name);
  const icon = editing.icon;
  setDisabled(editDialog, true);
  status.textContent = "Saving…";
  const ok = await quickSave((d) => {
    const f = findLink(d, from);
    if (!f) throw gone();
    if (to !== from && findLink(d, to)) throw new Error(`Another link is already called “${name}”.`);
    const l = f.link;
    if (icon) delete l.icon;
    else if (to !== from && !l.icon && loadedIcons.has(from)) l.icon = `icons/${from}.png`; // keep its icon file
    l.name = name;
    l.url = url;
    const target = findGroup(d, groupSlug);
    if (target && target !== f.section) {
      f.section.links.splice(f.index, 1);
      target.links.push(l);
    }
  }, `Edit ${name}`, null, icon ? { path: `icons/${to}.png`, base64: icon.split(",")[1] } : undefined);
  setDisabled(editDialog, false);
  if (!ok) return void (status.textContent = "");
  if (icon) { freshIcons.set(to, icon); render(); }
  editDialog.close();
  toast("Saved. Other devices update in about a minute.");
});

/* Rearrange: icons jiggle like the iPhone home screen; drag them, then Done saves the order. */

let arranging = null; // { group, before } while rearranging

const visibleSection = () => document.querySelector("#sections section:not(.hidden)");
const tileOrder = (section) => [...section.querySelectorAll(".tile")].map((t) => t.dataset.link);

function startArrange() {
  const section = visibleSection();
  if (!section || arranging) return;
  if (!token.get()) return void openGithub("Connect GitHub to save a new order.");
  arranging = { group: section.dataset.slug, before: tileOrder(section) };
  document.body.classList.add("arranging");
  $("#arrange-bar").hidden = false;
}

async function endArrange(keep) {
  if (!arranging) return;
  const section = visibleSection();
  const order = tileOrder(section);
  const { group, before } = arranging;
  arranging = null;
  document.body.classList.remove("arranging");
  $("#arrange-bar").hidden = true;
  if (order.join() === before.join()) return;
  if (!keep) return void render();
  const name = findGroup(data, group)?.name || "group";
  const pos = new Map(order.map((s, i) => [s, i]));
  const ok = await quickSave((d) => {
    const g = findGroup(d, group);
    if (!g) throw gone();
    // Links added on another device meanwhile keep their place at the end.
    g.links.sort((a, b) => (pos.get(slug(a.name)) ?? 1e9) - (pos.get(slug(b.name)) ?? 1e9));
  }, `Reorder ${name}`, "Order saved");
  if (!ok) render();
}

$("#arrange-done").addEventListener("click", () => endArrange(true));
$("#arrange-cancel").addEventListener("click", () => endArrange(false));

// Drag: the tile follows the finger or pointer; the others slide aside. Neighbours are what
// move in the page, never the dragged tile, so touch screens don't lose track of the finger.
function moveTile(tile, to) {
  const grid = tile.parentElement;
  const all = [...grid.querySelectorAll(".tile")];
  const from = all.indexOf(tile);
  if (to === from || to < 0 || to >= all.length) return;
  const was = new Map(all.map((t) => [t, [t.offsetLeft, t.offsetTop]]));
  if (to > from) tile.before(...all.slice(from + 1, to + 1));
  else tile.after(...all.slice(to, from));
  for (const t of all) {
    if (t === tile) continue;
    const [x, y] = was.get(t);
    const dx = x - t.offsetLeft, dy = y - t.offsetTop;
    if (!dx && !dy) continue;
    t.style.transition = "none";
    t.style.transform = `translate(${dx}px, ${dy}px)`;
    t.getBoundingClientRect();
    t.style.transition = "transform .22s ease";
    t.style.transform = "";
  }
}

$("#sections").addEventListener("pointerdown", (e) => {
  const tile = e.target.closest(".tile");
  if (!arranging || !tile || e.button > 0) return;
  e.preventDefault();
  const grid = tile.parentElement;
  const sx = e.clientX, sy = e.clientY, ox = tile.offsetLeft, oy = tile.offsetTop;
  tile.classList.add("lifted");
  const follow = (ev) => {
    const g = grid.getBoundingClientRect();
    const px = ev.clientX - g.left, py = ev.clientY - g.top;
    // Which tile's slot is the pointer over? (Layout boxes, so sliding tiles don't flicker.)
    const all = [...grid.querySelectorAll(".tile")];
    const over = all.findIndex((t) => t !== tile && px >= t.offsetLeft && px < t.offsetLeft + t.offsetWidth && py >= t.offsetTop && py < t.offsetTop + t.offsetHeight);
    if (over >= 0) moveTile(tile, over);
    tile.style.transform = `translate(${ev.clientX - sx - (tile.offsetLeft - ox)}px, ${ev.clientY - sy - (tile.offsetTop - oy)}px)`;
  };
  const drop = () => {
    for (const [t, f] of [["pointermove", follow], ["pointerup", drop], ["pointercancel", drop]]) window.removeEventListener(t, f);
    tile.classList.remove("lifted");
    tile.style.transition = "transform .2s ease";
    tile.style.transform = "";
    setTimeout(() => { tile.style.transition = ""; }, 220);
  };
  window.addEventListener("pointermove", follow);
  window.addEventListener("pointerup", drop);
  window.addEventListener("pointercancel", drop);
});

// Keyboard: arrow keys move the focused tile; Enter/Escape finish.
document.addEventListener("keydown", (e) => {
  if (!arranging || document.querySelector("dialog[open]")) return;
  if (e.key === "Escape") return void endArrange(false);
  if (e.key === "Enter") { e.preventDefault(); return void endArrange(true); }
  const tile = e.target.closest?.(".tile");
  const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
  if (!tile || !step) return;
  e.preventDefault();
  const all = [...tile.parentElement.querySelectorAll(".tile")];
  moveTile(tile, all.indexOf(tile) + step);
  tile.focus();
}, true);

/* ---------- Quick launch ---------- */
// ⌘K / Ctrl+K, "/", or just start typing a name: a short list of matching links, Enter opens one.

const launcher = $("#launcher");
const launch = { hits: [], index: 0 };

// Lower is better: name starts with it → a word starts with it → name contains it →
// address starts with it → its letters appear in order (e.g. "ytm" → YouTube Music).
function matchScore(q, link) {
  const name = link.name.toLowerCase();
  let host = "";
  try { host = new URL(link.url).hostname.replace(/^www\./, ""); } catch {}
  if (name.startsWith(q)) return 0;
  if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  if (host.split(".").some((part) => part.startsWith(q))) return 3; // "chase" → chase.com, not "ytm" → paytm.com
  let i = 0;
  for (const ch of name) if (ch === q[i]) i++;
  return i === q.length ? 4 : -1;
}

function findLinks(query) {
  const q = query.trim().toLowerCase();
  const all = data.sections.flatMap((s) => s.links.map((link) => ({ link, group: s.name })));
  if (!q) return all;
  return all
    .map((hit, order) => ({ ...hit, score: matchScore(q, hit.link), order }))
    .filter((h) => h.score >= 0)
    .sort((a, b) => a.score - b.score || a.order - b.order);
}

function renderLaunch() {
  const list = $("#launch-list");
  launch.hits = findLinks($("#launch-input").value);
  launch.index = Math.min(launch.index, Math.max(0, launch.hits.length - 1));
  if (!launch.hits.length) {
    const li = document.createElement("li");
    li.className = "launch-empty";
    li.textContent = "No links match.";
    list.replaceChildren(li);
    $("#launch-input").removeAttribute("aria-activedescendant");
    return;
  }
  list.replaceChildren(...launch.hits.map((h, i) => {
    const li = document.createElement("li");
    li.id = `launch-${i}`;
    li.setAttribute("role", "option");
    li.className = "launch-item";
    li.setAttribute("aria-selected", i === launch.index);
    const name = document.createElement("span");
    name.className = "launch-name";
    name.textContent = h.link.name;
    const group = document.createElement("span");
    group.className = "launch-group";
    group.textContent = h.group;
    li.append(wrapIcon(iconBox(h.link)), name, group);
    li.onpointermove = () => { if (launch.index !== i) { launch.index = i; markLaunch(); } };
    li.onclick = (e) => openHit(i, e.shiftKey || e.metaKey || e.ctrlKey);
    return li;
  }));
  markLaunch();
}

function markLaunch() {
  for (const [i, li] of [...$("#launch-list").children].entries()) {
    const on = i === launch.index;
    li.setAttribute("aria-selected", on);
    if (on) li.scrollIntoView({ block: "nearest" });
  }
  $("#launch-input").setAttribute("aria-activedescendant", `launch-${launch.index}`);
}

// `other` (Shift/⌘) flips the tab setting for this one link.
function openHit(i, other = false) {
  const hit = launch.hits[i];
  if (!hit) return;
  const newTab = (linkTarget === "new") !== other;
  launcher.close();
  if (newTab) window.open(hit.link.url, "_blank", "noopener,noreferrer");
  else location.href = hit.link.url;
}

function openLauncher(text = "") {
  if (!data || launcher.open) return;
  $("#launch-input").value = text;
  launch.index = 0;
  renderLaunch();
  launcher.showModal();
  $("#launch-input").focus();
}

$("#launch-input").addEventListener("input", () => { launch.index = 0; renderLaunch(); });
$("#launch-input").addEventListener("keydown", (e) => {
  const n = launch.hits.length;
  if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) { e.preventDefault(); if (n) { launch.index = (launch.index + 1) % n; markLaunch(); } }
  else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) { e.preventDefault(); if (n) { launch.index = (launch.index - 1 + n) % n; markLaunch(); } }
  else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); openHit(launch.index, e.shiftKey || e.metaKey || e.ctrlKey); }
});
launcher.addEventListener("click", (e) => { if (e.target === launcher) launcher.close(); });

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (launcher.open) launcher.close();
    else if (!document.querySelector("dialog[open]")) openLauncher();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || !data || arranging) return;
  if (document.querySelector("dialog[open]")) return;
  const field = e.target.closest?.("input, textarea, select, [contenteditable]");
  if (field && !field.closest("dialog:not([open])")) return; // typing in a field (focus can linger in a closed dialog)
  if (e.key === "/") {
    e.preventDefault();
    openLauncher();
  } else if (/^[1-9]$/.test(e.key)) {
    // 1–9 jump to that group in the sidebar.
    const group = data.sections[Number(e.key) - 1];
    if (group) location.hash = slug(group.name);
  } else if (/^\p{L}$/u.test(e.key)) {
    e.preventDefault();
    openLauncher(e.key);
  }
});

/* ---------- Greeting + clock ---------- */

const NAME = "Tanishq";

function greetingFor(hour) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Good night";
}

// Uses the device's own clock and time zone.
function tick() {
  const now = new Date();
  $("#greeting").textContent = `${greetingFor(now.getHours())}, ${NAME}`;
  const date = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  $("#now").textContent = `${date} · ${time}`;
}

// Fire right as each minute starts, so the clock never lags behind the device.
let clockTimer;
function startClock() {
  clearTimeout(clockTimer);
  tick();
  const now = new Date();
  clockTimer = setTimeout(startClock, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
// Phones pause timers in background tabs; catch up when the tab is visible again.
document.addEventListener("visibilitychange", () => { if (!document.hidden) startClock(); });

/* ---------- Start ---------- */

startClock();

updateDot();

// A week before the token runs out (or once it stops working), say so once a day.
if (["warn", "bad"].includes(tokenHealth())) {
  const today = new Date().toDateString();
  if (store.get("gh-warned") !== today) {
    store.set("gh-warned", today);
    setTimeout(() => toast(`GitHub: ${healthText()[0].toLowerCase()}. Renew it in GitHub Connection.`), 600);
  }
}

// ?v=dev is replaced with the commit id on deploy, so edits show up right away.
fetch("links.json?v=dev")
  .then((r) => r.json())
  .then((json) => {
    data = json;
    render();
    // Connected browsers also check GitHub directly: it's ahead of the site
    // for the minute between saving and the deploy finishing.
    if (token.get()) {
      readRemote()
        .then(({ json: fresh }) => {
          if (serialize(fresh) !== serialize(data)) { data = fresh; render(); }
        })
        .catch(() => {});
    }
  })
  .catch((err) => {
    $("#sections").textContent = "Could not load links.json — check it for a JSON typo.";
    console.error(err);
  });
