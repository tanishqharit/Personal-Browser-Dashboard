// Reads links.json and draws the dashboard. No libraries, no build step.
// Changes are saved by committing links.json to the GitHub repo through the
// GitHub API; the normal deploy then publishes them to every device.

const $ = (sel, root = document) => root.querySelector(sel);

const REPO = "tanishqharit/Personal-Browser-Dashboard";
const BRANCH = "main";
const API = `https://api.github.com/repos/${REPO}/contents/`;
// Files committed seconds ago are on raw.githubusercontent before Pages redeploys.
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const NEW_GROUP = "__new__";

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

function svg(paths) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = paths;
  return el;
}
const ICON = {
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

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

// Icon priority: icon uploaded this session → local "icon" path or icons/<slug>.png
// → same file on raw.githubusercontent (just committed) → colored letter tile.
// (An "icon" URL in links.json is only a download source for scripts/fetch_icons.py.)
function iconBox(link) {
  const box = document.createElement("span");
  box.className = "icon";

  const s = slug(link.name);
  const path = isLocalPath(link.icon) ? link.icon : `icons/${s}.png`;
  const sources = freshIcons.has(s) ? [freshIcons.get(s)] : [path, RAW + path];

  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => { if (path === `icons/${s}.png`) loadedIcons.add(s); };
  img.onerror = () => {
    sources.shift();
    if (sources.length) { img.src = sources[0]; return; }
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
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = link.name;
  a.append(wrapIcon(iconBox(link)), label);
  return a;
}

function render() {
  document.title = data.title || "Dashboard";

  $("#sections").replaceChildren(...data.sections.map((sec) => {
    const section = document.createElement("section");
    section.dataset.slug = slug(sec.name);
    const h = document.createElement("h2");
    h.textContent = sec.name;
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.append(...sec.links.map(linkTile));
    if (!sec.links.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No links yet.";
      grid.append(empty);
    }
    section.append(h, grid);
    return section;
  }));

  const navItems = [{ name: "All", slug: "all" }, ...data.sections.map((s) => ({ name: s.name, slug: slug(s.name) }))];
  $("#groups").replaceChildren(...navItems.map((item) => {
    const a = document.createElement("a");
    a.href = `#${item.slug}`;
    a.textContent = item.name;
    a.dataset.slug = item.slug;
    return a;
  }));

  show();
}

// Shows the section named in the URL hash; no hash (or unknown) → All.
function show() {
  const want = location.hash.slice(1);
  const known = data.sections.some((s) => slug(s.name) === want);
  const current = known ? want : "all";

  for (const s of document.querySelectorAll("#sections section")) {
    s.classList.toggle("hidden", current !== "all" && s.dataset.slug !== current);
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
  const lines = ["{", `  "title": ${JSON.stringify(d.title)},`, '  "sections": ['];
  d.sections.forEach((s, si) => {
    lines.push("    {", `      "name": ${JSON.stringify(s.name)},`, '      "links": [');
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
  set: (t, login) => { store.set("gh-token", t); store.set("gh-login", login || ""); },
  clear: () => { store.remove("gh-token"); store.remove("gh-login"); },
};

async function ghFetch(url, options = {}, tok = token.get()) {
  const r = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tok}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (r.ok) return r.json();
  if (r.status === 404 && (options.method || "GET") === "GET") return null;
  if (r.status === 401) throw new Error("The GitHub token is invalid or expired. Update it in GitHub Connection.");
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

/* ---------- Add Link ---------- */

const linkDialog = $("#link-dialog");
let pickedIcon = null; // data URL of a newly chosen icon

function openAddLink() {
  pickedIcon = null;
  $("#link-form").reset();
  $("#clear-icon").hidden = true;
  $("#link-status").textContent = "";

  const current = findGroup(data, location.hash.slice(1));
  const sel = $("#f-group");
  sel.replaceChildren(
    ...data.sections.map((s) => new Option(s.name, s.name, false, s === current)),
    new Option("＋ New group…", NEW_GROUP, false, !data.sections.length),
  );
  $("#new-group-row").hidden = sel.value !== NEW_GROUP;
  updatePreview();
  linkDialog.showModal();
  $("#f-name").focus();
}

function updatePreview() {
  const box = pickedIcon ? imageBox(pickedIcon) : letterBox($("#f-name").value.trim() || "?");
  box.id = "icon-preview";
  $("#icon-preview").replaceWith(box);
}

$("#f-name").addEventListener("input", () => { if (!pickedIcon) updatePreview(); });
$("#f-group").addEventListener("change", (e) => {
  $("#new-group-row").hidden = e.target.value !== NEW_GROUP;
  if (e.target.value === NEW_GROUP) $("#f-new-group").focus();
});
$("#f-icon").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pickedIcon = await iconFromFile(file);
    $("#clear-icon").hidden = false;
    updatePreview();
  } catch {
    $("#link-status").textContent = "Couldn't read that image. Try a PNG, JPG or SVG.";
  }
});
$("#clear-icon").addEventListener("click", () => {
  pickedIcon = null;
  $("#f-icon").value = "";
  $("#clear-icon").hidden = true;
  updatePreview();
});

$("#link-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("#link-status");
  const name = $("#f-name").value.trim();
  const url = normalizeUrl($("#f-url").value);
  const newGroup = $("#f-group").value === NEW_GROUP;
  const groupName = newGroup ? $("#f-new-group").value.trim() : $("#f-group").value;

  if (!name || !slug(name).replace(/-/g, "")) return void (status.textContent = "Give it a name.");
  if (!url) return void (status.textContent = "That URL doesn't look right. Example: chase.com");
  if (!groupName) return void (status.textContent = "Name the new group.");
  if (slug(groupName) === "all") return void (status.textContent = "“All” is reserved. Pick another group name.");
  if (findLink(data, slug(name))) return void (status.textContent = `There's already a link called “${name}”.`);

  const icon = pickedIcon && { path: `icons/${slug(name)}.png`, base64: pickedIcon.split(",")[1] };
  setDisabled(linkDialog, true);
  status.textContent = "Saving…";
  try {
    await save((d) => {
      let g = findGroup(d, slug(groupName));
      if (!g) d.sections.push((g = { name: groupName, links: [] }));
      g.links.push({ name, url });
    }, `Add ${name}`, icon);
    if (pickedIcon) freshIcons.set(slug(name), pickedIcon);
    render();
    location.hash = slug(groupName);
    linkDialog.close();
    toast(`Added ${name}`);
  } catch (err) {
    status.textContent = err.message;
  } finally {
    setDisabled(linkDialog, false);
  }
});

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
};

