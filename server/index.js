import express from "express";
import cors from "cors";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  createReadStream,
} from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { runYtDlp, spawnYtDlp, missingYtDlpMessage } from "./ytdlp.js";
import { registerAdvanceRoutes } from "./advance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_DOWNLOADS = join(ROOT, "downloads");
const jobs = new Map();

mkdirSync(DEFAULT_DOWNLOADS, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/downloads", express.static(DEFAULT_DOWNLOADS));


function parseHeight(format) {
  return format.height || format.resolution?.match(/(\d+)p?$/)?.[1] || 0;
}

function formatLabel(format) {
  const height = format.height ? `${format.height}p` : format.resolution || "audio";
  const ext = (format.ext || "mp4").toUpperCase();
  const fps = format.fps ? `${Math.round(format.fps)}fps` : "";
  const note = format.format_note || "";
  const vcodec = format.vcodec && format.vcodec !== "none";
  const acodec = format.acodec && format.acodec !== "none";
  const kind = vcodec && acodec ? "Video+Audio" : vcodec ? "Video" : "Audio";
  const size = format.filesize || format.filesize_approx;
  const sizeLabel = size ? `${(size / 1024 / 1024).toFixed(1)} MB` : "";
  return [height, ext, fps, note, kind, sizeLabel].filter(Boolean).join(" · ");
}

function pickFormats(info) {
  const formats = (info.formats || [])
    .filter((f) => f.url || f.manifest_url)
    .filter((f) => f.vcodec !== "none" || f.acodec !== "none")
    .map((f) => ({
      id: String(f.format_id),
      label: formatLabel(f),
      height: Number(parseHeight(f)) || 0,
      ext: f.ext || "mp4",
      fps: f.fps || null,
      vcodec: f.vcodec || "none",
      acodec: f.acodec || "none",
      filesize: f.filesize || f.filesize_approx || null,
      note: f.format_note || "",
    }));

  const unique = new Map();
  for (const format of formats) {
    const key = `${format.height}-${format.ext}-${format.vcodec}-${format.acodec}`;
    if (!unique.has(key) || (format.filesize || 0) > (unique.get(key).filesize || 0)) {
      unique.set(key, format);
    }
  }

  const presets = [
    { id: "best", label: "Best available (highest quality)", height: 9999 },
    { id: "bv*+ba/b", label: "Best video + best audio (merged)", height: 9998 },
    { id: "bestvideo[height<=2160]+bestaudio/best[height<=2160]", label: "4K / 2160p", height: 2160 },
    { id: "bestvideo[height<=1440]+bestaudio/best[height<=1440]", label: "1440p", height: 1440 },
    { id: "bestvideo[height<=1080]+bestaudio/best[height<=1080]", label: "1080p", height: 1080 },
    { id: "bestvideo[height<=720]+bestaudio/best[height<=720]", label: "720p", height: 720 },
    { id: "bestvideo[height<=480]+bestaudio/best[height<=480]", label: "480p", height: 480 },
    { id: "bestvideo[height<=360]+bestaudio/best[height<=360]", label: "360p", height: 360 },
    { id: "bestaudio/best", label: "Audio only (best)", height: 0 },
  ];

  return {
    presets,
    formats: [...unique.values()].sort((a, b) => b.height - a.height || (b.filesize || 0) - (a.filesize || 0)),
  };
}

function safeJoin(base, requested) {
  const target = resolve(requested || base);
  return target;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "PgVideoEditor" });
});

