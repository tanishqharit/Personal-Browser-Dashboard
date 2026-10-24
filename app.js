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
  a.dataset.search = link.name.toLowerCase();
  a.append(iconEl(link), labelEl(link.name));
  return a;
}

function folderTile(folder) {
  const btn = document.createElement("button");
  btn.className = "tile";
  btn.type = "button";
  btn.dataset.search = [folder.name, ...folder.folder.map((l) => l.name)].join(" ").toLowerCase();

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

function render(data) {
  document.title = data.title || "Dashboard";
  const out = data.sections.map((sec) => {
    const section = document.createElement("section");
    const h = document.createElement("h2");
    h.textContent = sec.name;
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.append(...sec.links.map((l) => (l.folder ? folderTile(l) : linkTile(l))));
    section.append(h, grid);
    return section;
  });
  $("#sections").replaceChildren(...out);
}

// Search: filters tiles as you type; Enter opens the first match.
$("#search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  for (const section of document.querySelectorAll("#sections section")) {
    let any = false;
    for (const tile of section.querySelectorAll(".tile")) {
      const hit = tile.dataset.search.includes(q);
      tile.classList.toggle("hidden", !hit);
      any ||= hit;
    }
    section.classList.toggle("hidden", !any);
  }
});
$("#search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = document.querySelector("#sections .tile:not(.hidden)");
  if (first) first.click();
});

// "/" focuses search from anywhere (laptop shortcut).
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $("#search")) {
    e.preventDefault();
    $("#search").focus();
  }
});

function tick() {
  $("#clock").textContent = new Date().toLocaleString([], {
    weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
tick();
setInterval(tick, 30_000);

fetch("links.json", { cache: "no-cache" })
  .then((r) => r.json())
  .then(render)
  .catch((err) => {
    $("#sections").textContent = "Could not load links.json — check it for a JSON typo.";
    console.error(err);
  });