function startEditing(json) {
  mgr.base = clone(json);
  mgr.work = clone(json);
  mgr.icons.clear();
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

const isDirty = () => mgr.icons.size > 0 || serialize(mgr.work) !== serialize(mgr.base);

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
    const b = document.createElement("button");
    b.type = "button";
    b.className = "group-item" + (i === mgr.selected ? " selected" : "");
    const name = document.createElement("span");
    name.textContent = g.name || "Untitled group";
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = g.links.length;
    b.append(name, count);
    b.onclick = () => { mgr.selected = i; mgr.confirming = false; renderManager(); };
    li.append(b);
    return li;
  }));
}

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

  // Header: editable group name + reorder / delete
  const head = document.createElement("div");
  head.className = "pane-head";
  const title = document.createElement("input");
  title.className = "title-input";
  title.value = g.name;
  title.maxLength = 30;
  title.setAttribute("aria-label", "Group name");
  title.oninput = () => { g.name = title.value; renderGroupList(); touched(); };
  const tools = document.createElement("div");
  tools.className = "tools";
  const up = iconButton("up", "Move group up", () => moveGroup(-1));
  const down = iconButton("down", "Move group down", () => moveGroup(1));
  up.disabled = mgr.selected === 0;
  down.disabled = mgr.selected === groups.length - 1;
  tools.append(up, down, iconButton("trash", "Delete group", () => { mgr.confirming = true; renderGroupPane(); }, "danger"));
  head.append(title, tools);

  const parts = [head];
  if (mgr.confirming) parts.push(deleteGroupBar(g));

  const list = document.createElement("ul");
  list.className = "link-list";
  list.append(...g.links.map((l, i) => linkRow(g, l, i)));
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
    else for (const l of g.links) mgr.icons.delete(l);
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
  li.className = "link-row";

  const iconBtn = document.createElement("button");
  iconBtn.type = "button";
  iconBtn.className = "row-icon";
  iconBtn.title = "Change icon";
  iconBtn.setAttribute("aria-label", `Change icon for ${link.name || "new link"}`);
  const orig = mgr.origName.get(link);
  const box = mgr.icons.has(link) ? imageBox(mgr.icons.get(link))
    : orig !== undefined ? iconBox({ ...link, name: orig })
    : letterBox(link.name || "?");
  iconBtn.append(wrapIcon(box));
  iconBtn.onclick = () => { mgr.iconTarget = link; $("#mgr-file").click(); };

  const fields = document.createElement("div");
  fields.className = "row-fields";
  const name = document.createElement("input");
  name.className = "row-name";
  name.placeholder = "Name";
  name.value = link.name;
  name.maxLength = 40;
  name.setAttribute("aria-label", "Link name");
  name.oninput = () => { link.name = name.value; touched(); };
  const url = document.createElement("input");
  url.className = "row-url";
  url.placeholder = "https://";
  url.value = link.url;
  url.inputMode = "url";
  url.autocapitalize = "off";
  url.spellcheck = false;
  url.setAttribute("aria-label", "Link URL");
  url.oninput = () => { link.url = url.value; touched(); };
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
  const up = iconButton("up", "Move up", () => moveLink(g, i, -1));
  const down = iconButton("down", "Move down", () => moveLink(g, i, 1));
  up.disabled = i === 0;
  down.disabled = i === g.links.length - 1;
  tools.append(up, down, iconButton("trash", "Delete link", () => {
    g.links.splice(i, 1);
    mgr.icons.delete(link);
    renderManager();
  }, "danger"));

  li.append(iconBtn, fields, move, tools);
  return li;
}

