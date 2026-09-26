import { Download, Home, Plus, Search, Settings, User } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { PROJECT_LIMIT, useAppStore } from "../store/appStore";

export default function Sidebar() {
  const navigate = useNavigate();
  const projects = useAppStore((s) => s.projects);
  const settings = useAppStore((s) => s.settings);
  const createProject = useAppStore((s) => s.createProject);

  function newProject() {
    const project = createProject();
    navigate(`/editor/${project.id}`);
  }

  return (
    <aside className="sidebar">
      <div className="user-block">
        <div className="avatar">
          <User size={20} />
        </div>
        <div>{settings.displayName}</div>
      </div>
      <nav className="nav">
        <NavLink to="/" end>
          <Home size={18} /> Projects
        </NavLink>
        <NavLink to="/download">
          <Download size={18} /> Download
        </NavLink>
        <NavLink to="/advance">
          <Search size={18} /> Advance Search
        </NavLink>
        <NavLink to="/settings">
          <Settings size={18} /> Settings
        </NavLink>
      </nav>
      <div className="sidebar-foot">
        <button className="primary" onClick={newProject}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Plus size={18} /> New Project
          </span>
        </button>
        <div className="usage">
          {projects.length} of {PROJECT_LIMIT} projects used
        </div>
      </div>
    </aside>
  );
}
