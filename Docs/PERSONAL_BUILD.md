# 花笺海鸥 · 个人定制版

基于 Achilng/floral-notepaper，保留原项目 MIT 许可及署名。

## 使用

- 用 Windows `Shift+Win+S` 截图，再按 `Ctrl+Alt+V` 贴到屏幕。可在设置中重新录制或清空贴图快捷键。
- 拖动图片移动，滚轮等比缩放。悬停显示复制、保存、原始尺寸和关闭按钮；右键也可打开系统菜单。`Ctrl+C` 复制图片，`Ctrl+S` 保存 PNG，`Esc` 关闭当前贴图。
- 托盘菜单也有“贴出剪贴板图片”。每次读取当前剪贴板，不后台监控剪贴板。取消系统截图后，剪贴板可能仍是上一张图片。
- 设置中分别调整主窗口、默认便签背景透明度。0% 为不透明，100% 为完全透明；文字和内容不会一起变淡。
- 每张便签右上角 `◐` 可覆盖默认透明度。选择“跟随默认值”可移除该张覆盖。编辑与磁贴模式共用该张设置。未保存草稿的单独设置随首次保存保留。
- 完全透明时，窗口控件静置隐藏、悬停显示。托盘“恢复主窗口背景”可恢复主窗口。
- 图片默认临时显示，关闭窗口后释放缓存；需要长期保留请使用“保存”。最多同时显示 20 张，单张不超过 3200 万像素。

## 安装与数据

安装包和便携程序均为 Windows x64。程序依赖 WebView2（Windows 11 通常已具备）。
定制程序未使用原作者的代码签名。请核对随包 SHA256.txt 和仓库构建来源。

个人版使用独立应用 ID、配置目录 `floral-notepaper-seagull` 及文档目录 `花笺海鸥`。
不会自动接管原版数据，也不注册 `.md` / `.txt` 文件关联。已有笔记可先在原版导出 Markdown，再导入本版；含本地图片的笔记需要同时保留图片资源并核对引用。
个人版停止原版自动更新，更新请从 DAseagull/floral-notepaper 的 Personal Windows Build 构建下载。

## 构建与验证

`npm ci`、`npm test`、`npm run lint`、`npm run build`。
Windows 需要 Rust MSVC 工具链及 Visual Studio C++ Build Tools；之后运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`npm run tauri build -- --bundles nsis`。

GitHub Actions 工作流 `.github/workflows/personal-windows.yml` 可自动构建，下载 `floral-seagull-windows-x64` artifact 后解压使用。

发布前需实际检查系统截图、无图片剪贴板、多屏混合 DPI、快捷键冲突、0/50/100% 透明、重启持久化、编辑和磁贴切换、原版共存。
性能应统计所有关联 WebView2 进程；创建关闭 100 次贴图、8 小时驻留、不同图片数量均需单独测量。未实测前不能将延迟、CPU 或内存目标当作保证。
