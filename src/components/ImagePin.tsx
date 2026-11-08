import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
import { Menu } from "@tauri-apps/api/menu";
import { save } from "@tauri-apps/plugin-dialog";
import { fitPinSize } from "../features/windows/pinSizing";
import "./ImagePin.css";

interface PinImage {
  path: string;
  width: number;
  height: number;
}

export default function ImagePin() {
  const [image, setImage] = useState<PinImage | null>(null);
  const [notice, setNotice] = useState("");
  const nativeMenu = useRef<Menu | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizing = useRef(false);
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 2500);
  }, []);
  const run = useCallback(
    async (operation: () => Promise<unknown>, success?: string) => {
      try {
        await operation();
        if (success) showNotice(success);
      } catch (error) {
        showNotice(
          typeof error === "object" && error && "message" in error
            ? String(error.message)
            : String(error),
        );
      }
    },
    [showNotice],
  );
  const copy = useCallback(() => run(() => invoke("pin_image_copy"), "已复制图片"), [run]);
  const saveImage = useCallback(
    () =>
      run(async () => {
        const path = await save({
          defaultPath: "截图.png",
          filters: [{ name: "PNG 图片", extensions: ["png"] }],
        });
        if (path) {
          await invoke("pin_image_save", { path });
          showNotice("已保存图片");
        }
      }),
    [run, showNotice],
  );
  const zoom = useCallback(
    async (scale?: number, delta?: number) => {
      if (!image || resizing.current) return;
      resizing.current = true;
      try {
        const window = getCurrentWindow();
        const [size, monitor] = await Promise.all([window.innerSize(), currentMonitor()]);
        const nextScale = scale ?? (size.width / image.width) * (delta && delta > 0 ? 0.9 : 1.1);
        const next = fitPinSize(
          image.width,
          image.height,
          nextScale,
          monitor?.workArea.size.width ?? 1920,
          monitor?.workArea.size.height ?? 1080,
        );
        await window.setSize(new PhysicalSize(next.width, next.height));
      } finally {
        resizing.current = false;
      }
    },
    [image],
  );
  useEffect(() => {
    let cancelled = false;
    void invoke<PinImage>("pin_image_get")
      .then((result) => {
        if (!cancelled) setImage(result);
      })
      .catch(() => {
        void getCurrentWindow().close();
      });
    return () => {
      cancelled = true;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const prefix = getCurrentWindow().label;
    const resource = Menu.new({
      items: [
        {
          id: `${prefix}-copy`,
          text: "复制图片",
          action: () => {
            void copy();
          },
        },
        {
          id: `${prefix}-save`,
          text: "另存为 PNG…",
          action: () => {
            void saveImage();
          },
        },
        {
          id: `${prefix}-reset`,
          text: "原始尺寸（限制在屏幕内）",
          action: () => {
            void run(() => zoom(1));
          },
        },
        {
          id: `${prefix}-close`,
          text: "关闭贴图",
          action: () => {
            void getCurrentWindow().close();
          },
        },
      ],
    });
    void resource
      .then((menu) => {
        if (!cancelled) nativeMenu.current = menu;
      })
      .catch(() => showNotice("右键菜单不可用，请使用悬浮按钮"));
    return () => {
      cancelled = true;
      nativeMenu.current = null;
      void resource.then((menu) => menu.close()).catch(() => {});
    };
  }, [copy, saveImage, zoom, run, showNotice]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void getCurrentWindow().close();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copy();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveImage();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [copy, saveImage]);
  return (
    <div
      className="image-pin"
      onContextMenu={(event) => {
        event.preventDefault();
        void nativeMenu.current?.popup();
      }}
      onWheel={(event) => {
        void run(() => zoom(undefined, event.deltaY));
      }}
    >
      {image && (
        <img
          src={convertFileSrc(image.path)}
          alt="固定截图"
          draggable={false}
          onMouseDown={(event) => {
            if (event.button === 0) void getCurrentWindow().startDragging();
          }}
          onLoad={() => {
            void getCurrentWindow().show();
          }}
          onError={() => {
            void getCurrentWindow().close();
          }}
        />
      )}
      <div className="pin-toolbar" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" title="复制图片 Ctrl+C" onClick={() => void copy()}>
          复制
        </button>
        <button type="button" title="另存为 PNG Ctrl+S" onClick={() => void saveImage()}>
          保存
        </button>
        <button type="button" title="恢复原始尺寸" onClick={() => void run(() => zoom(1))}>
          1:1
        </button>
        <button type="button" title="关闭贴图 Esc" onClick={() => void getCurrentWindow().close()}>
          ×
        </button>
      </div>
      {notice && (
        <div className="pin-notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
