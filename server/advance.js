import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  createWriteStream,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import https from "node:https";
import http from "node:http";
import * as XLSX from "xlsx";
import { runYtDlp, spawnYtDlp, missingYtDlpMessage } from "./ytdlp.js";

const META_DIR = "_advance";

export function safeKeyword(name) {
  return String(name || "keyword")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "keyword";
}

function packDir(root, keyword) {
  return join(root, safeKeyword(keyword));
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function formatViews(n) {
  const value = Number(n) || 0;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function extractPhrases(title, description = "") {
  const phrases = [];
  const skip = /subscribe|follow me|link in|these ads are included|the votes are in|results in detail|thanks to everybody/i;
  const push = (value) => {
    const clean = String(value || "")
      .replace(/\s+/g, " ")
      .replace(/["“”]/g, "")
      .trim();
    if (clean.length < 3 || clean.length > 72) return;
    if (skip.test(clean)) return;
    if (!phrases.some((item) => item.toLowerCase() === clean.toLowerCase())) phrases.push(clean);
  };
  push(title);
  for (const match of description.matchAll(/^\s*\d+[.)]\s+(.+)$/gm)) {
    push(match[1].split("—")[0].split(" - ")[0]);
  }
  for (const tag of description.match(/#[\p{L}\p{N}_]+/gu) || []) {
    push(tag.slice(1).replace(/[_-]+/g, " "));
  }
  for (const line of description.split(/\r?\n/)) {
    const trimmed = line.replace(/^[-*•]\s+/, "").trim();
    if (trimmed && !/^\d+[.)]/.test(trimmed) && !/^http/i.test(trimmed) && !skip.test(trimmed)) {
      push(trimmed);
    }
  }
  return phrases.slice(0, 20);
}

function normalizeEntry(entry) {
  return {
    id: entry.id || entry.url,
    title: entry.title || "Untitled",
    description: entry.description || "",
    views: Number(entry.view_count || entry.views || 0),
    duration: Number(entry.duration || 0),
    channel: entry.channel || entry.uploader || "",
    thumbnail: entry.thumbnail || entry.thumbnails?.at(-1)?.url || "",
    url: entry.webpage_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : ""),
  };
}

async function searchYoutube(query, cookies, limit = 10) {
  const { stdout } = await runYtDlp(
    ["-J", "--skip-download", "--playlist-end", String(limit), `ytsearch${limit}:${query}`],
    { cookies },
  );
  const data = JSON.parse(stdout);
  const entries = data.entries || (data.id ? [data] : []);
  return entries.map(normalizeEntry).filter((item) => item.url).sort((a, b) => b.views - a.views);
}

function loadPack(root, keyword) {
  const dir = packDir(root, keyword);
  const packPath = join(dir, "pack.json");
  if (!existsSync(packPath)) {
    return {
      keyword: safeKeyword(keyword),
      dir,
      videos: [],
      metadata: emptyMetadata(keyword),
    };
  }
  return readJson(packPath, { keyword: safeKeyword(keyword), dir, videos: [], metadata: emptyMetadata(keyword) });
}

function emptyMetadata(keyword) {
  return {
    title: `${keyword} | Top viewed compilation`,
    description: "",
    keywords: [keyword],
    tags: [],
    thumbnail: "",
  };
}

function buildMetadata(keyword, videos, related = []) {
  const ranked = [...videos].sort((a, b) => b.views - a.views);
  const tags = new Set(
    [keyword, ...related, "compilation", "top viewed", "youtube compilation"]
      .flatMap((item) => String(item).split(/[\s,/|]+/))
      .map((item) => item.toLowerCase())
      .filter((item) => item.length > 2),
  );
  const lineup = ranked
    .map((video, index) => `${index + 1}. ${video.title} — ${formatViews(video.views)} views`)
    .join("\n");
  return {
    title: `${keyword} | Top ${Math.max(ranked.length, 1)} most viewed`,
    description: [
      `A compilation of the most viewed YouTube videos for “${keyword}”, arranged from highest to lowest views.`,
      "",
      "Lineup (top viewed first):",
      lineup || "No videos yet.",
      "",
      "Created with PgVideoEditor Advance Search.",
    ].join("\n"),
    keywords: [keyword, ...related].filter(Boolean).slice(0, 20),
    tags: [...tags].slice(0, 25),
    thumbnail: ranked[0]?.thumbnail || "",
  };
}

function writeRankingExcel(dir, videos) {
  const ranked = [...videos].sort((a, b) => b.views - a.views).map((video, index) => ({
    Rank: index + 1,
    Views: video.views,
    ViewsLabel: formatViews(video.views),
    Title: video.title,
    Channel: video.channel,
    VideoId: video.id,
    URL: video.url,
    File: video.filename || "",
    DurationSec: video.duration || 0,
    SearchQuery: video.query || "",
    DownloadedAt: video.downloadedAt || "",
  }));
  const sheet = XLSX.utils.json_to_sheet(ranked);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Top viewers");
  XLSX.writeFile(book, join(dir, "ranking.xlsx"));
  return ranked;
}

function savePack(root, pack) {
  const dir = packDir(root, pack.keyword);
  mkdirSync(join(dir, "videos"), { recursive: true });
  pack.videos = [...pack.videos].sort((a, b) => b.views - a.views);
  pack.metadata = buildMetadata(pack.keyword, pack.videos, pack.related || []);
  writeRankingExcel(dir, pack.videos);
  writeJson(join(dir, "pack.json"), pack);
  writeJson(join(dir, "metadata.json"), pack.metadata);
  return pack;
}

function downloadUrl(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const file = createWriteStream(dest);
    client
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          downloadUrl(res.headers.location, dest).then(resolve, reject);
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(dest)));
      })
      .on("error", reject);
  });
}

