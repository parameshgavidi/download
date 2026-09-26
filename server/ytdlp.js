import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

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

export function missingYtDlpMessage(raw = "") {
  if (!/No module named yt_dlp|not recognized|ENOENT|cannot find/i.test(raw) && raw) return raw;
  return process.platform === "win32"
    ? "yt-dlp is not installed. In PowerShell run: python -m pip install -U yt-dlp"
    : "yt-dlp is not installed. Run: python3 -m pip install -U yt-dlp";
}

export function ytDlpArgs(extra, cookies) {
  const args = [...cached.prefix, "--no-warnings"];
  if (cookies && existsSync(cookies)) args.push("--cookies", cookies);
  args.push(...extra);
  return args;
}

export function spawnYtDlp(extra, cookies) {
  ensureYtDlp();
  return spawn(cached.cmd, ytDlpArgs(extra, cookies), {
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    windowsHide: true,
  });
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
