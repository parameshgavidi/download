import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAppStore } from "./store/appStore";
import ProjectsPage from "./pages/ProjectsPage";
import DownloaderPage from "./pages/DownloaderPage";
import SettingsPage from "./pages/SettingsPage";
import EditorPage from "./pages/EditorPage";
import AdvanceSearchPage from "./pages/AdvanceSearchPage";

export default function App() {
  const load = useAppStore((s) => s.load);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Routes>
      <Route path="/" element={<ProjectsPage />} />
      <Route path="/download" element={<DownloaderPage />} />
      <Route path="/advance" element={<AdvanceSearchPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/editor/:id" element={<EditorPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
