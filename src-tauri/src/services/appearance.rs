use super::notes::{default_store, AppError};
use crate::json_io::write_json_atomic;
use serde::Serialize;
use std::{collections::BTreeMap, fs, sync::Mutex};
use tauri::{Emitter, State};

#[derive(Default)]
pub struct AppearanceState(pub Mutex<()>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceAppearance {
    pub note_id: String,
    pub transparency: Option<u8>,
}

fn read_preferences() -> Result<BTreeMap<String, u8>, AppError> {
    let path = default_store()?
        .config_dir()
        .join("surface-appearance.json");
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

#[tauri::command]
pub fn surface_appearance_get(
    state: State<'_, AppearanceState>,
    note_id: String,
) -> Result<SurfaceAppearance, AppError> {
    let _guard = state.inner().0.lock().map_err(|_| AppError {
        code: "appearanceLock".into(),
        message: "无法读取便签外观设置".into(),
        details: Default::default(),
    })?;
    let preferences = read_preferences()?;
    Ok(SurfaceAppearance {
        transparency: preferences.get(&note_id).copied().map(|v| v.min(100)),
        note_id,
    })
}

#[tauri::command]
pub fn surface_appearance_set(
    app: tauri::AppHandle,
    state: State<'_, AppearanceState>,
    note_id: String,
    transparency: Option<u8>,
) -> Result<(), AppError> {
    // Validate the note before persisting an override; drafts keep their value locally.
    let store = default_store()?;
    store.read_note(&note_id)?;
    let _guard = state.inner().0.lock().map_err(|_| AppError {
        code: "appearanceLock".into(),
        message: "无法保存便签外观设置".into(),
        details: Default::default(),
    })?;
    let mut preferences = read_preferences()?;
    let transparency = transparency.map(|value| value.min(100));
    if let Some(value) = transparency {
        preferences.insert(note_id.clone(), value);
    } else {
        preferences.remove(&note_id);
    }
    write_json_atomic(
        &store.config_dir().join("surface-appearance.json"),
        &preferences,
    )?;
    let _ = app.emit(
        "surface-appearance-changed",
        SurfaceAppearance {
            note_id,
            transparency,
        },
    );
    Ok(())
}
