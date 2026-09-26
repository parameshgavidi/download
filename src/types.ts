export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";
export type ClipType = "video" | "image" | "audio" | "text" | "shape";
export type TrackId = "overlay" | "video" | "text" | "audio";
export type FilterPreset =
  | "none"
  | "cinematic"
  | "vivid"
  | "mono"
  | "warm"
  | "cool"
  | "fade"
  | "vintage";

export interface MediaAsset {
  id: string;
  name: string;
  kind: "video" | "image" | "audio";
  duration: number;
  width: number;
  height: number;
  thumb?: string;
}

export interface Clip {
  id: string;
  mediaId?: string;
  type: ClipType;
  track: TrackId;
  start: number;
  duration: number;
  inPoint: number;
  name: string;
  volume: number;
  speed: number;
  opacity: number;
  muted: boolean;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  brightness: number;
  contrast: number;
  saturate: number;
  hue: number;
  blur: number;
  filterPreset: FilterPreset;
  fadeIn: number;
  fadeOut: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  stroke: string;
  align: "left" | "center" | "right";
  shape: "rect" | "circle" | "star";
  fill: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspect: AspectRatio;
  fps: number;
  clips: Clip[];
  media: MediaAsset[];
  coverTime: number;
  thumbnail?: string;
}

export interface YoutubeFormat {
  id: string;
  label: string;
  height: number;
  ext: string;
  fps: number | null;
  filesize: number | null;
  note: string;
}

export interface YoutubeInfo {
  id: string;
  title: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  description: string;
  webpageUrl: string;
  presets: { id: string; label: string; height: number }[];
  formats: YoutubeFormat[];
}
