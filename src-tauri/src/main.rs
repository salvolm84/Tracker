#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{DateTime, NaiveDate, Utc};
use fs2::FileExt;
use serde::{Deserialize, Deserializer, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

mod attachments;

struct SaveLock(Mutex<()>);

const DEMERIT_VALUES: &[&str] = &[
    "DEM100", "DEM40", "DEM20FS", "DEM20", "DEM10FS", "DEM10", "DEM1", "NA",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapPayload {
    owners: Vec<String>,
    projects: Vec<String>,
    departments: Vec<String>,
    categories: Vec<String>,
    category_impact_factors: BTreeMap<String, f64>,
    priorities: Vec<String>,
    efforts: Vec<String>,
    impacts: Vec<String>,
    statuses: Vec<String>,
    reminder_cadences: Vec<ReminderCadenceOption>,
    db_path: String,
    db_revision: u64,
    record_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReminderCadenceOption {
    label: String,
    interval_days: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackerSettings {
    #[serde(default = "default_owner_values")]
    owners: Vec<String>,
    #[serde(default = "default_project_values")]
    projects: Vec<String>,
    #[serde(default = "default_department_values")]
    departments: Vec<String>,
    #[serde(default = "default_category_values")]
    categories: Vec<String>,
    #[serde(default = "default_category_impact_factor_values")]
    category_impact_factors: BTreeMap<String, f64>,
    #[serde(default = "default_priority_values")]
    priorities: Vec<String>,
    #[serde(default = "default_effort_values")]
    efforts: Vec<String>,
    #[serde(default = "default_impact_values")]
    impacts: Vec<String>,
    #[serde(default = "default_status_values")]
    statuses: Vec<String>,
    #[serde(default = "default_reminder_cadence_values")]
    reminder_cadences: Vec<ReminderCadenceOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugSettings {
    #[serde(default = "default_debug_category_values")]
    categories: Vec<String>,
    #[serde(default = "default_outcome_values")]
    outcome_options: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupplierRatingEntry {
    label: String,
    rating: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackerDatabase {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    #[serde(default)]
    revision: u64,
    #[serde(default = "default_tracker_settings")]
    settings: TrackerSettings,
    #[serde(default)]
    records: Vec<ActivityRecord>,
    #[serde(default)]
    debug_records: Vec<DebugRecord>,
    #[serde(default = "default_debug_settings")]
    debug_settings: DebugSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugRecord {
    id: String,
    submitted_at: String,
    projects: Vec<String>,
    start_date: String,
    end_date: String,
    category: Vec<String>,
    description: String,
    #[serde(default)]
    attachments: Vec<Attachment>,
    #[serde(default, alias = "manufacturer")]
    supplier: String,
    #[serde(default)]
    component: String,
    departments: Vec<String>,
    #[serde(default)]
    supplier_rating: Vec<SupplierRatingEntry>,
    #[serde(default)]
    outcome: Vec<String>,
    #[serde(default)]
    last_modified_at: String,
    #[serde(default)]
    occurrence_phase: String,
    #[serde(default = "default_demerit_value", deserialize_with = "deserialize_demerit")]
    demerit: String,
    #[serde(default)]
    linked_activity_ids: Vec<String>,
    #[serde(default)]
    lessons_learnt: Vec<LessonLearnt>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugInput {
    projects: Vec<String>,
    start_date: String,
    end_date: String,
    category: Vec<String>,
    description: String,
    #[serde(default)]
    attachments: Vec<Attachment>,
    #[serde(default, alias = "manufacturer")]
    supplier: String,
    #[serde(default)]
    component: String,
    departments: Vec<String>,
    #[serde(default)]
    supplier_rating: Vec<SupplierRatingEntry>,
    #[serde(default)]
    outcome: Vec<String>,
    #[serde(default)]
    occurrence_phase: String,
    #[serde(default = "default_demerit_value")]
    demerit: String,
    #[serde(default)]
    linked_activity_ids: Vec<String>,
    #[serde(default)]
    lessons_learnt: Vec<LessonLearnt>,
    #[serde(default)]
    expected_last_modified_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityInput {
    title: String,
    owner: String,
    projects: Vec<String>,
    start_date: String,
    end_date: String,
    departments: Vec<String>,
    description: String,
    effort: String,
    impact: String,
    priority: String,
    status: String,
    #[serde(default = "default_reminder_cadence")]
    reminder_cadence: String,
    categories: Vec<String>,
    #[serde(default)]
    attachments: Vec<Attachment>,
    #[serde(default, deserialize_with = "deserialize_lab_activity")]
    lab_activity: bool,
    #[serde(default)]
    hw_development: bool,
    #[serde(default)]
    sw_development: bool,
    #[serde(default)]
    expected_last_modified_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentInput {
    message: String,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    attachments: Vec<Attachment>,
    #[serde(default)]
    expected_last_modified_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoInput {
    text: String,
    owner: String,
    #[serde(default)]
    due_date: Option<String>,
    #[serde(default)]
    completed: Option<bool>,
    #[serde(default)]
    expected_last_modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Attachment {
    #[serde(default)]
    id: String,
    file_name: String,
    mime_type: String,
    size_bytes: usize,
    #[serde(default)]
    storage_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    base64_data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordComment {
    id: String,
    created_at: String,
    #[serde(default)]
    author: String,
    message: String,
    #[serde(default)]
    attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordTodo {
    id: String,
    created_at: String,
    #[serde(default)]
    updated_at: String,
    text: String,
    owner: String,
    #[serde(default)]
    due_date: String,
    #[serde(default)]
    completed: bool,
    #[serde(default)]
    completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordHistoryEntry {
    id: String,
    created_at: String,
    kind: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LessonLearnt {
    #[serde(default)]
    id: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    attachments: Vec<Attachment>,
}

fn deserialize_lab_activity<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct Visitor;
    impl<'de> serde::de::Visitor<'de> for Visitor {
        type Value = bool;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("bool or string")
        }
        fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<bool, E> {
            Ok(v)
        }
        // Old schema stored a String ("None" / "Minimal" / "Significant")
        fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<bool, E> {
            Ok(!v.eq_ignore_ascii_case("none") && !v.is_empty())
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<bool, E> {
            Ok(false)
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<bool, E> {
            Ok(false)
        }
    }
    deserializer.deserialize_any(Visitor)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityRecord {
    id: String,
    submitted_at: String,
    title: String,
    owner: String,
    projects: Vec<String>,
    start_date: String,
    end_date: String,
    departments: Vec<String>,
    description: String,
    effort: String,
    impact: String,
    priority: String,
    #[serde(default = "default_status")]
    status: String,
    #[serde(default = "default_reminder_cadence")]
    reminder_cadence: String,
    categories: Vec<String>,
    #[serde(default)]
    attachments: Vec<Attachment>,
    #[serde(default)]
    comments: Vec<RecordComment>,
    #[serde(default)]
    todos: Vec<RecordTodo>,
    #[serde(default)]
    history: Vec<RecordHistoryEntry>,
    #[serde(default)]
    last_modified_at: String,
    #[serde(default, deserialize_with = "deserialize_lab_activity")]
    lab_activity: bool,
    #[serde(default)]
    hw_development: bool,
    #[serde(default)]
    sw_development: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmitResult {
    db_path: String,
    db_revision: u64,
    record_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    backup_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentData {
    id: String,
    file_name: String,
    mime_type: String,
    size_bytes: usize,
    base64_data: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseBackup {
    file_name: String,
    path: String,
    modified_at: String,
    size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentStorageStats {
    file_count: usize,
    total_size_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuickUpdateInput {
    owner: Option<String>,
    status: Option<String>,
    reminder_cadence: Option<String>,
    #[serde(default)]
    expected_last_modified_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsRelabelInput {
    field: String,
    from: String,
    to: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatsFilters {
    search_term: String,
    owners: Vec<String>,
    departments: Vec<String>,
    categories: Vec<String>,
    projects: Vec<String>,
    priorities: Vec<String>,
    statuses: Vec<String>,
    efforts: Vec<String>,
    impacts: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CountBucket {
    label: String,
    count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseStats {
    record_count: usize,
    unique_owners: usize,
    unique_projects: usize,
    unique_departments: usize,
    unique_categories: usize,
    average_duration_days: f64,
    latest_submitted_at: Option<String>,
    upcoming_end_date: Option<String>,
    priority_counts: Vec<CountBucket>,
    effort_counts: Vec<CountBucket>,
    impact_counts: Vec<CountBucket>,
    top_owners: Vec<CountBucket>,
    top_projects: Vec<CountBucket>,
}

#[tauri::command]
fn bootstrap_form(app: AppHandle) -> Result<BootstrapPayload, String> {
    let db_path = shared_db_path(&app)?;
    ensure_database_file_exists(&db_path)?;
    let database = read_database(&db_path)?;

    Ok(BootstrapPayload {
        owners: database.settings.owners.clone(),
        projects: database.settings.projects.clone(),
        departments: database.settings.departments.clone(),
        categories: database.settings.categories.clone(),
        category_impact_factors: database.settings.category_impact_factors.clone(),
        priorities: database.settings.priorities.clone(),
        efforts: database.settings.efforts.clone(),
        impacts: database.settings.impacts.clone(),
        statuses: database.settings.statuses.clone(),
        reminder_cadences: database.settings.reminder_cadences.clone(),
        db_path: db_path.display().to_string(),
        db_revision: database.revision,
        record_count: database.records.len(),
    })
}

#[tauri::command]
fn get_database_stats(
    app: AppHandle,
    filters: Option<StatsFilters>,
) -> Result<DatabaseStats, String> {
    let db_path = shared_db_path(&app)?;
    ensure_database_file_exists(&db_path)?;
    let records = read_records(&db_path)?;
    let filters = filters.unwrap_or_default();
    let filtered_records = records
        .into_iter()
        .filter(|record| matches_filters(record, &filters))
        .collect::<Vec<_>>();
    Ok(build_database_stats(&filtered_records))
}

#[tauri::command]
fn get_activity_records(app: AppHandle) -> Result<Vec<ActivityRecord>, String> {
    let db_path = shared_db_path(&app)?;
    ensure_database_file_exists(&db_path)?;
    let mut records = read_records(&db_path)?;
    records.sort_by(|left, right| right.submitted_at.cmp(&left.submitted_at));
    Ok(records)
}

#[tauri::command]
fn list_database_backups(app: AppHandle) -> Result<Vec<DatabaseBackup>, String> {
    let db_path = shared_db_path(&app)?;
    ensure_database_file_exists(&db_path)?;
    list_database_backups_for(&db_path)
}

#[tauri::command]
fn get_attachment_storage_stats(app: AppHandle) -> Result<AttachmentStorageStats, String> {
    let db_path = shared_db_path(&app)?;
    let store_dir = attachments::store_directory(&db_path);
    if !store_dir.exists() {
        return Ok(AttachmentStorageStats {
            file_count: 0,
            total_size_bytes: 0,
        });
    }

    let mut file_count = 0usize;
    let mut total_size_bytes = 0u64;
    for entry in fs::read_dir(&store_dir).map_err(|error| {
        format!(
            "Unable to inspect attachment storage {}: {error}",
            store_dir.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Unable to read attachment storage entry: {error}"))?;
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Unable to inspect attachment file metadata: {error}"))?;
        if metadata.is_file() {
            file_count += 1;
            total_size_bytes += metadata.len();
        }
    }

    Ok(AttachmentStorageStats {
        file_count,
        total_size_bytes,
    })
}

#[tauri::command]
fn update_tracker_settings(
    app: AppHandle,
    state: State<'_, SaveLock>,
    payload: TrackerSettings,
    expected_revision: Option<u64>,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let db_path = shared_db_path(&app)?;
    let mut backup_path = None;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        let mut database = read_database_unlocked(db_path)?;
        ensure_database_revision_is_current(&database, expected_revision)?;
        let sanitized_settings = sanitize_settings(payload)?;
        validate_settings_compatibility(&sanitized_settings, &database.records)?;
        backup_path = create_database_backup(db_path)?;
        database.settings = sanitized_settings;
        persist_database(db_path, &database)?;
        Ok(database.records.len())
    })?;

    submit_result(&db_path, record_count, backup_path)
}

#[tauri::command]
fn relabel_tracker_settings(
    app: AppHandle,
    state: State<'_, SaveLock>,
    payload: TrackerSettings,
    replacements: Vec<SettingsRelabelInput>,
    expected_revision: Option<u64>,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let db_path = shared_db_path(&app)?;
    let mut backup_path = None;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        let mut database = read_database_unlocked(db_path)?;
        ensure_database_revision_is_current(&database, expected_revision)?;
        let sanitized_settings = sanitize_settings(payload)?;
        apply_settings_relabels(&mut database.records, &replacements)?;
        validate_settings_compatibility(&sanitized_settings, &database.records)?;
        backup_path = create_database_backup(db_path)?;
        database.settings = sanitized_settings;
        persist_database(db_path, &database)?;
        Ok(database.records.len())
    })?;

    submit_result(&db_path, record_count, backup_path)
}

#[tauri::command]
fn read_attachments_from_paths(paths: Vec<String>) -> Result<Vec<Attachment>, String> {
    paths
        .into_iter()
        .map(|path| {
            let path_buf = PathBuf::from(&path);
            let metadata = fs::metadata(&path_buf).map_err(|error| {
                format!(
                    "Unable to inspect dropped file {}: {error}",
                    path_buf.display()
                )
            })?;

            if !metadata.is_file() {
                return Err(format!(
                    "Dropped path is not a file: {}",
                    path_buf.display()
                ));
            }

            let bytes = fs::read(&path_buf).map_err(|error| {
                format!(
                    "Unable to read dropped file {}: {error}",
                    path_buf.display()
                )
            })?;

            let file_name = path_buf
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| format!("Unable to determine file name for {}", path_buf.display()))?
                .to_string();

            Ok(Attachment {
                id: Uuid::new_v4().to_string(),
                file_name,
                mime_type: "application/octet-stream".to_string(),
                size_bytes: bytes.len(),
                storage_id: String::new(),
                base64_data: STANDARD.encode(bytes),
            })
        })
        .collect()
}

#[tauri::command]
fn read_attachment_data(
    app: AppHandle,
    record_id: String,
    attachment_id: String,
    comment_id: Option<String>,
) -> Result<AttachmentData, String> {
    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for attachment reads".to_string());
    }

    let attachment_id = attachment_id.trim().to_string();
    if attachment_id.is_empty() {
        return Err("Attachment id is required for attachment reads".to_string());
    }

    let db_path = shared_db_path(&app)?;
    ensure_database_file_exists(&db_path)?;
    let database = read_database(&db_path)?;
    let record = database
        .records
        .iter()
        .find(|record| record.id == record_id)
        .ok_or_else(|| format!("Record '{}' was not found", record_id))?;

    let attachment = if let Some(comment_id) = comment_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        record
            .comments
            .iter()
            .find(|comment| comment.id == comment_id)
            .and_then(|comment| {
                comment
                    .attachments
                    .iter()
                    .find(|attachment| attachment.id == attachment_id)
            })
            .ok_or_else(|| {
                format!(
                    "Attachment '{}' was not found on comment '{}'",
                    attachment_id, comment_id
                )
            })?
    } else {
        record
            .attachments
            .iter()
            .find(|attachment| attachment.id == attachment_id)
            .ok_or_else(|| format!("Attachment '{}' was not found", attachment_id))?
    };

    Ok(AttachmentData {
        id: attachment.id.clone(),
        file_name: attachment.file_name.clone(),
        mime_type: attachment.mime_type.clone(),
        size_bytes: attachment.size_bytes,
        base64_data: attachments::read_base64(&db_path, attachment)?,
    })
}

#[tauri::command]
fn submit_activity(
    app: AppHandle,
    state: State<'_, SaveLock>,
    payload: ActivityInput,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let db_path = shared_db_path(&app)?;
    let record_count =
        with_exclusive_db_lock(&db_path, |db_path| write_activity_record(db_path, payload))?;

    submit_result(&db_path, record_count, None)
}

fn default_debug_category_values() -> Vec<String> {
    vec!["HW".to_string(), "SW".to_string(), "System".to_string()]
}

fn default_outcome_values() -> Vec<String> {
    vec![
        "Root cause found".to_string(),
        "Issue reproduced".to_string(),
        "Workaround identified".to_string(),
        "Fix identified".to_string(),
        "Workaround validated".to_string(),
        "Fix validated".to_string(),
        "Degraded performance".to_string(),
    ]
}

fn default_debug_settings() -> DebugSettings {
    DebugSettings {
        categories: default_debug_category_values(),
        outcome_options: default_outcome_values(),
    }
}

#[tauri::command]
fn get_debug_settings(app: AppHandle) -> Result<DebugSettings, String> {
    let db_path = shared_db_path(&app)?;
    ensure_database_file_exists(&db_path)?;
    let database = read_database(&db_path)?;
    Ok(database.debug_settings)
}

#[tauri::command]
fn update_debug_settings(
    app: AppHandle,
    state: State<'_, SaveLock>,
    payload: DebugSettings,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        let mut database = read_database_unlocked(db_path)?;
        let sanitized = sanitize_debug_settings(payload)?;
        // Validate existing records against new settings
        for record in &database.debug_records {
            for cat in &record.category {
                if !sanitized.categories.contains(cat) {
                    return Err(format!(
                        "Category '{}' is used by existing debug records. Remove its usages first.",
                        cat
                    ));
                }
            }
            for out in &record.outcome {
                if !sanitized.outcome_options.contains(out) {
                    return Err(format!(
                        "Outcome '{}' is used by existing debug records. Remove its usages first.",
                        out
                    ));
                }
            }
        }
        database.debug_settings = sanitized;
        persist_database(db_path, &database)?;
        Ok(database.records.len())
    })?;

    submit_result(&db_path, record_count, None)
}

fn sanitize_debug_settings(mut settings: DebugSettings) -> Result<DebugSettings, String> {
    settings.categories = sanitize_string_list(settings.categories);
    settings.outcome_options = sanitize_string_list(settings.outcome_options);

    if settings.categories.is_empty() {
        return Err("Add at least one debug category.".to_string());
    }
    if settings.outcome_options.is_empty() {
        return Err("Add at least one outcome option.".to_string());
    }

    Ok(settings)
}

#[tauri::command]
fn get_debug_records(app: AppHandle) -> Result<Vec<DebugRecord>, String> {
    let db_path = shared_db_path(&app)?;
    ensure_database_file_exists(&db_path)?;
    let database = read_database(&db_path)?;
    let mut records = database.debug_records;
    records.sort_by(|left, right| right.submitted_at.cmp(&left.submitted_at));
    Ok(records)
}

#[tauri::command]
fn submit_debug_record(
    app: AppHandle,
    state: State<'_, SaveLock>,
    payload: DebugInput,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        write_debug_record(db_path, payload)
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn update_debug_record(
    app: AppHandle,
    state: State<'_, SaveLock>,
    record_id: String,
    payload: DebugInput,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for updates".to_string());
    }

    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        update_debug_record_in_db(db_path, &record_id, payload)
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn delete_debug_record(
    app: AppHandle,
    state: State<'_, SaveLock>,
    record_id: String,
    expected_last_modified_at: Option<String>,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for deletion".to_string());
    }

    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        let mut database = read_database_unlocked(db_path)?;
        let record = database
            .debug_records
            .iter()
            .find(|r| r.id == record_id)
            .ok_or_else(|| format!("Debug record '{}' was not found", record_id))?;

        let expected = expected_last_modified_at
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .ok_or_else(|| {
                format!(
                    "Missing concurrency token for debug record '{}'. Refresh and try again.",
                    record_id
                )
            })?;

        let current = if record.last_modified_at.trim().is_empty() {
            record.submitted_at.as_str()
        } else {
            record.last_modified_at.as_str()
        };

        if current != expected {
            return Err(format!(
                "Concurrency conflict: debug record '{}' was modified concurrently. Refresh and try again.",
                record_id
            ));
        }

        let starting_len = database.debug_records.len();
        database.debug_records.retain(|r| r.id != record_id);
        if database.debug_records.len() == starting_len {
            return Err(format!("Debug record '{}' was not found", record_id));
        }

        persist_database(db_path, &database)?;
        Ok(database.records.len())
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn read_debug_attachment_data(
    app: AppHandle,
    record_id: String,
    attachment_id: String,
) -> Result<AttachmentData, String> {
    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required".to_string());
    }
    let attachment_id = attachment_id.trim().to_string();
    if attachment_id.is_empty() {
        return Err("Attachment id is required".to_string());
    }

    let db_path = shared_db_path(&app)?;
    ensure_database_file_exists(&db_path)?;
    let database = read_database(&db_path)?;
    let record = database
        .debug_records
        .iter()
        .find(|r| r.id == record_id)
        .ok_or_else(|| format!("Debug record '{}' was not found", record_id))?;
    let attachment = record
        .attachments
        .iter()
        .find(|a| a.id == attachment_id)
        .ok_or_else(|| format!("Attachment '{}' was not found", attachment_id))?;

    Ok(AttachmentData {
        id: attachment.id.clone(),
        file_name: attachment.file_name.clone(),
        mime_type: attachment.mime_type.clone(),
        size_bytes: attachment.size_bytes,
        base64_data: attachments::read_base64(&db_path, attachment)?,
    })
}

fn sanitize_and_validate_debug(
    mut payload: DebugInput,
    tracker_settings: &TrackerSettings,
    debug_settings: &DebugSettings,
) -> Result<DebugInput, String> {
    payload.start_date = payload.start_date.trim().to_string();
    payload.end_date = payload.end_date.trim().to_string();
    payload.description = payload.description.trim().to_string();
    payload.supplier = payload.supplier.trim().to_string();
    payload.component = payload.component.trim().to_string();
    payload.occurrence_phase = payload.occurrence_phase.trim().to_string();
    payload.projects = sanitize_string_list(payload.projects);
    payload.departments = sanitize_string_list(payload.departments);
    payload.category = sanitize_string_list(payload.category);
    payload.outcome = sanitize_string_list(payload.outcome);
    payload.linked_activity_ids = sanitize_string_list(payload.linked_activity_ids);
    payload.attachments = sanitize_attachments(payload.attachments);
    for lesson in &mut payload.lessons_learnt {
        lesson.text = lesson.text.trim().to_string();
        lesson.category = lesson.category.trim().to_string();
        if lesson.id.is_empty() {
            lesson.id = Uuid::new_v4().to_string();
        }
        lesson.attachments = sanitize_attachments(lesson.attachments.clone());
    }
    payload.expected_last_modified_at = payload
        .expected_last_modified_at
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if payload.projects.is_empty() {
        return Err("Select at least one project".to_string());
    }
    validate_allowed_values(&payload.projects, &tracker_settings.projects, "Project")?;

    if payload.start_date.is_empty() || payload.end_date.is_empty() {
        return Err("Start date and end date are required".to_string());
    }
    let start_date = NaiveDate::parse_from_str(&payload.start_date, "%Y-%m-%d")
        .map_err(|_| "Start date must use the YYYY-MM-DD format".to_string())?;
    let end_date = NaiveDate::parse_from_str(&payload.end_date, "%Y-%m-%d")
        .map_err(|_| "End date must use the YYYY-MM-DD format".to_string())?;
    if end_date < start_date {
        return Err("End date cannot be earlier than start date".to_string());
    }

    if payload.category.is_empty() {
        return Err("Select at least one category".to_string());
    }
    validate_allowed_values(&payload.category, &debug_settings.categories, "Debug category")?;

    if payload.description.len() < 10 {
        return Err("Description must contain at least 10 characters".to_string());
    }

    if payload.departments.is_empty() {
        return Err("Select at least one department".to_string());
    }
    validate_allowed_values(&payload.departments, &tracker_settings.departments, "Department")?;

    for entry in &payload.supplier_rating {
        if !(0.0..=5.0).contains(&entry.rating) || (entry.rating * 2.0).fract() != 0.0 {
            return Err(format!(
                "Supplier rating for '{}' must be a multiple of 0.5 between 0 and 5",
                entry.label
            ));
        }
    }

    validate_allowed_values(&payload.outcome, &debug_settings.outcome_options, "Outcome")?;
    payload.demerit = payload.demerit.trim().to_uppercase();
    if payload.demerit.is_empty() {
        payload.demerit = default_demerit_value();
    } else if !DEMERIT_VALUES.contains(&payload.demerit.as_str()) {
        let numeric_alias = format!("DEM{}", payload.demerit);
        if DEMERIT_VALUES.contains(&numeric_alias.as_str()) {
            payload.demerit = numeric_alias;
        } else {
            return Err("Demerit must be one of DEM100, DEM40, DEM20FS, DEM20, DEM10FS, DEM10, DEM1, or NA".to_string());
        }
    }

    validate_attachments(&payload.attachments, "record")?;

    Ok(payload)
}

fn default_demerit_value() -> String {
    "NA".to_string()
}

fn normalize_demerit_value(value: &str) -> String {
    let normalized = value.trim().to_uppercase();
    if normalized.is_empty() {
        return default_demerit_value();
    }
    if DEMERIT_VALUES.contains(&normalized.as_str()) {
        return normalized;
    }
    let numeric_alias = format!("DEM{normalized}");
    if DEMERIT_VALUES.contains(&numeric_alias.as_str()) {
        return numeric_alias;
    }
    default_demerit_value()
}

fn deserialize_demerit<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    let demerit = match value {
        serde_json::Value::String(text) => normalize_demerit_value(&text),
        serde_json::Value::Number(number) => normalize_demerit_value(&number.to_string()),
        serde_json::Value::Null => default_demerit_value(),
        _ => default_demerit_value(),
    };
    Ok(demerit)
}

fn write_debug_record(db_path: &Path, payload: DebugInput) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;
    let mut payload =
        sanitize_and_validate_debug(payload, &database.settings, &database.debug_settings)?;
    payload.attachments = attachments::externalize(db_path, payload.attachments)?;

    let created_at = now_rfc3339();
    database.debug_records.push(DebugRecord {
        id: Uuid::new_v4().to_string(),
        submitted_at: created_at.clone(),
        projects: payload.projects,
        start_date: payload.start_date,
        end_date: payload.end_date,
        category: payload.category,
        description: payload.description,
        attachments: payload.attachments,
        supplier: payload.supplier,
        component: payload.component,
        departments: payload.departments,
        supplier_rating: payload.supplier_rating,
        outcome: payload.outcome,
        last_modified_at: created_at,
        occurrence_phase: payload.occurrence_phase,
        demerit: payload.demerit,
        linked_activity_ids: payload.linked_activity_ids,
        lessons_learnt: payload.lessons_learnt,
    });

    persist_database(db_path, &database)?;
    Ok(database.records.len())
}

fn update_debug_record_in_db(db_path: &Path, record_id: &str, payload: DebugInput) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;
    let mut payload =
        sanitize_and_validate_debug(payload, &database.settings, &database.debug_settings)?;
    payload.attachments = attachments::externalize(db_path, payload.attachments)?;

    let record = database
        .debug_records
        .iter_mut()
        .find(|r| r.id == record_id)
        .ok_or_else(|| format!("Debug record '{}' was not found", record_id))?;

    let expected = payload
        .expected_last_modified_at
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            format!(
                "Missing concurrency token for debug record '{}'. Refresh and try again.",
                record_id
            )
        })?;

    let current = if record.last_modified_at.trim().is_empty() {
        record.submitted_at.as_str()
    } else {
        record.last_modified_at.as_str()
    };

    if current != expected {
        return Err(format!(
            "Concurrency conflict: debug record '{}' was modified concurrently. Refresh and try again.",
            record_id
        ));
    }

    record.projects = payload.projects;
    record.start_date = payload.start_date;
    record.end_date = payload.end_date;
    record.category = payload.category;
    record.description = payload.description;
    record.attachments = payload.attachments;
    record.supplier = payload.supplier;
    record.component = payload.component;
    record.departments = payload.departments;
    record.supplier_rating = payload.supplier_rating;
    record.outcome = payload.outcome;
    record.occurrence_phase = payload.occurrence_phase;
    record.demerit = payload.demerit;
    record.linked_activity_ids = payload.linked_activity_ids;
    record.lessons_learnt = payload.lessons_learnt;
    record.last_modified_at = now_rfc3339();

    persist_database(db_path, &database)?;
    Ok(database.records.len())
}

fn default_status() -> String {
    "Open".to_string()
}

fn default_reminder_cadence() -> String {
    "None".to_string()
}

fn default_schema_version() -> u32 {
    1
}

fn parse_embedded_list(content: &str) -> Vec<String> {
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(ToOwned::to_owned)
        .collect()
}

fn default_owner_values() -> Vec<String> {
    parse_embedded_list(include_str!("../resources/lists/owners.txt"))
}

fn default_project_values() -> Vec<String> {
    parse_embedded_list(include_str!("../resources/lists/projects.txt"))
}

fn default_department_values() -> Vec<String> {
    parse_embedded_list(include_str!("../resources/lists/departments.txt"))
}

fn default_category_values() -> Vec<String> {
    parse_embedded_list(include_str!("../resources/lists/categories.txt"))
}

fn default_category_impact_factor_values() -> BTreeMap<String, f64> {
    default_category_values()
        .into_iter()
        .map(|category| (category, 1.0))
        .collect()
}

fn default_priority_values() -> Vec<String> {
    vec![
        "Low".to_string(),
        "Normal".to_string(),
        "High".to_string(),
        "Critical".to_string(),
    ]
}

fn default_effort_values() -> Vec<String> {
    vec!["Low".to_string(), "Mid".to_string(), "High".to_string()]
}

fn default_impact_values() -> Vec<String> {
    default_effort_values()
}

fn default_status_values() -> Vec<String> {
    vec![
        "Scheduled".to_string(),
        "Open".to_string(),
        "On Hold".to_string(),
        "Halted".to_string(),
        "Completed".to_string(),
    ]
}

fn default_reminder_cadence_values() -> Vec<ReminderCadenceOption> {
    vec![
        ReminderCadenceOption {
            label: "None".to_string(),
            interval_days: 0,
        },
        ReminderCadenceOption {
            label: "Weekly".to_string(),
            interval_days: 7,
        },
        ReminderCadenceOption {
            label: "Biweekly".to_string(),
            interval_days: 14,
        },
        ReminderCadenceOption {
            label: "Monthly".to_string(),
            interval_days: 30,
        },
    ]
}

fn default_tracker_settings() -> TrackerSettings {
    TrackerSettings {
        owners: default_owner_values(),
        projects: default_project_values(),
        departments: default_department_values(),
        categories: default_category_values(),
        category_impact_factors: default_category_impact_factor_values(),
        priorities: default_priority_values(),
        efforts: default_effort_values(),
        impacts: default_impact_values(),
        statuses: default_status_values(),
        reminder_cadences: default_reminder_cadence_values(),
    }
}

fn default_tracker_database() -> TrackerDatabase {
    TrackerDatabase {
        schema_version: default_schema_version(),
        revision: 0,
        settings: default_tracker_settings(),
        records: Vec::new(),
        debug_records: Vec::new(),
        debug_settings: default_debug_settings(),
    }
}

fn default_db_file_name() -> &'static str {
    "activity-db.json"
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn default_comment_author() -> String {
    "Unknown user".to_string()
}

fn current_account_name() -> String {
    ["USERNAME", "USER", "LOGNAME"]
        .iter()
        .find_map(|key| {
            env::var(key)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(default_comment_author)
}

fn history_entry(kind: &str, message: String) -> RecordHistoryEntry {
    RecordHistoryEntry {
        id: Uuid::new_v4().to_string(),
        created_at: now_rfc3339(),
        kind: kind.to_string(),
        message,
    }
}

fn record_last_update_timestamp(record: &ActivityRecord) -> String {
    record
        .comments
        .iter()
        .map(|comment| comment.created_at.as_str())
        .chain(record.todos.iter().map(|todo| todo.updated_at.as_str()))
        .chain(record.todos.iter().map(|todo| todo.created_at.as_str()))
        .chain(record.history.iter().map(|entry| entry.created_at.as_str()))
        .chain(std::iter::once(record.submitted_at.as_str()))
        .max()
        .unwrap_or(record.submitted_at.as_str())
        .to_string()
}

fn record_concurrency_token(record: &ActivityRecord) -> &str {
    if record.last_modified_at.trim().is_empty() {
        record.submitted_at.as_str()
    } else {
        record.last_modified_at.as_str()
    }
}

fn ensure_record_is_current(
    record: &ActivityRecord,
    expected_last_modified_at: Option<&str>,
) -> Result<(), String> {
    let expected = expected_last_modified_at
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "Missing concurrency token for record '{}'. Refresh the record and try again.",
                record.id
            )
        })?;

    let current = record_concurrency_token(record);
    if current == expected {
        return Ok(());
    }

    Err(format!(
        "Concurrency conflict: record '{}' was modified by another user at {}. Refresh the records and reopen the item before saving again.",
        record.id, current
    ))
}

fn ensure_database_revision_is_current(
    database: &TrackerDatabase,
    expected_revision: Option<u64>,
) -> Result<(), String> {
    if let Some(expected_revision) = expected_revision {
        if database.revision != expected_revision {
            return Err(format!(
                "Database conflict: the tracker database changed from revision {} to {}. Refresh and try again.",
                expected_revision, database.revision
            ));
        }
    }

    Ok(())
}

#[tauri::command]
fn update_activity(
    app: AppHandle,
    state: State<'_, SaveLock>,
    record_id: String,
    payload: ActivityInput,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for updates".to_string());
    }

    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        update_activity_record(db_path, &record_id, payload)
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn quick_update_activity(
    app: AppHandle,
    state: State<'_, SaveLock>,
    record_id: String,
    payload: QuickUpdateInput,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for quick updates".to_string());
    }

    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        quick_update_activity_record(db_path, &record_id, payload)
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn append_activity_comment(
    app: AppHandle,
    state: State<'_, SaveLock>,
    record_id: String,
    payload: CommentInput,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for comments".to_string());
    }

    let payload = sanitize_and_validate_comment(payload)?;
    let author = current_account_name();
    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        append_comment_to_activity_record(db_path, &record_id, payload, author)
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn update_activity_comment(
    app: AppHandle,
    state: State<'_, SaveLock>,
    record_id: String,
    comment_id: String,
    payload: CommentInput,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for comment updates".to_string());
    }

    let comment_id = comment_id.trim().to_string();
    if comment_id.is_empty() {
        return Err("Comment id is required for comment updates".to_string());
    }

    let payload = sanitize_and_validate_comment(payload)?;
    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        update_comment_in_activity_record(db_path, &record_id, &comment_id, payload)
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn delete_activity_comment(
    app: AppHandle,
    state: State<'_, SaveLock>,
    record_id: String,
    comment_id: String,
    expected_last_modified_at: Option<String>,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for comment deletion".to_string());
    }

    let comment_id = comment_id.trim().to_string();
    if comment_id.is_empty() {
        return Err("Comment id is required for comment deletion".to_string());
    }

    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        delete_comment_from_activity_record(
            db_path,
            &record_id,
            &comment_id,
            expected_last_modified_at.as_deref(),
        )
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn append_activity_todo(
    app: AppHandle,
    state: State<'_, SaveLock>,
    record_id: String,
    payload: TodoInput,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for todos".to_string());
    }

    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        append_todo_to_activity_record(db_path, &record_id, payload)
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn update_activity_todo(
    app: AppHandle,
    state: State<'_, SaveLock>,
    record_id: String,
    todo_id: String,
    payload: TodoInput,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for todo updates".to_string());
    }

    let todo_id = todo_id.trim().to_string();
    if todo_id.is_empty() {
        return Err("Todo id is required for todo updates".to_string());
    }

    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        update_todo_in_activity_record(db_path, &record_id, &todo_id, payload)
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn delete_activity_todo(
    app: AppHandle,
    state: State<'_, SaveLock>,
    record_id: String,
    todo_id: String,
    expected_last_modified_at: Option<String>,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let record_id = record_id.trim().to_string();
    if record_id.is_empty() {
        return Err("Record id is required for todo deletion".to_string());
    }

    let todo_id = todo_id.trim().to_string();
    if todo_id.is_empty() {
        return Err("Todo id is required for todo deletion".to_string());
    }

    let db_path = shared_db_path(&app)?;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        delete_todo_from_activity_record(
            db_path,
            &record_id,
            &todo_id,
            expected_last_modified_at.as_deref(),
        )
    })?;

    submit_result(&db_path, record_count, None)
}

#[tauri::command]
fn replace_database_records(
    app: AppHandle,
    state: State<'_, SaveLock>,
    records: Vec<ActivityRecord>,
    settings: Option<TrackerSettings>,
    debug_records: Option<Vec<DebugRecord>>,
    debug_settings: Option<DebugSettings>,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let db_path = shared_db_path(&app)?;
    let mut backup_path = None;
    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        backup_path = create_database_backup(db_path)?;
        replace_records_in_database(db_path, records, settings, debug_records, debug_settings)
    })?;

    submit_result(&db_path, record_count, backup_path)
}

#[tauri::command]
fn restore_database_backup(
    app: AppHandle,
    state: State<'_, SaveLock>,
    backup_path: String,
) -> Result<SubmitResult, String> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| "Unable to acquire the save lock".to_string())?;

    let requested_backup_path = backup_path.trim();
    if requested_backup_path.is_empty() {
        return Err("Backup path is required".to_string());
    }

    let db_path = shared_db_path(&app)?;
    let validated_backup_path = validate_backup_path(&db_path, Path::new(requested_backup_path))?;
    let mut created_backup_path = None;

    let record_count = with_exclusive_db_lock(&db_path, |db_path| {
        let database = read_database_unlocked(&validated_backup_path)?;
        created_backup_path = create_database_backup(db_path)?;
        persist_database(db_path, &database)?;
        Ok(database.records.len())
    })?;

    submit_result(&db_path, record_count, created_backup_path)
}

fn submit_result(
    db_path: &Path,
    record_count: usize,
    backup_path: Option<String>,
) -> Result<SubmitResult, String> {
    let db_revision = read_database(db_path)?.revision;

    Ok(SubmitResult {
        db_path: db_path.display().to_string(),
        db_revision,
        record_count,
        backup_path,
    })
}

fn ensure_database_file_exists(db_path: &Path) -> Result<(), String> {
    if db_path.exists() {
        return Ok(());
    }

    with_exclusive_db_lock(db_path, |db_path| {
        if db_path.exists() {
            return Ok(());
        }

        persist_database(db_path, &default_tracker_database())
    })
}

fn with_exclusive_db_lock<T, F>(db_path: &Path, action: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String>,
{
    ensure_database_directory(db_path)?;
    let lock_file = open_db_lock_file(db_path)?;
    lock_file
        .lock_exclusive()
        .map_err(|error| format!("Unable to lock the database file: {error}"))?;

    let action_result = action(db_path);
    let unlock_result = lock_file.unlock();

    let value = action_result?;
    unlock_result.map_err(|error| format!("Unable to unlock the database file: {error}"))?;
    Ok(value)
}

fn with_shared_db_lock<T, F>(db_path: &Path, action: F) -> Result<T, String>
where
    F: FnOnce(&Path) -> Result<T, String>,
{
    ensure_database_directory(db_path)?;
    let lock_file = open_db_lock_file(db_path)?;
    lock_file
        .lock_shared()
        .map_err(|error| format!("Unable to lock the database file for reading: {error}"))?;

    let action_result = action(db_path);
    let unlock_result = lock_file.unlock();

    let value = action_result?;
    unlock_result
        .map_err(|error| format!("Unable to unlock the database file after reading: {error}"))?;
    Ok(value)
}

fn open_db_lock_file(db_path: &Path) -> Result<File, String> {
    let lock_path = db_lock_path(db_path);
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&lock_path)
        .map_err(|error| {
            format!(
                "Unable to open database lock file {}: {error}",
                lock_path.display()
            )
        })
}

fn ensure_database_directory(db_path: &Path) -> Result<(), String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create database directory {}: {error}",
                parent.display()
            )
        })?;
    }

    Ok(())
}

fn db_lock_path(db_path: &Path) -> PathBuf {
    let file_name = db_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(default_db_file_name());

    match db_path.parent() {
        Some(parent) => parent.join(format!("{file_name}.lock")),
        None => PathBuf::from(format!("{file_name}.lock")),
    }
}

fn temporary_db_path(db_path: &Path) -> PathBuf {
    let file_name = db_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(default_db_file_name());

    match db_path.parent() {
        Some(parent) => parent.join(format!(".{file_name}.tmp-{}", Uuid::new_v4())),
        None => PathBuf::from(format!(".{file_name}.tmp-{}", Uuid::new_v4())),
    }
}

fn backup_db_path(db_path: &Path) -> PathBuf {
    let stem = db_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("activity-db");
    let extension = db_path.extension().and_then(|value| value.to_str());
    let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    let backup_file_name = match extension {
        Some(extension) if !extension.is_empty() => {
            format!("{stem}.backup-{timestamp}.{extension}")
        }
        _ => format!("{stem}.backup-{timestamp}"),
    };

    match db_path.parent() {
        Some(parent) => parent.join(backup_file_name),
        None => PathBuf::from(backup_file_name),
    }
}

fn backup_name_parts(db_path: &Path) -> (String, Option<String>) {
    let stem = db_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("activity-db")
        .to_string();
    let extension = db_path
        .extension()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned);

    (stem, extension)
}

fn is_database_backup_name(db_path: &Path, file_name: &str) -> bool {
    let (stem, extension) = backup_name_parts(db_path);
    let prefix = format!("{stem}.backup-");

    if !file_name.starts_with(&prefix) {
        return false;
    }

    match extension {
        Some(extension) if !extension.is_empty() => file_name.ends_with(&format!(".{extension}")),
        _ => true,
    }
}

fn list_database_backups_for(db_path: &Path) -> Result<Vec<DatabaseBackup>, String> {
    let Some(parent) = db_path.parent() else {
        return Ok(Vec::new());
    };

    if !parent.exists() {
        return Ok(Vec::new());
    }

    let mut backups = fs::read_dir(parent)
        .map_err(|error| {
            format!(
                "Unable to list database backups in {}: {error}",
                parent.display()
            )
        })?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file() {
                return None;
            }

            let file_name = entry.file_name();
            let file_name = file_name.to_str()?.to_string();
            if !is_database_backup_name(db_path, &file_name) {
                return None;
            }

            let metadata = entry.metadata().ok()?;
            let modified_at = metadata.modified().ok()?;
            let modified_at = DateTime::<Utc>::from(modified_at).to_rfc3339();

            Some(DatabaseBackup {
                file_name,
                path: entry.path().display().to_string(),
                modified_at,
                size_bytes: metadata.len(),
            })
        })
        .collect::<Vec<_>>();

    backups.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| left.file_name.cmp(&right.file_name))
    });
    backups.truncate(8);

    Ok(backups)
}

