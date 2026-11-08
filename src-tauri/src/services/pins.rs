use super::notes::AppError;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

const MAX_PIXELS: u64 = 32_000_000;
const MAX_PINS: usize = 20;

#[derive(Default)]
pub struct PinState {
    entries: Mutex<HashMap<String, PinImage>>,
    busy: AtomicBool,
    shortcut_down: AtomicBool,
    last_request: Mutex<Option<Instant>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinImage {
    path: PathBuf,
    width: u32,
    height: u32,
}

fn error(message: impl Into<String>) -> AppError {
    AppError { code: "imagePin".into(), message: message.into(), details: Default::default() }
}

fn validate_dimensions(width: u32, height: u32, bytes: usize) -> Result<(), AppError> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels == 0 || pixels > MAX_PIXELS || pixels * 4 != bytes as u64 {
        return Err(error("图片为空、像素数据无效或超过 3200 万像素上限"));
    }
    Ok(())
}

pub fn initialize(app: &AppHandle) {
    // A crashed process can leave temporary files; only remove this feature's UUID-named PNGs.
    let Ok(directory) = app.path().app_cache_dir().map(|path| path.join("pins")) else { return; };
    let Ok(entries) = fs::read_dir(directory) else { return; };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.strip_prefix("pin-").and_then(|name| name.strip_suffix(".png"))
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok()) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

pub fn shortcut_event(app: &AppHandle, pressed: bool) {
    let previous = app.state::<PinState>().shortcut_down.swap(pressed, Ordering::SeqCst);
    if pressed && !previous { request_pin(app); }
}

impl Drop for PinState {
    fn drop(&mut self) {
        if let Ok(entries) = self.entries.get_mut() {
            for image in entries.values() { let _ = fs::remove_file(&image.path); }
        }
    }
}

pub fn request_pin(app: &AppHandle) {
    let state = app.state::<PinState>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(mut last) = state.last_request.lock() {
        if last.is_some_and(|time| time.elapsed() < Duration::from_millis(600)) {
            state.busy.store(false, Ordering::SeqCst);
            return;
        }
        *last = Some(Instant::now());
    }
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = capture_and_open(&handle);
        handle.state::<PinState>().busy.store(false, Ordering::SeqCst);
        if let Err(failure) = result {
            handle.dialog().message(failure.message).title("花笺·海鸥 — 贴图").show(|_| {});
        }
    });
}

