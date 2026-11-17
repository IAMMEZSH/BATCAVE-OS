'use strict';
/* BATCAVE OS // 发布雷达：GitHub / GitCode 新项目与新版本提示 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const embedded = require('./embedded');
const { compareVersions, parseVersion } = require('./update');
const cfg = require('../package.json');

const GITHUB_USER = 'IAMMEZSH';
const GITCODE_USER = 'gcw_So3EkhfR';
const CACHE_TTL = 10 * 60 * 1000;
const WATCH_INTERVAL = 30 * 60 * 1000;
const MAX_EVENTS = 100;

const KNOWN = {
  'BATCAVE-OS': {
    order: 0, name: 'BATCAVE OS', en: 'NIGHT OPERATIONS SHELL', category: 'SYSTEM',
    desc: '本地优先的 Windows 虚拟桌面：真实终端、文件系统、网络与自带应用。',
    updater: 'self'
  },
  TenSaint73OS: {
    order: 1, name: 'TenSaint73OS', en: 'COMMAND NEXUS', category: 'COMMUNITY',
    desc: '单管理员社区系统：论坛、共享文件与会员。',
    updater: 'embedded', app: 'tensaint'
  },
  'global-reading-room': {
    order: 2, name: '环球报阁', en: 'GLOBAL READING ROOM', category: 'READER',
    desc: '多语种报刊阅读：RSS 抓取、正文抽取、翻译、朗读与导出。',
    updater: 'embedded', app: 'reading'
  },
  'CodeForge-AI': {
    order: 3, name: 'CodeForge AI', en: 'AI DEVELOPMENT NEXUS', category: 'DEVELOPER',
    desc: 'AI 编程中枢：项目浏览、编译运行、诊断与自修复。',
    updater: 'embedded', app: 'codeforge'
  },
  'geo-position-workstation': {
    order: 4, name: '定位工作站', en: 'GEO POSITION WORKSTATION', category: 'GEOLOCATION',
    desc: 'IP / Wi-Fi / 时区 / 路由定位与网络诊断工作台。',
    updater: 'external'
  },
  'wanjuan-ge': {
    order: 5, name: '万卷阁', en: 'WANJUAN GE', category: 'READER',
    desc: '万卷阁阅读与资料系统，支持群聊开关与文明发言过滤。',
    updater: 'external'
  }
};

let DATA_DIR = '';
let cache = null;
let cacheAt = 0;
let inflight = null;
let watchTimer = null;

function init(dataDir) {
  DATA_DIR = dataDir || DATA_DIR;
}

function stateFile() {
  return path.join(DATA_DIR || path.join(__dirname, '..', 'data'), 'releases', 'feed.json');
}

function emptyState() {
  return { version: 1, seeded: false, baseline: {}, events: [], updatedAt: null };
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch { return fallback; }
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

async function loadState() {
  const state = await readJson(stateFile(), null);
  if (!state || typeof state !== 'object') return emptyState();
  return {
    version: 1,
    seeded: !!state.seeded,
    baseline: state.baseline && typeof state.baseline === 'object' ? state.baseline : {},
    events: Array.isArray(state.events) ? state.events : [],
    updatedAt: state.updatedAt || null
  };
}

function saveState(state) {
  return writeJson(stateFile(), state);
}

function apiHeaders(source) {
  const headers = {
    'user-agent': 'BATCAVE-OS/' + (cfg.version || 'unknown'),
    accept: source === 'github' ? 'application/vnd.github+json' : 'application/json'
  };
  if (source === 'github' && process.env.GITHUB_TOKEN) {
    headers.authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  }
  return headers;
}

async function fetchJson(url, source) {
  const res = await fetch(url, {
    headers: apiHeaders(source),
    signal: AbortSignal.timeout(20000)
  });
  if (res.status === 404) return { status: 404, data: null };
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  if (text.length > 6 * 1024 * 1024) throw new Error('发布信息过大');
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { throw new Error('发布信息不是 JSON'); }
}

function releaseVersion(tag) {
  const v = String(tag || '').trim().replace(/^v/i, '');
  return parseVersion(v) ? v : '';
}

function platformUrl(source, repo, tag) {
  const user = source === 'github' ? GITHUB_USER : GITCODE_USER;
  const base = source === 'github' ? 'https://github.com/' : 'https://gitcode.com/';
  return base + user + '/' + repo + '/releases/tag/' + encodeURIComponent(tag);
}

function normalizeAssets(data, source) {
  const out = [];
  for (const raw of Array.isArray(data && data.assets) ? data.assets : []) {
    if (!raw || !raw.name) continue;
    const size = Number(raw.size || raw.file_size || 0);
    if (!(size > 0)) continue;
    const url = source === 'github'
      ? (raw.browser_download_url || raw.url || '')
      : (raw.browser_download_url || raw.url || raw.download_url || '');
    if (!url) continue;
    const digest = String(raw.digest || raw.sha256 || '').replace(/^sha256:/i, '').toLowerCase();
    out.push({
      name: String(raw.name),
      size,
      url: String(url),
      sha256: /^[a-f0-9]{64}$/.test(digest) ? digest : '',
      windows: /windows|win64|win-x64|win_x64|\.exe$|\.msi$/i.test(String(raw.name))
    });
  }
  return out.slice(0, 20);
}

function normalizePlatform(data, source, repo) {
  if (!data) return null;
  const tag = String(data.tag_name || '');
  const version = releaseVersion(tag);
  if (!version) return null;
  const assets = normalizeAssets(data, source);
  return {
    source,
    tag,
    version,
    title: String(data.name || ''),
    notes: String(data.body || '').slice(0, 12000),
    published: String(data.published_at || data.created_at || ''),
    releaseUrl: String(data.html_url || platformUrl(source, repo, tag)),
    assets,
    windowsAsset: assets.find(a => a.windows) || null
  };
}

async function latestRelease(source, repo) {
  const url = source === 'github'
    ? 'https://api.github.com/repos/' + GITHUB_USER + '/' + repo + '/releases/latest'
    : 'https://api.gitcode.com/api/v5/repos/' + GITCODE_USER + '/' + repo + '/releases/latest';
  const r = await fetchJson(url, source);
  return normalizePlatform(r.data, source, repo);
}

async function discoverRepos() {
  const found = new Set(Object.keys(KNOWN));
  try {
    const r = await fetchJson('https://api.github.com/users/' + GITHUB_USER + '/repos?per_page=100&sort=updated&type=owner', 'github');
    for (const repo of Array.isArray(r.data) ? r.data : []) {
      if (!repo || repo.fork || repo.archived || !repo.name) continue;
      found.add(String(repo.name));
    }
  } catch { /* 发现失败时继续使用内置清单 */ }
  return Array.from(found);
}