fn validate_backup_path(db_path: &Path, requested_backup_path: &Path) -> Result<PathBuf, String> {
    let backup_path = fs::canonicalize(requested_backup_path).map_err(|error| {
        format!(
            "Unable to resolve the selected backup file {}: {error}",
            requested_backup_path.display()
        )
    })?;

    let parent = db_path
        .parent()
        .ok_or_else(|| "Unable to resolve the database directory".to_string())?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| {
        format!(
            "Unable to resolve the database directory {}: {error}",
            parent.display()
        )
    })?;

    if !backup_path.starts_with(&canonical_parent) {
        return Err("Selected backup is outside the tracker database directory".to_string());
    }

    let file_name = backup_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Selected backup has an invalid file name".to_string())?;

    if !is_database_backup_name(db_path, file_name) {
        return Err("Selected file is not a tracker database backup".to_string());
    }

    let metadata = fs::metadata(&backup_path).map_err(|error| {
        format!(
            "Unable to inspect backup file {}: {error}",
            backup_path.display()
        )
    })?;

    if !metadata.is_file() {
        return Err("Selected backup is not a file".to_string());
    }

    Ok(backup_path)
}

fn create_database_backup(db_path: &Path) -> Result<Option<String>, String> {
    if !db_path.exists() {
        return Ok(None);
    }

    let metadata = fs::metadata(db_path).map_err(|error| {
        format!(
            "Unable to inspect the existing database file {}: {error}",
            db_path.display()
        )
    })?;

    if !metadata.is_file() || metadata.len() == 0 {
        return Ok(None);
    }

    let backup_path = backup_db_path(db_path);
    fs::copy(db_path, &backup_path).map_err(|error| {
        format!(
            "Unable to create a backup of the database at {}: {error}",
            backup_path.display()
        )
    })?;

    Ok(Some(backup_path.display().to_string()))
}

