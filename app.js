// Reads links.json and draws the dashboard. No libraries, no build step.
// Edits (add / edit / move / delete) are saved by committing links.json to the
// GitHub repo with the API; the normal deploy then publishes them.

const $ = (sel) => document.querySelector(sel);

const REPO = "tanishqharit/Personal-Browser-Dashboard";
const BRANCH = "main";
const API = `https://api.github.com/repos/${REPO}/contents/`;
// Files committed seconds ago are on raw.githubusercontent before Pages redeploys.
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const NEW_GROUP = "__new__";

let data = null;
let editing = false;
const freshIcons = new Map(); // slug → data URL of icons uploaded in this tab
const loadedIcons = new Set(); // slugs whose icons/<slug>.png exists

// "YouTube Music" → "youtube-music". Used for icon files and URL hashes.
// Must match slug() in scripts/fetch_icons.py.
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const isLocalPath = (icon) => typeof icon === "string" && !icon.startsWith("http");

/* ---------- Drawing ---------- */

// Icon priority: icon uploaded this session → local "icon" path or icons/<slug>.png
// → same file on raw.githubusercontent (just committed) → colored letter tile.
// (An "icon" URL in links.json is only a download source for scripts/fetch_icons.py.)
function iconEl(link) {
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
    box.replaceChildren(letterEl(link.name));
    box.style.background = colorFor(link.name);
  };
  img.src = sources[0];
  box.append(img);

  const wrap = document.createElement("span");
  wrap.className = "icon-wrap";
  wrap.append(box);
  return wrap;
}

function letterEl(name) {
  const s = document.createElement("span");
  s.className = "letter";
  s.textContent = (name.trim()[0] || "?").toUpperCase();
  return s;
}

// Same name always gets the same color.
function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}

function linkTile(link, section) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = link.url;
  a.rel = "noreferrer";
  a.draggable = editing;
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = link.name;
  a.append(iconEl(link), label);

  a.addEventListener("click", (e) => {
    if (!editing) return;
    e.preventDefault();
    openLinkDialog(link, section);
  });
  a.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", slug(link.name));
    e.dataTransfer.effectAllowed = "move";
  });
  return a;
}

function render() {
  document.title = data.title || "Dashboard";
  document.body.classList.toggle("editing", editing);

  $("#sections").replaceChildren(...data.sections.map((sec) => {
    const section = document.createElement("section");
    section.dataset.slug = slug(sec.name);
    const h = document.createElement("h2");
    h.textContent = sec.name;
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.append(...sec.links.map((l) => linkTile(l, sec)));
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
    if (item.slug !== "all") makeDropTarget(a, item.slug);
    return a;
  }));

  show();
}

