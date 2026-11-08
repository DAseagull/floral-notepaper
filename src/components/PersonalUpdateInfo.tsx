import { openUrl } from "@tauri-apps/plugin-opener";

export function PersonalUpdateInfo(_props: { mode?: string }) {
  return (
    <section data-solid-ui="true" className="space-y-2 text-[12px] text-ink-soft">
      <p>花笺海鸥 · 个人定制版</p>
      <p className="text-ink-faint leading-relaxed">
        此版本从你的 GitHub 仓库下载更新。主窗口、便签和截图均在本地处理。
      </p>
      <button
        type="button"
        className="text-bamboo cursor-pointer"
        onClick={() =>
          void openUrl(
            "https://github.com/DAseagull/floral-notepaper/actions/workflows/personal-windows.yml",
          )
        }
      >
        打开个人版下载页面
      </button>
    </section>
  );
}
