import { FolderOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";
import { formatBytes, formatClock } from "../lib/time";
import { useAppStore } from "../store/appStore";
import type { YoutubeInfo } from "../types";

interface PathInfo {
  current: string;
  parent: string;
  home: string;
  defaultPath: string;
  entries: { name: string; path: string; isDir: boolean; size: number }[];
}

interface JobStatus {
  status: "queued" | "downloading" | "done" | "error";
  progress: number;
  speed: string;
  eta: string;
  filename: string;
  fileUrl: string;
  error: string;
}

interface DownloadFile {
  name: string;
  path: string;
  size: number;
  url: string;
}

export default function DownloaderPage() {
  const settings = useAppStore((s) => s.settings);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<YoutubeInfo | null>(null);
  const [formatId, setFormatId] = useState("bv*+ba/b");
  const [path, setPath] = useState(settings.defaultDownloadPath);
  const [pathInfo, setPathInfo] = useState<PathInfo | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<JobStatus | null>(null);
  const [files, setFiles] = useState<DownloadFile[]>([]);

  useEffect(() => {
    void loadFiles();
    void loadPath(settings.defaultDownloadPath || undefined);
  }, [settings.defaultDownloadPath]);

  const selectedLabel = useMemo(() => {
    return (
      info?.presets.find((p) => p.id === formatId)?.label ||
      info?.formats.find((f) => f.id === formatId)?.label ||
      "Best video + best audio"
    );
  }, [info, formatId]);

  async function loadFiles() {
    const res = await fetch("/api/downloads");
    if (!res.ok) return;
    const data = (await res.json()) as { files: DownloadFile[]; path: string };
    setFiles(data.files);
    if (!path) setPath(data.path);
  }

  async function loadPath(next?: string) {
    const query = next ? `?path=${encodeURIComponent(next)}` : "";
    const res = await fetch(`/api/paths${query}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not open that folder");
      return;
    }
    setPathInfo(data);
    setPath(data.current);
  }

  async function probe() {
    setError("");
    setInfo(null);
    setJob(null);
    setBusy(true);
    try {
      const res = await fetch("/api/youtube/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, cookies: settings.cookiesPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInfo(data);
      setFormatId("bv*+ba/b");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read this link");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/youtube/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, formatId, path, cookies: settings.cookiesPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await pollJob(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
      setBusy(false);
    }
  }

  async function pollJob(jobId: string) {
    const tick = async () => {
      const res = await fetch(`/api/youtube/jobs/${jobId}`);
      const data = (await res.json()) as JobStatus;
      setJob(data);
      if (data.status === "downloading" || data.status === "queued") {
        setTimeout(() => void tick(), 900);
        return;
      }
      setBusy(false);
      if (data.status === "done") await loadFiles();
      if (data.status === "error") setError(data.error);
    };
    await tick();
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="page downloader">
        <div className="page-head">
          <div>
            <h1>YouTube Downloader</h1>
            <p className="sub">Download high quality YouTube video as one merged MP4 (video + audio together).</p>
          </div>
        </div>
        <div className="panel">
          <div className="field">
            <label>Download link</label>
            <div className="row grow">
              <input
                value={url}
                placeholder="https://www.youtube.com/watch?v=..."
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void probe();
                }}
              />
              <button className="ghost" style={{ flex: "0 0 auto" }} onClick={() => void probe()} disabled={busy || !url}>
                Get resolutions
              </button>
            </div>
          </div>

          {info && (
            <div className="video-info">
              <img src={info.thumbnail} alt="" />
              <div>
                <h2>{info.title}</h2>
                <p className="sub">
                  {info.channel}
                  {info.duration ? ` · ${formatClock(info.duration)}` : ""}
                </p>
                <p className="sub">{info.description}</p>
              </div>
            </div>
          )}

          <div className="field">
            <label>Resolution</label>
            <div className="chips">
              {(info?.presets || [
                { id: "bv*+ba/b", label: "Best video + best audio" },
                { id: "bestvideo[height<=1080]+bestaudio/best[height<=1080]", label: "1080p" },
                { id: "bestvideo[height<=720]+bestaudio/best[height<=720]", label: "720p" },
                { id: "bestaudio/best", label: "Audio only" },
              ]).map((preset) => (
                <button
                  key={preset.id}
                  className={`chip ${formatId === preset.id ? "active" : ""}`}
                  onClick={() => setFormatId(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {info && info.formats.length > 0 && (
              <select value={formatId} onChange={(e) => setFormatId(e.target.value)} style={{ marginTop: 10 }}>
                <option value={formatId}>{selectedLabel}</option>
                {info.formats.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="field">
            <label>Download path</label>
            <div className="row grow">
              <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/workspace/downloads" />
              <button className="ghost" style={{ flex: "0 0 auto" }} onClick={() => { setPickerOpen(true); void loadPath(path); }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <FolderOpen size={16} /> Select path
                </span>
              </button>
            </div>
          </div>

          <button className="primary" onClick={() => void download()} disabled={busy || !url}>
            {busy ? "Downloading…" : "Download"}
          </button>

          {job && (
            <div style={{ marginTop: 16 }}>
              <div className="progress">
                <span style={{ width: `${job.progress}%` }} />
              </div>
              <div className="sub">
                {job.status === "done"
                  ? `Saved ${job.filename}`
                  : `${job.progress}% ${job.speed ? `· ${job.speed}` : ""} ${job.eta ? `· ETA ${job.eta}` : ""}`}
              </div>
              {job.status === "done" && job.fileUrl && (
                <a className="ghost" href={job.fileUrl} style={{ display: "inline-block", marginTop: 10, textDecoration: "none" }}>
                  Save a copy to this computer
                </a>
              )}
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h3>Downloaded files</h3>
          <div className="downloads-list">
            {files.length === 0 && <div className="sub">Nothing downloaded yet.</div>}
            {files.map((file) => (
              <div key={file.path} className="download-row">
                <span>{file.name}</span>
                <span>
                  {formatBytes(file.size)} · <a href={file.url}>Open</a>
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>

      {pickerOpen && pathInfo && (
        <div className="modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Select a folder</h3>
            <p className="sub">{pathInfo.current}</p>
            <div className="actions" style={{ justifyContent: "flex-start", margin: "12px 0" }}>
              <button className="ghost" onClick={() => void loadPath(pathInfo.parent)}>Up</button>
              <button className="ghost" onClick={() => void loadPath(pathInfo.home)}>Home</button>
              <button className="ghost" onClick={() => void loadPath(pathInfo.defaultPath)}>App downloads</button>
            </div>
            {pathInfo.entries.filter((e) => e.isDir).map((entry) => (
              <button key={entry.path} className="path-item" onClick={() => void loadPath(entry.path)}>
                <span>{entry.name}</span>
                <span className="sub">Folder</span>
              </button>
            ))}
            <div className="actions">
              <button className="ghost" onClick={() => setPickerOpen(false)}>Cancel</button>
              <button className="primary" onClick={() => setPickerOpen(false)}>Use this path</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