fn persist_database(db_path: &Path, database: &TrackerDatabase) -> Result<(), String> {
    ensure_database_directory(db_path)?;
    let temp_path = temporary_db_path(db_path);
    let mut database_to_write = database.clone();
    database_to_write.revision = next_database_revision(db_path, database.revision);

    let write_result = (|| -> Result<(), String> {
        let mut temp_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| {
                format!(
                    "Unable to create a temporary database file {}: {error}",
                    temp_path.display()
                )
            })?;

        serde_json::to_writer_pretty(&mut temp_file, &database_to_write)
            .map_err(|error| format!("Unable to serialize the database content: {error}"))?;

        temp_file
            .write_all(b"\n")
            .map_err(|error| format!("Unable to finalize the database file: {error}"))?;
        temp_file
            .flush()
            .map_err(|error| format!("Unable to flush the database file: {error}"))?;
        temp_file
            .sync_all()
            .map_err(|error| format!("Unable to sync the database file: {error}"))?;

        drop(temp_file);
        replace_file_atomically(&temp_path, db_path)?;
        sync_parent_directory(db_path)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    write_result
}

fn next_database_revision(db_path: &Path, proposed_revision: u64) -> u64 {
    let current_revision = fs::read_to_string(db_path)
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|value| value.get("revision").and_then(serde_json::Value::as_u64))
        .unwrap_or(0);

    current_revision.max(proposed_revision).saturating_add(1)
}