// In edit mode, dropping a tile on a sidebar group moves the link there.
function makeDropTarget(el, groupSlug) {
  el.addEventListener("dragover", (e) => {
    if (!editing) return;
    e.preventDefault();
    el.classList.add("drop");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drop");
    const linkSlug = e.dataTransfer.getData("text/plain");
    const found = findLink(data, linkSlug);
    if (!found || slug(found.section.name) === groupSlug) return;
    const groupName = findGroup(data, groupSlug).name;
    save((d) => moveLink(d, linkSlug, groupSlug), `Move ${found.link.name} to ${groupName}`)
      .catch((err) => alert(err.message));
  });
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

/* ---------- Data changes (each runs on the freshest links.json) ---------- */

function findGroup(d, groupSlug) {
  return d.sections.find((s) => slug(s.name) === groupSlug);
}

function findLink(d, linkSlug) {
  for (const section of d.sections) {
    const i = section.links.findIndex((l) => slug(l.name) === linkSlug);
    if (i >= 0) return { section, index: i, link: section.links[i] };
  }
  return null;
}

function groupFor(d, groupName) {
  let g = findGroup(d, slug(groupName));
  if (!g) {
    g = { name: groupName, links: [] };
    d.sections.push(g);
  }
  return g;
}

// Replaces the link that was called oldSlug (or adds it), keeping its spot if the group is unchanged.
function putLink(d, oldSlug, link, groupName) {
  const target = groupFor(d, groupName);
  const found = oldSlug && findLink(d, oldSlug);
  if (found && found.section === target) {
    target.links[found.index] = link;
    return;
  }
  if (found) found.section.links.splice(found.index, 1);
  target.links.push(link);
}

function moveLink(d, linkSlug, groupSlug) {
  const found = findLink(d, linkSlug);
  const target = findGroup(d, groupSlug);
  if (!found || !target) throw new Error("That link or group no longer exists.");
  found.section.links.splice(found.index, 1);
  target.links.push(found.link);
}

function deleteLink(d, linkSlug) {
  const found = findLink(d, linkSlug);
  if (found) found.section.links.splice(found.index, 1);
}

function deleteGroup(d, groupSlug, moveToSlug) {
  const g = findGroup(d, groupSlug);
  if (!g) return;
  if (g.links.length) {
    const target = findGroup(d, moveToSlug);
    if (!target || target === g) throw new Error("Pick a group to move its links to.");
    target.links.push(...g.links);
  }
  d.sections.splice(d.sections.indexOf(g), 1);
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

const token = {
  get: () => { try { return localStorage.getItem("gh-token"); } catch { return null; } },
  set: (t) => { try { localStorage.setItem("gh-token", t); } catch {} },
  clear: () => { try { localStorage.removeItem("gh-token"); } catch {} },
};

async function gh(path, options = {}, tok = token.get()) {
  const r = await fetch(API + path, {
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
  if (r.status === 401) throw new Error("GitHub token is invalid or expired. Update it under “GitHub connection…”.");
  if (r.status === 403 || r.status === 404) throw new Error("This token can't write to the repo. It needs Contents: Read and write on Personal-Browser-Dashboard.");
  if (r.status === 409) throw Object.assign(new Error("Someone else saved at the same time."), { conflict: true });
  throw new Error(`GitHub error ${r.status}.`);
}

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function readRemote() {
  const file = await gh(`links.json?ref=${BRANCH}`);
  if (!file) throw new Error("links.json not found in the repo.");
  return { json: JSON.parse(fromBase64(file.content)), sha: file.sha };
}

async function putFile(path, base64, message) {
  const existing = await gh(`${path}?ref=${BRANCH}`);
  await gh(path, {
    method: "PUT",
    body: JSON.stringify({ message, content: base64, branch: BRANCH, ...(existing ? { sha: existing.sha } : {}) }),
  });
}

// Applies `change` to the latest links.json on GitHub and commits it.
// Starting from the remote copy means edits from another device are never lost.
async function save(change, message, icon) {
  if (!token.get()) {
    openTokenDialog();
    throw new Error("Connect GitHub first, then press Save again.");
  }
  if (icon) await putFile(icon.path, icon.base64, `Upload icon: ${icon.path}`);

  for (let attempt = 0; ; attempt++) {
    const { json, sha } = await readRemote();
    change(json);
    try {
      await gh("links.json", {
        method: "PUT",
        body: JSON.stringify({ message, content: toBase64(new TextEncoder().encode(serialize(json))), sha, branch: BRANCH }),
      });
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

/* ---------- Add / edit dialog ---------- */

const linkDialog = $("#link-dialog");
let editingLink = null; // the link being edited, or null when adding
let pickedIcon = null; // data URL of a newly chosen icon

function fillGroupSelect(selected) {
  const sel = $("#f-group");
  sel.replaceChildren(
    ...data.sections.map((s) => new Option(s.name, s.name, false, s.name === selected)),
    new Option("＋ New group…", NEW_GROUP, false, !data.sections.length),
  );
  $("#new-group-row").hidden = sel.value !== NEW_GROUP;
}

function openLinkDialog(link = null, section = null) {
  editingLink = link;
  pickedIcon = null;
  $("#link-title").textContent = link ? "Edit link" : "Add link";
  $("#f-name").value = link?.name || "";
  $("#f-url").value = link?.url || "";
  $("#f-icon").value = "";
  $("#f-new-group").value = "";
  $("#delete-link").hidden = !link;
  $("#clear-icon").hidden = true;
  $("#link-status").textContent = "";
  $("#manage-groups").open = false;

  const current = data.sections.find((s) => slug(s.name) === location.hash.slice(1));
  fillGroupSelect(section?.name || current?.name || data.sections[0]?.name);
  renderGroupList();
  updatePreview();
  linkDialog.showModal();
  if (!link) $("#f-name").focus();
}

function updatePreview() {
  const name = $("#f-name").value.trim() || "?";
  let box;
  if (pickedIcon) {
    box = document.createElement("span");
    box.className = "icon";
    const img = new Image();
    img.src = pickedIcon;
    box.append(img);
  } else if (editingLink) {
    box = iconEl(editingLink).firstChild; // keeps its own fallback handling
  } else {
    box = document.createElement("span");
    box.className = "icon";
    box.style.background = colorFor(name);
    box.append(letterEl(name));
  }
  box.id = "icon-preview";
  $("#icon-preview").replaceWith(box);
}

$("#f-name").addEventListener("input", () => { if (!editingLink && !pickedIcon) updatePreview(); });
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

function normalizeUrl(raw) {
  let u = raw.trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes(".") ? parsed.href : null;
  } catch {
    return null;
  }
}

$("#link-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("#link-status");
  const name = $("#f-name").value.trim();
  const url = normalizeUrl($("#f-url").value);
  const newGroup = $("#f-group").value === NEW_GROUP;
  const groupName = newGroup ? $("#f-new-group").value.trim() : $("#f-group").value;
  const oldSlug = editingLink && slug(editingLink.name);
  const newSlug = slug(name);

  if (!name || !newSlug.replace(/-/g, "")) return void (status.textContent = "Give it a name.");
  if (!url) return void (status.textContent = "That URL doesn't look right. Example: chase.com");
  if (!groupName) return void (status.textContent = "Name the new group.");
  if (slug(groupName) === "all") return void (status.textContent = "“All” is taken. Pick another group name.");
  if (newSlug !== oldSlug && findLink(data, newSlug)) return void (status.textContent = `There's already a link called “${name}”.`);

  const link = { name, url };
  let icon = null;
  if (pickedIcon) {
    icon = { path: `icons/${newSlug}.png`, base64: pickedIcon.split(",")[1] };
  } else if (editingLink?.icon) {
    link.icon = editingLink.icon;
  } else if (editingLink && newSlug !== oldSlug && loadedIcons.has(oldSlug)) {
    link.icon = `icons/${oldSlug}.png`; // renamed: keep using the old icon file
  }

  setBusy(true, "Saving…");
  try {
    await save((d) => putLink(d, oldSlug, link, groupName), editingLink ? `Edit ${name}` : `Add ${name}`, icon);
    if (pickedIcon) freshIcons.set(newSlug, pickedIcon);
    render();
    location.hash = slug(groupName);
    status.textContent = "Saved. Other devices update in about a minute.";
    setTimeout(() => linkDialog.close(), 700);
  } catch (err) {
    status.textContent = err.message;
  } finally {
    setBusy(false);
  }
});

$("#delete-link").addEventListener("click", async () => {
  if (!editingLink || !confirm(`Delete “${editingLink.name}”?`)) return;
  setBusy(true, "Deleting…");
  try {
    await save((d) => deleteLink(d, slug(editingLink.name)), `Delete ${editingLink.name}`);
    linkDialog.close();
  } catch (err) {
    $("#link-status").textContent = err.message;
  } finally {
    setBusy(false);
  }
});

function setBusy(busy, text) {
  for (const b of linkDialog.querySelectorAll("button, input, select")) b.disabled = busy;
  if (text) $("#link-status").textContent = text;
}

// "Manage groups": delete a group; if it has links, choose where they go.
function renderGroupList() {
  $("#group-list").replaceChildren(...data.sections.map((g) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = g.name;
    const count = document.createElement("small");
    count.textContent = ` ${g.links.length} link${g.links.length === 1 ? "" : "s"}`;
    name.append(count);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger small";
    del.textContent = "Delete";
    del.onclick = () => {
      if (!g.links.length) {
        if (confirm(`Delete the empty group “${g.name}”?`)) removeGroup(g, null);
        return;
      }
      const others = data.sections.filter((s) => s !== g);
      if (!others.length) {
        $("#link-status").textContent = "This is your only group. Make another one first.";
        return;
      }
      const sel = document.createElement("select");
      sel.append(...others.map((s) => new Option(s.name, slug(s.name))));
      const go = document.createElement("button");
      go.type = "button";
      go.className = "danger small";
      go.textContent = "Delete group";
      go.onclick = () => removeGroup(g, sel.value);
      const label = document.createElement("span");
      label.className = "move-to";
      label.textContent = `Move its ${g.links.length} link${g.links.length === 1 ? "" : "s"} to`;
      li.replaceChildren(label, sel, go);
    };
    li.append(name, del);
    return li;
  }));
}

async function removeGroup(g, moveTo) {
  setBusy(true, `Deleting ${g.name}…`);
  try {
    await save((d) => deleteGroup(d, slug(g.name), moveTo), `Delete group ${g.name}`);
    fillGroupSelect($("#f-group").value);
    renderGroupList();
    $("#link-status").textContent = `Deleted “${g.name}”.`;
  } catch (err) {
    $("#link-status").textContent = err.message;
  } finally {
    setBusy(false);
  }
}

/* ---------- Token dialog ---------- */

const tokenDialog = $("#token-dialog");

function openTokenDialog() {
  $("#f-token").value = "";
  $("#token-status").textContent = token.get() ? "This browser is connected. Paste a new token to replace it." : "";
  tokenDialog.showModal();
}

$("#token-btn").addEventListener("click", openTokenDialog);
$("#token-forget").addEventListener("click", () => {
  token.clear();
  $("#token-status").textContent = "Token removed from this browser.";
});
$("#token-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = $("#f-token").value.trim();
  if (!t) return void ($("#token-status").textContent = "Paste a token first.");
  $("#token-status").textContent = "Checking…";
  try {
    if (!(await gh(`links.json?ref=${BRANCH}`, {}, t))) throw new Error("This token can't see the repo.");
    token.set(t);
    $("#token-status").textContent = "Connected.";
    if (linkDialog.open) $("#link-status").textContent = "Connected. Press Save.";
    setTimeout(() => tokenDialog.close(), 500);
  } catch (err) {
    $("#token-status").textContent = err.message;
  }
});

/* ---------- Sidebar buttons, dialogs ---------- */

$("#add-btn").addEventListener("click", () => openLinkDialog());
$("#edit-btn").addEventListener("click", () => {
  editing = !editing;
  $("#edit-btn").textContent = editing ? "Done" : "Edit";
  $("#edit-btn").setAttribute("aria-pressed", editing);
  render();
});

for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });
}

/* ---------- Start ---------- */

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
