use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use uuid::Uuid;

use super::{replace_file_atomically, Attachment};

pub(super) fn store_directory(db_path: &Path) -> PathBuf {
    let stem = db_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("activity-db");

    match db_path.parent() {
        Some(parent) => parent.join(format!("{stem}.attachments")),
        None => PathBuf::from(format!("{stem}.attachments")),
    }
}

pub(super) fn blob_path(db_path: &Path, storage_id: &str) -> PathBuf {
    store_directory(db_path).join(storage_id)
}

pub(super) fn externalize(
    db_path: &Path,
    attachments: Vec<Attachment>,
) -> Result<Vec<Attachment>, String> {
    attachments
        .into_iter()
        .map(|attachment| externalize_one(db_path, attachment))
        .collect()
}

fn externalize_one(db_path: &Path, mut attachment: Attachment) -> Result<Attachment, String> {
    if attachment.id.trim().is_empty() {
        attachment.id = Uuid::new_v4().to_string();
    }

    if attachment.base64_data.trim().is_empty() {
        return Ok(attachment);
    }

    let bytes = STANDARD
        .decode(attachment.base64_data.trim())
        .map_err(|error| {
            format!(
                "Attachment '{}' contains invalid base64 data: {error}",
                attachment.file_name
            )
        })?;

    if bytes.len() > 10 * 1024 * 1024 {
        return Err(format!(
            "Attachment '{}' exceeds the 10 MB limit",
            attachment.file_name
        ));
    }

    let storage_id = if attachment.storage_id.trim().is_empty() {
        Uuid::new_v4().to_string()
    } else {
        attachment.storage_id.trim().to_string()
    };
    let store_dir = store_directory(db_path);
    fs::create_dir_all(&store_dir).map_err(|error| {
        format!(
            "Unable to create attachment directory {}: {error}",
            store_dir.display()
        )
    })?;

    let final_path = blob_path(db_path, &storage_id);
    let temp_path = store_dir.join(format!(".{storage_id}.tmp-{}", Uuid::new_v4()));

    let write_result = (|| -> Result<(), String> {
        let mut temp_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| {
                format!(
                    "Unable to create attachment file {}: {error}",
                    temp_path.display()
                )
            })?;
        temp_file
            .write_all(&bytes)
            .map_err(|error| format!("Unable to write attachment data: {error}"))?;
        temp_file
            .sync_all()
            .map_err(|error| format!("Unable to sync attachment data: {error}"))?;
        drop(temp_file);
        replace_file_atomically(&temp_path, &final_path)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result?;

    attachment.storage_id = storage_id;
    attachment.size_bytes = bytes.len();
    attachment.base64_data.clear();
    Ok(attachment)
}

pub(super) fn read_base64(db_path: &Path, attachment: &Attachment) -> Result<String, String> {
    if !attachment.base64_data.trim().is_empty() {
        return Ok(attachment.base64_data.clone());
    }

    if attachment.storage_id.trim().is_empty() {
        return Err(format!(
            "Attachment '{}' has no stored file data",
            attachment.file_name
        ));
    }

    let blob_path = blob_path(db_path, &attachment.storage_id);
    let bytes = fs::read(&blob_path).map_err(|error| {
        format!(
            "Unable to read attachment '{}' from {}: {error}",
            attachment.file_name,
            blob_path.display()
        )
    })?;

    Ok(STANDARD.encode(bytes))
}
