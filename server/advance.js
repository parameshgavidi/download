import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  createWriteStream,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import https from "node:https";
import http from "node:http";
import * as XLSX from "xlsx";
import { runYtDlp, spawnYtDlp, missingYtDlpMessage, ffmpegAvailable, mergeDownloadArgs } from "./ytdlp.js";

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

function youtubeIdFrom(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:v=|youtu\.be\/|shorts\/|\/embed\/)([\w-]{11})/);
  if (match) return match[1];
  if (/^[\w-]{11}$/.test(text)) return text;
  return "";
}

function canonicalYoutubeUrl(idOrUrl) {
  const id = youtubeIdFrom(idOrUrl);
  return id ? `https://www.youtube.com/watch?v=${id}` : String(idOrUrl || "").trim();
}

function normalizeEntry(entry) {
  const id = youtubeIdFrom(entry.id) || youtubeIdFrom(entry.webpage_url || entry.url) || entry.id || "";
  return {
    id,
    title: entry.title || "Untitled",
    description: entry.description || "",
    views: Number(entry.view_count || entry.views || 0),
    duration: Number(entry.duration || 0),
    channel: entry.channel || entry.uploader || "",
    thumbnail: entry.thumbnail || entry.thumbnails?.at(-1)?.url || "",
    url: canonicalYoutubeUrl(id || entry.webpage_url || entry.url),
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

const COPY_MARKERS = /reupload|re-upload|copied from|from youtube|no copyright intended|full compilation|all ads in one|mirrored upload|youtube copy|not the official/i;
const COMPILATION_MARKERS = /compilation|top\s*\d+|top ten|countdown|every super bowl|famous funny commercials|best ads|ads ranked/i;
const ENTERTAINMENT_MARKERS = /music video|full movie|gameplay|podcast|vlog|live stream|reaction|reacts to|explained|behind the scenes|making of|leaked audio|full album/i;
const COMMERCIAL_MARKERS = /commercial|advert|tv ad|tv spot|super bowl ad|brand film| :15| :30| :60|\b15s\b|\b30s\b|\b60s\b|30-second|60-second/i;

function isYoutubeCopy(video, sourceId) {
  if (sourceId && video.id === sourceId) return true;
  const text = `${video.title} ${video.description || ""}`;
  if (COPY_MARKERS.test(text)) return true;
  if (video.duration > 180 && COMPILATION_MARKERS.test(video.title)) return true;
  return false;
}

function isCommercialLength(video) {
  if (!video.duration) return true;
  return video.duration >= 8 && video.duration <= 210;
}

function commercialScore(video, query) {
  let score = Number(video.views) || 0;
  if (video.duration >= 15 && video.duration <= 90) score *= 1.2;
  if (COMMERCIAL_MARKERS.test(video.title)) score *= 1.12;
  if (/official/i.test(video.title) && COMMERCIAL_MARKERS.test(video.title)) score *= 1.05;
  const words = String(query).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const title = video.title.toLowerCase();
  score *= 1 + words.filter((word) => title.includes(word)).length * 0.06;
  return score;
}

function pickCommercial(results, { sourceId, query, existingIds }) {
  return [...results]
    .filter((video) => video.url && !existingIds.has(video.id))
    .filter((video) => !isYoutubeCopy(video, sourceId))
    .filter((video) => isCommercialLength(video))
    .sort((a, b) => commercialScore(b, query) - commercialScore(a, query))[0];
}

function judgeCommercial(video, query = "") {
  if (!video) return { ok: false, reason: "No video found", confidence: 0 };
  if (isYoutubeCopy(video)) return { ok: false, reason: "Looks like a YouTube copy or compilation", confidence: 10 };
  if (video.duration && video.duration < 8) return { ok: false, reason: "Too short for a TV commercial", confidence: 15 };
  if (video.duration && video.duration > 210) return { ok: false, reason: "Too long — likely a compilation, not one commercial", confidence: 20 };
  const text = `${video.title} ${video.description || ""} ${query}`;
  if (ENTERTAINMENT_MARKERS.test(text) && !COMMERCIAL_MARKERS.test(text)) {
    return { ok: false, reason: "Looks like entertainment, not a brand commercial", confidence: 20 };
  }
  let confidence = 55;
  if (video.duration >= 15 && video.duration <= 90) confidence += 20;
  if (COMMERCIAL_MARKERS.test(text)) confidence += 15;
  if (/official/i.test(video.title) && COMMERCIAL_MARKERS.test(video.title)) confidence += 5;
  const firstWord = String(query).toLowerCase().split(/[^a-z0-9]+/).find((word) => word.length > 2);
  if (firstWord && video.title.toLowerCase().includes(firstWord)) confidence += 5;
  return {
    ok: confidence >= 60,
    reason: confidence >= 60
      ? "Looks like a single brand commercial (heuristic only — not a rights check)"
      : "Not confident this is a standalone commercial",
    confidence: Math.min(95, confidence),
  };
}

async function probeVideo(url, cookies) {
  const { stdout } = await runYtDlp(["-J", "--skip-download", "--no-playlist", url], { cookies });
  return normalizeEntry(JSON.parse(stdout));
}

function cleanupSplitFiles(dir, videoId) {
  if (!existsSync(dir) || !videoId) return;
  for (const name of readdirSync(dir)) {
    if (name.includes(`[${videoId}]`) && /\.f\d+\./i.test(name)) {
      try {
        unlinkSync(join(dir, name));
      } catch {
        // leftover fragment
      }
    }
  }
}

async function findCommercial(query, cookies, sourceId, existingIds) {
  let results = await searchYoutube(`${query} official commercial`, cookies, 12);
  let video = pickCommercial(results, { sourceId, query, existingIds });
  if (!video) {
    results = await searchYoutube(query, cookies, 12);
    video = pickCommercial(results, { sourceId, query, existingIds });
  }
  return video;
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

function uniqueWords(values) {
  const seen = new Set();
  const words = [];
  for (const value of values) {
    for (const word of String(value).toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length < 3 || seen.has(word)) continue;
      if (/^(the|and|for|from|with|this|that|official|video)$/.test(word)) continue;
      seen.add(word);
      words.push(word);
    }
  }
  return words;
}

function buildMetadata(keyword, videos, related = []) {
  const ranked = [...videos].sort((a, b) => b.views - a.views);
  const brands = ranked.map((video) => video.query || video.title.split(/[-|/]/)[0].trim()).filter(Boolean);
  const year = new Date().getFullYear();
  const title = `${brands[0] || keyword}: audience-ranked ad recap ${year}`;
  const lineup = ranked
    .map((video, index) => `${index + 1}. ${video.query || video.title} · ${formatViews(video.views)} audience views`)
    .join("\n");
  const keywords = uniqueWords([keyword, ...brands, ...related, ...ranked.map((video) => video.title)]).slice(0, 18);
  const tags = uniqueWords(["ad recap", "audience rank", "brand film", ...brands, ...related]).slice(0, 22);
  return {
    title,
    description: [
      `An independently ordered recap of individual brand spots found for “${keyword}”.`,
      "Order is not copied from any source countdown. Each clip is ranked by that clip’s own public view count, highest first.",
      "",
      "Audience-ranked sequence:",
      lineup || "No commercials yet.",
      "",
      "Title, description, and tags are generated from this new ranking, not copied from another upload.",
      "Upload only content you have rights to use. Brand commercials may be copyrighted and can affect YouTube monetization.",
    ].join("\n"),
    keywords,
    tags,
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
    YouTubeURL: video.youtubeUrl || video.url,
    URL: video.youtubeUrl || video.url,
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
      youtubeUrl: video.youtubeUrl || video.url,
      fileUrl: video.filename
        ? `/downloads/${encodeURIComponent(keyword)}/videos/${encodeURIComponent(video.filename)}`
        : "",
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

export { judgeCommercial, youtubeIdFrom, canonicalYoutubeUrl };

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
      pack.sourceVideoId = top.id;
      savePack(downloadsRoot, pack);
      res.json({
        keyword: pack.keyword,
        top,
        sourceVideoId: top.id,
        related: related.filter((item) => item.toLowerCase() !== keyword.toLowerCase()),
        videos,
        sourceUrl: top.url,
        ffmpeg: ffmpegAvailable(),
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

  app.post("/api/advance/resolve", async (req, res) => {
    const keyword = safeKeyword(req.body?.keyword);
    const queries = [...new Set((req.body?.queries || []).map((item) => String(item).trim()).filter(Boolean))];
    const cookies = String(req.body?.cookies || "").trim();
    if (!keyword || !queries.length) return res.status(400).json({ error: "Select at least one commercial phrase." });
    const pack = loadPack(downloadsRoot, keyword);
    const sourceId = req.body?.sourceVideoId || pack.sourceVideoId || pack.research?.top?.id;
    const usedIds = new Set(pack.videos.map((video) => youtubeIdFrom(video.id || video.youtubeUrl || video.url)).filter(Boolean));
    const usedUrls = new Set(pack.videos.map((video) => canonicalYoutubeUrl(video.youtubeUrl || video.url)).filter(Boolean));
    const items = [];
    try {
      for (const query of queries) {
        const video = await findCommercial(query, cookies, sourceId, usedIds);
        if (!video) {
          items.push({ query, ok: false, duplicate: false, reason: "No individual commercial found", video: null });
          continue;
        }
        const youtubeUrl = canonicalYoutubeUrl(video.id || video.url);
        const judge = judgeCommercial(video, query);
        const duplicate = usedIds.has(video.id) || usedUrls.has(youtubeUrl);
        if (!duplicate && judge.ok) {
          usedIds.add(video.id);
          usedUrls.add(youtubeUrl);
        }
        items.push({
          query,
          ok: judge.ok && !duplicate,
          duplicate,
          reason: duplicate ? "Same YouTube link as another selected commercial" : judge.reason,
          confidence: judge.confidence,
          video: { ...video, url: youtubeUrl, youtubeUrl },
        });
      }
      res.json({ items, ffmpeg: ffmpegAvailable() });
    } catch (error) {
      res.status(400).json({ error: missingYtDlpMessage(error.message.replace(/\n/g, " ")).slice(0, 400) });
    }
  });

  app.post("/api/advance/download-top", async (req, res) => {
    const keyword = safeKeyword(req.body?.keyword);
    const query = String(req.body?.query || req.body?.keyword || "").trim();
    const cookies = String(req.body?.cookies || "").trim();
    if (!keyword || !query) return res.status(400).json({ error: "Select a keyword and a search phrase." });
    try {
      if (!ffmpegAvailable()) {
        return res.status(400).json({
          error: "FFmpeg is required to join video + audio into one MP4. If WinGet already installed it, close VS Code completely, reopen, and run npm run dev again.",
        });
      }
      const pack = loadPack(downloadsRoot, keyword);
      const sourceId = req.body?.sourceVideoId || pack.sourceVideoId || pack.research?.top?.id;
      const existingIds = new Set(pack.videos.map((video) => youtubeIdFrom(video.id || video.youtubeUrl || video.url)).filter(Boolean));
      const existingUrls = new Set(pack.videos.map((video) => canonicalYoutubeUrl(video.youtubeUrl || video.url)).filter(Boolean));
      let top = null;
      if (req.body?.url) {
        const requested = String(req.body.url);
        try {
          top = await probeVideo(requested, cookies);
        } catch {
          top = {
            id: youtubeIdFrom(req.body.videoId || requested) || requested,
            title: req.body.title || query,
            description: "",
            views: Number(req.body.views || 0),
            duration: Number(req.body.duration || 0),
            channel: req.body.channel || "",
            thumbnail: req.body.thumbnail || "",
            url: canonicalYoutubeUrl(requested),
          };
        }
        if (req.body.title && !top.title) top.title = req.body.title;
        if (req.body.views) top.views = Number(req.body.views);
      } else {
        top = await findCommercial(query, cookies, sourceId, existingIds);
      }
      if (!top) {
        return res.status(404).json({
          error: `No individual commercial found for “${query}”. Skipped YouTube copies and compilation reuploads.`,
        });
      }
      top.url = canonicalYoutubeUrl(top.id || top.url);
      const judge = judgeCommercial(top, query);
      if (!judge.ok) {
        return res.status(400).json({ error: `${judge.reason}. We only download likely commercial spots.` });
      }
      if (existingIds.has(top.id) || existingUrls.has(top.url)) {
        return res.json({ already: true, pack: publicPack(downloadsRoot, savePack(downloadsRoot, pack)), video: { ...top, youtubeUrl: top.url } });
      }
      const dir = packDir(downloadsRoot, keyword);
      const videoDir = join(dir, "videos");
      mkdirSync(videoDir, { recursive: true });
      const child = spawnYtDlp(
        [...mergeDownloadArgs(join(videoDir, "%(title).70s [%(id)s].%(ext)s")), top.url],
        cookies,
      );
      const { jobId, done } = trackJob(jobs, child, videoDir);
      res.json({ jobId, video: top, keyword, query });
      try {
        const job = await done;
        const filename = job.filename ? job.filename.split(/[/\\]/).pop() : "";
        cleanupSplitFiles(videoDir, top.id);
        pack.videos.push({
          ...top,
          youtubeUrl: top.url,
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
