// Node 18+ has global fetch. No deps needed.
const fs = require("fs");
const { execSync } = require("child_process");

const USERNAME = detectUsername();
const PROJECT_SECTION_START = "<!--PROJECTS:START-->";
const PROJECT_SECTION_END   = "<!--PROJECTS:END-->";
const LANG_SECTION_START = "<!--LANGUAGES:START-->";
const LANG_SECTION_END   = "<!--LANGUAGES:END-->";
const FRAME_SECTION_START = "<!--FRAMEWORKS:START-->";
const FRAME_SECTION_END   = "<!--FRAMEWORKS:END-->";

// Opsi: exclude repo tertentu (fork, arsip, dsb)
const EXCLUDE = (process.env.EXCLUDE_REPOS || "")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// Pilihan strategi sorting: stars | updated | pushed
const STRATEGY = process.env.SORT_STRATEGY || "stars"; 
// Jumlah repo yang ditampilkan (set LIMIT<=0 untuk menampilkan semuanya)
const LIMIT = process.env.LIMIT !== undefined ? Number(process.env.LIMIT) : 8;

const LANGUAGE_ALIASES = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  py: "Python",
  python: "Python",
  rb: "Ruby",
  ruby: "Ruby",
  csharp: "C#",
  "c#": "C#",
  cpp: "C++",
  "c++": "C++",
  go: "Go",
  golang: "Go"
};

const FRAMEWORK_ALIASES = normalizeFrameworkAliasMap({
  react: "React",
  reactjs: "React",
  nextjs: "Next.js",
  nextjs13: "Next.js",
  "next-js": "Next.js",
  vue: "Vue.js",
  "vuejs": "Vue.js",
  nuxt: "Nuxt.js",
  nuxtjs: "Nuxt.js",
  svelte: "Svelte",
  solidjs: "SolidJS",
  astro: "Astro",
  angular: "Angular",
  "angularjs": "AngularJS",
  express: "Express",
  expressjs: "Express",
  fastify: "Fastify",
  nest: "NestJS",
  nestjs: "NestJS",
  koa: "Koa",
  laravel: "Laravel",
  lumen: "Lumen",
  codeigniter: "CodeIgniter",
  symfony: "Symfony",
  django: "Django",
  flask: "Flask",
  fastapi: "FastAPI",
  spring: "Spring",
  springboot: "Spring Boot",
  rails: "Ruby on Rails",
  dotnet: ".NET",
  aspnet: "ASP.NET",
  bootstrap: "Bootstrap",
  tailwind: "Tailwind CSS",
  tailwindcss: "Tailwind CSS",
  chakraui: "Chakra UI",
  mantine: "Mantine",
  materialui: "Material UI",
  jquery: "jQuery",
  gatsby: "Gatsby",
  remix: "Remix",
  electron: "Electron",
  ionic: "Ionic",
  flutter: "Flutter",
  reactnative: "React Native",
  capacitor: "Capacitor",
  astrojs: "Astro",
  adonis: "AdonisJS",
  strapi: "Strapi",
  wordpress: "WordPress"
});

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

function filterRepos(repos) {
  return repos
    .filter(r => !r.archived && !r.private)
    .filter(r => !EXCLUDE.includes(r.name.toLowerCase()));
}

function pickRepos(cleaned) {
  const data = [...cleaned];
  if (STRATEGY === "stars") {
    data.sort((a,b) => b.stargazers_count - a.stargazers_count);
  } else if (STRATEGY === "updated") {
    data.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
  } else if (STRATEGY === "pushed") {
    data.sort((a,b) => new Date(b.pushed_at) - new Date(a.pushed_at));
  }

  const sliceCount = !Number.isFinite(LIMIT) || LIMIT <= 0 ? data.length : LIMIT;
  return data.slice(0, sliceCount);
}

function fmtDate(iso) {
  try { return new Date(iso).toISOString().slice(0,10); } catch { return iso; }
}

function usageBar(pct) {
  const blocks = 10;
  let filled = pct > 0 ? Math.round((pct / 100) * blocks) : 0;
  filled = Math.max(0, Math.min(blocks, filled));
  if (pct > 0 && filled === 0) filled = 1;
  const empty = blocks - filled;
  const bar = `${"█".repeat(filled)}${"░".repeat(empty)}`;
  return `\`${bar}\` ${pct.toFixed(0)}%`;
}