app.get("/api/paths", (req, res) => {
  const requested = String(req.query.path || DEFAULT_DOWNLOADS);
  try {
    const current = safeJoin(DEFAULT_DOWNLOADS, requested);
    if (!existsSync(current) || !statSync(current).isDirectory()) {
      return res.status(400).json({ error: "Path is not a folder" });
    }
    const entries = readdirSync(current)
      .map((name) => {
        const full = join(current, name);
        try {
          const stat = statSync(full);
          return {
            name,
            path: full,
            isDir: stat.isDirectory(),
            size: stat.size,
            updatedAt: stat.mtimeMs,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));

    res.json({
      current,
      parent: dirname(current),
      home: os.homedir(),
      defaultPath: DEFAULT_DOWNLOADS,
      entries,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/youtube/info", async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!url) return res.status(400).json({ error: "Paste a YouTube link first." });

  try {
    const cookies = String(req.body?.cookies || "").trim();
    const { stdout } = await runYtDlp(["-J", "--skip-download", "--no-playlist", url], { cookies });
    const info = JSON.parse(stdout);
    const { presets, formats } = pickFormats(info);
    res.json({
      id: info.id,
      title: info.title,
      channel: info.channel || info.uploader,
      duration: info.duration,
      thumbnail: info.thumbnail,
      description: info.description?.slice(0, 280) || "",
      webpageUrl: info.webpage_url,
      presets,
      formats,
    });
  } catch (error) {
    const raw = error.message.replace(/\n/g, " ");
    const bot = /sign in to confirm/i.test(raw);
    res.status(400).json({
      error: bot
        ? "YouTube asked this network to sign in. On your machine, export cookies.txt from a logged-in browser, set the cookies path in Settings, and try again."
        : missingYtDlpMessage(raw).slice(0, 400) || "Could not read this YouTube link. Check the URL and try again.",
    });
  }
});

app.post("/api/youtube/download", async (req, res) => {
  const url = String(req.body?.url || "").trim();
  const formatId = String(req.body?.formatId || "bv*+ba/b");
  const cookies = String(req.body?.cookies || "").trim();
  const outputDir = safeJoin(DEFAULT_DOWNLOADS, req.body?.path || DEFAULT_DOWNLOADS);
  if (!url) return res.status(400).json({ error: "Paste a YouTube link first." });

  try {
    mkdirSync(outputDir, { recursive: true });
  } catch (error) {
    return res.status(400).json({ error: `Cannot write to that folder: ${error.message}` });
  }

  const jobId = randomUUID();
  const job = {
    id: jobId,
    status: "queued",
    progress: 0,
    speed: "",
    eta: "",
    filename: "",
    error: "",
    logs: [],
  };
  jobs.set(jobId, job);

  const outputTemplate = join(outputDir, "%(title).80s [%(resolution)s].%(ext)s");
  const args = [
    "-f",
    formatId,
    "--merge-output-format",
    "mp4",
    "--newline",
    "-o",
    outputTemplate,
    url,
  ];

  const child = spawnYtDlp(["--no-playlist", ...args], cookies);

  job.status = "downloading";
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
  child.stderr.on("data", (chunk) => {
    job.logs.push(chunk.toString());
  });
  child.on("error", (error) => {
    job.status = "error";
    job.error = error.message;
  });
  child.on("close", (code) => {
    if (code === 0) {
      job.status = "done";
      job.progress = 100;
      if (!job.filename) {
        const files = readdirSync(outputDir)
          .map((name) => ({ name, mtime: statSync(join(outputDir, name)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files[0]) job.filename = join(outputDir, files[0].name);
      }
    } else if (job.status !== "error") {
      job.status = "error";
      job.error = job.logs.slice(-4).join(" ").slice(0, 400) || `Download failed (${code})`;
    }
  });

  res.json({ jobId, path: outputDir });
});

app.get("/api/youtube/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Download job not found" });
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    filename: job.filename,
    fileUrl: job.filename ? `/api/files?path=${encodeURIComponent(job.filename)}` : "",
    error: job.error,
  });
});

app.get("/api/files", (req, res) => {
  const filePath = String(req.query.path || "");
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return res.status(404).json({ error: "File not found" });
  }
  res.setHeader("Content-Disposition", `attachment; filename="${basename(filePath)}"`);
  createReadStream(filePath).pipe(res);
});

registerAdvanceRoutes(app, { downloadsRoot: DEFAULT_DOWNLOADS, jobs });

app.get("/api/downloads", (_req, res) => {
  const files = readdirSync(DEFAULT_DOWNLOADS)
    .map((name) => {
      const full = join(DEFAULT_DOWNLOADS, name);
      const stat = statSync(full);
      if (!stat.isFile() || name.startsWith(".")) return null;
      return {
        name,
        path: full,
        size: stat.size,
        updatedAt: stat.mtimeMs,
        url: `/downloads/${encodeURIComponent(name)}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json({ path: DEFAULT_DOWNLOADS, files });
});

const port = Number(process.env.PORT || 8787);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`PgVideoEditor API on http://127.0.0.1:${port}`);
});
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Close other Node processes and try again.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