function metaOf(repo) {
  return KNOWN[repo] || {
    order: 99, name: repo, en: repo.toUpperCase(), category: 'PROJECT',
    desc: 'GitHub / GitCode 双平台项目', updater: 'external'
  };
}

async function installedVersion(meta) {
  if (meta.updater === 'self') return cfg.version || '';
  if (meta.updater === 'embedded' && meta.app) {
    try { return String(await embedded.appVersion(meta.app, DATA_DIR) || ''); }
    catch { return ''; }
  }
  return '';
}

function stamp(platform) {
  return platform ? { tag: platform.tag, version: platform.version, published: platform.published } : null;
}

function changed(prev, next) {
  if (!next) return false;
  if (!prev) return true;
  return String(prev.tag) !== String(next.tag) || String(prev.published || '') !== String(next.published || '');
}

async function build() {
  const state = await loadState();
  const repos = await discoverRepos();
  const errors = [];

  const projects = (await Promise.all(repos.map(async (repo) => {
    const meta = metaOf(repo);
    const [gh, gc] = await Promise.all([
      latestRelease('github', repo).catch(e => { errors.push(repo + ' · GitHub: ' + e.message); return null; }),
      latestRelease('gitcode', repo).catch(e => { errors.push(repo + ' · GitCode: ' + e.message); return null; })
    ]);
    if (!gh && !gc) return KNOWN[repo] ? emptyProject(repo, meta) : null;
    const latest = [gh, gc].filter(Boolean).sort((a, b) => compareVersions(b.version, a.version))[0];
    const installed = await installedVersion(meta);
    return {
      repo,
      name: meta.name,
      en: meta.en,
      category: meta.category,
      desc: meta.desc,
      updater: meta.updater || 'external',
      app: meta.app || '',
      latest: latest.version,
      releaseTitle: latest.title || (meta.name + ' v' + latest.version),
      releaseNotes: String((gh || gc).notes || ''),
      installed,
      updateAvailable: installed ? compareVersions(latest.version, installed) > 0 : null,
      platforms: { github: gh, gitcode: gc }
    };
  }))).filter(Boolean);

  projects.sort((a, b) => {
    const oa = KNOWN[a.repo] ? KNOWN[a.repo].order : 99;
    const ob = KNOWN[b.repo] ? KNOWN[b.repo].order : 99;
    return oa - ob || a.repo.localeCompare(b.repo);
  });

  const now = new Date().toISOString();
  if (!state.seeded) {
    for (const p of projects) {
      state.baseline[p.repo] = { github: stamp(p.platforms.github), gitcode: stamp(p.platforms.gitcode) };
    }
    state.seeded = true;
    state.updatedAt = now;
    await saveState(state);
    cache = {
      ok: true, updatedAt: now, seeded: true, projects, events: state.events,
      unseen: state.events.filter(e => !e.seen).length, errors, baselineSeededNow: true
    };
    cacheAt = Date.now();
    return cache;
  }

  for (const p of projects) {
    const prev = state.baseline[p.repo];
    const cur = { github: stamp(p.platforms.github), gitcode: stamp(p.platforms.gitcode) };
    const newProject = !prev;
    const sources = [];
    if (newProject) {
      if (cur.github) sources.push('github');
      if (cur.gitcode) sources.push('gitcode');
    } else {
      if (changed(prev.github, cur.github)) sources.push('github');
      if (changed(prev.gitcode, cur.gitcode)) sources.push('gitcode');
    }
    const uniqueSources = Array.from(new Set(sources));
    if (uniqueSources.length) {
      const id = p.repo + '@' + p.latest + '@' + uniqueSources.join('+');
      const exists = state.events.some(e => e.id === id);
      if (!exists) {
        state.events.unshift({
          id,
          repo: p.repo,
          name: p.name,
          kind: newProject ? 'project' : 'release',
          version: p.latest,
          sources: uniqueSources,
          title: p.releaseTitle,
          at: now,
          seen: false
        });
      }
    }
    state.baseline[p.repo] = cur;
  }
  state.events = state.events.slice(0, MAX_EVENTS);
  state.updatedAt = now;
  await saveState(state);
  cache = {
    ok: true, updatedAt: now, seeded: true, projects, events: state.events,
    unseen: state.events.filter(e => !e.seen).length, errors, baselineSeededNow: false
  };
  cacheAt = Date.now();
  return cache;
}