#[cfg(not(windows))]
fn sync_parent_directory(path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };

    let directory = File::open(parent).map_err(|error| {
        format!(
            "Unable to open database directory {} for syncing: {error}",
            parent.display()
        )
    })?;

    directory.sync_all().map_err(|error| {
        format!(
            "Unable to sync database directory {}: {error}",
            parent.display()
        )
    })
}

#[cfg(windows)]
fn sync_parent_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, target: &Path) -> Result<(), String> {
    fs::rename(source, target).map_err(|error| {
        format!(
            "Unable to replace the database file {} with {}: {error}",
            target.display(),
            source.display()
        )
    })
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();

    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if result == 0 {
        return Err(format!(
            "Unable to replace the database file {} with {}: {}",
            target.display(),
            source.display(),
            std::io::Error::last_os_error()
        ));
    }

    Ok(())
}

fn read_database_unlocked(path: &Path) -> Result<TrackerDatabase, String> {
    if !path.exists() {
        return Ok(default_tracker_database());
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read database file {}: {error}", path.display()))?;

    if content.trim().is_empty() {
        return Ok(default_tracker_database());
    }

    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("Database file contains invalid JSON: {error}"))?;

    let database = if parsed.is_array() {
        TrackerDatabase {
            schema_version: default_schema_version(),
            revision: 0,
            settings: default_tracker_settings(),
            records: serde_json::from_value(parsed)
                .map_err(|error| format!("Database file contains invalid record JSON: {error}"))?,
            debug_records: Vec::new(),
            debug_settings: default_debug_settings(),
        }
    } else {
        serde_json::from_value(parsed).map_err(|error| {
            format!("Database file contains an invalid tracker document: {error}")
        })?
    };

    sanitize_database(database)
}

fn read_database(path: &Path) -> Result<TrackerDatabase, String> {
    with_shared_db_lock(path, read_database_unlocked)
}

fn read_records_unlocked(path: &Path) -> Result<Vec<ActivityRecord>, String> {
    Ok(read_database_unlocked(path)?.records)
}

fn write_activity_record(db_path: &Path, payload: ActivityInput) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;
    let mut payload = sanitize_and_validate(payload, &database.settings)?;
    payload.attachments = attachments::externalize(db_path, payload.attachments)?;

    let created_at = now_rfc3339();
    database.records.push(ActivityRecord {
        id: Uuid::new_v4().to_string(),
        submitted_at: created_at.clone(),
        title: payload.title,
        owner: payload.owner,
        projects: payload.projects,
        start_date: payload.start_date,
        end_date: payload.end_date,
        departments: payload.departments,
        description: payload.description,
        effort: payload.effort,
        impact: payload.impact,
        priority: payload.priority,
        status: payload.status,
        reminder_cadence: payload.reminder_cadence,
        categories: payload.categories,
        attachments: payload.attachments,
        lab_activity: payload.lab_activity,
        hw_development: payload.hw_development,
        sw_development: payload.sw_development,
        comments: Vec::new(),
        todos: Vec::new(),
        history: vec![history_entry("created", "Record created".to_string())],
        last_modified_at: created_at,
    });

    persist_database(db_path, &database)?;

    Ok(database.records.len())
}

fn append_comment_to_activity_record(
    db_path: &Path,
    record_id: &str,
    payload: CommentInput,
    author: String,
) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;

    let record = database
        .records
        .iter_mut()
        .find(|record| record.id == record_id)
        .ok_or_else(|| format!("Record '{}' was not found", record_id))?;
    ensure_record_is_current(record, payload.expected_last_modified_at.as_deref())?;

    let comment_created_at = payload.created_at.unwrap_or_else(now_rfc3339);
    let attachments = attachments::externalize(db_path, payload.attachments)?;
    record.comments.push(RecordComment {
        id: Uuid::new_v4().to_string(),
        created_at: comment_created_at.clone(),
        author,
        message: payload.message,
        attachments,
    });
    record
        .history
        .push(history_entry("comment_added", "Comment added".to_string()));
    record.last_modified_at = comment_created_at;

    persist_database(db_path, &database)?;

    Ok(database.records.len())
}

fn update_comment_in_activity_record(
    db_path: &Path,
    record_id: &str,
    comment_id: &str,
    payload: CommentInput,
) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;

    let record = database
        .records
        .iter_mut()
        .find(|record| record.id == record_id)
        .ok_or_else(|| format!("Record '{}' was not found", record_id))?;
    ensure_record_is_current(record, payload.expected_last_modified_at.as_deref())?;

    let comment = record
        .comments
        .iter_mut()
        .find(|comment| comment.id == comment_id)
        .ok_or_else(|| format!("Comment '{}' was not found", comment_id))?;

    comment.message = payload.message;
    if let Some(created_at) = payload.created_at {
        comment.created_at = created_at;
    }
    if !payload.attachments.is_empty() {
        comment.attachments = attachments::externalize(db_path, payload.attachments)?;
    }
    record.history.push(history_entry(
        "comment_updated",
        "Comment updated".to_string(),
    ));
    record.last_modified_at = now_rfc3339();

    persist_database(db_path, &database)?;

    Ok(database.records.len())
}

