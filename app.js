// Reads links.json and draws the dashboard. No libraries, no build step.

const $ = (sel) => document.querySelector(sel);

// "YouTube Music" → "youtube-music". Used for icon files and URL hashes.
// Must match slug() in scripts/fetch_icons.py.
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// Icon priority: local "icon" path in links.json → icons/<slug>.png → colored letter tile.
// (An "icon" URL is only a download source for scripts/fetch_icons.py.)
function iconEl(link) {
  const box = document.createElement("span");
  box.className = "icon";

  const local = typeof link.icon === "string" && !link.icon.startsWith("http");
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.src = local ? link.icon : `icons/${slug(link.name)}.png`;
  img.onerror = () => {
    const s = document.createElement("span");
    s.className = "letter";
    s.textContent = link.name[0].toUpperCase();
    box.style.background = colorFor(link.name);
    box.replaceChildren(s);
  };
  box.append(img);

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
  a.append(iconEl(link), label);
  return a;
}

function render(data) {
  document.title = data.title || "Dashboard";

  const sections = data.sections.map((sec) => {
    const section = document.createElement("section");
    section.dataset.slug = slug(sec.name);
    const h = document.createElement("h2");
    h.textContent = sec.name;
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.append(...sec.links.map(linkTile));
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

// ?v=dev is replaced with the commit id on deploy, so edits show up right away.
fetch("links.json?v=dev")
  .then((r) => r.json())
  .then(render)
  .catch((err) => {
    $("#sections").textContent = "Could not load links.json — check it for a JSON typo.";
    console.error(err);
  });
