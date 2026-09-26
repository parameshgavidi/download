import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import { useAppStore } from "../store/appStore";

export default function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [ffmpeg, setFfmpeg] = useState<{ ok: boolean; path: string } | null>(null);

  useEffect(() => {
    void fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setFfmpeg({ ok: Boolean(data.ffmpeg), path: data.ffmpegPath || "" }))
      .catch(() => setFfmpeg({ ok: false, path: "" }));
  }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="page settings-wrap">
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <p className="sub">Defaults for downloads, export, and new projects.</p>
          </div>
        </div>
        <div className="panel">
          <div className="field">
            <label>Display name</label>
            <input
              value={settings.displayName}
              onChange={(e) => updateSettings({ displayName: e.target.value })}
            />
          </div>
          <p className={ffmpeg?.ok ? "ok" : "sub"} style={{ marginBottom: 16 }}>
            {ffmpeg?.ok
              ? `FFmpeg found${ffmpeg.path ? `: ${ffmpeg.path}` : ""}. Downloads will merge video + audio into one MP4.`
              : "FFmpeg is not visible to this app yet. If WinGet already installed it, close VS Code completely and reopen, then run npm run dev again."}
          </p>
          <div className="field">
            <label>YouTube cookies.txt (optional)</label>
            <input
              value={settings.cookiesPath}
              placeholder="/path/to/cookies.txt for networks that require a YouTube login"
              onChange={(e) => updateSettings({ cookiesPath: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Default download folder</label>
            <input
              value={settings.defaultDownloadPath}
              placeholder="Leave empty to use the app downloads folder"
              onChange={(e) => updateSettings({ defaultDownloadPath: e.target.value })}
            />
          </div>
          <div className="row grow">
            <div className="field">
              <label>Export quality</label>
              <select
                value={settings.exportQuality}
                onChange={(e) =>
                  updateSettings({ exportQuality: e.target.value as typeof settings.exportQuality })
                }
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4K</option>
              </select>
            </div>
            <div className="field">
              <label>New project aspect</label>
              <select
                value={settings.defaultAspect}
                onChange={(e) =>
                  updateSettings({ defaultAspect: e.target.value as typeof settings.defaultAspect })
                }
              >
                <option value="9:16">9:16 Vertical</option>
                <option value="16:9">16:9 Landscape</option>
                <option value="1:1">1:1 Square</option>
                <option value="4:5">4:5 Portrait</option>
              </select>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
