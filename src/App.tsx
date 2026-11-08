import { useEffect, lazy, Suspense } from "react";
import "./App.css";
import { ContextMenuProvider } from "./components/ContextMenu";
const MainWindow = lazy(() =>
  import("./components/MainWindow").then((module) => ({ default: module.MainWindow })),
);
const NotePad = lazy(() =>
  import("./components/NotePad").then((module) => ({ default: module.NotePad })),
);
const TileShowcase = lazy(() =>
  import("./components/TileShowcase").then((module) => ({ default: module.TileShowcase })),
);
import { ToastContainer } from "./components/Toast";
import { tabToIndentListener } from "indent-textarea";
import { getConfig } from "./features/settings/api";
import { applyTheme, watchSystemTheme } from "./features/settings/theme";
import type { AppConfig, ThemeOption } from "./features/settings/types";
import { getInitialRoute } from "./features/windows/windowRoutes";
import { syncLanguage } from "./locales";
import { listen } from "@tauri-apps/api/event";

const ImagePin = lazy(() => import("./components/ImagePin"));

function App() {
  return (
    <Suspense fallback={null}>
      {getInitialRoute().view === "pin" ? <ImagePin /> : <NoteApp />}
    </Suspense>
  );
}

function NoteApp() {
  const route = getInitialRoute();
  const activeView = route.view;

  useEffect(() => {
    let cleanup = () => {};
    getConfig()
      .then((config) => {
        const theme = (config.theme || "system") as ThemeOption;
        applyTheme(theme);
        cleanup = watchSystemTheme(theme);
        document.documentElement.style.setProperty(
          "--tab-indent-size",
          String(config.tabIndentSize ?? 2),
        );
        void syncLanguage(config.locale);
      })
      .catch(() => {});
    return () => cleanup();
  }, []);

  useEffect(() => {
    let themeCleanup = () => {};
    const unlisten = listen<AppConfig>("config-changed", (event) => {
      const theme = (event.payload.theme || "system") as ThemeOption;
      applyTheme(theme);
      themeCleanup();
      themeCleanup = watchSystemTheme(theme);
      document.documentElement.style.setProperty(
        "--tab-indent-size",
        String(event.payload.tabIndentSize ?? 2),
      );
      void syncLanguage(event.payload.locale);
    });
    return () => {
      themeCleanup();
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const handleTab = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (target.dataset.tabIndent !== "true") return;
      tabToIndentListener(event);
    };
    window.addEventListener("keydown", handleTab, true);
    return () => window.removeEventListener("keydown", handleTab, true);
  }, []);

  useEffect(() => {
    const isWindows =
      navigator.userAgent.includes("Windows") || navigator.platform.toLowerCase().startsWith("win");
    if (!isWindows) return;

    const preventSystemMenu = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "Space") {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", preventSystemMenu, true);
    return () => document.removeEventListener("keydown", preventSystemMenu, true);
  }, []);

  return (
    <ContextMenuProvider>
      <div className="app-window-shell h-screen font-body text-ink overflow-hidden">
        {activeView === "main" ? (
          <MainWindow />
        ) : activeView === "notepad" ? (
          <NotePad initialNoteId={route.noteId} />
        ) : (
          <TileShowcase noteId={route.noteId} />
        )}
        <ToastContainer />
      </div>
    </ContextMenuProvider>
  );
}

export default App;
