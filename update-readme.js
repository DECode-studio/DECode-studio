// Node 18+ has global fetch. No deps needed.
const fs = require("fs");
const { execSync } = require("child_process");

const USERNAME = detectUsername();
const SECTION_START = "<!--PROJECTS:START-->";
const SECTION_END   = "<!--PROJECTS:END-->";

// Opsi: exclude repo tertentu (fork, arsip, dsb)
const EXCLUDE = (process.env.EXCLUDE_REPOS || "")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// Pilihan strategi sorting: stars | updated | pushed
const STRATEGY = process.env.SORT_STRATEGY || "stars"; 
// Jumlah repo yang ditampilkan
const LIMIT = Number(process.env.LIMIT || 8);

function detectUsername() {
  const fromEnv =
    process.env.GH_USERNAME ||
    process.env.GITHUB_ACTOR ||
    (process.env.GITHUB_REPOSITORY || "").split("/")[0];

  const cleaned = (fromEnv || "").trim();
  if (cleaned && cleaned !== "YOUR_USERNAME") return cleaned;

  try {
    const remote = execSync("git config --get remote.origin.url", { encoding: "utf8" }).trim();
    const match = remote.match(/github\.com[:/](?<owner>[^/]+)\/.+$/i);
    if (match?.groups?.owner) return match.groups.owner;
  } catch {
    // ignore; fallback to throwing below
  }

  throw new Error(
    "Tidak bisa menentukan GH username. Set env GH_USERNAME atau pastikan remote origin mengarah ke GitHub."
  );
}

async function fetchAllRepos() {
  // Ambil repo milik user (owner), 100 cukup untuk kebanyakan
  const url = `https://api.github.com/users/${USERNAME}/repos?per_page=100&type=owner&sort=updated`;
  const headers = {};
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}\n${body}`);
  }
  return await res.json();
}

function pickRepos(repos) {
  const cleaned = repos
    .filter(r => !r.archived && !r.private)
    .filter(r => !EXCLUDE.includes(r.name.toLowerCase()));

  let sorted = cleaned;
  if (STRATEGY === "stars") {
    sorted = cleaned.sort((a,b) => b.stargazers_count - a.stargazers_count);
  } else if (STRATEGY === "updated") {
    sorted = cleaned.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
  } else if (STRATEGY === "pushed") {
    sorted = cleaned.sort((a,b) => new Date(b.pushed_at) - new Date(a.pushed_at));
  }

  return sorted.slice(0, LIMIT);
}

function fmtDate(iso) {
  try { return new Date(iso).toISOString().slice(0,10); } catch { return iso; }
}

function toMarkdownTable(repos) {
  if (repos.length === 0) return "_No public repositories found._";

  const rows = repos.map(r => {
    const stars = `⭐ ${r.stargazers_count}`;
    const forks = `🍴 ${r.forks_count}`;
    const lang  = r.language ? `\`${r.language}\`` : "`-`";
    const upd   = fmtDate(r.pushed_at || r.updated_at);
    return `| [${r.name}](${r.html_url}) | ${lang} | ${stars} • ${forks} | ${upd} |`;
  });

  return [
    "",
    `> Strategy: **${STRATEGY}** • Limit: **${LIMIT}**`,
    "",
    "| Repository | Main Lang | Stats | Last Push |",
    "|---|---|---|---|",
    ...rows,
    "",
    `_Last update: ${new Date().toLocaleString()}_`,
    ""
  ].join("\n");
}

function injectIntoReadme(readme, newBlock) {
  const start = readme.indexOf(SECTION_START);
  const end   = readme.indexOf(SECTION_END);

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Marker <!--PROJECTS:START--> / <!--PROJECTS:END--> tidak ditemukan/urutannya salah.");
  }
  const before = readme.slice(0, start + SECTION_START.length);
  const after  = readme.slice(end);
  return `${before}\n${newBlock}\n${after}`;
}

async function main() {
  const repos = await fetchAllRepos();
  const picked = pickRepos(repos);
  const block = toMarkdownTable(picked);

  const path = "README.md";
  const oldMd = fs.readFileSync(path, "utf8");
  const newMd = injectIntoReadme(oldMd, block);

  if (newMd.trim() !== oldMd.trim()) {
    fs.writeFileSync(path, newMd);
    console.log("README updated.");
  } else {
    console.log("No changes.");
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