fn delete_comment_from_activity_record(
    db_path: &Path,
    record_id: &str,
    comment_id: &str,
    expected_last_modified_at: Option<&str>,
) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;

    let record = database
        .records
        .iter_mut()
        .find(|record| record.id == record_id)
        .ok_or_else(|| format!("Record '{}' was not found", record_id))?;
    ensure_record_is_current(record, expected_last_modified_at)?;

    let starting_len = record.comments.len();
    record.comments.retain(|comment| comment.id != comment_id);

    if record.comments.len() == starting_len {
        return Err(format!("Comment '{}' was not found", comment_id));
    }
    record.history.push(history_entry(
        "comment_deleted",
        "Comment deleted".to_string(),
    ));
    record.last_modified_at = now_rfc3339();

    persist_database(db_path, &database)?;

    Ok(database.records.len())
}

fn append_todo_to_activity_record(
    db_path: &Path,
    record_id: &str,
    payload: TodoInput,
) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;
    let payload = sanitize_and_validate_todo(payload, &database.settings)?;

    let record = database
        .records
        .iter_mut()
        .find(|record| record.id == record_id)
        .ok_or_else(|| format!("Record '{}' was not found", record_id))?;
    ensure_record_is_current(record, payload.expected_last_modified_at.as_deref())?;

    let created_at = now_rfc3339();
    record.todos.push(RecordTodo {
        id: Uuid::new_v4().to_string(),
        created_at: created_at.clone(),
        updated_at: created_at.clone(),
        text: payload.text,
        owner: payload.owner,
        due_date: payload.due_date.unwrap_or_default(),
        completed: payload.completed.unwrap_or(false),
        completed_at: String::new(),
    });
    record
        .history
        .push(history_entry("todo_added", "Todo added".to_string()));
    record.last_modified_at = created_at;

    persist_database(db_path, &database)?;

    Ok(database.records.len())
}

fn update_todo_in_activity_record(
    db_path: &Path,
    record_id: &str,
    todo_id: &str,
    payload: TodoInput,
) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;
    let payload = sanitize_and_validate_todo(payload, &database.settings)?;

    let record = database
        .records
        .iter_mut()
        .find(|record| record.id == record_id)
        .ok_or_else(|| format!("Record '{}' was not found", record_id))?;
    ensure_record_is_current(record, payload.expected_last_modified_at.as_deref())?;

    let todo = record
        .todos
        .iter_mut()
        .find(|todo| todo.id == todo_id)
        .ok_or_else(|| format!("Todo '{}' was not found", todo_id))?;

    let was_completed = todo.completed;
    let next_completed = payload.completed.unwrap_or(todo.completed);
    let updated_at = now_rfc3339();

    todo.text = payload.text;
    todo.owner = payload.owner;
    todo.due_date = payload.due_date.unwrap_or_default();
    todo.completed = next_completed;
    todo.updated_at = updated_at.clone();
    if next_completed && !was_completed {
        todo.completed_at = updated_at.clone();
    } else if !next_completed {
        todo.completed_at = String::new();
    }

    record.history.push(history_entry(
        if next_completed && !was_completed {
            "todo_completed"
        } else {
            "todo_updated"
        },
        if next_completed && !was_completed {
            "Todo completed".to_string()
        } else {
            "Todo updated".to_string()
        },
    ));
    record.last_modified_at = updated_at;

    persist_database(db_path, &database)?;

    Ok(database.records.len())
}

fn delete_todo_from_activity_record(
    db_path: &Path,
    record_id: &str,
    todo_id: &str,
    expected_last_modified_at: Option<&str>,
) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;

    let record = database
        .records
        .iter_mut()
        .find(|record| record.id == record_id)
        .ok_or_else(|| format!("Record '{}' was not found", record_id))?;
    ensure_record_is_current(record, expected_last_modified_at)?;

    let starting_len = record.todos.len();
    record.todos.retain(|todo| todo.id != todo_id);

    if record.todos.len() == starting_len {
        return Err(format!("Todo '{}' was not found", todo_id));
    }
    record
        .history
        .push(history_entry("todo_deleted", "Todo deleted".to_string()));
    record.last_modified_at = now_rfc3339();

    persist_database(db_path, &database)?;

    Ok(database.records.len())
}

fn update_activity_record(
    db_path: &Path,
    record_id: &str,
    payload: ActivityInput,
) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;
    let mut payload = sanitize_and_validate(payload, &database.settings)?;
    payload.attachments = attachments::externalize(db_path, payload.attachments)?;

    let record = database
        .records
        .iter_mut()
        .find(|record| record.id == record_id)
        .ok_or_else(|| format!("Record '{}' was not found", record_id))?;
    ensure_record_is_current(record, payload.expected_last_modified_at.as_deref())?;

    let mut changed_fields = Vec::new();
    if record.title != payload.title {
        changed_fields.push("title");
    }
    if record.owner != payload.owner {
        changed_fields.push("owner");
    }
    if record.projects != payload.projects {
        changed_fields.push("projects");
    }
    if record.start_date != payload.start_date || record.end_date != payload.end_date {
        changed_fields.push("dates");
    }
    if record.departments != payload.departments {
        changed_fields.push("departments");
    }
    if record.description != payload.description {
        changed_fields.push("description");
    }
    if record.effort != payload.effort {
        changed_fields.push("effort");
    }
    if record.impact != payload.impact {
        changed_fields.push("impact");
    }
    if record.priority != payload.priority {
        changed_fields.push("priority");
    }
    if record.status != payload.status {
        changed_fields.push("status");
    }
    if record.reminder_cadence != payload.reminder_cadence {
        changed_fields.push("reminder");
    }
    if record.categories != payload.categories {
        changed_fields.push("categories");
    }
    if record.attachments != payload.attachments {
        changed_fields.push("attachments");
    }

    record.title = payload.title;
    record.owner = payload.owner;
    record.projects = payload.projects;
    record.start_date = payload.start_date;
    record.end_date = payload.end_date;
    record.departments = payload.departments;
    record.description = payload.description;
    record.effort = payload.effort;
    record.impact = payload.impact;
    record.priority = payload.priority;
    record.status = payload.status;
    record.reminder_cadence = payload.reminder_cadence;
    record.categories = payload.categories;
    record.attachments = payload.attachments;
    record.lab_activity = payload.lab_activity;
    record.hw_development = payload.hw_development;
    record.sw_development = payload.sw_development;
    record.history.push(history_entry(
        "record_updated",
        if changed_fields.is_empty() {
            "Record saved with no material field changes".to_string()
        } else {
            format!("Updated {}", changed_fields.join(", "))
        },
    ));
    record.last_modified_at = now_rfc3339();

    persist_database(db_path, &database)?;

    Ok(database.records.len())
}

fn quick_update_activity_record(
    db_path: &Path,
    record_id: &str,
    payload: QuickUpdateInput,
) -> Result<usize, String> {
    let mut database = read_database_unlocked(db_path)?;
    let payload = sanitize_and_validate_quick_update(payload, &database.settings)?;

    let record = database
        .records
        .iter_mut()
        .find(|record| record.id == record_id)
        .ok_or_else(|| format!("Record '{}' was not found", record_id))?;
    ensure_record_is_current(record, payload.expected_last_modified_at.as_deref())?;

    let mut changes = Vec::new();

    if let Some(owner) = payload.owner {
        if record.owner != owner {
            changes.push(format!("owner to '{}'", owner));
            record.owner = owner;
        }
    }

    if let Some(status) = payload.status {
        if record.status != status {
            changes.push(format!("status to '{}'", status));
            record.status = status;
        }
    }

    if let Some(reminder_cadence) = payload.reminder_cadence {
        if record.reminder_cadence != reminder_cadence {
            changes.push(format!("reminder cadence to '{}'", reminder_cadence));
            record.reminder_cadence = reminder_cadence;
        }
    }

    if !changes.is_empty() {
        record.history.push(history_entry(
            "quick_updated",
            format!("Quick updated {}", changes.join(", ")),
        ));
        record.last_modified_at = now_rfc3339();
        persist_database(db_path, &database)?;
    }

    Ok(database.records.len())
}

fn replace_records_in_database(
    db_path: &Path,
    records: Vec<ActivityRecord>,
    settings: Option<TrackerSettings>,
    debug_records: Option<Vec<DebugRecord>>,
    debug_settings: Option<DebugSettings>,
) -> Result<usize, String> {
    let settings = sanitize_settings(settings.unwrap_or_else(default_tracker_settings))?;
    let mut sanitized_records = sanitize_imported_records(records, &settings)?;
    for record in &mut sanitized_records {
        record.attachments =
            attachments::externalize(db_path, std::mem::take(&mut record.attachments))?;
        for comment in &mut record.comments {
            comment.attachments =
                attachments::externalize(db_path, std::mem::take(&mut comment.attachments))?;
        }
    }
    // When debug data is not provided in the import, preserve the existing debug data
    let existing = read_database_unlocked(db_path).ok();
    let final_debug_records = debug_records
        .unwrap_or_else(|| existing.as_ref().map(|db| db.debug_records.clone()).unwrap_or_default());
    let final_debug_settings = debug_settings
        .unwrap_or_else(|| existing.as_ref().map(|db| db.debug_settings.clone()).unwrap_or_else(default_debug_settings));
    persist_database(
        db_path,
        &TrackerDatabase {
            schema_version: default_schema_version(),
            revision: 0,
            settings,
            records: sanitized_records.clone(),
            debug_records: final_debug_records,
            debug_settings: final_debug_settings,
        },
    )?;
    Ok(sanitized_records.len())
}

fn read_records(path: &Path) -> Result<Vec<ActivityRecord>, String> {
    with_shared_db_lock(path, read_records_unlocked)
}

fn build_database_stats(records: &[ActivityRecord]) -> DatabaseStats {
    let mut owners = BTreeSet::new();
    let mut projects = BTreeSet::new();
    let mut departments = BTreeSet::new();
    let mut categories = BTreeSet::new();

    let mut priority_counts = BTreeMap::new();
    let mut effort_counts = BTreeMap::new();
    let mut impact_counts = BTreeMap::new();
    let mut owner_counts = BTreeMap::new();
    let mut project_counts = BTreeMap::new();

    let mut latest_submitted_at: Option<String> = None;
    let mut upcoming_end_date: Option<NaiveDate> = None;
    let mut total_duration_days: i64 = 0;

    for record in records {
        owners.insert(record.owner.clone());
        *owner_counts.entry(record.owner.clone()).or_insert(0usize) += 1;

        for value in &record.projects {
            projects.insert(value.clone());
            *project_counts.entry(value.clone()).or_insert(0usize) += 1;
        }

        for value in &record.departments {
            departments.insert(value.clone());
        }

        for value in &record.categories {
            categories.insert(value.clone());
        }

        *priority_counts
            .entry(record.priority.clone())
            .or_insert(0usize) += 1;
        *effort_counts.entry(record.effort.clone()).or_insert(0usize) += 1;
        *impact_counts.entry(record.impact.clone()).or_insert(0usize) += 1;

        match &latest_submitted_at {
            Some(current) if current >= &record.submitted_at => {}
            _ => latest_submitted_at = Some(record.submitted_at.clone()),
        }

        if let Ok(end_date) = NaiveDate::parse_from_str(&record.end_date, "%Y-%m-%d") {
            match upcoming_end_date {
                Some(current) if current <= end_date => {}
                _ => upcoming_end_date = Some(end_date),
            }
        }

        if let Ok(start_date) = NaiveDate::parse_from_str(&record.start_date, "%Y-%m-%d") {
            let end_date = if record.end_date.trim().is_empty() {
                Utc::now().date_naive()
            } else if let Ok(end_date) = NaiveDate::parse_from_str(&record.end_date, "%Y-%m-%d") {
                end_date
            } else {
                continue;
            };
            total_duration_days += (end_date - start_date).num_days().max(0) + 1;
        }
    }

    let average_duration_days = if records.is_empty() {
        0.0
    } else {
        total_duration_days as f64 / records.len() as f64
    };

    DatabaseStats {
        record_count: records.len(),
        unique_owners: owners.len(),
        unique_projects: projects.len(),
        unique_departments: departments.len(),
        unique_categories: categories.len(),
        average_duration_days: (average_duration_days * 10.0).round() / 10.0,
        latest_submitted_at,
        upcoming_end_date: upcoming_end_date.map(|date| date.format("%Y-%m-%d").to_string()),
        priority_counts: ordered_buckets(&priority_counts),
        effort_counts: ordered_buckets(&effort_counts),
        impact_counts: ordered_buckets(&impact_counts),
        top_owners: top_buckets(&owner_counts, 4),
        top_projects: top_buckets(&project_counts, 4),
    }
}