function moveGroup(dir) {
  const s = mgr.work.sections, i = mgr.selected, j = i + dir;
  if (j < 0 || j >= s.length) return;
  [s[i], s[j]] = [s[j], s[i]];
  mgr.selected = j;
  renderManager();
}

function moveLink(g, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= g.links.length) return;
  [g.links[i], g.links[j]] = [g.links[j], g.links[i]];
  renderManager();
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
    if (gs === "all") return fail("“All” is reserved. Rename that group.");
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
  for (const g of work.sections) for (const l of g.links) {
    const orig = mgr.origName.get(l);
    if (mgr.icons.has(l)) {
      delete l.icon;
      uploads.push({ link: l, url: mgr.icons.get(l) });
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
    for (const u of uploads) freshIcons.set(slug(u.link.name), u.url);
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
    toast("Changes saved. Other devices update in about a minute.");
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

/* ---------- GitHub Connection ---------- */

const githubDialog = $("#github-dialog");

function renderGithub() {
  const t = token.get();
  const on = !!t;
  $("#gh-card-dot").classList.toggle("on", on);
  $("#gh-state").textContent = on ? "Connected" : "Not connected";
  $("#gh-detail").textContent = on
    ? "Adding and managing links is enabled in this browser."
    : "Connect to add and manage links from this browser. Viewing the dashboard doesn't need this.";
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
  const on = !!token.get();
  $("#gh-dot").classList.toggle("on", on);
  $("#github-btn").title = on ? "GitHub: connected" : "GitHub: not connected";
}

function openGithub(message = "") {
  renderGithub();
  $("#f-token").value = "";
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
    if (login) token.set(token.get(), login);
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

/* ---------- Sidebar, dialogs ---------- */

$("#add-btn").addEventListener("click", openAddLink);
$("#manage-btn").addEventListener("click", openManager);
$("#github-btn").addEventListener("click", () => openGithub());

for (const dialog of [linkDialog, githubDialog]) {
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });
}

/* ---------- Start ---------- */

updateDot();

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
