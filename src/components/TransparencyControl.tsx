import { useEffect, useRef, useState } from "react";

export function TransparencyControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reveal = () => setOpen(true);
    window.addEventListener("floral-open-transparency", reveal);
    return () => window.removeEventListener("floral-open-transparency", reveal);
  }, []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className={`surface-transparency-control ${open ? "is-open" : ""}`}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="transparency-toggle"
        aria-label="便签背景透明度"
        title="便签背景透明度"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ◐
      </button>
      {open && (
        <div
          data-solid-ui="true"
          className="transparency-popover"
          role="dialog"
          aria-label="便签背景透明度"
        >
          <label>
            背景透明度 <output>{value}%</output>
            <input
              aria-label="便签背景透明度"
              type="range"
              min="0"
              max="100"
              value={value}
              onChange={(event) => onChange(Number(event.target.value))}
            />
          </label>
          <div className="transparency-presets">
            {[0, 50, 100].map((preset) => (
              <button type="button" key={preset} onClick={() => onChange(preset)}>
                {preset}%
              </button>
            ))}
          </div>
          <button type="button" onClick={() => onChange(null)}>
            跟随默认值
          </button>
        </div>
      )}
    </div>
  );
}
