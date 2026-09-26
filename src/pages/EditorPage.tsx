import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Magnet,
  Pause,
  Play,
  Plus,
  Redo2,
  Search,
  Square,
  Type,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Inspector from "../components/editor/Inspector";
import PreviewStage from "../components/editor/PreviewStage";
import Timeline from "../components/editor/Timeline";
import { exportProject } from "../lib/exportVideo";
import { timelineLength, useEditorStore } from "../store/editorStore";
import { useAppStore } from "../store/appStore";

export default function EditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedPack = useRef("");
  const [mutedAll, setMutedAll] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [packs, setPacks] = useState<{ keyword: string; videos: { url: string; filename?: string; title: string }[] }[]>([]);
  const [packKeyword, setPackKeyword] = useState(params.get("pack") || "");
  const [packMeta, setPackMeta] = useState<{ title: string; description: string; tags: string[]; keywords: string[]; thumbnail: string } | null>(null);
  const [loadingPack, setLoadingPack] = useState(false);
  const load = useAppStore((s) => s.load);
  const project = useEditorStore((s) => s.project);
  const loadProject = useEditorStore((s) => s.loadProject);
  const playing = useEditorStore((s) => s.playing);
  const playhead = useEditorStore((s) => s.playhead);
  const zoom = useEditorStore((s) => s.zoom);
  const snap = useEditorStore((s) => s.snap);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setZoom = useEditorStore((s) => s.setZoom);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const importFiles = useEditorStore((s) => s.importFiles);
  const importRemoteVideos = useEditorStore((s) => s.importRemoteVideos);
  const addText = useEditorStore((s) => s.addText);
  const addShape = useEditorStore((s) => s.addShape);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const rename = useEditorStore((s) => s.rename);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const persist = useEditorStore((s) => s.persist);
  const exporting = useEditorStore((s) => s.exporting);
  const exportProgress = useEditorStore((s) => s.exportProgress);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (id) loadProject(id);
  }, [id, loadProject]);

  useEffect(() => {
    void fetch("/api/advance/packs")
      .then((res) => res.json())
      .then((data) => setPacks(data.packs || []))
      .catch(() => undefined);
  }, []);

  async function loadKeywordFolder(keyword: string) {
    if (!keyword) return;
    setLoadingPack(true);
    try {
      const res = await fetch(`/api/advance/packs/${encodeURIComponent(keyword)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPackMeta(data.metadata);
      const items = [...(data.videos || [])]
        .sort((a: { rank: number }, b: { rank: number }) => a.rank - b.rank)
        .filter((video: { url: string; filename?: string }) => Boolean(video.filename || video.url))
        .map((video: { url: string; filename?: string; title: string }) => ({
          url: video.url,
          name: video.filename || `${video.title}.mp4`,
        }));
      useEditorStore.getState().setPlayhead(0);
      await importRemoteVideos(items);
      if (data.metadata?.title) rename(data.metadata.title);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not load that keyword folder");
    } finally {
      setLoadingPack(false);
    }
  }

  useEffect(() => {
    const pack = params.get("pack");
    if (pack && project && project.clips.length === 0 && loadedPack.current !== pack) {
      loadedPack.current = pack;
      setPackKeyword(pack);
      void loadKeywordFolder(pack);
    }
  }, [params, project]);

  useEffect(() => {
    document.querySelectorAll("video, audio").forEach((el) => {
      (el as HTMLMediaElement).muted = mutedAll;
    });
  }, [mutedAll, playhead, project]);

  useEffect(() => {
    if (!playing || !project) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = useEditorStore.getState().playhead + dt;
      const end = timelineLength(project) - 2;
      if (next >= Math.max(0.2, end)) {
        useEditorStore.getState().setPlaying(false);
        useEditorStore.getState().setPlayhead(end);
        return;
      }
      useEditorStore.getState().setPlayhead(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, project]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        setPlaying(!useEditorStore.getState().playing);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      }
      if (!typing && (e.key === "Delete" || e.key === "Backspace")) deleteSelected();
      if (!typing && e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) splitAtPlayhead();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, duplicateSelected, redo, setPlaying, splitAtPlayhead, undo]);

  async function onExport() {
    if (!project) return;
    useEditorStore.setState({ exporting: true, exportProgress: 0 });
    try {
      const blob = await exportProject(project, (value) => {
        useEditorStore.setState({ exportProgress: value });
      });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${project.name.replace(/\s+/g, "-")}.webm`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Export failed");
    } finally {
      useEditorStore.setState({ exporting: false });
    }
  }

  if (!project) {
    return (
      <div className="editor" style={{ placeItems: "center" }}>
        <div>
          <p>Project not found.</p>
          <button className="primary" onClick={() => navigate("/")}>Back to projects</button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn" onClick={() => { persist(); navigate("/"); }} title="Close">
            <X size={16} />
          </button>
        </div>
        <input
          className="name-edit"
          value={project.name}
          onChange={(e) => rename(e.target.value)}
        />
        <div className="topbar-right">
          <button className="icon-btn" title="Import" onClick={() => fileRef.current?.click()}>
            <Upload size={16} />
          </button>
          <button className="ghost" onClick={() => void onExport()} disabled={exporting}>
            {exporting ? `Export ${exportProgress}%` : "Export"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="rail">
          <button className="icon-btn" title="Media library" onClick={() => setLibraryOpen((v) => !v)}>
            <Search size={16} />
          </button>
          <button className="icon-btn" title="Import media" onClick={() => fileRef.current?.click()}>
            <Plus size={16} />
          </button>
        </aside>
        <PreviewStage />
        <Inspector />
      </div>

      <div className="transport">
        <div className="transport-side">
          <button className="icon-btn" onClick={undo} title="Undo">
            <Undo2 size={16} />
          </button>
          <button className="icon-btn" onClick={redo} title="Redo">
            <Redo2 size={16} />
          </button>
        </div>
        <div className="transport-mid">
          <button className="icon-btn" onClick={() => setPlayhead(Math.max(0, playhead - 1))}>
            <ChevronLeft size={16} />
          </button>
          <button className="play-btn" onClick={() => setPlaying(!playing)}>
            {playing ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <button className="icon-btn" onClick={() => setPlayhead(playhead + 1)}>
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="transport-side">
          <button className="icon-btn" onClick={() => setMutedAll((v) => !v)} title="Mute preview">
            {mutedAll ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button className={`icon-btn ${snap ? "" : ""}`} onClick={toggleSnap} title="Snap">
            <Magnet size={16} color={snap ? "#3b82f6" : undefined} />
          </button>
          <button className="icon-btn" onClick={addText} title="Add text">
            <Type size={16} />
          </button>
          <button className="icon-btn" onClick={() => addShape("rect")} title="Add shape">
            <Square size={16} />
          </button>
          <button className="icon-btn" onClick={() => addShape("circle")} title="Add circle">
            <Circle size={16} />
          </button>
          <button className="icon-btn" onClick={() => setZoom(zoom - 16)}>
            <ZoomOut size={16} />
          </button>
          <button className="icon-btn" onClick={() => setZoom(zoom + 16)}>
            <ZoomIn size={16} />
          </button>
        </div>
      </div>

      <Timeline />

      <input
        ref={fileRef}
        className="hidden"
        type="file"
        accept="video/*,audio/*,image/*"
        multiple
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {libraryOpen && (
        <div className="modal-backdrop" onClick={() => setLibraryOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Media</h3>
            <p className="sub">Import files, or load an Advance Search keyword folder in top-view order.</p>
            <div className="field">
              <label>Main keyword folder</label>
              <div className="row grow">
                <select value={packKeyword} onChange={(e) => setPackKeyword(e.target.value)}>
                  <option value="">Select keyword folder</option>
                  {packs.map((item) => (
                    <option key={item.keyword} value={item.keyword}>{item.keyword}</option>
                  ))}
                </select>
                <button className="primary" style={{ flex: "0 0 auto" }} disabled={!packKeyword || loadingPack} onClick={() => void loadKeywordFolder(packKeyword)}>
                  {loadingPack ? "Loading…" : "Load by views"}
                </button>
              </div>
            </div>
            {packMeta && (
              <div className="sub" style={{ marginBottom: 12 }}>
                <div><strong>{packMeta.title}</strong></div>
                <div>Tags: {packMeta.tags.slice(0, 8).join(", ")}</div>
              </div>
            )}
            <div className="downloads-list">
              {project.media.length === 0 && <div className="sub">No media yet.</div>}
              {project.media.map((media) => (
                <div key={media.id} className="download-row">
                  <span>{media.name}</span>
                  <span>{media.kind}</span>
                </div>
              ))}
            </div>
            <button className="ghost" style={{ marginTop: 14 }} onClick={() => fileRef.current?.click()}>
              Import media
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