function trackJob(jobs, child, outputDir) {
  const jobId = randomUUID();
  const job = {
    id: jobId,
    status: "downloading",
    progress: 0,
    speed: "",
    eta: "",
    filename: "",
    error: "",
    logs: [],
  };
  jobs.set(jobId, job);
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    job.logs.push(text);
    const progress = text.match(/(\d+(?:\.\d+)?)%/);
    if (progress) job.progress = Math.min(99, Number(progress[1]));
    const speed = text.match(/at\s+(\S+)/);
    if (speed) job.speed = speed[1];
    const eta = text.match(/ETA\s+(\S+)/);
    if (eta) job.eta = eta[1];
    const dest = text.match(/Destination:\s+(.+)/);
    if (dest) job.filename = dest[1].trim();
    const merged = text.match(/Merging formats into "(.+)"/);
    if (merged) job.filename = merged[1];
  });
  child.stderr.on("data", (chunk) => job.logs.push(chunk.toString()));
  child.on("error", (error) => {
    job.status = "error";
    job.error = error.message;
  });
  const done = new Promise((resolve, reject) => {
    child.on("close", (code) => {
      if (code === 0) {
        job.status = "done";
        job.progress = 100;
        if (!job.filename && existsSync(outputDir)) {
          const files = readdirSync(outputDir)
            .filter((name) => !name.startsWith("."))
            .map((name) => ({ name, mtime: statSync(join(outputDir, name)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          if (files[0]) job.filename = join(outputDir, files[0].name);
        }
        resolve(job);
      } else {
        job.status = "error";
        job.error = job.logs.slice(-4).join(" ").slice(0, 400) || `Download failed (${code})`;
        reject(new Error(missingYtDlpMessage(job.error)));
      }
    });
  });
  return { jobId, done };
}

function publicPack(root, pack) {
  const keyword = pack.keyword;
  const videos = [...pack.videos]
    .sort((a, b) => b.views - a.views)
    .map((video, index) => ({
      ...video,
      rank: index + 1,
      viewsLabel: formatViews(video.views),
      url: video.filename
        ? `/downloads/${encodeURIComponent(keyword)}/videos/${encodeURIComponent(video.filename)}`
        : video.url,
    }));
  return {
    keyword,
    videos,
    related: pack.related || [],
    metadata: {
      ...pack.metadata,
      thumbnail: pack.metadata?.thumbnail
        ? existsSync(join(packDir(root, keyword), "thumbnail.jpg"))
          ? `/downloads/${encodeURIComponent(keyword)}/thumbnail.jpg`
          : pack.metadata.thumbnail
        : "",
    },
    rankingUrl: `/api/advance/packs/${encodeURIComponent(keyword)}/ranking.xlsx`,
    folder: packDir(root, keyword),
  };
}

export function registerAdvanceRoutes(app, { downloadsRoot, jobs }) {
  const metaPath = join(downloadsRoot, META_DIR, "keywords.json");
  mkdirSync(join(downloadsRoot, META_DIR), { recursive: true });

  app.get("/api/advance/keywords", (_req, res) => {
    res.json(readJson(metaPath, { name: "", keywords: [] }));
  });

  app.post("/api/advance/keywords", (req, res) => {
    const keywords = [...new Set((req.body?.keywords || []).map((item) => String(item).trim()).filter(Boolean))];
    const payload = { name: req.body?.name || "keywords.xlsx", keywords, updatedAt: Date.now() };
    writeJson(metaPath, payload);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Keywords"], ...keywords.map((item) => [item])]), "Keywords");
    XLSX.writeFile(book, join(downloadsRoot, META_DIR, "keywords.xlsx"));
    res.json(payload);
  });

  app.post("/api/advance/research", async (req, res) => {
    const keyword = String(req.body?.keyword || "").trim();
    const cookies = String(req.body?.cookies || "").trim();
    if (!keyword) return res.status(400).json({ error: "Select a keyword first." });
    try {
      const videos = await searchYoutube(keyword, cookies, 8);
      const top = videos[0];
      if (!top) return res.status(404).json({ error: "No YouTube videos found for that keyword." });
      const related = extractPhrases(top.title, top.description);
      const pack = loadPack(downloadsRoot, keyword);
      pack.related = related;
      pack.research = { top, videos, researchedAt: Date.now() };
      savePack(downloadsRoot, pack);
      res.json({
        keyword: pack.keyword,
        top,
        related: [keyword, ...related.filter((item) => item.toLowerCase() !== keyword.toLowerCase())],
        videos,
      });
    } catch (error) {
      const raw = error.message.replace(/\n/g, " ");
      const bot = /sign in to confirm/i.test(raw);
      res.status(400).json({
        error: bot
          ? "YouTube asked this network to sign in. Add cookies.txt in Settings and try again."
          : missingYtDlpMessage(raw).slice(0, 400),
      });
    }
  });

  app.post("/api/advance/download-top", async (req, res) => {
    const keyword = safeKeyword(req.body?.keyword);
    const query = String(req.body?.query || req.body?.keyword || "").trim();
    const cookies = String(req.body?.cookies || "").trim();
    if (!keyword || !query) return res.status(400).json({ error: "Select a keyword and a search phrase." });
    try {
      const results = await searchYoutube(query, cookies, 10);
      const top = results[0];
      if (!top) return res.status(404).json({ error: "No top-viewed video found for that search." });
      const dir = packDir(downloadsRoot, keyword);
      const videoDir = join(dir, "videos");
      mkdirSync(videoDir, { recursive: true });
      const pack = loadPack(downloadsRoot, keyword);
      if (pack.videos.some((video) => video.id === top.id)) {
        return res.json({ already: true, pack: publicPack(downloadsRoot, savePack(downloadsRoot, pack)), video: top });
      }
      const child = spawnYtDlp(
        [
          "-f",
          "bv*+ba/b",
          "--merge-output-format",
          "mp4",
          "--newline",
          "-o",
          join(videoDir, "%(title).70s [%(id)s].%(ext)s"),
          top.url,
        ],
        cookies,
      );
      const { jobId, done } = trackJob(jobs, child, videoDir);
      res.json({ jobId, video: top, keyword, query });
      try {
        const job = await done;
        const filename = job.filename ? job.filename.split(/[/\\]/).pop() : "";
        pack.videos.push({
          ...top,
          query,
          filename,
          downloadedAt: new Date().toISOString(),
        });
        if (top.thumbnail) {
          try {
            await downloadUrl(top.thumbnail, join(dir, "thumbnail.jpg"));
          } catch {
            // thumbnail is optional
          }
        }
        savePack(downloadsRoot, pack);
      } catch (error) {
        const job = jobs.get(jobId);
        if (job) {
          job.status = "error";
          job.error = error.message;
        }
      }
    } catch (error) {
      res.status(400).json({ error: missingYtDlpMessage(error.message.replace(/\n/g, " ")).slice(0, 400) });
    }
  });

  app.get("/api/advance/packs", (_req, res) => {
    const packs = readdirSync(downloadsRoot)
      .filter((name) => name !== META_DIR && existsSync(join(downloadsRoot, name, "pack.json")))
      .map((name) => publicPack(downloadsRoot, loadPack(downloadsRoot, name)));
    res.json({ packs });
  });

  app.get("/api/advance/packs/:keyword", (req, res) => {
    const pack = loadPack(downloadsRoot, req.params.keyword);
    if (!pack.videos.length && !existsSync(join(packDir(downloadsRoot, req.params.keyword), "pack.json"))) {
      return res.status(404).json({ error: "No compilation folder for that keyword yet." });
    }
    res.json(publicPack(downloadsRoot, pack));
  });

  app.get("/api/advance/packs/:keyword/ranking.xlsx", (req, res) => {
    const file = join(packDir(downloadsRoot, req.params.keyword), "ranking.xlsx");
    if (!existsSync(file)) return res.status(404).json({ error: "Ranking sheet not created yet." });
    res.download(file, `${safeKeyword(req.params.keyword)}-top-viewers.xlsx`);
  });
}
