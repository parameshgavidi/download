import type { Clip, Project } from "../types";
import { aspectSize, cssFilter } from "./media";
import { getBlob } from "./idb";

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function mediaElement(id: string, kind: "video" | "image" | "audio") {
  const blob = await getBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  if (kind === "image") return { url, el: await loadImage(url) };
  const el = document.createElement(kind);
  el.src = url;
  el.muted = kind === "video";
  await new Promise<void>((resolve, reject) => {
    el.onloadedmetadata = () => resolve();
    el.onerror = () => reject(new Error("media failed"));
  });
  return { url, el };
}

function clipOpacity(clip: Clip, localTime: number) {
  let opacity = clip.opacity;
  if (clip.fadeIn && localTime < clip.fadeIn) opacity *= localTime / clip.fadeIn;
  if (clip.fadeOut && localTime > clip.duration - clip.fadeOut) {
    opacity *= Math.max(0, (clip.duration - localTime) / clip.fadeOut);
  }
  return opacity;
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  localTime: number,
  source: CanvasImageSource | null,
  width: number,
  height: number,
) {
  ctx.save();
  ctx.globalAlpha = clipOpacity(clip, localTime);
  ctx.filter = cssFilter(clip);
  ctx.translate(width / 2 + clip.x, height / 2 + clip.y);
  ctx.rotate((clip.rotation * Math.PI) / 180);
  ctx.scale(clip.scale, clip.scale);
  if (clip.type === "text") {
    ctx.font = `700 ${clip.fontSize}px ${clip.fontFamily}`;
    ctx.textAlign = clip.align;
    ctx.lineWidth = 6;
    ctx.strokeStyle = clip.stroke;
    ctx.fillStyle = clip.color;
    ctx.strokeText(clip.text, 0, 0);
    ctx.fillText(clip.text, 0, 0);
  } else if (clip.type === "shape") {
    ctx.fillStyle = clip.fill;
    if (clip.shape === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(width, height) / 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-width / 6, -height / 8, width / 3, height / 4);
    }
  } else if (source) {
    ctx.drawImage(source, -width / 2, -height / 2, width, height);
  }
  ctx.restore();
}

export async function exportProject(
  project: Project,
  onProgress: (value: number) => void,
) {
  const quality = JSON.parse(localStorage.getItem("pgve-settings") || "{}") as {
    exportQuality?: "720p" | "1080p" | "4k";
  };
  const widthMap = { "720p": 720, "1080p": 1080, "4k": 2160 };
  const size = aspectSize(project.aspect, widthMap[quality.exportQuality || "1080p"]);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create export canvas");

  const duration = Math.max(
    0.5,
    project.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0),
  );
  const fps = project.fps || 30;
  const frames = Math.ceil(duration * fps);

  const sources = new Map<string, { url: string; el: HTMLVideoElement | HTMLImageElement | HTMLAudioElement }>();
  for (const media of project.media) {
    const loaded = await mediaElement(media.id, media.kind);
    if (loaded) sources.set(media.id, loaded);
  }

  const stream = canvas.captureStream(fps);
  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  const audioNodes: { clip: Clip; source: MediaElementAudioSourceNode; gain: GainNode }[] = [];
  for (const clip of project.clips.filter((c) => c.type === "audio" || c.type === "video")) {
    const media = clip.mediaId ? sources.get(clip.mediaId) : null;
    if (!media || !(media.el instanceof HTMLMediaElement)) continue;
    const source = audioCtx.createMediaElementSource(media.el);
    const gain = audioCtx.createGain();
    source.connect(gain).connect(dest);
    audioNodes.push({ clip, source, gain });
  }
  dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));

  const recorder = new MediaRecorder(stream, {
    mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm",
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
  });
  recorder.start();

  for (let i = 0; i < frames; i += 1) {
    const time = i / fps;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const stack = ["video", "overlay", "text"] as const;
    for (const track of stack) {
      for (const clip of project.clips.filter((c) => c.track === track)) {
        if (time < clip.start || time >= clip.start + clip.duration) continue;
        const local = time - clip.start;
        const media = clip.mediaId ? sources.get(clip.mediaId) : null;
        if (media?.el instanceof HTMLVideoElement) {
          const target = clip.inPoint + local * clip.speed;
          if (Math.abs(media.el.currentTime - target) > 0.05) media.el.currentTime = target;
        }
        drawClip(ctx, clip, local, media?.el instanceof HTMLImageElement || media?.el instanceof HTMLVideoElement ? media.el : null, canvas.width, canvas.height);
      }
    }
    for (const node of audioNodes) {
      const active = time >= node.clip.start && time < node.clip.start + node.clip.duration && !node.clip.muted;
      node.gain.gain.value = active ? node.clip.volume : 0;
      if (active && node.source.mediaElement.paused) void node.source.mediaElement.play();
    }
    onProgress(Math.round(((i + 1) / frames) * 100));
    await new Promise((r) => requestAnimationFrame(r));
  }

  recorder.stop();
  await audioCtx.close();
  sources.forEach((item) => URL.revokeObjectURL(item.url));
  return done;
}