fn ordered_buckets(counts: &BTreeMap<String, usize>) -> Vec<CountBucket> {
    let preferred_order = ["Critical", "High", "Normal", "Mid", "Low"];
    let mut buckets = Vec::new();

    for label in preferred_order {
        if let Some(count) = counts.get(label) {
            buckets.push(CountBucket {
                label: label.to_string(),
                count: *count,
            });
        }
    }

    for (label, count) in counts {
        if preferred_order.contains(&label.as_str()) {
            continue;
        }

        buckets.push(CountBucket {
            label: label.clone(),
            count: *count,
        });
    }

    buckets
}

fn top_buckets(counts: &BTreeMap<String, usize>, limit: usize) -> Vec<CountBucket> {
    let mut entries = counts
        .iter()
        .map(|(label, count)| CountBucket {
            label: label.clone(),
            count: *count,
        })
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.label.cmp(&right.label))
    });
    entries.truncate(limit);
    entries
}

fn matches_filters(record: &ActivityRecord, filters: &StatsFilters) -> bool {
    let search_term = filters.search_term.trim().to_lowercase();
    let search_match = search_term.is_empty()
        || [
            record.title.as_str(),
            record.description.as_str(),
            record.owner.as_str(),
            record.status.as_str(),
            record.priority.as_str(),
            record.effort.as_str(),
            record.impact.as_str(),
        ]
        .iter()
        .any(|value| value.to_lowercase().contains(&search_term))
        || record
            .projects
            .iter()
            .any(|value| value.to_lowercase().contains(&search_term))
        || record
            .departments
            .iter()
            .any(|value| value.to_lowercase().contains(&search_term))
        || record
            .categories
            .iter()
            .any(|value| value.to_lowercase().contains(&search_term))
        || record
            .comments
            .iter()
            .any(|comment| comment.message.to_lowercase().contains(&search_term))
        || record
            .history
            .iter()
            .any(|entry| entry.message.to_lowercase().contains(&search_term));
    let owner_match =
        filters.owners.is_empty() || filters.owners.iter().any(|value| value == &record.owner);
    let department_match = filters.departments.is_empty()
        || record
            .departments
            .iter()
            .any(|value| filters.departments.iter().any(|selected| selected == value));
    let category_match = filters.categories.is_empty()
        || record
            .categories
            .iter()
            .any(|value| filters.categories.iter().any(|selected| selected == value));
    let project_match = filters.projects.is_empty()
        || record
            .projects
            .iter()
            .any(|value| filters.projects.iter().any(|selected| selected == value));
    let priority_match = filters.priorities.is_empty()
        || filters
            .priorities
            .iter()
            .any(|value| value == &record.priority);
    let status_match =
        filters.statuses.is_empty() || filters.statuses.iter().any(|value| value == &record.status);
    let effort_match =
        filters.efforts.is_empty() || filters.efforts.iter().any(|value| value == &record.effort);
    let impact_match =
        filters.impacts.is_empty() || filters.impacts.iter().any(|value| value == &record.impact);

    search_match
        && owner_match
        && department_match
        && category_match
        && project_match
        && priority_match
        && status_match
        && effort_match
        && impact_match
}

fn portable_db_directory() -> Option<PathBuf> {
    let executable_path = env::current_exe().ok()?;
    let executable_dir = executable_path.parent()?;

    if cfg!(windows) {
        return Some(executable_dir.to_path_buf());
    }

    let candidate = executable_dir
        .parent()
        .and_then(|contents| {
            if contents.file_name().and_then(|v| v.to_str()) == Some("Contents") {
                contents.parent()
            } else {
                None
            }
        })
        .filter(|bundle_root| {
            bundle_root
                .extension()
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.eq_ignore_ascii_case("app"))
        })
        .and_then(|bundle_root| bundle_root.parent())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| executable_dir.to_path_buf());

    // Only return this path if we can actually write there.
    if fs::metadata(&candidate)
        .map(|m| !m.permissions().readonly())
        .unwrap_or(false)
    {
        Some(candidate)
    } else {
        None
    }
}

fn shared_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("TRACKER_DB_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    // Prefer a portable DB next to the app; fall back to the standard app data
    // directory when the app lives somewhere not user-writable (e.g. /Applications/).
    let base = if let Some(dir) = portable_db_directory() {
        dir
    } else {
        use tauri::Manager;
        let mut dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Unable to resolve app data directory: {e}"))?;
        dir.push("tracker-db");
        dir
    };

    let mut path = base;
    path.push(default_db_file_name());
    Ok(path)
}

fn sanitize_string_list(items: Vec<String>) -> Vec<String> {
    let mut deduped = BTreeSet::new();

    items
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .filter(|item| deduped.insert(item.clone()))
        .collect()
}

fn sanitize_settings(mut settings: TrackerSettings) -> Result<TrackerSettings, String> {
    settings.owners = sanitize_string_list(settings.owners);
    settings.projects = sanitize_string_list(settings.projects);
    settings.departments = sanitize_string_list(settings.departments);
    settings.categories = sanitize_string_list(settings.categories);
    settings.category_impact_factors =
        sanitize_category_impact_factors(&settings.categories, settings.category_impact_factors)?;
    settings.priorities = sanitize_string_list(settings.priorities);
    if is_legacy_default_priorities(&settings.priorities) {
        settings.priorities = default_priority_values();
    }
    settings.efforts = sanitize_string_list(settings.efforts);
    settings.impacts = sanitize_string_list(settings.impacts);
    settings.statuses = sanitize_string_list(settings.statuses);
    settings.reminder_cadences = sanitize_reminder_cadence_options(settings.reminder_cadences)?;

    if settings.priorities.is_empty() {
        return Err("Add at least one priority value in Admin.".to_string());
    }

    if settings.efforts.is_empty() {
        return Err("Add at least one effort value in Admin.".to_string());
    }

    if settings.impacts.is_empty() {
        return Err("Add at least one impact value in Admin.".to_string());
    }

    if settings.statuses.is_empty() {
        return Err("Add at least one status value in Admin.".to_string());
    }

    if settings.reminder_cadences.is_empty() {
        return Err("Add at least one reminder cadence in Admin.".to_string());
    }

    Ok(settings)
}

fn sanitize_category_impact_factors(
    categories: &[String],
    factors: BTreeMap<String, f64>,
) -> Result<BTreeMap<String, f64>, String> {
    let mut sanitized = BTreeMap::new();

    for category in categories {
        let factor = factors.get(category).copied().unwrap_or(1.0);
        if !factor.is_finite() || !(0.0..=2.0).contains(&factor) {
            return Err(format!(
                "Impact factor for category '{}' must be a number between 0 and 2.",
                category
            ));
        }

        sanitized.insert(category.clone(), factor);
    }

    Ok(sanitized)
}

fn sanitize_reminder_cadence_options(
    options: Vec<ReminderCadenceOption>,
) -> Result<Vec<ReminderCadenceOption>, String> {
    let mut seen_labels = BTreeSet::new();
    let mut sanitized = Vec::new();

    for option in options {
        let label = option.label.trim().to_string();
        if label.is_empty() {
            continue;
        }

        if !seen_labels.insert(label.clone()) {
            continue;
        }

        sanitized.push(ReminderCadenceOption {
            label,
            interval_days: option.interval_days,
        });
    }

    Ok(sanitized)
}

fn sanitize_database(mut database: TrackerDatabase) -> Result<TrackerDatabase, String> {
    database.schema_version = default_schema_version();
    database.settings = sanitize_settings(database.settings)?;
    normalize_legacy_priorities(&database.settings, &mut database.records);
    database.records = sanitize_imported_records(database.records, &database.settings)?;
    Ok(database)
}

fn is_legacy_default_priorities(priorities: &[String]) -> bool {
    priorities.len() == 3
        && priorities[0] == "Low"
        && priorities[1] == "Mid"
        && priorities[2] == "High"
}

fn normalize_legacy_priorities(settings: &TrackerSettings, records: &mut [ActivityRecord]) {
    if settings.priorities.iter().any(|priority| priority == "Normal")
        && !settings.priorities.iter().any(|priority| priority == "Mid")
    {
        for record in records {
            if record.priority == "Mid" {
                record.priority = "Normal".to_string();
            }
        }
    }
}

fn sanitize_imported_records(
    records: Vec<ActivityRecord>,
    settings: &TrackerSettings,
) -> Result<Vec<ActivityRecord>, String> {
    let mut sanitized_records = Vec::new();
    let mut seen_ids = BTreeSet::new();

    for record in records {
        let sanitized = sanitize_imported_record(record, settings)?;
        if !seen_ids.insert(sanitized.id.clone()) {
            return Err(format!(
                "Duplicate record id '{}' found in imported data",
                sanitized.id
            ));
        }
        sanitized_records.push(sanitized);
    }

    sanitized_records.sort_by(|left, right| right.submitted_at.cmp(&left.submitted_at));
    Ok(sanitized_records)
}

fn validate_allowed_value(value: &str, allowed: &[String], field: &str) -> Result<(), String> {
    if allowed.iter().any(|entry| entry == value) {
        Ok(())
    } else {
        Err(format!(
            "{} '{}' is not available in Admin settings",
            field, value
        ))
    }
}

fn validate_allowed_values(
    values: &[String],
    allowed: &[String],
    field: &str,
) -> Result<(), String> {
    for value in values {
        validate_allowed_value(value, allowed, field)?;
    }

    Ok(())
}

fn validate_reminder_cadence_value(label: &str, settings: &TrackerSettings) -> Result<(), String> {
    if settings
        .reminder_cadences
        .iter()
        .any(|entry| entry.label == label)
    {
        Ok(())
    } else {
        Err(format!(
            "Reminder cadence '{}' is not available in Admin settings",
            label
        ))
    }
}

fn validate_settings_compatibility(
    settings: &TrackerSettings,
    records: &[ActivityRecord],
) -> Result<(), String> {
    for record in records {
        validate_allowed_value(&record.owner, &settings.owners, "Owner")?;
        for todo in &record.todos {
            validate_allowed_value(&todo.owner, &settings.owners, "Todo owner")?;
        }
        validate_allowed_values(&record.projects, &settings.projects, "Project")?;
        validate_allowed_values(&record.departments, &settings.departments, "Department")?;
        validate_allowed_values(&record.categories, &settings.categories, "Category")?;
        validate_allowed_value(&record.priority, &settings.priorities, "Priority")?;
        validate_allowed_value(&record.effort, &settings.efforts, "Effort")?;
        validate_allowed_value(&record.impact, &settings.impacts, "Impact")?;
        validate_allowed_value(&record.status, &settings.statuses, "Status")?;
        validate_reminder_cadence_value(&record.reminder_cadence, settings)?;
    }

    Ok(())
}

fn apply_settings_relabels(
    records: &mut [ActivityRecord],
    replacements: &[SettingsRelabelInput],
) -> Result<(), String> {
    for replacement in replacements {
        let field = replacement.field.trim();
        let from = replacement.from.trim();
        let to = replacement.to.trim();

        if field.is_empty() || from.is_empty() || to.is_empty() {
            return Err("Relabel replacements require field, from, and to values".to_string());
        }

        for record in records.iter_mut() {
            match field {
                "owners" => {
                    if record.owner == from {
                        record.owner = to.to_string();
                    }
                    for todo in &mut record.todos {
                        if todo.owner == from {
                            todo.owner = to.to_string();
                        }
                    }
                }
                "projects" => replace_list_values(&mut record.projects, from, to),
                "departments" => replace_list_values(&mut record.departments, from, to),
                "categories" => replace_list_values(&mut record.categories, from, to),
                "priorities" => {
                    if record.priority == from {
                        record.priority = to.to_string();
                    }
                }
                "efforts" => {
                    if record.effort == from {
                        record.effort = to.to_string();
                    }
                }
                "impacts" => {
                    if record.impact == from {
                        record.impact = to.to_string();
                    }
                }
                "statuses" => {
                    if record.status == from {
                        record.status = to.to_string();
                    }
                }
                "reminderCadences" => {
                    if record.reminder_cadence == from {
                        record.reminder_cadence = to.to_string();
                    }
                }
                _ => return Err(format!("Unsupported relabel field '{}'", field)),
            }
        }
    }

    Ok(())
}

fn replace_list_values(values: &mut Vec<String>, from: &str, to: &str) {
    for value in values.iter_mut() {
        if value == from {
            *value = to.to_string();
        }
    }

    *values = sanitize_string_list(std::mem::take(values));
}