function buildLanguageSection(repos) {
  const stats = aggregateLanguages(repos);
  if (!stats.items.length) return "_Belum ada bahasa publik yang bisa ditampilkan._";

  const rows = stats.items.slice(0, 8).map((item, idx) => {
    const pct = stats.total ? (item.count / stats.total) * 100 : 0;
    return `| #${idx + 1} | ${item.name} | ${item.count} repos | ${usageBar(pct)} |`;
  });

  return [
    "",
    `> Berdasarkan ${stats.total} repositori publik bertanda bahasa`,
    "",
    "| Rank | Bahasa | Frekuensi | Intensitas |",
    "|---|---|---|---|",
    ...rows,
    "",
    "_Diurutkan dari yang paling sering dikerjakan._",
    ""
  ].join("\n");
}

function buildFrameworkSection(repos, topicsMap) {
  const stats = aggregateFrameworks(repos, topicsMap);
  if (!stats.items.length) return "_Belum ada framework yang terdeteksi dari GitHub Topics._";

  const rows = stats.items.slice(0, 8).map((item, idx) => {
    const pct = stats.totalHits ? (item.count / stats.totalHits) * 100 : 0;
    return `| #${idx + 1} | ${item.name} | ${item.count} repos | ${usageBar(pct)} |`;
  });

  return [
    "",
    `> ${stats.repoHits} repos menyebut framework (${stats.totalHits} total tags)`,
    "",
    "| Rank | Framework / Library | Frekuensi | Intensitas |",
    "|---|---|---|---|",
    ...rows,
    "",
    "_Data diambil otomatis dari GitHub Topics & tags._",
    ""
  ].join("\n");
}

async function fetchRepoTopics(owner, repos) {
  const topics = {};
  if (!repos.length) return topics;

  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  for (const repo of repos) {
    const url = `https://api.github.com/repos/${owner}/${repo.name}/topics`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 403) {
          console.warn("Lewati pengambilan GitHub Topics (butuh token untuk rate limit lebih tinggi).");
          return {};
        }
        topics[repo.name] = [];
        continue;
      }
      const data = await res.json();
      topics[repo.name] = data.names || [];
    } catch {
      topics[repo.name] = [];
    }
  }
  return topics;
}

function aggregateLanguages(repos) {
  const counts = {};
  for (const repo of repos) {
    const lang = prettyLanguage(repo.language);
    if (!lang) continue;
    counts[lang] = (counts[lang] || 0) + 1;
  }
  const items = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a,b) => b.count - a.count);
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return { items, total };
}

function aggregateFrameworks(repos, topicsMap = {}) {
  const counts = {};
  let repoHits = 0;

  for (const repo of repos) {
    const topics = topicsMap[repo.name] || [];
    const frameworks = new Set();
    topics.forEach(topic => {
      const name = normalizeFrameworkTopic(topic);
      if (name) frameworks.add(name);
    });

    if (frameworks.size > 0) repoHits += 1;
    frameworks.forEach(name => {
      counts[name] = (counts[name] || 0) + 1;
    });
  }

  const items = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a,b) => b.count - a.count);
  const totalHits = items.reduce((sum, item) => sum + item.count, 0);
  return { items, totalHits, repoHits };
}

function prettyLanguage(lang) {
  if (!lang) return "";
  const trimmed = String(lang).trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  return LANGUAGE_ALIASES[lower] ||
    LANGUAGE_ALIASES[lower.replace(/\s+/g, "")] ||
    trimmed;
}

function normalizeFrameworkTopic(topic) {
  const key = (topic || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return FRAMEWORK_ALIASES[key] || null;
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

function injectSection(readme, startMarker, endMarker, newBlock) {
  const start = readme.indexOf(startMarker);
  const end   = readme.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Marker ${startMarker} / ${endMarker} tidak ditemukan/urutannya salah.`);
  }
  const before = readme.slice(0, start + startMarker.length);
  const after  = readme.slice(end);
  return `${before}\n${newBlock}\n${after}`;
}

async function main() {
  const repos = await fetchAllRepos();
  const cleaned = filterRepos(repos);
  const picked = pickRepos(cleaned);
  const topics = await fetchRepoTopics(USERNAME, cleaned);

  const projectBlock = toMarkdownTable(picked);
  const languageBlock = buildLanguageSection(cleaned);
  const frameworkBlock = buildFrameworkSection(cleaned, topics);

  const path = "README.md";
  const oldMd = fs.readFileSync(path, "utf8");

  let newMd = injectSection(oldMd, PROJECT_SECTION_START, PROJECT_SECTION_END, projectBlock);
  newMd = injectSection(newMd, LANG_SECTION_START, LANG_SECTION_END, languageBlock);
  newMd = injectSection(newMd, FRAME_SECTION_START, FRAME_SECTION_END, frameworkBlock);

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

function normalizeFrameworkAliasMap(entries) {
  const normalized = {};
  for (const [key, value] of Object.entries(entries)) {
    const clean = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    normalized[clean] = value;
  }
  return normalized;
}
