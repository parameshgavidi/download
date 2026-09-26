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
  youtubeUrl?: string;
}

interface Candidate {
  query: string;
  ok: boolean;
  duplicate: boolean;
  reason: string;
  confidence?: number;
  video: ResearchVideo | null;
}

interface PackVideo extends ResearchVideo {
  rank: number;
  viewsLabel: string;
  filename?: string;
  query?: string;
  fileUrl?: string;
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

function youtubeHref(video?: ResearchVideo | null) {
  const href = video?.youtubeUrl || "";
  if (href.startsWith("http") && /youtube\.com|youtu\.be/i.test(href)) return href;
  return "";
}

function youtubeIdFromUrl(url: string) {
  return url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/)?.[1] || "";
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
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [job, setJob] = useState<JobStatus | null>(null);
  const [copied, setCopied] = useState("");
  const [mergeOrder, setMergeOrder] = useState<string[]>([]);
  const [mergeSelected, setMergeSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<PackVideo | null>(null);

  useEffect(() => {
    void refreshKeywords();
    void refreshPacks();
    void fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setFfmpegOk(Boolean(data.ffmpeg)))
      .catch(() => setFfmpegOk(null));
  }, []);

  useEffect(() => {
    const current = packs.find((item) => item.keyword === keyword);
    if (!current) return;
    setPack(current);
    if (related.length === 0 && current.related?.length) {
      setRelated(current.related);
      setSelected(current.related);
    }
  }, [packs, keyword, related.length]);

  const selectedPack = useMemo(
    () => packs.find((item) => item.keyword === keyword) || pack,
    [packs, keyword, pack],
  );

  const candidateByQuery = useMemo(
    () => new Map(candidates.map((item) => [item.query, item])),
    [candidates],
  );

  const downloadable = useMemo(
    () => selected
      .map((query) => candidateByQuery.get(query))
      .filter((item): item is Candidate => Boolean(item?.ok && item.video)),
    [selected, candidateByQuery],
  );

  const packVideos = selectedPack?.videos || [];
  const packKey = `${selectedPack?.keyword || ""}:${packVideos.map((video) => video.id).join(",")}`;

  useEffect(() => {
    if (!packVideos.length) {
      setMergeOrder([]);
      setMergeSelected([]);
      return;
    }
    setMergeOrder(packVideos.map((video) => video.id));
    setMergeSelected(packVideos.filter((video) => video.fileUrl).map((video) => video.id));
  }, [packKey]);