fn sanitize_and_validate(
    mut payload: ActivityInput,
    settings: &TrackerSettings,
) -> Result<ActivityInput, String> {
    payload.title = payload.title.trim().to_string();
    payload.owner = payload.owner.trim().to_string();
    payload.start_date = payload.start_date.trim().to_string();
    payload.end_date = payload.end_date.trim().to_string();
    payload.description = payload.description.trim().to_string();
    payload.effort = payload.effort.trim().to_string();
    payload.impact = payload.impact.trim().to_string();
    payload.priority = payload.priority.trim().to_string();
    payload.status = payload.status.trim().to_string();
    payload.reminder_cadence = payload.reminder_cadence.trim().to_string();

    payload.projects = sanitize_string_list(payload.projects);
    payload.departments = sanitize_string_list(payload.departments);
    payload.categories = sanitize_string_list(payload.categories);
    payload.attachments = sanitize_attachments(payload.attachments);
    payload.expected_last_modified_at = payload
        .expected_last_modified_at
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if payload.title.len() < 3 {
        return Err("Title must contain at least 3 characters".to_string());
    }

    if payload.owner.is_empty() {
        return Err("Owner is required".to_string());
    }

    validate_allowed_value(&payload.owner, &settings.owners, "Owner")?;

    if payload.projects.is_empty() {
        return Err("Select at least one project".to_string());
    }

    validate_allowed_values(&payload.projects, &settings.projects, "Project")?;

    if payload.start_date.is_empty() {
        return Err("Start date is required".to_string());
    }

    let start_date = NaiveDate::parse_from_str(&payload.start_date, "%Y-%m-%d")
        .map_err(|_| "Start date must use the YYYY-MM-DD format".to_string())?;

    if !payload.end_date.is_empty() {
        let end_date = NaiveDate::parse_from_str(&payload.end_date, "%Y-%m-%d")
            .map_err(|_| "End date must use the YYYY-MM-DD format".to_string())?;

        if end_date < start_date {
            return Err("End date cannot be earlier than start date".to_string());
        }
    }

    if payload.departments.is_empty() {
        return Err("Select at least one department".to_string());
    }

    validate_allowed_values(&payload.departments, &settings.departments, "Department")?;

    if payload.description.len() < 10 {
        return Err("Description must contain at least 10 characters".to_string());
    }

    validate_allowed_value(&payload.effort, &settings.efforts, "Effort")?;
    validate_allowed_value(&payload.impact, &settings.impacts, "Impact")?;
    validate_allowed_value(&payload.priority, &settings.priorities, "Priority")?;
    validate_allowed_value(&payload.status, &settings.statuses, "Status")?;
    validate_reminder_cadence_value(&payload.reminder_cadence, settings)?;

    if payload.categories.is_empty() {
        return Err("Select at least one category".to_string());
    }

    validate_allowed_values(&payload.categories, &settings.categories, "Category")?;

    validate_attachments(&payload.attachments, "record")?;

    Ok(payload)
}

fn sanitize_and_validate_comment(mut payload: CommentInput) -> Result<CommentInput, String> {
    payload.message = payload.message.trim().to_string();
    payload.created_at = payload
        .created_at
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    payload.attachments = sanitize_attachments(payload.attachments);
    payload.expected_last_modified_at = payload
        .expected_last_modified_at
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if payload.message.is_empty() {
        return Err("Comment text is required".to_string());
    }

    if let Some(created_at) = payload.created_at.as_deref() {
        DateTime::parse_from_rfc3339(created_at)
            .map_err(|_| "Comment date must be a valid timestamp".to_string())?;
    }

    validate_attachments(&payload.attachments, "comment")?;

    Ok(payload)
}

fn sanitize_and_validate_todo(
    mut payload: TodoInput,
    settings: &TrackerSettings,
) -> Result<TodoInput, String> {
    payload.text = payload.text.trim().to_string();
    payload.owner = payload.owner.trim().to_string();
    payload.due_date = payload
        .due_date
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    payload.expected_last_modified_at = payload
        .expected_last_modified_at
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if payload.text.is_empty() {
        return Err("Todo text is required".to_string());
    }

    if payload.text.len() > 240 {
        return Err("Todo text must be 240 characters or less".to_string());
    }

    if payload.owner.is_empty() {
        return Err("Todo owner is required".to_string());
    }

    validate_allowed_value(&payload.owner, &settings.owners, "Owner")?;

    if let Some(due_date) = payload.due_date.as_deref() {
        NaiveDate::parse_from_str(due_date, "%Y-%m-%d")
            .map_err(|_| "Todo due date must use the YYYY-MM-DD format".to_string())?;
    }

    Ok(payload)
}

fn sanitize_and_validate_quick_update(
    mut payload: QuickUpdateInput,
    settings: &TrackerSettings,
) -> Result<QuickUpdateInput, String> {
    payload.owner = payload.owner.map(|value| value.trim().to_string());
    payload.status = payload.status.map(|value| value.trim().to_string());
    payload.reminder_cadence = payload
        .reminder_cadence
        .map(|value| value.trim().to_string());
    payload.expected_last_modified_at = payload
        .expected_last_modified_at
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(owner) = payload.owner.as_deref() {
        if owner.is_empty() {
            return Err("Owner cannot be empty".to_string());
        }

        validate_allowed_value(owner, &settings.owners, "Owner")?;
    }

    if payload.owner.is_none() && payload.status.is_none() && payload.reminder_cadence.is_none() {
        return Err("Quick update payload is empty".to_string());
    }

    if let Some(status) = payload.status.as_deref() {
        validate_allowed_value(status, &settings.statuses, "Status")?;
    }

    if let Some(reminder_cadence) = payload.reminder_cadence.as_deref() {
        validate_reminder_cadence_value(reminder_cadence, settings)?;
    }

    Ok(payload)
}

fn sanitize_attachments(attachments: Vec<Attachment>) -> Vec<Attachment> {
    attachments
        .into_iter()
        .enumerate()
        .filter_map(|(index, attachment)| {
            let id = attachment.id.trim().to_string();
            let file_name = attachment.file_name.trim().to_string();
            let mime_type = attachment.mime_type.trim().to_string();
            let storage_id = attachment.storage_id.trim().to_string();
            let base64_data = attachment.base64_data.trim().to_string();

            if file_name.is_empty() || (storage_id.is_empty() && base64_data.is_empty()) {
                return None;
            }

            let id = if id.is_empty() {
                stable_attachment_id(
                    index,
                    &file_name,
                    &mime_type,
                    attachment.size_bytes,
                    &storage_id,
                    &base64_data,
                )
            } else {
                id
            };

            Some(Attachment {
                id,
                file_name,
                mime_type: if mime_type.is_empty() {
                    "application/octet-stream".to_string()
                } else {
                    mime_type
                },
                size_bytes: attachment.size_bytes,
                storage_id,
                base64_data,
            })
        })
        .collect()
}

fn stable_attachment_id(
    index: usize,
    file_name: &str,
    mime_type: &str,
    size_bytes: usize,
    storage_id: &str,
    base64_data: &str,
) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in format!(
        "{index}|{file_name}|{mime_type}|{size_bytes}|{storage_id}|{}",
        base64_data.len()
    )
    .as_bytes()
    {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }

    format!("att-{hash:016x}")
}

fn sanitize_imported_record(
    mut record: ActivityRecord,
    settings: &TrackerSettings,
) -> Result<ActivityRecord, String> {
    record.id = record.id.trim().to_string();
    record.submitted_at = record.submitted_at.trim().to_string();
    record.title = record.title.trim().to_string();
    record.owner = record.owner.trim().to_string();
    record.start_date = record.start_date.trim().to_string();
    record.end_date = record.end_date.trim().to_string();
    record.description = record.description.trim().to_string();
    record.effort = record.effort.trim().to_string();
    record.impact = record.impact.trim().to_string();
    record.priority = record.priority.trim().to_string();
    record.status = record.status.trim().to_string();
    record.reminder_cadence = if record.reminder_cadence.trim().is_empty() {
        default_reminder_cadence()
    } else {
        record.reminder_cadence.trim().to_string()
    };
    record.last_modified_at = record.last_modified_at.trim().to_string();

    record.projects = record
        .projects
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    record.departments = record
        .departments
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    record.categories = record
        .categories
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    record.attachments = sanitize_attachments(record.attachments);
    record.comments = record
        .comments
        .into_iter()
        .filter_map(|comment| {
            let id = comment.id.trim().to_string();
            let created_at = comment.created_at.trim().to_string();
            let author = if comment.author.trim().is_empty() {
                default_comment_author()
            } else {
                comment.author.trim().to_string()
            };
            let message = comment.message.trim().to_string();

            if id.is_empty() || created_at.is_empty() || message.is_empty() {
                return None;
            }

            let attachments = sanitize_attachments(comment.attachments);
            if validate_attachments(&attachments, "comment").is_err() {
                return None;
            }

            Some(RecordComment {
                id,
                created_at,
                author,
                message,
                attachments,
            })
        })
        .collect();
    record.todos = record
        .todos
        .into_iter()
        .filter_map(|todo| {
            let id = todo.id.trim().to_string();
            let created_at = todo.created_at.trim().to_string();
            let updated_at = todo.updated_at.trim().to_string();
            let text = todo.text.trim().to_string();
            let owner = todo.owner.trim().to_string();
            let due_date = todo.due_date.trim().to_string();
            let completed_at = todo.completed_at.trim().to_string();

            if id.is_empty() || created_at.is_empty() || text.is_empty() || owner.is_empty() {
                return None;
            }

            Some(RecordTodo {
                id,
                created_at: created_at.clone(),
                updated_at: if updated_at.is_empty() {
                    created_at
                } else {
                    updated_at
                },
                text,
                owner,
                due_date,
                completed: todo.completed,
                completed_at,
            })
        })
        .collect();
    record.history = record
        .history
        .into_iter()
        .filter_map(|entry| {
            let id = entry.id.trim().to_string();
            let created_at = entry.created_at.trim().to_string();
            let kind = entry.kind.trim().to_string();
            let message = entry.message.trim().to_string();

            if id.is_empty() || created_at.is_empty() || kind.is_empty() || message.is_empty() {
                return None;
            }

            Some(RecordHistoryEntry {
                id,
                created_at,
                kind,
                message,
            })
        })
        .collect();

    if record.id.is_empty() {
        return Err("Imported records require an id".to_string());
    }

    if record.submitted_at.is_empty() {
        return Err(format!(
            "Imported record '{}' is missing submittedAt",
            record.id
        ));
    }

    if record.last_modified_at.is_empty() {
        record.last_modified_at = record_last_update_timestamp(&record);
    }

    if record.history.is_empty() {
        record.history.push(history_entry(
            "imported",
            "Record imported into the tracker database".to_string(),
        ));
    }

    validate_attachments(&record.attachments, "record")?;
    for todo in &record.todos {
        let payload = TodoInput {
            text: todo.text.clone(),
            owner: todo.owner.clone(),
            due_date: Some(todo.due_date.clone()),
            completed: Some(todo.completed),
            expected_last_modified_at: None,
        };
        sanitize_and_validate_todo(payload, settings)?;
    }
    let payload = ActivityInput {
        title: record.title.clone(),
        owner: record.owner.clone(),
        projects: record.projects.clone(),
        start_date: record.start_date.clone(),
        end_date: record.end_date.clone(),
        departments: record.departments.clone(),
        description: record.description.clone(),
        effort: record.effort.clone(),
        impact: record.impact.clone(),
        priority: record.priority.clone(),
        status: record.status.clone(),
        reminder_cadence: record.reminder_cadence.clone(),
        categories: record.categories.clone(),
        attachments: record.attachments.clone(),
        lab_activity: record.lab_activity,
        hw_development: record.hw_development,
        sw_development: record.sw_development,
        expected_last_modified_at: None,
    };
    let sanitized_payload = sanitize_and_validate(payload, settings)?;

    record.title = sanitized_payload.title;
    record.owner = sanitized_payload.owner;
    record.projects = sanitized_payload.projects;
    record.start_date = sanitized_payload.start_date;
    record.end_date = sanitized_payload.end_date;
    record.departments = sanitized_payload.departments;
    record.description = sanitized_payload.description;
    record.effort = sanitized_payload.effort;
    record.impact = sanitized_payload.impact;
    record.priority = sanitized_payload.priority;
    record.status = sanitized_payload.status;
    record.reminder_cadence = sanitized_payload.reminder_cadence;
    record.categories = sanitized_payload.categories;
    record.attachments = sanitized_payload.attachments;

    Ok(record)
}

