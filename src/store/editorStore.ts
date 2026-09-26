import { create } from "zustand";
import type { Clip, FilterPreset, MediaAsset, Project, TrackId } from "../types";
import { inspectFile, uid } from "../lib/media";
import { deleteBlob, getBlob, putBlob } from "../lib/idb";
import { useAppStore } from "./appStore";

const urlCache = new Map<string, string>();

export async function mediaUrl(id: string) {
  const cached = urlCache.get(id);
  if (cached) return cached;
  const blob = await getBlob(id);
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

function defaultClip(partial: Partial<Clip> & Pick<Clip, "type" | "track" | "name" | "duration">): Clip {
  return {
    id: uid("clip"),
    start: 0,
    inPoint: 0,
    volume: 1,
    speed: 1,
    opacity: 1,
    muted: false,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    brightness: 1,
    contrast: 1,
    saturate: 1,
    hue: 0,
    blur: 0,
    filterPreset: "none",
    fadeIn: 0,
    fadeOut: 0,
    text: "Text",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 42,
    color: "#ffffff",
    stroke: "#000000",
    align: "center",
    shape: "rect",
    fill: "#3b82f6",
    ...partial,
  };
}

function projectDuration(clips: Clip[]) {
  return clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface EditorState {
  project: Project | null;
  selectedId: string | null;
  playhead: number;
  playing: boolean;
  zoom: number;
  snap: boolean;
  past: Project[];
  future: Project[];
  exporting: boolean;
  exportProgress: number;
  loadProject: (id: string) => void;
  persist: () => void;
  setPlayhead: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  toggleSnap: () => void;
  select: (id: string | null) => void;
  importFiles: (files: FileList | File[]) => Promise<void>;
  importRemoteVideos: (items: { url: string; name: string }[]) => Promise<void>;
  addText: () => void;
  addShape: (shape?: Clip["shape"]) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  moveClip: (id: string, start: number, track?: TrackId) => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  undo: () => void;
  redo: () => void;
  rename: (name: string) => void;
  setAspect: (aspect: Project["aspect"]) => void;
  setCoverTime: (time: number) => void;
  setThumbnail: (dataUrl: string) => void;
}

function pushHistory(state: EditorState): Pick<EditorState, "past" | "future"> {
  if (!state.project) return { past: state.past, future: [] };
  return {
    past: [...state.past.slice(-40), clone(state.project)],
    future: [],
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: null,
  selectedId: null,
  playhead: 0,
  playing: false,
  zoom: 80,
  snap: true,
  past: [],
  future: [],
  exporting: false,
  exportProgress: 0,
  loadProject: (id) => {
    const project = useAppStore.getState().projects.find((p) => p.id === id) || null;
    set({
      project: project ? clone(project) : null,
      selectedId: null,
      playhead: 0,
      playing: false,
      past: [],
      future: [],
    });
  },
  persist: () => {
    const { project } = get();
    if (project) useAppStore.getState().saveProject(clone(project));
  },
  setPlayhead: (time) => set({ playhead: Math.max(0, time) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (zoom) => set({ zoom: Math.min(240, Math.max(24, zoom)) }),
  toggleSnap: () => set({ snap: !get().snap }),
  select: (id) => set({ selectedId: id }),
  importFiles: async (files) => {
    const list = [...files];
    if (!list.length || !get().project) return;
    const history = pushHistory(get());
    const project = clone(get().project!);
    let cursor = get().playhead;

    for (const file of list) {
      const info = await inspectFile(file);
      const media: MediaAsset = {
        id: uid("media"),
        name: file.name,
        kind: info.kind,
        duration: info.duration,
        width: info.width,
        height: info.height,
        thumb: info.thumb,
      };
      await putBlob(media.id, file);
      project.media.push(media);
      const track: TrackId = info.kind === "audio" ? "audio" : info.kind === "image" ? "overlay" : "video";
      const clip = defaultClip({
        mediaId: media.id,
        type: info.kind,
        track,
        name: file.name.replace(/\.[^.]+$/, ""),
        duration: info.duration,
        start: cursor,
      });
      project.clips.push(clip);
      if (!project.thumbnail && info.thumb) project.thumbnail = info.thumb;
      cursor += info.duration;
    }

    set({ project, selectedId: project.clips.at(-1)?.id ?? null, ...history });
    get().persist();
  },
  importRemoteVideos: async (items) => {
    const files: File[] = [];
    for (const item of items) {
      const res = await fetch(item.url);
      if (!res.ok) continue;
      const blob = await res.blob();
      files.push(new File([blob], item.name, { type: blob.type || "video/mp4" }));
    }
    if (files.length) await get().importFiles(files);
  },
  addText: () => {
    if (!get().project) return;
    const history = pushHistory(get());
    const project = clone(get().project!);
    const clip = defaultClip({
      type: "text",
      track: "text",
      name: "Text",
      text: "Text",
      duration: 3,
      start: get().playhead,
    });
    project.clips.push(clip);
    set({ project, selectedId: clip.id, ...history });
    get().persist();
  },
  addShape: (shape = "rect") => {
    if (!get().project) return;
    const history = pushHistory(get());
    const project = clone(get().project!);
    const clip = defaultClip({
      type: "shape",
      track: "overlay",
      name: shape,
      shape,
      duration: 3,
      start: get().playhead,
      scale: 0.35,
    });
    project.clips.push(clip);
    set({ project, selectedId: clip.id, ...history });
    get().persist();
  },
  updateClip: (id, patch) => {
    if (!get().project) return;
    const history = pushHistory(get());
    const project = clone(get().project!);
    project.clips = project.clips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip));
    set({ project, ...history });
    get().persist();
  },
  moveClip: (id, start, track) => {
    if (!get().project) return;
    const history = pushHistory(get());
    const project = clone(get().project!);
    const snap = get().snap;
    const nextStart = snap ? Math.round(start * 10) / 10 : start;
    project.clips = project.clips.map((clip) =>
      clip.id === id ? { ...clip, start: Math.max(0, nextStart), track: track ?? clip.track } : clip,
    );
    set({ project, ...history });
    get().persist();
  },
  splitAtPlayhead: () => {
    const { project, playhead, selectedId } = get();
    if (!project) return;
    const target =
      project.clips.find((c) => c.id === selectedId) ||
      project.clips.find((c) => playhead > c.start + 0.04 && playhead < c.start + c.duration - 0.04);
    if (!target) return;
    const offset = playhead - target.start;
    if (offset <= 0.04 || offset >= target.duration - 0.04) return;
    const history = pushHistory(get());
    const next = clone(project);
    next.clips = next.clips.flatMap((clip) => {
      if (clip.id !== target.id) return [clip];
      const left = { ...clip, duration: offset };
      const right = {
        ...clip,
        id: uid("clip"),
        start: playhead,
        duration: clip.duration - offset,
        inPoint: clip.inPoint + offset * clip.speed,
      };
      return [left, right];
    });
    set({ project: next, selectedId: target.id, ...history });
    get().persist();
  },
  deleteSelected: () => {
    const { project, selectedId } = get();
    if (!project || !selectedId) return;
    const history = pushHistory(get());
    const next = clone(project);
    next.clips = next.clips.filter((c) => c.id !== selectedId);
    set({ project: next, selectedId: null, ...history });
    get().persist();
  },
  duplicateSelected: () => {
    const { project, selectedId } = get();
    if (!project || !selectedId) return;
    const clip = project.clips.find((c) => c.id === selectedId);
    if (!clip) return;
    const history = pushHistory(get());
    const next = clone(project);
    const copy = { ...clone(clip), id: uid("clip"), start: clip.start + clip.duration };
    next.clips.push(copy);
    set({ project: next, selectedId: copy.id, ...history });
    get().persist();
  },
  undo: () => {
    const { past, project, future } = get();
    const prev = past.at(-1);
    if (!prev || !project) return;
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [clone(project), ...future],
    });
    get().persist();
  },
  redo: () => {
    const { future, project, past } = get();
    const next = future[0];
    if (!next || !project) return;
    set({
      project: next,
      future: future.slice(1),
      past: [...past, clone(project)],
    });
    get().persist();
  },
  rename: (name) => {
    const project = get().project;
    if (!project) return;
    set({ project: { ...project, name } });
    get().persist();
  },
  setAspect: (aspect) => {
    const project = get().project;
    if (!project) return;
    const history = pushHistory(get());
    set({ project: { ...project, aspect }, ...history });
    get().persist();
  },
  setCoverTime: (time) => {
    const project = get().project;
    if (!project) return;
    set({ project: { ...project, coverTime: time } });
    get().persist();
  },
  setThumbnail: (dataUrl) => {
    const project = get().project;
    if (!project) return;
    set({ project: { ...project, thumbnail: dataUrl } });
    get().persist();
  },
}));

export function activeClips(project: Project, time: number) {
  return project.clips.filter((clip) => time >= clip.start && time < clip.start + clip.duration);
}

export function timelineLength(project: Project) {
  return Math.max(8, projectDuration(project.clips) + 2);
}

export const FILTERS: { id: FilterPreset; label: string }[] = [
  { id: "none", label: "Original" },
  { id: "cinematic", label: "Cinematic" },
  { id: "vivid", label: "Vivid" },
  { id: "mono", label: "Mono" },
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
  { id: "fade", label: "Fade" },
  { id: "vintage", label: "Vintage" },
];

export async function removeProjectMedia(project: Project) {
  await Promise.all(project.media.map((m) => deleteBlob(m.id)));
}
