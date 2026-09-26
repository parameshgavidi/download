export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function aspectSize(aspect: "16:9" | "9:16" | "1:1" | "4:5", width = 1080) {
  const map = {
    "16:9": [16, 9],
    "9:16": [9, 16],
    "1:1": [1, 1],
    "4:5": [4, 5],
  } as const;
  const [w, h] = map[aspect];
  return { width, height: Math.round((width * h) / w) };
}

export function loadMediaElement(url: string, kind: "video" | "audio" | "image") {
  return new Promise<HTMLVideoElement | HTMLAudioElement | HTMLImageElement>((resolve, reject) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read image"));
      img.src = url;
      return;
    }
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(el);
    el.onerror = () => reject(new Error(`Could not read ${kind}`));
    el.src = url;
  });
}

export async function inspectFile(file: File) {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("audio/")) {
      const el = (await loadMediaElement(url, "audio")) as HTMLAudioElement;
      return {
        kind: "audio" as const,
        duration: Number.isFinite(el.duration) ? el.duration : 8,
        width: 0,
        height: 0,
        thumb: undefined as string | undefined,
      };
    }
    if (file.type.startsWith("image/")) {
      const img = (await loadMediaElement(url, "image")) as HTMLImageElement;
      const thumb = makeImageThumb(img);
      return {
        kind: "image" as const,
        duration: 4,
        width: img.naturalWidth,
        height: img.naturalHeight,
        thumb,
      };
    }
    const video = (await loadMediaElement(url, "video")) as HTMLVideoElement;
    const thumb = await makeVideoThumb(video);
    return {
      kind: "video" as const,
      duration: Number.isFinite(video.duration) ? video.duration : 5,
      width: video.videoWidth,
      height: video.videoHeight,
      thumb,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function makeImageThumb(img: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  const scale = 320 / Math.max(img.naturalWidth, 1);
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

async function makeVideoThumb(video: HTMLVideoElement) {
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    video.currentTime = Math.min(0.2, (video.duration || 1) / 8);
    video.onseeked = done;
    setTimeout(done, 800);
  });
  const canvas = document.createElement("canvas");
  const w = video.videoWidth || 320;
  const h = video.videoHeight || 180;
  const scale = 320 / w;
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

export function cssFilter(clip: {
  brightness: number;
  contrast: number;
  saturate: number;
  hue: number;
  blur: number;
  filterPreset: string;
}) {
  const presets: Record<string, string> = {
    cinematic: "contrast(1.15) saturate(0.85) brightness(0.95)",
    vivid: "saturate(1.45) contrast(1.1)",
    mono: "grayscale(1)",
    warm: "sepia(0.25) saturate(1.2) hue-rotate(-10deg)",
    cool: "hue-rotate(18deg) saturate(1.1) brightness(1.05)",
    fade: "contrast(0.85) brightness(1.1) saturate(0.8)",
    vintage: "sepia(0.45) contrast(1.1) saturate(0.8)",
  };
  const extra = presets[clip.filterPreset] || "";
  return [
    `brightness(${clip.brightness})`,
    `contrast(${clip.contrast})`,
    `saturate(${clip.saturate})`,
    `hue-rotate(${clip.hue}deg)`,
    `blur(${clip.blur}px)`,
    extra,
  ].join(" ");
}
