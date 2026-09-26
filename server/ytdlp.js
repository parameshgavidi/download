import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import os from "node:os";

export function resolveYtDlp() {
  const candidates = [
    ["yt-dlp", ["--version"]],
    ["python", ["-m", "yt_dlp", "--version"]],
    ["python3", ["-m", "yt_dlp", "--version"]],
    ["py", ["-m", "yt_dlp", "--version"]],
  ];
  for (const [cmd, probe] of candidates) {
    try {
      const result = spawnSync(cmd, probe, { encoding: "utf8", windowsHide: true });
      if (result.status === 0) {
        return { cmd, prefix: probe[0] === "-m" ? ["-m", "yt_dlp"] : [] };
      }
    } catch {
      // try next
    }
  }
  return {
    cmd: process.platform === "win32" ? "python" : "python3",
    prefix: ["-m", "yt_dlp"],
  };
}

let cached = resolveYtDlp();

export function ensureYtDlp() {
  cached = resolveYtDlp();
  return cached;
}

export function youtubeBotMessage(raw = "") {
  if (/cookie database|could not copy|failed to decrypt/i.test(raw)) {
    return "Chrome is locking its cookies. Close every Chrome window, then try Download again. Settings can also use a cookies.txt file.";
  }
  if (!/sign in to confirm|not a bot|cookies-from-browser|--cookies/i.test(raw)) return "";
  return "YouTube blocked this request (bot check). In Settings choose “Use Chrome login”, keep Chrome logged into YouTube, then try again. If Chrome is open and it still fails, close Chrome first.";
}

export function missingYtDlpMessage(raw = "") {
  const bot = youtubeBotMessage(raw);
  if (bot) return bot;
  if (!/No module named yt_dlp|not recognized|ENOENT|cannot find/i.test(raw) && raw) return raw;
  return process.platform === "win32"
    ? "yt-dlp is not installed. In PowerShell run: python -m pip install -U yt-dlp"
    : "yt-dlp is not installed. Run: python3 -m pip install -U yt-dlp";
}

function worksAsFfmpeg(cmd) {
  if (!cmd) return false;
  try {
    const result = spawnSync(cmd, ["-version"], { encoding: "utf8", windowsHide: true });
    return result.status === 0 && /ffmpeg version/i.test(`${result.stdout || ""}\n${result.stderr || ""}`);
  } catch {
    return false;
  }
}

function findFfmpegFile(dir, depth = 0) {
  if (!dir || depth > 4 || !existsSync(dir)) return "";
  const names = process.platform === "win32" ? ["ffmpeg.exe"] : ["ffmpeg"];
  for (const name of names) {
    const direct = join(dir, name);
    if (existsSync(direct) && worksAsFfmpeg(direct)) return direct;
    const nested = join(dir, "bin", name);
    if (existsSync(nested) && worksAsFfmpeg(nested)) return nested;
  }
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      try {
        if (statSync(full).isDirectory()) {
          const found = findFfmpegFile(full, depth + 1);
          if (found) return found;
        }
      } catch {
        // skip locked folders
      }
    }
  } catch {
    // skip unreadable folders
  }
  return "";
}

function windowsFfmpegCandidates() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const found = [];
  const links = join(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe");
  if (existsSync(links)) found.push(links);
  const packages = join(local, "Microsoft", "WinGet", "Packages");
  if (existsSync(packages)) {
    try {
      for (const name of readdirSync(packages)) {
        if (!/ffmpeg/i.test(name)) continue;
        const match = findFfmpegFile(join(packages, name));
        if (match) found.push(match);
      }
    } catch {
      // keep looking
    }
  }
  for (const root of [
    "C:\\ffmpeg",
    join(programFiles, "ffmpeg"),
    join(programFiles, "Gyan", "FFmpeg"),
    join(home, "scoop", "apps", "ffmpeg", "current"),
    join(home, "scoop", "shims"),
    "C:\\ProgramData\\chocolatey\\bin",
  ]) {
    const match = findFfmpegFile(root);
    if (match) found.push(match);
  }
  return found;
}

let ffmpegPath = "";

export function resolveFfmpeg() {
  if (ffmpegPath === "ffmpeg" || ffmpegPath === "ffmpeg.exe") return ffmpegPath;
  if (ffmpegPath && existsSync(ffmpegPath)) return ffmpegPath;

  for (const cmd of process.platform === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg"]) {
    if (worksAsFfmpeg(cmd)) {
      ffmpegPath = cmd;
      return ffmpegPath;
    }
  }

  if (process.platform === "win32") {
    try {
      const result = spawnSync("where.exe", ["ffmpeg"], { encoding: "utf8", windowsHide: true });
      for (const line of String(result.stdout || "").split(/\r?\n/)) {
        const candidate = line.trim();
        if (candidate && worksAsFfmpeg(candidate)) {
          ffmpegPath = candidate;
          return ffmpegPath;
        }
      }
    } catch {
      // keep looking in install folders
    }
    for (const candidate of windowsFfmpegCandidates()) {
      if (worksAsFfmpeg(candidate)) {
        ffmpegPath = candidate;
        return ffmpegPath;
      }
    }
  }

  return "";
}

export function ffmpegAvailable() {
  return Boolean(resolveFfmpeg());
}

const BROWSERS = new Set(["chrome", "edge", "firefox", "brave", "opera", "chromium"]);

export function readCookieOptions(body = {}) {
  return {
    file: String(body.cookies || "").trim(),
    browser: String(body.cookiesBrowser || "").trim().toLowerCase(),
  };
}

export function ytDlpArgs(extra, cookies) {
  const auth = typeof cookies === "string" ? { file: cookies, browser: "" } : cookies || {};
  const args = [...cached.prefix, "--no-warnings"];
  const ffmpeg = resolveFfmpeg();
  if (ffmpeg) args.push("--ffmpeg-location", ffmpeg);
  if (auth.browser && BROWSERS.has(auth.browser)) args.push("--cookies-from-browser", auth.browser);
  else if (auth.file && existsSync(auth.file)) args.push("--cookies", auth.file);
  args.push(...extra);
  return args;
}

export function spawnYtDlp(extra, cookies) {
  ensureYtDlp();
  const ffmpeg = resolveFfmpeg();
  const pathPrefix = ffmpeg && (ffmpeg.includes("\\") || ffmpeg.includes("/"))
    ? `${dirname(ffmpeg)}${delimiter}`
    : "";
  return spawn(cached.cmd, ytDlpArgs(extra, cookies), {
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PATH: `${pathPrefix}${process.env.PATH || process.env.Path || ""}`,
    },
    windowsHide: true,
  });
}

export function mergeDownloadArgs(outputTemplate) {
  return [
    "-f",
    "bestvideo+bestaudio/best",
    "--merge-output-format",
    "mp4",
    "--remux-video",
    "mp4",
    "--newline",
    "-o",
    outputTemplate,
  ];
}

export function runYtDlp(args, { cookies } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnYtDlp(args, cookies);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(missingYtDlpMessage(stderr.trim()) || `yt-dlp exited with code ${code}`));
    });
  });
}