function emptyProject(repo, meta) {
  return {
    repo, name: meta.name, en: meta.en, category: meta.category, desc: meta.desc,
    updater: meta.updater || 'external', app: meta.app || '', latest: '',
    releaseTitle: '', releaseNotes: '', installed: '', updateAvailable: null,
    platforms: { github: null, gitcode: null }
  };
}

async function refresh(opts = {}) {
  if (inflight) return inflight;
  if (!opts.force && cache && Date.now() - cacheAt < CACHE_TTL) return cache;
  inflight = build().finally(() => { inflight = null; });
  return inflight;
}

async function getFeed(opts = {}) {
  const data = await refresh(opts);
  return {
    ok: true,
    updatedAt: data.updatedAt,
    projects: data.projects,
    events: data.events,
    unseen: data.unseen,
    errors: data.errors || []
  };
}

async function markSeen(ids) {
  const state = await loadState();
  const wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
  let marked = 0;
  for (const ev of state.events) {
    if (ev.seen) continue;
    if (wanted && !wanted.has(String(ev.id))) continue;
    ev.seen = true;
    ev.seenAt = new Date().toISOString();
    marked++;
  }
  if (marked) await saveState(state);
  cache = null;
  cacheAt = 0;
  return { ok: true, marked, unseen: state.events.filter(e => !e.seen).length };
}

function startWatching() {
  if (watchTimer) return;
  setTimeout(() => { refresh({ force: true }).catch(() => { }); }, 7000).unref?.();
  watchTimer = setInterval(() => { refresh({ force: true }).catch(() => { }); }, WATCH_INTERVAL);
  watchTimer.unref?.();
}

module.exports = { init, getFeed, refresh, markSeen, startWatching };