fn validate_attachments(attachments: &[Attachment], subject: &str) -> Result<(), String> {
    if attachments.len() > 10 {
        return Err(format!("Attach up to 10 files per {}", subject));
    }

    for attachment in attachments {
        if attachment.size_bytes > 10 * 1024 * 1024 {
            return Err(format!(
                "Attachment '{}' exceeds the 10 MB limit",
                attachment.file_name
            ));
        }
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(SaveLock(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![
            bootstrap_form,
            get_database_stats,
            get_activity_records,
            list_database_backups,
            get_attachment_storage_stats,
            update_tracker_settings,
            relabel_tracker_settings,
            read_attachments_from_paths,
            read_attachment_data,
            submit_activity,
            update_activity,
            quick_update_activity,
            append_activity_comment,
            update_activity_comment,
            delete_activity_comment,
            append_activity_todo,
            update_activity_todo,
            delete_activity_todo,
            replace_database_records,
            restore_database_backup,
            get_debug_records,
            submit_debug_record,
            update_debug_record,
            delete_debug_record,
            read_debug_attachment_data,
            get_debug_settings,
            update_debug_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tracker application");
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_embedded_list ───────────────────────────────────────────────────

    #[test]
    fn parse_embedded_list_basic() {
        let input = "Alice\nBob\nCharlie";
        let result = parse_embedded_list(input);
        assert_eq!(result, vec!["Alice", "Bob", "Charlie"]);
    }

    #[test]
    fn parse_embedded_list_strips_comments() {
        let input = "# This is a comment\nAlice\n# Another\nBob";
        let result = parse_embedded_list(input);
        assert_eq!(result, vec!["Alice", "Bob"]);
    }

    #[test]
    fn parse_embedded_list_trims_whitespace() {
        let input = "  Alice  \n  Bob  ";
        let result = parse_embedded_list(input);
        assert_eq!(result, vec!["Alice", "Bob"]);
    }

    #[test]
    fn parse_embedded_list_ignores_blank_lines() {
        let input = "Alice\n\n\nBob";
        let result = parse_embedded_list(input);
        assert_eq!(result, vec!["Alice", "Bob"]);
    }

    // ── sanitize_string_list ──────────────────────────────────────────────────

    #[test]
    fn sanitize_string_list_trims_entries() {
        let input = vec!["  Alice  ".to_string(), "  Bob  ".to_string()];
        let result = sanitize_string_list(input);
        assert!(result.contains(&"Alice".to_string()));
        assert!(result.contains(&"Bob".to_string()));
    }

    #[test]
    fn sanitize_string_list_removes_empty() {
        let input = vec!["Alice".to_string(), "".to_string(), "   ".to_string()];
        let result = sanitize_string_list(input);
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"Alice".to_string()));
    }

    #[test]
    fn sanitize_string_list_deduplicates() {
        let input = vec!["Alice".to_string(), "Bob".to_string(), "Alice".to_string()];
        let result = sanitize_string_list(input);
        assert_eq!(result.len(), 2);
    }

    // ── validate_allowed_value ────────────────────────────────────────────────

    #[test]
    fn validate_allowed_value_accepts_valid() {
        let allowed = vec!["Low".to_string(), "Mid".to_string(), "High".to_string()];
        assert!(validate_allowed_value("Low", &allowed, "Priority").is_ok());
        assert!(validate_allowed_value("High", &allowed, "Priority").is_ok());
    }

    #[test]
    fn validate_allowed_value_rejects_invalid() {
        let allowed = vec!["Low".to_string(), "Mid".to_string()];
        let result = validate_allowed_value("Unknown", &allowed, "Priority");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Priority"));
    }

    #[test]
    fn validate_allowed_value_empty_string_rejected() {
        // Empty string is not in any allowed list, so it fails
        let allowed = vec!["Low".to_string()];
        assert!(validate_allowed_value("", &allowed, "Field").is_err());
    }

    #[test]
    fn validate_allowed_value_empty_in_allowed_list_passes() {
        // If "" is explicitly in the allowed list it passes
        let allowed = vec!["".to_string(), "Low".to_string()];
        assert!(validate_allowed_value("", &allowed, "Field").is_ok());
    }

    // ── validate_allowed_values ───────────────────────────────────────────────

    #[test]
    fn validate_allowed_values_accepts_valid_list() {
        let allowed = vec!["A".to_string(), "B".to_string(), "C".to_string()];
        assert!(validate_allowed_values(&["A".to_string(), "B".to_string()], &allowed, "Field").is_ok());
    }

    #[test]
    fn validate_allowed_values_rejects_any_invalid() {
        let allowed = vec!["A".to_string(), "B".to_string()];
        let result = validate_allowed_values(&["A".to_string(), "X".to_string()], &allowed, "Cat");
        assert!(result.is_err());
    }

    #[test]
    fn validate_allowed_values_empty_list_passes() {
        let allowed = vec!["A".to_string()];
        assert!(validate_allowed_values(&[], &allowed, "Field").is_ok());
    }

    // ── sanitize_category_impact_factors ──────────────────────────────────────

    #[test]
    fn sanitize_category_impact_factors_valid_range() {
        let mut factors = BTreeMap::new();
        factors.insert("A".to_string(), 1.5f64);
        factors.insert("B".to_string(), 0.0f64);
        let result = sanitize_category_impact_factors(
            &["A".to_string(), "B".to_string()],
            factors,
        );
        assert!(result.is_ok());
        let map = result.unwrap();
        assert_eq!(map["A"], 1.5);
        assert_eq!(map["B"], 0.0);
    }

    #[test]
    fn sanitize_category_impact_factors_rejects_above_two() {
        let mut factors = BTreeMap::new();
        factors.insert("A".to_string(), 3.0f64);
        let result = sanitize_category_impact_factors(&["A".to_string()], factors);
        assert!(result.is_err());
    }

    #[test]
    fn sanitize_category_impact_factors_rejects_negative() {
        let mut factors = BTreeMap::new();
        factors.insert("A".to_string(), -0.1f64);
        let result = sanitize_category_impact_factors(&["A".to_string()], factors);
        assert!(result.is_err());
    }

    // ── stable_attachment_id ──────────────────────────────────────────────────

    #[test]
    fn stable_attachment_id_is_deterministic() {
        let id1 = stable_attachment_id(0, "file.txt", "text/plain", 100, "", "abc123");
        let id2 = stable_attachment_id(0, "file.txt", "text/plain", 100, "", "abc123");
        assert_eq!(id1, id2);
    }

    #[test]
    fn stable_attachment_id_differs_for_different_content_length() {
        // The hash includes base64_data.len(), so content of different lengths differs
        let id1 = stable_attachment_id(0, "file.txt", "text/plain", 100, "", "short");
        let id2 = stable_attachment_id(0, "file.txt", "text/plain", 100, "", "a-much-longer-base64-string-here");
        assert_ne!(id1, id2);
    }

    #[test]
    fn stable_attachment_id_starts_with_att_prefix() {
        let id = stable_attachment_id(0, "file.txt", "text/plain", 100, "", "data");
        assert!(id.starts_with("att-"));
    }

    #[test]
    fn stable_attachment_id_differs_for_different_filenames() {
        let id1 = stable_attachment_id(0, "a.txt", "text/plain", 100, "", "data");
        let id2 = stable_attachment_id(0, "b.txt", "text/plain", 100, "", "data");
        assert_ne!(id1, id2);
    }

    // ── default values ────────────────────────────────────────────────────────

    #[test]
    fn default_priority_values_returns_tracker_priority_levels() {
        let result = default_priority_values();
        assert_eq!(
            result,
            vec![
                "Low".to_string(),
                "Normal".to_string(),
                "High".to_string(),
                "Critical".to_string(),
            ],
        );
    }

    #[test]
    fn default_status_values_contains_expected_statuses() {
        let result = default_status_values();
        assert!(result.contains(&"Open".to_string()));
        assert!(result.contains(&"Completed".to_string()));
        assert!(result.contains(&"Scheduled".to_string()));
        assert!(result.contains(&"Halted".to_string()));
        assert!(result.contains(&"On Hold".to_string()));
    }

    #[test]
    fn default_status_returns_open() {
        assert_eq!(default_status(), "Open");
    }

    #[test]
    fn default_reminder_cadence_returns_none() {
        assert_eq!(default_reminder_cadence(), "None");
    }

    #[test]
    fn default_schema_version_is_one() {
        assert_eq!(default_schema_version(), 1);
    }

    // ── sanitize_reminder_cadence_options ─────────────────────────────────────

    #[test]
    fn sanitize_reminder_cadence_options_accepts_valid() {
        let options = vec![
            ReminderCadenceOption { label: "None".to_string(), interval_days: 0 },
            ReminderCadenceOption { label: "Weekly".to_string(), interval_days: 7 },
        ];
        let result = sanitize_reminder_cadence_options(options);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 2);
    }

    #[test]
    fn sanitize_reminder_cadence_options_deduplicates_labels() {
        let options = vec![
            ReminderCadenceOption { label: "Weekly".to_string(), interval_days: 7 },
            ReminderCadenceOption { label: "Weekly".to_string(), interval_days: 14 },
        ];
        let result = sanitize_reminder_cadence_options(options);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 1);
    }

    #[test]
    fn sanitize_reminder_cadence_options_accepts_empty() {
        // No minimum required; empty input yields empty Ok result
        let result = sanitize_reminder_cadence_options(vec![]);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    // ── deserialize_lab_activity ──────────────────────────────────────────────

    #[derive(Deserialize)]
    struct LabWrapper {
        #[serde(deserialize_with = "deserialize_lab_activity")]
        v: bool,
    }

    #[test]
    fn deserialize_lab_activity_handles_bool_false() {
        let w: LabWrapper = serde_json::from_str(r#"{"v":false}"#).unwrap();
        assert!(!w.v);
    }

    #[test]
    fn deserialize_lab_activity_handles_bool_true() {
        let w: LabWrapper = serde_json::from_str(r#"{"v":true}"#).unwrap();
        assert!(w.v);
    }

    #[test]
    fn deserialize_lab_activity_handles_string_none() {
        let w: LabWrapper = serde_json::from_str(r#"{"v":"None"}"#).unwrap();
        assert!(!w.v);
    }

    #[test]
    fn deserialize_lab_activity_handles_string_significant() {
        let w: LabWrapper = serde_json::from_str(r#"{"v":"Significant"}"#).unwrap();
        assert!(w.v);
    }

    #[test]
    fn deserialize_lab_activity_handles_string_minimal() {
        let w: LabWrapper = serde_json::from_str(r#"{"v":"Minimal"}"#).unwrap();
        assert!(w.v);
    }

    // ── replace_list_values ───────────────────────────────────────────────────

    #[test]
    fn replace_list_values_renames_matching_entries() {
        // replace_list_values calls sanitize_string_list which deduplicates
        let mut values = vec!["Alice".to_string(), "Bob".to_string(), "Alice".to_string()];
        replace_list_values(&mut values, "Alice", "Alexandra");
        assert!(values.contains(&"Alexandra".to_string()));
        assert!(values.contains(&"Bob".to_string()));
        assert!(!values.contains(&"Alice".to_string()));
    }

    #[test]
    fn replace_list_values_noop_when_no_match() {
        let mut values = vec!["Alice".to_string(), "Bob".to_string()];
        replace_list_values(&mut values, "Charlie", "Charles");
        assert_eq!(values, vec!["Alice", "Bob"]);
    }

    #[test]
    fn replace_list_values_empty_list() {
        let mut values: Vec<String> = vec![];
        replace_list_values(&mut values, "Alice", "Alex");
        assert!(values.is_empty());
    }

    // ── sanitize_settings ─────────────────────────────────────────────────────

    #[test]
    fn sanitize_settings_accepts_empty_owners() {
        // sanitize_settings normalises values but does not enforce minimum counts
        let settings = TrackerSettings {
            owners: vec![],
            projects: vec!["P".to_string()],
            departments: vec!["D".to_string()],
            categories: vec!["C".to_string()],
            category_impact_factors: BTreeMap::new(),
            priorities: vec!["Low".to_string()],
            efforts: vec!["Low".to_string()],
            impacts: vec!["Low".to_string()],
            statuses: vec!["Open".to_string()],
            reminder_cadences: vec![ReminderCadenceOption { label: "None".to_string(), interval_days: 0 }],
        };
        let result = sanitize_settings(settings);
        assert!(result.is_ok());
        assert!(result.unwrap().owners.is_empty());
    }

    #[test]
    fn sanitize_settings_trims_and_deduplicates() {
        let settings = TrackerSettings {
            owners: vec!["  Alice  ".to_string(), "Alice".to_string()],
            projects: vec!["Project".to_string()],
            departments: vec!["Dept".to_string()],
            categories: vec!["Cat".to_string()],
            category_impact_factors: BTreeMap::new(),
            priorities: vec!["Low".to_string()],
            efforts: vec!["Low".to_string()],
            impacts: vec!["Low".to_string()],
            statuses: vec!["Open".to_string()],
            reminder_cadences: vec![ReminderCadenceOption { label: "None".to_string(), interval_days: 0 }],
        };
        let result = sanitize_settings(settings).unwrap();
        assert_eq!(result.owners.len(), 1);
        assert_eq!(result.owners[0], "Alice");
    }
}
