import { Image, Layers, Music, Scissors, Type, Volume2 } from "lucide-react";
import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import { formatClock } from "../../lib/time";
import { timelineLength, useEditorStore } from "../../store/editorStore";
import type { Clip, TrackId } from "../../types";

const TRACKS: { id: TrackId; icon: typeof Music; label: string }[] = [
  { id: "overlay", icon: Layers, label: "Overlay" },
  { id: "video", icon: Image, label: "Video" },
  { id: "text", icon: Type, label: "Text" },
  { id: "audio", icon: Volume2, label: "Audio" },
];

export default function Timeline() {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const zoom = useEditorStore((s) => s.zoom);
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const moveClip = useEditorStore((s) => s.moveClip);
  const updateClip = useEditorStore((s) => s.updateClip);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const setCoverTime = useEditorStore((s) => s.setCoverTime);
  const setThumbnail = useEditorStore((s) => s.setThumbnail);
  const importFiles = useEditorStore((s) => s.importFiles);
  const lanesRef = useRef<HTMLDivElement>(null);

  if (!project) return null;
  const length = timelineLength(project);
  const width = Math.max(800, length * zoom);

  function timeAt(clientX: number) {
    const lane = lanesRef.current;
    if (!lane) return 0;
    const x = clientX - lane.getBoundingClientRect().left + lane.scrollLeft;
    return Math.max(0, x / zoom);
  }

  function onLaneMouse(e: ReactMouseEvent, track?: TrackId) {
    if ((e.target as HTMLElement).closest(".clip")) return;
    setPlayhead(timeAt(e.clientX));
    if (track) select(null);
  }

  function startDrag(e: ReactMouseEvent, clip: Clip) {
    e.stopPropagation();
    select(clip.id);
    const startX = e.clientX;
    const origin = clip.start;
    const onMove = (ev: MouseEvent) => {
      moveClip(clip.id, origin + (ev.clientX - startX) / zoom);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startTrim(e: ReactMouseEvent, clip: Clip, edge: "left" | "right") {
    e.stopPropagation();
    const startX = e.clientX;
    const originStart = clip.start;
    const originDur = clip.duration;
    const originIn = clip.inPoint;
    const onMove = (ev: MouseEvent) => {
      const delta = (ev.clientX - startX) / zoom;
      if (edge === "left") {
        const nextStart = Math.max(0, originStart + delta);
        const shift = nextStart - originStart;
        updateClip(clip.id, {
          start: nextStart,
          duration: Math.max(0.2, originDur - shift),
          inPoint: Math.max(0, originIn + shift * clip.speed),
        });
      } else {
        updateClip(clip.id, { duration: Math.max(0.2, originDur + delta) });
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const ticks = [];
  for (let t = 0; t <= length; t += 1) {
    ticks.push(
      <span key={t} style={{ position: "absolute", left: t * zoom, top: 8 }}>
        {formatClock(t)}
      </span>,
    );
  }

  return (
    <div
      className="timeline"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
      }}
    >
      <div className="track-labels">
        <div className="track-label" style={{ height: 28 }} />
        {TRACKS.map((track) => {
          const Icon = track.icon;
          return (
            <div key={track.id} className="track-label" title={track.label}>
              {track.id === "video" ? (
                <button
                  className="ghost"
                  style={{ padding: "4px 8px", fontSize: 11, borderRadius: 8 }}
                  onClick={() => {
                    setCoverTime(playhead);
                    const frame = document.getElementById("preview-frame");
                    if (frame) {
                      const canvas = document.createElement("canvas");
                      canvas.width = 640;
                      canvas.height = 360;
                      const ctx = canvas.getContext("2d");
                      const video = frame.querySelector("video, img");
                      if (ctx && video) {
                        ctx.fillStyle = "#000";
                        ctx.fillRect(0, 0, 640, 360);
                        ctx.drawImage(video as CanvasImageSource, 0, 0, 640, 360);
                        setThumbnail(canvas.toDataURL("image/jpeg", 0.8));
                      }
                    }
                  }}
                >
                  Cover
                </button>
              ) : (
                <Icon size={16} />
              )}
            </div>
          );
        })}
      </div>
      <div>
        <div className="ruler" style={{ width }} onMouseDown={(e) => onLaneMouse(e)}>
          {ticks}
          <div className="playhead" style={{ left: playhead * zoom }} />
        </div>
        <div
          className="lanes"
          ref={lanesRef}
          onMouseDown={(e) => onLaneMouse(e)}
        >
          {project.clips.length === 0 && (
            <div className="drop-hint" style={{ position: "absolute", left: 16, right: 16, top: 88, zIndex: 2 }}>
              Drag material here and start to create
            </div>
          )}
          {TRACKS.map((track) => (
            <div key={track.id} className="track-lane" style={{ position: "relative", width }} onMouseDown={(e) => onLaneMouse(e, track.id)}>
              {project.clips
                .filter((clip) => clip.track === track.id)
                .map((clip) => (
                  <div
                    key={clip.id}
                    className={`clip ${clip.type} ${selectedId === clip.id ? "selected" : ""}`}
                    style={{ left: clip.start * zoom, width: Math.max(18, clip.duration * zoom) }}
                    onMouseDown={(e) => startDrag(e, clip)}
                  >
                    <span className="handle left" onMouseDown={(e) => startTrim(e, clip, "left")} />
                    {clip.name}
                    <span className="handle right" onMouseDown={(e) => startTrim(e, clip, "right")} />
                  </div>
                ))}
            </div>
          ))}
          <div className="playhead" style={{ left: playhead * zoom }} />
        </div>
      </div>
      <div style={{ display: "grid", placeItems: "center" }}>
        <button className="icon-btn" title="Split at playhead" onClick={splitAtPlayhead}>
          <Scissors size={16} />
        </button>
      </div>
    </div>
  );
}
