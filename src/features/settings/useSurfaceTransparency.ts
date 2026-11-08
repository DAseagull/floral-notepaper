import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getConfig } from "./api";
import { normalizeTransparency } from "./transparency";
import type { AppConfig } from "./types";
import { showToast } from "../../components/Toast";

interface Appearance {
  noteId: string;
  transparency: number | null;
}

export function useSurfaceTransparency(noteId: string | null) {
  const [defaultValue, setDefaultValue] = useState(0);
  const [override, setOverride] = useState<number | null>(null);
  const previousId = useRef(noteId);
  const overrideRef = useRef(override);
  overrideRef.current = override;
  const pending = useRef<{
    id: string;
    timer: ReturnType<typeof setTimeout>;
    save: () => void;
  } | null>(null);
  const writeQueue = useRef(Promise.resolve());

  const persist = useCallback((id: string, value: number | null) => {
    writeQueue.current = writeQueue.current.then(async () => {
      try {
        await invoke("surface_appearance_set", { noteId: id, transparency: value });
      } catch {
        showToast("便签透明度保存失败，请重试");
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current.save();
      pending.current = null;
    }
    const carryDraft =
      previousId.current === null && noteId !== null && overrideRef.current !== null;
    previousId.current = noteId;
    if (carryDraft && noteId) {
      persist(noteId, overrideRef.current);
    } else {
      setOverride(null);
      if (noteId)
        void invoke<Appearance>("surface_appearance_get", { noteId })
          .then((result) => {
            if (!cancelled) setOverride(result.transparency);
          })
          .catch(() => {
            if (!cancelled) showToast("无法读取便签透明度");
          });
    }
    return () => {
      cancelled = true;
    };
  }, [noteId, persist]);

  useEffect(() => {
    let cancelled = false;
    void getConfig()
      .then((config) => {
        if (!cancelled) setDefaultValue(normalizeTransparency(config.defaultSurfaceTransparency));
      })
      .catch(() => {});
    const configListener = listen<AppConfig>("config-changed", ({ payload }) => {
      setDefaultValue(normalizeTransparency(payload.defaultSurfaceTransparency));
    });
    const appearanceListener = listen<Appearance>("surface-appearance-changed", ({ payload }) => {
      if (payload.noteId === noteId && !pending.current) setOverride(payload.transparency);
    });
    return () => {
      cancelled = true;
      void configListener.then((unlisten) => unlisten());
      void appearanceListener.then((unlisten) => unlisten());
    };
  }, [noteId]);

  useEffect(
    () => () => {
      if (pending.current) {
        clearTimeout(pending.current.timer);
        pending.current.save();
        pending.current = null;
      }
    },
    [],
  );

  const change = useCallback(
    (value: number | null) => {
      const normalized = value === null ? null : normalizeTransparency(value);
      setOverride(normalized);
      if (pending.current) {
        clearTimeout(pending.current.timer);
        if (pending.current.id !== noteId) pending.current.save();
        pending.current = null;
      }
      if (noteId) {
        const save = () => persist(noteId, normalized);
        pending.current = {
          id: noteId,
          save,
          timer: setTimeout(() => {
            save();
            pending.current = null;
          }, 250),
        };
      }
    },
    [noteId, persist],
  );

  const resetDraft = useCallback(() => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current.save();
      pending.current = null;
    }
    setOverride(null);
  }, []);
  const flush = useCallback(() => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current.save();
      pending.current = null;
    }
    return writeQueue.current;
  }, []);
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      await flush();
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [flush]);
  return {
    transparency: normalizeTransparency(override ?? defaultValue),
    change,
    resetDraft,
    flush,
  };
}
