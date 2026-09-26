import { create } from "zustand";
import type { AspectRatio, Project } from "../types";
import { uid } from "../lib/media";

const PROJECTS_KEY = "pgve-projects";
const SETTINGS_KEY = "pgve-settings";
const MAX_PROJECTS = 100;

export interface Settings {
  displayName: string;
  defaultDownloadPath: string;
  cookiesPath: string;
  cookiesBrowser: "chrome" | "edge" | "firefox" | "";
  exportQuality: "720p" | "1080p" | "4k";
  defaultAspect: AspectRatio;
}

interface AppState {
  projects: Project[];
  settings: Settings;
  load: () => void;
  createProject: (name?: string) => Project;
  saveProject: (project: Project) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const defaultSettings: Settings = {
  displayName: "Logged in",
  defaultDownloadPath: "",
  cookiesPath: "",
  cookiesBrowser: "chrome",
  exportQuality: "1080p",
  defaultAspect: "9:16",
};

function readProjects(): Project[] {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]") as Project[];
  } catch {
    return [];
  }
}

function writeProjects(projects: Project[]) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function emptyProject(name: string, aspect: AspectRatio): Project {
  const now = Date.now();
  return {
    id: uid("proj"),
    name,
    createdAt: now,
    updatedAt: now,
    aspect,
    fps: 30,
    clips: [],
    media: [],
    coverTime: 0,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  settings: defaultSettings,
  load: () => {
    const settings = {
      ...defaultSettings,
      ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<Settings>),
    };
    set({ projects: readProjects().sort((a, b) => b.updatedAt - a.updatedAt), settings });
  },
  createProject: (name) => {
    const { projects, settings } = get();
    if (projects.length >= MAX_PROJECTS) {
      throw new Error(`Project limit reached (${MAX_PROJECTS}).`);
    }
    const project = emptyProject(name || new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }), settings.defaultAspect);
    const next = [project, ...projects];
    writeProjects(next);
    set({ projects: next });
    return project;
  },
  saveProject: (project) => {
    const next = get().projects.filter((p) => p.id !== project.id);
    const updated = { ...project, updatedAt: Date.now() };
    const projects = [updated, ...next].sort((a, b) => b.updatedAt - a.updatedAt);
    writeProjects(projects);
    set({ projects });
  },
  deleteProject: (id) => {
    const projects = get().projects.filter((p) => p.id !== id);
    writeProjects(projects);
    set({ projects });
  },
  renameProject: (id, name) => {
    const projects = get().projects.map((p) =>
      p.id === id ? { ...p, name, updatedAt: Date.now() } : p,
    );
    writeProjects(projects);
    set({ projects });
  },
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    set({ settings });
  },
}));

export function youtubeAuth(settings: Settings) {
  return {
    cookies: settings.cookiesPath,
    cookiesBrowser: settings.cookiesBrowser,
  };
}

export const PROJECT_LIMIT = MAX_PROJECTS;
