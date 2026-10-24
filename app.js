// Reads links.json and draws the dashboard. No libraries, no build step.

const $ = (sel) => document.querySelector(sel);

// Icon priority: custom file in icons/ → site favicon → colored letter tile.
function iconEl(link) {
  const box = document.createElement("span");
  box.className = "icon";

  const letter = () => {
    box.replaceChildren();
    const s = document.createElement("span");
    s.className = "letter";
    s.textContent = link.name[0].toUpperCase();
    box.style.background = colorFor(link.name);
    box.append(s);
  };

  const img = new Image();
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  if (link.icon) {
    img.src = link.icon;
  } else {
    img.src = `https://icons.duckduckgo.com/ip3/${new URL(link.url).hostname}.ico`;
    img.className = "favicon";
  }
  img.onerror = letter;
  box.append(img);
  return box;
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
  a.append(iconEl(link), labelEl(link.name));
  return a;
}

function folderTile(folder) {
  const btn = document.createElement("button");
  btn.className = "tile";
  btn.type = "button";

  const preview = document.createElement("span");
  preview.className = "icon folder";
  for (const l of folder.folder.slice(0, 4)) preview.append(iconEl(l));

  btn.append(preview, labelEl(folder.name));
  btn.onclick = () => openFolder(folder);
  return btn;
}

function labelEl(text) {
  const s = document.createElement("span");
  s.className = "label";
  s.textContent = text;
  return s;
}

function openFolder(folder) {
  $("#folder-title").textContent = folder.name;
  $("#folder-grid").replaceChildren(...folder.folder.map(linkTile));
  $("#folder").showModal();
}

// Click outside the sheet closes it.
$("#folder").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

// "Finance" → "finance", used in the URL hash (#finance).
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function render(data) {
  document.title = data.title || "Dashboard";

  const sections = data.sections.map((sec) => {
    const section = document.createElement("section");
    section.dataset.slug = slug(sec.name);
    const h = document.createElement("h2");
    h.textContent = sec.name;
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.append(...sec.links.map((l) => (l.folder ? folderTile(l) : linkTile(l))));
    section.append(h, grid);
    return section;
  });
  $("#sections").replaceChildren(...sections);

  const navItems = [{ name: "All", slug: "all" }, ...data.sections.map((s) => ({ name: s.name, slug: slug(s.name) }))];
  $("#sidebar").replaceChildren(...navItems.map((item) => {
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
  const known = [...document.querySelectorAll("#sections section")].some((s) => s.dataset.slug === want);
  const current = known ? want : "all";

  for (const s of document.querySelectorAll("#sections section")) {
    s.classList.toggle("hidden", current !== "all" && s.dataset.slug !== current);
  }
  for (const a of document.querySelectorAll("#sidebar a")) {
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

fetch("links.json", { cache: "no-cache" })
  .then((r) => r.json())
  .then(render)
  .catch((err) => {
    $("#sections").textContent = "Could not load links.json — check it for a JSON typo.";
    console.error(err);
  });
