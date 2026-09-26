import { FolderOpen, Sparkles, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import Sidebar from "../components/Sidebar";
import { formatClock } from "../lib/time";
import { useAppStore } from "../store/appStore";

interface ResearchVideo {
  id: string;
  title: string;
  description: string;
  views: number;
  duration: number;
  channel: string;
  thumbnail: string;
  url: string;
}

interface PackVideo extends ResearchVideo {
  rank: number;
  viewsLabel: string;
  filename?: string;
  query?: string;
}

interface Pack {
  keyword: string;
  videos: PackVideo[];
  related: string[];
  metadata: {
    title: string;
    description: string;
    keywords: string[];
    tags: string[];
    thumbnail: string;
  };
  rankingUrl: string;
}

interface JobStatus {
  status: string;
  progress: number;
  error: string;
}

function parseKeywords(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const book = XLSX.read(buffer, { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    return [...new Set(
      rows
        .flat()
        .map((cell) => String(cell ?? "").trim())
        .filter((cell) => cell && !/^keywords?$/i.test(cell)),
    )];
  });
}

export default function AdvanceSearchPage() {
  const navigate = useNavigate();
  const settings = useAppStore((s) => s.settings);
  const createProject = useAppStore((s) => s.createProject);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [related, setRelated] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [top, setTop] = useState<ResearchVideo | null>(null);
  const [pack, setPack] = useState<Pack | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [job, setJob] = useState<JobStatus | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    void refreshKeywords();
    void refreshPacks();
  }, []);

  const selectedPack = useMemo(
    () => packs.find((item) => item.keyword === keyword) || pack,
    [packs, keyword, pack],
  );

  async function refreshKeywords() {
    const res = await fetch("/api/advance/keywords");
    const data = await res.json();
    setKeywords(data.keywords || []);
    setSheetName(data.name || "");
    if (!keyword && data.keywords?.[0]) setKeyword(data.keywords[0]);
  }

  async function refreshPacks() {
    const res = await fetch("/api/advance/packs");
    const data = await res.json();
    setPacks(data.packs || []);
  }

  async function onUpload(file?: File) {
    if (!file) return;
    setError("");
    setBusy("Reading Excel…");
    try {
      const list = await parseKeywords(file);
      if (!list.length) throw new Error("No keywords found in that sheet.");
      const res = await fetch("/api/advance/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, keywords: list }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setKeywords(data.keywords);
      setSheetName(data.name);
      setKeyword(data.keywords[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that Excel file.");
    } finally {
      setBusy("");
    }
  }

  async function research() {
    if (!keyword) return;
    setError("");
    setBusy("Searching YouTube for the top video…");
    try {
      const res = await fetch("/api/advance/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, cookies: settings.cookiesPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTop(data.top);
      setRelated(data.related || []);
      setSelected(data.related || []);
      await refreshPacks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "YouTube research failed.");
    } finally {
      setBusy("");
    }
  }

  function togglePhrase(phrase: string) {
    setSelected((current) =>
      current.includes(phrase) ? current.filter((item) => item !== phrase) : [...current, phrase],
    );
  }

  async function downloadSelected() {
    if (!keyword || selected.length === 0) return;
    setError("");
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const query = selected[index];
        setBusy(`Downloading ${index + 1} of ${selected.length}: ${query}`);
        const res = await fetch("/api/advance/download-top", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword, query, cookies: settings.cookiesPath }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed on “${query}”`);
        if (data.already) {
          setPack(data.pack);
        } else if (data.jobId) {
          await pollJob(data.jobId);
        }
        const packRes = await fetch(`/api/advance/packs/${encodeURIComponent(keyword)}`);
        if (packRes.ok) setPack(await packRes.json());
        await refreshPacks();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusy("");
    }
  }

  async function pollJob(jobId: string) {
    for (;;) {
      const res = await fetch(`/api/youtube/jobs/${jobId}`);
      const data = (await res.json()) as JobStatus;
      setJob(data);
      if (data.status === "done" || data.status === "error") {
        if (data.status === "error") throw new Error(data.error || "Download failed");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }

  function openEditor() {
    const project = createProject(keyword || "Compilation");
    navigate(`/editor/${project.id}?pack=${encodeURIComponent(keyword)}`);
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="page downloader">
        <div className="page-head">
          <div>
            <h1>Advance Search</h1>
            <p className="sub">Upload keywords, research YouTube, download top-viewed clips, then merge in view order.</p>
          </div>
        </div>

        <div className="steps">
          <span className={sheetName ? "on" : ""}>1. Excel</span>
          <span className={top ? "on" : ""}>2. Research</span>
          <span className={selectedPack?.videos.length ? "on" : ""}>3. Download</span>
          <span>4. Merge pack</span>
        </div>

        <div className="panel">
          <h3>1. Upload keyword Excel</h3>
          <p className="sub">Use a sheet like your keyword list. The first column is read as keywords.</p>
          <label className="ghost" style={{ display: "inline-flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <Upload size={16} /> {sheetName || "Choose .xlsx / .csv"}
            <input
              className="hidden"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => void onUpload(e.target.files?.[0])}
            />
          </label>
          {sheetName && <p className="ok" style={{ marginTop: 10 }}>{keywords.length} keywords loaded from {sheetName}</p>}
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h3>2. Research the keyword</h3>
          <div className="row grow">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Main keyword</label>
              <select value={keyword} onChange={(e) => setKeyword(e.target.value)}>
                <option value="">Select a keyword</option>
                {keywords.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <button className="primary" style={{ flex: "0 0 auto", alignSelf: "end" }} onClick={() => void research()} disabled={!keyword || Boolean(busy)}>
              Search YouTube
            </button>
          </div>
          {top && (
            <div className="video-info" style={{ marginTop: 16 }}>
              {top.thumbnail ? <img src={top.thumbnail} alt="" /> : <div />}
              <div>
                <h2>{top.title}</h2>
                <p className="sub">{top.channel} · {top.views.toLocaleString()} views · {formatClock(top.duration)}</p>
                <p className="sub">{top.description.slice(0, 280) || "No description"}</p>
              </div>
            </div>
          )}
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h3>3. Choose phrases and download each top viewed video</h3>
          <p className="sub">Check the ads or phrases you want. Each selected item is searched on YouTube and the highest-viewed video is saved in the keyword folder.</p>
          <div className="actions" style={{ justifyContent: "flex-start", marginTop: 10 }}>
            <button className="ghost" type="button" disabled={!related.length} onClick={() => setSelected(related)}>Select all</button>
            <button className="ghost" type="button" disabled={!selected.length} onClick={() => setSelected([])}>Clear</button>
            <span className="sub">{selected.length} selected</span>
          </div>
          <div className="check-list">
            {related.length === 0 && <div className="sub">Search YouTube first to fill this list from the top video.</div>}
            {related.map((item) => (
              <label key={item} className="check-item">
                <input type="checkbox" checked={selected.includes(item)} onChange={() => togglePhrase(item)} />
                <span>{item}</span>
              </label>
            ))}
          </div>
          <button className="primary" onClick={() => void downloadSelected()} disabled={!keyword || selected.length === 0 || Boolean(busy)}>
            Download selected ({selected.length})
          </button>
          {job && (
            <div style={{ marginTop: 14 }}>
              <div className="progress"><span style={{ width: `${job.progress}%` }} /></div>
              <div className="sub">{job.progress}%</div>
            </div>
          )}
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h3>4. Keyword folder · merge in top-view order</h3>
          <p className="sub">Clips are saved in <code>downloads\{keyword || "keyword"}</code>. The editor loads this folder and lines them up from most viewed to least viewed.</p>
          {selectedPack?.videos.length ? (
            <table className="rank-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Views</th>
                  <th>Title</th>
                  <th>Search</th>
                </tr>
              </thead>
              <tbody>
                {selectedPack.videos.map((video) => (
                  <tr key={video.id}>
                    <td>{video.rank}</td>
                    <td>{video.viewsLabel}</td>
                    <td>{video.title}</td>
                    <td>{video.query || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="sub">No videos in this keyword folder yet.</p>
          )}
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            {selectedPack && (
              <a className="ghost" href={selectedPack.rankingUrl} style={{ textDecoration: "none" }}>
                Download ranking Excel
              </a>
            )}
            <button className="primary" onClick={openEditor} disabled={!keyword}>
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <Sparkles size={16} /> Merge in editor
              </span>
            </button>
          </div>
        </div>

        {selectedPack?.metadata && selectedPack.videos.length > 0 && (
          <div className="panel" style={{ marginTop: 18 }}>
            <h3>YouTube upload pack</h3>
            {selectedPack.metadata.thumbnail && (
              <img src={selectedPack.metadata.thumbnail} alt="" style={{ width: 280, borderRadius: 12, margin: "10px 0" }} />
            )}
            <MetaBlock label="Title" value={selectedPack.metadata.title} copied={copied} onCopy={copy} />
            <MetaBlock label="Description" value={selectedPack.metadata.description} copied={copied} onCopy={copy} />
            <MetaBlock label="Keywords" value={selectedPack.metadata.keywords.join(", ")} copied={copied} onCopy={copy} />
            <MetaBlock label="Tags" value={selectedPack.metadata.tags.join(", ")} copied={copied} onCopy={copy} />
          </div>
        )}

        <div className="panel" style={{ marginTop: 18 }}>
          <h3>Compilation folders</h3>
          <div className="downloads-list">
            {packs.length === 0 && <div className="sub">Download a top viewed video to create a keyword folder.</div>}
            {packs.map((item) => (
              <button key={item.keyword} className="download-row" style={{ width: "100%", textAlign: "left" }} onClick={() => { setKeyword(item.keyword); setPack(item); }}>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <FolderOpen size={16} /> {item.keyword}
                </span>
                <span>{item.videos.length} videos · top viewed first</span>
              </button>
            ))}
          </div>
        </div>

        {busy && <p className="sub">{busy}</p>}
        {error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}

function MetaBlock({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: string;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div className="field">
      <label>
        {label}{" "}
        <button className="chip" type="button" onClick={() => void onCopy(label, value)}>
          {copied === label ? "Copied" : "Copy"}
        </button>
      </label>
      <textarea readOnly value={value} rows={label === "Description" ? 8 : 2} />
    </div>
  );
}
