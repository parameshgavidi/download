import { Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { formatClock, formatDate, formatRelative } from "../lib/time";
import { PROJECT_LIMIT, useAppStore } from "../store/appStore";
import { removeProjectMedia } from "../store/editorStore";

export default function ProjectsPage() {
  const navigate = useNavigate();
  const projects = useAppStore((s) => s.projects);
  const createProject = useAppStore((s) => s.createProject);
  const deleteProject = useAppStore((s) => s.deleteProject);

  function newProject() {
    const project = createProject();
    navigate(`/editor/${project.id}`);
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="page">
        <div className="page-head">
          <div>
            <h1>Projects</h1>
            <p className="sub">Create a project to open the VN-style editor.</p>
          </div>
          <button className="primary" onClick={newProject} disabled={projects.length >= PROJECT_LIMIT}>
            + New Project
          </button>
        </div>
        <div className="grid">
          {projects.map((project) => {
            const duration = project.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
            return (
              <Link key={project.id} to={`/editor/${project.id}`} className="project-card">
                <div className="thumb">
                  {project.thumbnail ? <img src={project.thumbnail} alt="" /> : null}
                  <div className="duration-badge">{formatClock(duration)}</div>
                  <div className="card-actions">
                    <button
                      className="icon-btn danger"
                      title="Delete project"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirm(`Delete “${project.name}”?`)) {
                          void removeProjectMedia(project);
                          deleteProject(project.id);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="card-meta">
                  <div className="card-title">{formatDate(project.updatedAt)}</div>
                  <div>
                    {project.clips.length} {project.clips.length === 1 ? "clip" : "clips"} · Updated {formatRelative(project.updatedAt)}
                  </div>
                </div>
              </Link>
            );
          })}
          {projects.length === 0 && (
            <>
              <button className="empty-card" onClick={newProject} aria-label="Create new project" />
              <div className="empty-card" />
              <div className="empty-card" />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
