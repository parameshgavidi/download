import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import { useAppStore } from "../store/appStore";

export default function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [ffmpeg, setFfmpeg] = useState<{ ok: boolean; path: string } | null>(null);
  const [cookieNote, setCookieNote] = useState("");
  const [cookieBusy, setCookieBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setFfmpeg({ ok: Boolean(data.ffmpeg), path: data.ffmpegPath || "" }))
      .catch(() => setFfmpeg({ ok: false, path: "" }));
  }, []);

  async function prepareCookies(kill: boolean) {
    if (!settings.cookiesBrowser) return;
    setCookieBusy(true);
    setCookieNote("");
    try {
      const res = await fetch("/api/youtube/cookies/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browser: settings.cookiesBrowser, kill }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCookieNote("Copied browser cookies. Go back to Advance Search and download again.");
    } catch (err) {
      setCookieNote(err instanceof Error ? err.message : "Could not copy browser cookies.");
    } finally {
      setCookieBusy(false);
    }
  }

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
            <label>Best way to download YouTube videos</label>
            <p className="sub">
              Public YouTube videos can download without Chrome. Leave “Use logged-in browser” on None. Only add cookies.txt if a specific video still asks you to sign in.
            </p>
          </div>
          <div className="field">
            <label>Use logged-in browser</label>
            <select
              value={settings.cookiesBrowser}
              onChange={(e) =>
                updateSettings({ cookiesBrowser: e.target.value as typeof settings.cookiesBrowser })
              }
            >
              <option value="">None (recommended)</option>
              <option value="chrome">Chrome</option>
              <option value="edge">Edge</option>
              <option value="firefox">Firefox</option>
            </select>
            <div className="actions" style={{ justifyContent: "flex-start", marginTop: 10 }}>
              <button
                className="ghost"
                type="button"
                disabled={cookieBusy || !settings.cookiesBrowser}
                onClick={() => void prepareCookies(false)}
              >
                Copy browser cookies
              </button>
              <button
                className="ghost"
                type="button"
                disabled={cookieBusy || !settings.cookiesBrowser}
                onClick={() => void prepareCookies(true)}
              >
                Stop Chrome and copy cookies
              </button>
            </div>
            {cookieNote && <p className={cookieNote.startsWith("Copied") ? "ok" : "error"}>{cookieNote}</p>}
          </div>
          <div className="field">
            <label>YouTube cookies.txt (most reliable)</label>
            <input
              value={settings.cookiesPath}
              placeholder="C:\Users\You\Downloads\www.youtube.com_cookies.txt"
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