fn capture_and_open(app: &AppHandle) -> Result<(), AppError> {
    if app.state::<PinState>().entries.lock().map_err(|_| error("贴图状态不可用"))?.len() >= MAX_PINS {
        return Err(error("最多同时显示 20 张贴图，请先关闭部分图片"));
    }
    let mut captured = None;
    for attempt in 0..3 {
        match app.clipboard().read_image() {
            Ok(image) => {
                captured = Some(image);
                break;
            }
            Err(_) if attempt < 2 => std::thread::sleep(Duration::from_millis(60)),
            Err(_) => {}
        }
    }
    let image = captured.ok_or_else(|| error("剪贴板中没有可读取的图片。请先用 Shift+Win+S 截图，再按贴图快捷键。"))?;
    let (width, height) = (image.width(), image.height());
    validate_dimensions(width, height, image.rgba().len())?;
    let label = format!("pin-{}", uuid::Uuid::new_v4());
    let directory = app.path().app_cache_dir()?.join("pins");
    fs::create_dir_all(&directory)?;
    let path = directory.join(format!("{label}.png"));
    image::save_buffer_with_format(&path, image.rgba(), width, height, image::ColorType::Rgba8, image::ImageFormat::Png)
        .map_err(|failure| error(failure.to_string()))?;
    drop(image);
    app.asset_protocol_scope().allow_file(&path).map_err(|failure| error(failure.to_string()))?;
    app.state::<PinState>().entries.lock().map_err(|_| error("贴图状态不可用"))?
        .insert(label.clone(), PinImage { path, width, height });
    let result = (|| -> Result<(), AppError> {
        let cursor = app.cursor_position()?;
        let monitor = app.monitor_from_point(cursor.x, cursor.y)?.or(app.primary_monitor()?);
        let (max_width, max_height, origin_x, origin_y) = monitor.as_ref().map(|screen| {
            let area = screen.work_area();
            (f64::from(area.size.width) * 0.75, f64::from(area.size.height) * 0.75,
             area.position.x, area.position.y)
        }).unwrap_or((960.0, 720.0, 0, 0));
        let scale = (max_width / f64::from(width)).min(max_height / f64::from(height)).min(1.0);
        let display_width = (f64::from(width) * scale).round().max(1.0) as u32;
        let display_height = (f64::from(height) * scale).round().max(1.0) as u32;
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html?view=pin".into()))
            .title("花笺·海鸥 — 贴图")
            .decorations(false).transparent(true).shadow(false).always_on_top(true)
            .skip_taskbar(true).visible(false).focused(false).resizable(false)
            .inner_size(f64::from(display_width), f64::from(display_height))
            .build()?;
        // Physical coordinates preserve image proportions across mixed-DPI monitors.
        window.set_size(PhysicalSize::new(display_width, display_height))?;
        let right = origin_x as f64 + max_width / 0.75 - f64::from(display_width);
        let bottom = origin_y as f64 + max_height / 0.75 - f64::from(display_height);
        let x = (cursor.x + 16.0).clamp(origin_x as f64, right.max(origin_x as f64));
        let y = (cursor.y + 16.0).clamp(origin_y as f64, bottom.max(origin_y as f64));
        window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))?;
        Ok(())
    })();
    if result.is_err() {
        if let Some(window) = app.get_webview_window(&label) { let _ = window.close(); }
        remove_pin(app, &label);
    }
    result
}

pub fn remove_pin(app: &AppHandle, label: &str) {
    if let Ok(mut entries) = app.state::<PinState>().entries.lock() {
        if let Some(image) = entries.remove(label) {
            let _ = app.asset_protocol_scope().forbid_file(&image.path);
            let _ = fs::remove_file(image.path);
        }
    }
}

fn own_image(window: &WebviewWindow) -> Result<PinImage, AppError> {
    window.app_handle().state::<PinState>().entries.lock().map_err(|_| error("贴图状态不可用"))?
        .get(window.label()).cloned().ok_or_else(|| error("贴图已关闭"))
}

#[tauri::command]
pub fn pin_image_get(window: WebviewWindow) -> Result<PinImage, AppError> { own_image(&window) }

#[tauri::command]
pub async fn pin_image_copy(window: WebviewWindow) -> Result<(), AppError> {
    let entry = own_image(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let pixels = image::open(entry.path).map_err(|failure| error(failure.to_string()))?.into_rgba8();
        let image = tauri::image::Image::new_owned(pixels.into_raw(), entry.width, entry.height);
        app.clipboard().write_image(&image).map_err(|failure| error(failure.to_string()))
    }).await.map_err(|failure| error(failure.to_string()))?
}

#[tauri::command]
pub async fn pin_image_save(window: WebviewWindow, path: PathBuf) -> Result<(), AppError> {
    let entry = own_image(&window)?;
    if path.extension().and_then(|extension| extension.to_str()).is_none_or(|extension| !extension.eq_ignore_ascii_case("png")) {
        return Err(error("请保存为 PNG 图片"));
    }
    tauri::async_runtime::spawn_blocking(move || fs::copy(entry.path, path).map(|_| ()).map_err(AppError::from))
        .await.map_err(|failure| error(failure.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_empty_oversized_and_invalid_pixel_buffers() {
        assert!(validate_dimensions(0, 10, 0).is_err());
        assert!(validate_dimensions(100_000, 100_000, 0).is_err());
        assert!(validate_dimensions(2, 2, 15).is_err());
        assert!(validate_dimensions(2, 2, 16).is_ok());
    }
}