  const mergeVideos = useMemo(
    () => mergeOrder
      .map((id, index) => {
        const video = packVideos.find((item) => item.id === id);
        return video ? { video, order: index + 1, selected: mergeSelected.includes(id) } : null;
      })
      .filter((item): item is { video: PackVideo; order: number; selected: boolean } => Boolean(item)),
    [mergeOrder, mergeSelected, packVideos],
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
      setCandidates([]);
      if (typeof data.ffmpeg === "boolean") setFfmpegOk(data.ffmpeg);
      await refreshPacks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "YouTube research failed.");
    } finally {
      setBusy("");
    }
  }

  function togglePhrase(phrase: string) {
    const candidate = candidateByQuery.get(phrase);
    if (candidate && !candidate.ok) return;
    setSelected((current) =>
      current.includes(phrase) ? current.filter((item) => item !== phrase) : [...current, phrase],
    );
  }

  async function resolveLinks(queries = selected) {
    if (!keyword || queries.length === 0) return [];
    setError("");
    setBusy("Finding unique commercial YouTube links…");
    try {
      const res = await fetch("/api/advance/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          queries,
          cookies: settings.cookiesPath,
          sourceVideoId: top?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const items = (data.items || []) as Candidate[];
      setCandidates(items);
      setFfmpegOk(Boolean(data.ffmpeg));
      setSelected(items.filter((item) => item.ok).map((item) => item.query));
      return items;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve YouTube links.");
      return [];
    } finally {
      setBusy("");
    }
  }

  async function downloadSelected() {
    const queries = [...selected];
    if (!keyword || queries.length === 0) return;
    setError("");
    let saved = 0;
    const problems: string[] = [];
    try {
      for (let index = 0; index < queries.length; index += 1) {
        const query = queries[index];
        try {
          const candidate = candidateByQuery.get(query);
          const video = candidate?.ok ? candidate.video : null;
          setBusy(`Downloading ${index + 1} of ${queries.length}: ${query}`);
          const payload: Record<string, string | number | undefined> = {
            keyword,
            query,
            cookies: settings.cookiesPath,
            sourceVideoId: top?.id,
          };
          if (video && youtubeHref(video)) {
            payload.url = youtubeHref(video);
            payload.videoId = video.id;
            payload.title = video.title;
            payload.views = video.views;
            payload.duration = video.duration;
            payload.channel = video.channel;
            payload.thumbnail = video.thumbnail;
          }
          const res = await fetch("/api/advance/download-top", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) {
            problems.push(`${query}: ${data.error || "download failed"}`);
            continue;
          }
          if (data.already) {
            setPack(data.pack);
            saved += 1;
          } else if (data.jobId) {
            await pollJob(data.jobId);
            saved += 1;
          }
          const packRes = await fetch(`/api/advance/packs/${encodeURIComponent(keyword)}`);
          if (packRes.ok) setPack(await packRes.json());
          await refreshPacks();
        } catch (itemError) {
          problems.push(`${query}: ${itemError instanceof Error ? itemError.message : "download failed"}`);
        }
      }
      if (problems.length) {
        setError(problems.join(" · "));
      }
      if (saved) setBusy(`Saved ${saved} of ${queries.length} videos.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      if (!saved) setBusy("");
    }
  }

  async function deleteLocalVideo(video: PackVideo) {
    if (!keyword) return;
    const ok = window.confirm(`Delete “${video.title}” from this computer?`);
    if (!ok) return;
    setError("");
    setBusy(`Deleting ${video.title}…`);
    try {
      const res = await fetch(
        `/api/advance/packs/${encodeURIComponent(keyword)}/videos/${encodeURIComponent(video.id || video.filename || "")}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not delete that video.");
      setPack(data);
      setMergeOrder((current) => current.filter((id) => id !== video.id));
      setMergeSelected((current) => current.filter((id) => id !== video.id));
      if (preview?.id === video.id) setPreview(null);
      await refreshPacks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that video.");
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
    const chosen = mergeVideos.filter((item) => item.selected && item.video.fileUrl);
    if (!chosen.length) {
      setError("Review the clips, select the downloaded MP4s you want, then click Merge.");
      return;
    }
    const ids = chosen.map((item) => item.video.id).join(",");
    const project = createProject(keyword || "Compilation");
    navigate(`/editor/${project.id}?pack=${encodeURIComponent(keyword)}&ids=${encodeURIComponent(ids)}`);
  }

  function toggleMerge(id: string) {
    setMergeSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function moveMerge(id: string, direction: -1 | 1) {
    setMergeOrder((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  }

  function selectResolved() {
    if (candidates.length) {
      setSelected(candidates.filter((item) => item.ok).map((item) => item.query));
      return;
    }
    setSelected(related);
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="page downloader advance">
        <div className="page-head">
          <div>
            <h1>Advance Search</h1>
            <p className="sub">Upload keywords, research YouTube, download unique commercial spots as one MP4, then merge in view order.</p>
          </div>
        </div>

        <div className="steps">
          <span className={sheetName ? "on" : ""}>1. Excel</span>
          <span className={top ? "on" : ""}>2. Research</span>
          <span className={candidates.some((item) => item.ok) ? "on" : ""}>3. Unique links</span>
          <span className={selectedPack?.videos.length ? "on" : ""}>4. Download</span>
          <span>5. Merge pack</span>
        </div>

        {ffmpegOk === false && (
          <p className="error">
            This window cannot see FFmpeg yet, even if WinGet already installed it. Close VS Code completely, reopen it, then run npm run dev again. If it still fails, in a new PowerShell window run: winget install Gyan.FFmpeg
          </p>
        )}

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
                {top.url && (
                  <p className="sub">
                    Source: <a className="yt-link" href={top.url} target="_blank" rel="noreferrer">{top.url}</a>
                  </p>
                )}
                <p className="sub">{top.description.slice(0, 280) || "No description"}</p>
              </div>
            </div>
          )}
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h3>3. Unique commercial YouTube links</h3>
          <p className="sub">
            Check the individual commercials, then find a unique YouTube page for each one. Duplicate links are blocked.
            We only keep clips that look like a standalone brand commercial (about 8–210 seconds, not a compilation, reaction, or reupload).
            This is a heuristic, not a copyright or monetization check.
          </p>
          <div className="actions" style={{ justifyContent: "flex-start", marginTop: 10 }}>
            <button className="ghost" type="button" disabled={!related.length} onClick={selectResolved}>Select all</button>
            <button className="ghost" type="button" disabled={!selected.length} onClick={() => setSelected([])}>Clear</button>
            <button className="ghost" type="button" disabled={!selected.length || Boolean(busy)} onClick={() => void resolveLinks()}>
              Find unique commercial links
            </button>
            <span className="sub">{selected.length} selected · {downloadable.length} unique commercials</span>
          </div>
          <div className="check-list">
            {related.length === 0 && <div className="sub">Search YouTube first to fill this list from the top video.</div>}
            {related.map((item) => {
              const candidate = candidateByQuery.get(item);
              const video = candidate?.video;
              const checked = selected.includes(item);
              const blocked = Boolean(candidate && !candidate.ok);
              return (
                <label key={item} className={`check-item ${blocked ? "blocked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={blocked}
                    onChange={() => togglePhrase(item)}
                  />
                  <span className="check-copy">
                    <strong>{item}</strong>
                    {video ? (
                      <>
                        <span className="sub">{video.title} · {video.views.toLocaleString()} views · {formatClock(video.duration)}</span>
                        <a className="yt-link" href={youtubeHref(video)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                          {youtubeHref(video)}
                        </a>
                      </>
                    ) : (
                      <span className="sub">Find unique commercial links to show the YouTube URL.</span>
                    )}
                    {candidate && (
                      <span className={`badge ${candidate.ok ? "ok" : candidate.duplicate ? "dup" : "no"}`}>
                        {candidate.ok
                          ? `Commercial · ${candidate.confidence || 0}%`
                          : candidate.duplicate
                            ? "Duplicate link"
                            : "Not a commercial"}
                        {" · "}
                        {candidate.reason}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <button className="primary" onClick={() => void downloadSelected()} disabled={!keyword || selected.length === 0 || Boolean(busy)}>
            {busy.startsWith("Downloading") || busy.startsWith("Saved") ? busy : `Download selected (${selected.length})`}
          </button>
          {busy && <p className="sub" style={{ marginTop: 10 }}>{busy}</p>}
          {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
          {job && (
            <div style={{ marginTop: 14 }}>
              <div className="progress"><span style={{ width: `${job.progress}%` }} /></div>
              <div className="sub">{job.progress}% · one merged MP4 (video + audio)</div>
            </div>
          )}
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <h3>4. Review, select, order, then merge</h3>
          <p className="sub">Click Review on each clip, keep only the commercials you want, set the order, then merge. The editor loads only the selected downloaded MP4s — not YouTube pages.</p>
          <p className="sub">Brand ads may be copyrighted. This app does not bypass Content ID or make a compilation monetizable. Upload only what you have rights to use.</p>
          {mergeVideos.length ? (
            <div className="review-list">
              {mergeVideos.map(({ video, order, selected }) => (
                <div key={video.id} className={`review-row ${selected ? "on" : ""}`}>
                  <input type="checkbox" checked={selected} disabled={!video.fileUrl} onChange={() => toggleMerge(video.id)} />
                  <div className="review-order">
                    <button className="icon-btn" type="button" disabled={order === 1} onClick={() => moveMerge(video.id, -1)} aria-label="Move up">↑</button>
                    <strong>{order}</strong>
                    <button className="icon-btn" type="button" disabled={order === mergeVideos.length} onClick={() => moveMerge(video.id, 1)} aria-label="Move down">↓</button>
                  </div>
                  <div className="review-copy">
                    <strong>{video.title}</strong>
                    <span className="sub">{video.viewsLabel} views · {formatClock(video.duration)} · {video.query || "—"}</span>
                    {youtubeHref(video) && (
                      <a className="yt-link" href={youtubeHref(video)} target="_blank" rel="noreferrer">{youtubeHref(video)}</a>
                    )}
                    <span className={`badge ${video.fileUrl ? "ok" : "no"}`}>
                      {video.fileUrl ? "Downloaded MP4 ready" : "No local file — download first"}
                    </span>
                  </div>
                  <div className="review-actions">
                    <button className="ghost" type="button" onClick={() => setPreview(video)}>Review</button>
                    <button className="ghost danger-btn" type="button" onClick={() => void deleteLocalVideo(video)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="sub">No videos in this keyword folder yet.</p>
          )}
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            <button className="ghost" type="button" disabled={!mergeVideos.some((item) => item.video.fileUrl)} onClick={() => setMergeSelected(mergeVideos.filter((item) => item.video.fileUrl).map((item) => item.video.id))}>
              Select downloaded
            </button>
            <button className="ghost" type="button" disabled={!mergeSelected.length} onClick={() => setMergeSelected([])}>Clear selection</button>
            {selectedPack && (
              <a className="ghost" href={selectedPack.rankingUrl} style={{ textDecoration: "none" }}>
                Download ranking Excel
              </a>
            )}
            <button className="primary" onClick={openEditor} disabled={!keyword || !mergeVideos.some((item) => item.selected && item.video.fileUrl)}>
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <Sparkles size={16} /> Merge selected ({mergeVideos.filter((item) => item.selected && item.video.fileUrl).length})
              </span>
            </button>
          </div>
        </div>

        {selectedPack?.metadata && selectedPack.videos.length > 0 && (
          <div className="panel" style={{ marginTop: 18 }}>
            <h3>New upload pack (not copied from the source video)</h3>
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
              <button key={item.keyword} className="download-row" style={{ width: "100%", textAlign: "left" }} onClick={() => { setKeyword(item.keyword); setPack(item); setRelated(item.related || []); setSelected(item.related || []); setCandidates([]); }}>
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

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal review-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{preview.title}</h3>
            <p className="sub">{preview.channel} · {preview.viewsLabel || preview.views.toLocaleString()} views · {formatClock(preview.duration)}</p>
            {preview.fileUrl ? (
              <video className="review-player" src={preview.fileUrl} controls autoPlay />
            ) : youtubeIdFromUrl(youtubeHref(preview)) ? (
              <iframe
                className="review-player"
                title={preview.title}
                src={`https://www.youtube.com/embed/${youtubeIdFromUrl(youtubeHref(preview))}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <p className="sub">No preview available. Download this commercial first.</p>
            )}
            {youtubeHref(preview) && (
              <p className="sub">
                YouTube: <a className="yt-link" href={youtubeHref(preview)} target="_blank" rel="noreferrer">{youtubeHref(preview)}</a>
              </p>
            )}
            <div className="actions">
              <button className="ghost" type="button" onClick={() => setPreview(null)}>Close</button>
              <button
                className="primary"
                type="button"
                disabled={!preview.fileUrl}
                onClick={() => {
                  if (!mergeSelected.includes(preview.id)) toggleMerge(preview.id);
                  setPreview(null);
                }}
              >
                {mergeSelected.includes(preview.id) ? "Keep selected" : "Select this clip"}
              </button>
            </div>
          </div>
        </div>
      )}
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
