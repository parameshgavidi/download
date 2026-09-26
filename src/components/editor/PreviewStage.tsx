import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cssFilter } from "../../lib/media";
import { formatClock } from "../../lib/time";
import { activeClips, mediaUrl, useEditorStore } from "../../store/editorStore";
import type { Clip } from "../../types";

function clipOpacity(clip: Clip, time: number) {
  const local = time - clip.start;
  let opacity = clip.opacity;
  if (clip.fadeIn && local < clip.fadeIn) opacity *= local / clip.fadeIn;
  if (clip.fadeOut && local > clip.duration - clip.fadeOut) {
    opacity *= Math.max(0, (clip.duration - local) / clip.fadeOut);
  }
  return opacity;
}

function MediaLayer({ clip, time, playing }: { clip: Clip; time: number; playing: boolean }) {
  const [url, setUrl] = useState("");
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | HTMLImageElement | null>(null);
  const local = time - clip.start;
  const sourceTime = clip.inPoint + local * clip.speed;

  useEffect(() => {
    if (!clip.mediaId) return;
    void mediaUrl(clip.mediaId).then(setUrl);
  }, [clip.mediaId]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !(el instanceof HTMLMediaElement) || !url) return;
    el.playbackRate = clip.speed;
    el.volume = clip.muted ? 0 : clip.volume;
    if (Math.abs(el.currentTime - sourceTime) > 0.12) el.currentTime = sourceTime;
    if (playing) void el.play().catch(() => undefined);
    else el.pause();
  }, [url, playing, sourceTime, clip.speed, clip.volume, clip.muted]);

  if (clip.type === "audio") {
    return url ? <audio ref={(el) => { mediaRef.current = el; }} src={url} /> : null;
  }

  const style: CSSProperties = {
    opacity: clipOpacity(clip, time),
    transform: `translate(${clip.x}px, ${clip.y}px) scale(${clip.scale}) rotate(${clip.rotation}deg)`,
    filter: cssFilter(clip),
    objectFit: "contain",
  };

  if (clip.type === "image") {
    return url ? <img className="layer" src={url} alt="" style={style} /> : null;
  }
  return url ? (
    <video
      className="layer"
      ref={(el) => {
        mediaRef.current = el;
      }}
      src={url}
      muted={clip.muted}
      playsInline
      style={style}
    />
  ) : null;
}

function OverlayLayer({ clip, time }: { clip: Clip; time: number }) {
  const style: CSSProperties = {
    opacity: clipOpacity(clip, time),
    transform: `translate(${clip.x}px, ${clip.y}px) scale(${clip.scale}) rotate(${clip.rotation}deg)`,
    display: "grid",
    placeItems: "center",
    pointerEvents: "none",
  };
  if (clip.type === "text") {
    return (
      <div className="layer" style={style}>
        <div
          style={{
            fontFamily: clip.fontFamily,
            fontSize: clip.fontSize,
            color: clip.color,
            textAlign: clip.align,
            fontWeight: 800,
            WebkitTextStroke: `2px ${clip.stroke}`,
            paintOrder: "stroke fill",
            whiteSpace: "pre-wrap",
            maxWidth: "80%",
          }}
        >
          {clip.text}
        </div>
      </div>
    );
  }
  if (clip.type === "shape") {
    return (
      <div className="layer" style={style}>
        <div
          style={{
            width: clip.shape === "circle" ? 160 : 220,
            height: clip.shape === "circle" ? 160 : 120,
            borderRadius: clip.shape === "circle" ? "50%" : 16,
            background: clip.fill,
          }}
        />
      </div>
    );
  }
  return null;
}

export default function PreviewStage() {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const playing = useEditorStore((s) => s.playing);

  const clips = useMemo(() => (project ? activeClips(project, playhead) : []), [project, playhead]);
  const duration = project?.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0) || 0;
  const ratio = project?.aspect.replace(":", " / ") || "9 / 16";

  if (!project) return null;

  return (
    <div className="stage-wrap">
      <div className="stage">
        <div
          className="canvas-frame"
          id="preview-frame"
          style={{ aspectRatio: ratio }}
        >
          {clips
            .filter((c) => c.track === "video")
            .map((clip) => (
              <MediaLayer key={clip.id} clip={clip} time={playhead} playing={playing} />
            ))}
          {clips
            .filter((c) => c.track === "overlay")
            .map((clip) =>
              clip.type === "image" || clip.type === "video" ? (
                <MediaLayer key={clip.id} clip={clip} time={playhead} playing={playing} />
              ) : (
                <OverlayLayer key={clip.id} clip={clip} time={playhead} />
              ),
            )}
          {clips
            .filter((c) => c.track === "text")
            .map((clip) => (
              <OverlayLayer key={clip.id} clip={clip} time={playhead} />
            ))}
          {clips
            .filter((c) => c.track === "audio")
            .map((clip) => (
              <MediaLayer key={clip.id} clip={clip} time={playhead} playing={playing} />
            ))}
        </div>
      </div>
      <div className="preview-foot">
        <span>
          {formatClock(playhead, true)} / {formatClock(duration, true)}
        </span>
        <span>{project.aspect === "9:16" ? "Original" : project.aspect}</span>
      </div>
    </div>
  );
}
