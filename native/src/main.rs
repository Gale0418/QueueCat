use serde::{Deserialize, Serialize};
use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const HOST_NAME: &str = "com.queuecat.helper";
const MAX_MESSAGE: usize = 1024 * 1024;
const MAX_PASSWORD: usize = 4096;
const MAX_LISTING: usize = 32 * 1024 * 1024;
const SECRET_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const SECRET_CLEANUP_BATCH: usize = 128;
const MAX_WORKERS: usize = 4;
const QUEUE_WAIT_TIMEOUT: Duration = Duration::from_secs(4 * 30 * 60);
const ENGINE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Deserialize)]
#[serde(
    tag = "op",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Request {
    Ping,
    StoreSecret {
        id: String,
        password: String,
    },
    Start {
        id: String,
        paths: Vec<String>,
        secret_id: String,
    },
    Status {
        id: String,
    },
    ForgetSecret {
        id: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Reply {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seven_zip_available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
}

impl Reply {
    fn error(code: &str) -> Self {
        Self {
            ok: false,
            version: None,
            seven_zip_available: None,
            status: None,
            output_dir: None,
            error_code: Some(code.into()),
        }
    }
    fn simple() -> Self {
        Self {
            ok: true,
            version: None,
            seven_zip_available: None,
            status: None,
            output_dir: None,
            error_code: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    paths: Vec<String>,
    source_fingerprints: Vec<SourceFingerprint>,
    secret_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    worker_pid: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceFingerprint {
    path: String,
    size: u64,
    modified_ns: u128,
}

struct FileLock {
    file: File,
    #[cfg(windows)]
    overlapped: windows_sys::Win32::System::IO::OVERLAPPED,
    #[cfg(not(windows))]
    path: PathBuf,
}
impl Drop for FileLock {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::UnlockFileEx;
            UnlockFileEx(
                self.file.as_raw_handle() as _,
                0,
                1,
                0,
                &mut self.overlapped,
            );
        }
        #[cfg(not(windows))]
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}
fn acquire_lock(path: PathBuf, wait: bool) -> io::Result<FileLock> {
    let deadline = SystemTime::now()
        + if wait {
            QUEUE_WAIT_TIMEOUT
        } else {
            Duration::ZERO
        };
    #[cfg(windows)]
    {
        use std::{mem::zeroed, os::windows::io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{
            LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY, LockFileEx,
        };
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(path)?;
        loop {
            let mut overlapped = unsafe { zeroed() };
            let ok = unsafe {
                LockFileEx(
                    file.as_raw_handle() as _,
                    LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                    0,
                    1,
                    0,
                    &mut overlapped,
                )
            };
            if ok != 0 {
                return Ok(FileLock { file, overlapped });
            }
            let error = io::Error::last_os_error();
            if !wait || SystemTime::now() >= deadline {
                return Err(error);
            }
            thread::sleep(Duration::from_millis(200));
        }
    }
    #[cfg(not(windows))]
    {
        loop {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => return Ok(FileLock { file, path }),
                Err(e)
                    if e.kind() == io::ErrorKind::AlreadyExists
                        && wait
                        && SystemTime::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(200))
                }
                Err(e) => return Err(e),
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct Config {
    seven_zip_path: Option<String>,
}

fn root() -> io::Result<PathBuf> {
    if let Some(p) = env::var_os("QUEUECAT_HELPER_HOME") {
        return Ok(PathBuf::from(p));
    }
    let local = env::var_os("LOCALAPPDATA")
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA unavailable"))?;
    Ok(PathBuf::from(local).join("QueueCatHelper"))
}
fn ensure_root() -> io::Result<PathBuf> {
    let p = root()?;
    fs::create_dir_all(&p)?;
    Ok(p)
}
fn secret_expired_at(modified: SystemTime, now: SystemTime) -> bool {
    match now.duration_since(modified) {
        Ok(age) => age >= SECRET_TTL,
        Err(_) => true,
    }
}
fn secret_file_expired(path: &Path, now: SystemTime) -> io::Result<bool> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse(&metadata) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "secret is not a regular file",
        ));
    }
    let modified = metadata.modified().unwrap_or(UNIX_EPOCH);
    Ok(secret_expired_at(modified, now))
}
fn cleanup_expired_secrets(r: &Path) {
    let secret_dir = r.join("secrets");
    let Ok(entries) = fs::read_dir(&secret_dir) else {
        return;
    };
    let Ok(_lock) = acquire_lock(r.join("secret-cleanup.lock"), false) else {
        return;
    };
    let cursor_path = r.join("secret-cleanup.cursor");
    let cursor = fs::read_to_string(&cursor_path)
        .ok()
        .filter(|value| value.is_empty() || valid_id(value))
        .unwrap_or_default();
    let mut ids: Vec<String> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            let id = name.strip_suffix(".bin")?;
            valid_id(id).then(|| id.to_owned())
        })
        .collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        let _ = write_cleanup_cursor(r, "");
        return;
    }
    let start = ids.partition_point(|id| id <= &cursor);
    let count = ids.len().min(SECRET_CLEANUP_BATCH);
    let selected: Vec<&str> = (0..count)
        .map(|offset| ids[(start + offset) % ids.len()].as_str())
        .collect();
    let next_cursor = selected.last().copied().unwrap_or_default();
    if write_cleanup_cursor(r, next_cursor).is_err() {
        return;
    }
    let now = SystemTime::now();
    for id in &selected {
        let path = secret_dir.join(format!("{id}.bin"));
        if secret_file_expired(&path, now).unwrap_or(false) {
            let _ = fs::remove_file(path);
        }
    }
}
fn write_cleanup_cursor(r: &Path, value: &str) -> io::Result<()> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp = r.join(format!(
        ".secret-cleanup.cursor.{}.{}",
        std::process::id(),
        nonce
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    file.write_all(value.as_bytes())?;
    file.sync_all()?;
    replace_file(&temp, &r.join("secret-cleanup.cursor")).map_err(|error| {
        let _ = fs::remove_file(&temp);
        error
    })
}
fn read_secret_blob(r: &Path, id: &str) -> Result<Vec<u8>, &'static str> {
    let path = r.join("secrets").join(format!("{id}.bin"));
    match secret_file_expired(&path, SystemTime::now()) {
        Ok(true) => {
            let _ = fs::remove_file(&path);
            return Err("secret-expired");
        }
        Ok(false) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Err("secret-unavailable"),
        Err(_) => return Err("secret-unavailable"),
    }
    let file = File::open(path).map_err(|_| "secret-unavailable")?;
    let mut bytes = Vec::new();
    file.take((MAX_PASSWORD + 64 * 1024 + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "secret-unavailable")?;
    if bytes.len() > MAX_PASSWORD + 64 * 1024 {
        return Err("secret-invalid");
    }
    Ok(bytes)
}
fn spawn_with_breakaway_retry<T>(mut spawn: impl FnMut(bool) -> io::Result<T>) -> io::Result<T> {
    match spawn(true) {
        Err(error) => {
            #[cfg(windows)]
            if error.raw_os_error()
                == Some(windows_sys::Win32::Foundation::ERROR_ACCESS_DENIED as i32)
            {
                return spawn(false);
            }
            Err(error)
        }
        Ok(value) => Ok(value),
    }
}
fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn state_path(r: &Path, id: &str) -> PathBuf {
    r.join("jobs").join(format!("{id}.json"))
}
fn atomic_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    atomic_write_with(
        path,
        |file| serde_json::to_writer(file, value).map_err(io::Error::other),
        File::sync_all,
        replace_file,
    )
}
fn atomic_write_with(
    path: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
    sync: impl FnOnce(&File) -> io::Result<()>,
    replace: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    fs::create_dir_all(path.parent().unwrap())?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let write_result = write(&mut f).and_then(|()| sync(&f));
    drop(f);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    match replace(&temp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&temp);
            Err(e)
        }
    }
}
fn load_job(r: &Path, id: &str) -> io::Result<Job> {
    serde_json::from_slice(&fs::read(state_path(r, id))?).map_err(io::Error::other)
}
fn job_load_error_code(error: &io::Error) -> &'static str {
    if error.kind() == io::ErrorKind::NotFound {
        "job-not-found"
    } else {
        "job-state-invalid"
    }
}
fn active_worker_count(r: &Path) -> io::Result<usize> {
    let jobs = r.join("jobs");
    let entries = match fs::read_dir(jobs) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e),
    };
    let mut count = 0usize;
    for entry in entries {
        let entry = entry?;
        if entry.path().extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        match fs::read(entry.path())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Job>(&bytes).ok())
        {
            Some(job)
                if matches!(job.status.as_str(), "queued" | "extracting")
                    && job.worker_pid.is_some_and(process_is_alive) =>
            {
                count += 1;
            }
            // A damaged record may belong to a still-running worker. Fail closed
            // for admission rather than using corruption to bypass the cap.
            None => count += 1,
            _ => {}
        }
    }
    Ok(count)
}
fn reconcile_job(r: &Path, id: &str, mut job: Job) -> Job {
    if !matches!(job.status.as_str(), "queued" | "extracting")
        || job.worker_pid.is_some_and(process_is_alive)
    {
        return job;
    }
    let Ok(_lock) = acquire_lock(r.join("jobs").join(format!("{id}.lock")), false) else {
        return job;
    };
    let Ok(latest) = load_job(r, id) else {
        return job;
    };
    job = latest;
    if matches!(job.status.as_str(), "queued" | "extracting")
        && !job.worker_pid.is_some_and(process_is_alive)
    {
        job.status = "failed".into();
        job.error_code = Some("worker-lost".into());
        job.worker_pid = None;
        let _ = atomic_json(&state_path(r, id), &job);
    }
    job
}
fn reply_job(j: Job) -> Reply {
    Reply {
        ok: true,
        version: None,
        seven_zip_available: None,
        status: Some(j.status),
        output_dir: j.output_dir,
        error_code: j.error_code,
    }
}
fn user_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        rest.to_owned()
    } else {
        value.into_owned()
    }
}

fn seven_zip_path(r: &Path) -> Option<PathBuf> {
    if let Ok(bytes) = fs::read(r.join("config.json")) {
        if let Ok(cfg) = serde_json::from_slice::<Config>(&bytes) {
            if let Some(s) = cfg.seven_zip_path {
                let p = PathBuf::from(s);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    let bundled = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("engine").join("7z.exe")));
    bundled
        .into_iter()
        .chain([
            r.join("7z.exe"),
            PathBuf::from(r"C:\Program Files\7-Zip\7z.exe"),
            PathBuf::from(r"C:\Program Files (x86)\7-Zip\7z.exe"),
        ])
        .into_iter()
        .find(|p| p.is_file())
}

fn validate_archive_paths(input: &[String]) -> Result<Vec<PathBuf>, &'static str> {
    if input.is_empty() || input.len() > 1000 {
        return Err("invalid-paths");
    }
    let mut paths = Vec::with_capacity(input.len());
    let mut seen = std::collections::HashSet::new();
    let mut parent: Option<PathBuf> = None;
    for raw in input {
        if raw.is_empty() || raw.contains('\0') {
            return Err("invalid-path");
        }
        let p = PathBuf::from(raw);
        if !p.is_absolute() {
            return Err("path-not-absolute");
        }
        let original_meta = fs::symlink_metadata(&p).map_err(|_| "source-unavailable")?;
        if !original_meta.is_file()
            || original_meta.file_type().is_symlink()
            || is_reparse(&original_meta)
        {
            return Err("source-not-regular");
        }
        let canonical = p.canonicalize().map_err(|_| "source-unavailable")?;
        let meta = fs::symlink_metadata(&canonical).map_err(|_| "source-unavailable")?;
        if !meta.is_file() || meta.file_type().is_symlink() || is_reparse(&meta) {
            return Err("source-not-regular");
        }
        let ext = canonical
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !supported_archive_name(&ext) {
            return Err("unsupported-archive");
        }
        let dir = canonical.parent().ok_or("invalid-path")?.to_path_buf();
        if parent.as_ref().is_some_and(|v| v != &dir) {
            return Err("different-parent-directories");
        }
        parent = Some(dir);
        let key = canonical.to_string_lossy().to_lowercase();
        if !seen.insert(key) {
            return Err("duplicate-path");
        }
        paths.push(canonical);
    }
    if paths.len() > 1 && !valid_volume_set(&paths) {
        return Err("invalid-volume-set");
    }
    if paths.len() == 1 {
        let name = paths[0]
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if volume_info(&name).is_some_and(|(_, index)| index != 1) {
            return Err("invalid-volume-set");
        }
    }
    if paths.len() > 1 {
        paths.sort_by_key(|p| volume_index(p.file_name().and_then(|x| x.to_str()).unwrap_or("")));
    }
    Ok(paths)
}
#[cfg(windows)]
fn is_reparse(m: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    m.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn is_reparse(_: &fs::Metadata) -> bool {
    false
}
fn supported_archive_name(n: &str) -> bool {
    let numeric_part_suffix = part_rar_digits(n).is_some();
    n.ends_with(".zip")
        || n.rsplit_once(".zip.")
            .is_some_and(|(_, tail)| volume_number(tail).is_some_and(|v| (1..=999).contains(&v)))
        || (n.ends_with(".rar") && (!numeric_part_suffix || part_rar_info(n).is_some()))
        || part_rar_info(n).is_some()
        || n.rsplit_once(".r")
            .is_some_and(|(_, tail)| tail.len() == 2 && tail.bytes().all(|b| b.is_ascii_digit()))
        || n.ends_with(".7z")
        || n.rsplit_once(".part").is_some_and(|(_, tail)| {
            tail.strip_suffix(".rar")
                .and_then(|s| s.parse::<u32>().ok())
                .is_some_and(|v| v > 0)
        })
        || n.rsplit_once(".7z.").is_some_and(|(_, tail)| {
            tail.len() == 3
                && tail.bytes().all(|b| b.is_ascii_digit())
                && tail.parse::<u16>().is_ok_and(|v| (1..=999).contains(&v))
        })
}
fn valid_volume_set(paths: &[PathBuf]) -> bool {
    let mut volumes: Vec<_> = paths
        .iter()
        .filter_map(|p| p.file_name()?.to_str().map(str::to_ascii_lowercase))
        .filter_map(|n| volume_info(&n).map(|(group, index)| (n, group, index)))
        .collect();
    if volumes.len() != paths.len() {
        return false;
    }
    volumes.sort_by_key(|(_, _, index)| *index);
    let Some((_, group, _)) = volumes.first() else {
        return false;
    };
    volumes
        .iter()
        .enumerate()
        .all(|(i, (_, g, index))| g == group && *index == i + 1)
}
fn volume_index(name: &str) -> usize {
    volume_info(name).map(|(_, index)| index).unwrap_or(0)
}
fn volume_number(s: &str) -> Option<usize> {
    if s.len() == 3 && s.bytes().all(|b| b.is_ascii_digit()) {
        s.parse().ok()
    } else {
        None
    }
}
fn volume_info(name: &str) -> Option<(String, usize)> {
    if let Some((group, index)) = part_rar_info(name) {
        return Some((group, index));
    }
    if let Some((prefix, tail)) = name.rsplit_once(".7z.") {
        let index = volume_number(tail)?;
        return Some((format!("7z:{prefix}"), index));
    }
    if let Some((prefix, tail)) = name.rsplit_once(".zip.") {
        let index = volume_number(tail)?;
        return Some((format!("zip:{prefix}"), index));
    }
    if let Some(prefix) = name.strip_suffix(".rar") {
        return Some((format!("legacy-rar:{prefix}"), 1));
    }
    if let Some((prefix, tail)) = name.rsplit_once(".r") {
        if tail.len() == 2 && tail.bytes().all(|b| b.is_ascii_digit()) {
            let index = tail.parse::<usize>().ok()?.checked_add(2)?;
            return Some((format!("legacy-rar:{prefix}"), index));
        }
    }
    None
}
fn part_rar_digits(name: &str) -> Option<(&str, &str)> {
    let (prefix, tail) = name.rsplit_once(".part")?;
    let digits = tail.strip_suffix(".rar")?;
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())).then_some((prefix, digits))
}
fn part_rar_info(name: &str) -> Option<(String, usize)> {
    let (prefix, digits) = part_rar_digits(name)?;
    let index = digits.parse::<usize>().ok()?;
    (index > 0).then(|| (format!("part-rar:{prefix}"), index))
}
fn fingerprints(paths: &[PathBuf]) -> Result<Vec<SourceFingerprint>, &'static str> {
    paths
        .iter()
        .map(|p| {
            let meta = fs::symlink_metadata(p).map_err(|_| "source-unavailable")?;
            if !meta.is_file() || meta.file_type().is_symlink() || is_reparse(&meta) {
                return Err("source-not-regular");
            }
            let modified_ns = meta
                .modified()
                .unwrap_or(SystemTime::UNIX_EPOCH)
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            Ok(SourceFingerprint {
                path: p.to_string_lossy().into_owned(),
                size: meta.len(),
                modified_ns,
            })
        })
        .collect()
}
fn request_path_key(raw: &str) -> Option<String> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return None;
    }
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Some(request_path_key_from_normalized(
        &normalized.to_string_lossy(),
    ))
}
fn request_path_key_from_normalized(path: &str) -> String {
    user_path(Path::new(path))
        .replace('/', "\\")
        .to_ascii_lowercase()
}
fn existing_job_matches_request(job: &Job, paths: &[String], secret_id: &str) -> bool {
    if job.secret_id != secret_id {
        return false;
    }
    let Some(mut request_keys) = paths
        .iter()
        .map(|path| request_path_key(path))
        .collect::<Option<Vec<_>>>()
    else {
        return false;
    };
    let Some(mut job_keys) = job
        .paths
        .iter()
        .map(|path| request_path_key(path))
        .collect::<Option<Vec<_>>>()
    else {
        return false;
    };
    request_keys.sort_unstable();
    job_keys.sort_unstable();
    if request_keys.is_empty() || request_keys != job_keys {
        return false;
    }
    let mut fingerprint_keys: Vec<String> = job
        .source_fingerprints
        .iter()
        .filter_map(|fingerprint| request_path_key(&fingerprint.path))
        .collect();
    fingerprint_keys.sort_unstable();
    if fingerprint_keys != job_keys {
        return false;
    }

    // Preserve the metadata fingerprint conflict check when source files still
    // exist, while allowing a recorded terminal result to be read after the
    // original downloads have been removed.
    job.source_fingerprints.iter().all(|expected| {
        let path = Path::new(&expected.path);
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return true,
            Err(_) => return false,
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse(&metadata) {
            return false;
        }
        let modified_ns = metadata
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        metadata.len() == expected.size && modified_ns == expected.modified_ns
    })
}

fn handle(req: Request) -> Reply {
    match req {
        Request::Ping => {
            let r = match ensure_root() {
                Ok(v) => v,
                Err(_) => return Reply::error("storage-unavailable"),
            };
            cleanup_expired_secrets(&r);
            Reply {
                ok: true,
                version: Some(VERSION.into()),
                seven_zip_available: Some(seven_zip_path(&r).is_some()),
                status: None,
                output_dir: None,
                error_code: None,
            }
        }
        Request::StoreSecret { id, password } => {
            if !valid_id(&id) {
                return Reply::error("invalid-id");
            }
            if password.len() > MAX_PASSWORD {
                return Reply::error("password-too-long");
            }
            let r = match ensure_root() {
                Ok(v) => v,
                Err(_) => return Reply::error("storage-unavailable"),
            };
            cleanup_expired_secrets(&r);
            match protect(password.as_bytes())
                .and_then(|b| atomic_bytes(&r.join("secrets").join(format!("{id}.bin")), &b))
            {
                Ok(()) => Reply::simple(),
                Err(_) => Reply::error("secret-storage-failed"),
            }
        }
        Request::ForgetSecret { id } => {
            if !valid_id(&id) {
                return Reply::error("invalid-id");
            }
            match ensure_root()
                .and_then(|r| fs::remove_file(r.join("secrets").join(format!("{id}.bin"))))
            {
                Ok(()) => Reply::simple(),
                Err(e) if e.kind() == io::ErrorKind::NotFound => Reply::simple(),
                Err(_) => Reply::error("secret-storage-failed"),
            }
        }
        Request::Status { id } => {
            if !valid_id(&id) {
                return Reply::error("invalid-id");
            }
            let r = match root() {
                Ok(r) => r,
                Err(_) => return Reply::error("storage-unavailable"),
            };
            cleanup_expired_secrets(&r);
            match load_job(&r, &id) {
                Ok(j) => reply_job(reconcile_job(&r, &id, j)),
                Err(e) => Reply::error(job_load_error_code(&e)),
            }
        }
        Request::Start {
            id,
            paths,
            secret_id,
        } => {
            if !valid_id(&id) || !valid_id(&secret_id) {
                return Reply::error("invalid-id");
            }
            let r = match ensure_root() {
                Ok(v) => v,
                Err(_) => return Reply::error("storage-unavailable"),
            };
            if fs::create_dir_all(r.join("jobs")).is_err() {
                return Reply::error("job-state-failed");
            }
            let _job_lock = match acquire_lock(r.join("jobs").join(format!("{id}.lock")), false) {
                Ok(v) => v,
                Err(_) => return Reply::error("job-busy"),
            };
            let state = state_path(&r, &id);
            let existing = load_job(&r, &id);
            match existing {
                Ok(mut existing) => {
                    if !existing_job_matches_request(&existing, &paths, &secret_id) {
                        return Reply::error("job-conflict");
                    }
                    if matches!(existing.status.as_str(), "queued" | "extracting")
                        && !existing.worker_pid.is_some_and(process_is_alive)
                    {
                        existing.status = "failed".into();
                        existing.error_code = Some("worker-lost".into());
                        existing.worker_pid = None;
                        let _ = atomic_json(&state, &existing);
                        return reply_job(existing);
                    }
                    if matches!(
                        existing.status.as_str(),
                        "complete" | "failed" | "queued" | "extracting"
                    ) {
                        return reply_job(existing);
                    }
                    return Reply::error("job-state-invalid");
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(_) => return Reply::error("job-state-invalid"),
            }

            let validated = match validate_archive_paths(&paths) {
                Ok(v) => v,
                Err(e) => return Reply::error(e),
            };
            let canonical_strings: Vec<String> = validated
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            let source_fingerprints = match fingerprints(&validated) {
                Ok(v) => v,
                Err(e) => return Reply::error(e),
            };
            match read_secret_blob(&r, &secret_id) {
                Ok(_) => {}
                Err("secret-expired") => return Reply::error("secret-expired"),
                Err("secret-unavailable") => return Reply::error("secret-not-found"),
                Err(code) => return Reply::error(code),
            }
            let mut j = Job {
                id: id.clone(),
                paths: canonical_strings,
                source_fingerprints,
                secret_id,
                status: "queued".into(),
                output_dir: None,
                error_code: None,
                worker_pid: None,
            };
            let _dispatch_lock = {
                let lock = match acquire_lock(r.join("dispatch.lock"), false) {
                    Ok(lock) => lock,
                    Err(_) => return Reply::error("worker-capacity"),
                };
                match active_worker_count(&r) {
                    Ok(count) if count < MAX_WORKERS => lock,
                    _ => return Reply::error("worker-capacity"),
                }
            };
            j.status = "queued".into();
            j.worker_pid = None;
            if atomic_json(&state, &j).is_err() {
                return Reply::error("job-state-failed");
            }
            let exe = match env::current_exe() {
                Ok(v) => v,
                Err(_) => return Reply::error("worker-start-failed"),
            };
            let mut child = match spawn_with_breakaway_retry(|breakaway| {
                let mut cmd = Command::new(&exe);
                cmd.arg("--worker")
                    .arg(&id)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
                    let breakaway_flag = if breakaway {
                        CREATE_BREAKAWAY_FROM_JOB
                    } else {
                        0
                    };
                    cmd.creation_flags(0x08000000 | 0x00000008 | breakaway_flag);
                }
                cmd.spawn()
            }) {
                Ok(child) => child,
                Err(_) => return Reply::error("worker-start-failed"),
            };
            j.worker_pid = Some(child.id());
            if atomic_json(&state, &j).is_err() {
                // The child is blocked on this job lock. Stop it before releasing
                // the lock so a failed PID commit cannot launch untracked work.
                let _ = child.kill();
                let _ = child.wait();
                return Reply::error("job-state-failed");
            }
            reply_job(j)
        }
    }
}
fn atomic_bytes(path: &Path, b: &[u8]) -> io::Result<()> {
    atomic_write_with(path, |file| file.write_all(b), File::sync_all, replace_file)
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let from_w: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_w: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        MoveFileExW(
            from_w.as_ptr(),
            to_w.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(h, &mut code);
        CloseHandle(h);
        ok != 0 && code == 259
    }
}
#[cfg(not(windows))]
fn process_is_alive(_: u32) -> bool {
    false
}

#[cfg(windows)]
fn protect(data: &[u8]) -> io::Result<Vec<u8>> {
    dpapi(data, true)
}
#[cfg(not(windows))]
fn protect(_: &[u8]) -> io::Result<Vec<u8>> {
    Err(io::Error::other("Windows-only DPAPI"))
}
#[cfg(windows)]
fn unprotect(data: &[u8]) -> io::Result<Vec<u8>> {
    dpapi(data, false)
}
#[cfg(not(windows))]
fn unprotect(_: &[u8]) -> io::Result<Vec<u8>> {
    Err(io::Error::other("Windows-only DPAPI"))
}
#[cfg(windows)]
fn dpapi(data: &[u8], encrypt: bool) -> io::Result<Vec<u8>> {
    use std::{mem::zeroed, ptr::null_mut};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
        },
    };
    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output: CRYPT_INTEGER_BLOB = zeroed();
        let ok = if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                null_mut(),
                null_mut(),
                null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &mut input,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as *mut _);
        Ok(bytes)
    }
}

fn read_request() -> io::Result<Option<Request>> {
    let mut stdin = io::stdin().lock();
    let mut len = [0u8; 4];
    if stdin.read(&mut len[..1])? == 0 {
        return Ok(None);
    }
    stdin.read_exact(&mut len[1..])?;
    let n = u32::from_le_bytes(len) as usize;
    if n == 0 || n > MAX_MESSAGE {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "message size"));
    }
    let mut data = vec![0; n];
    stdin.read_exact(&mut data)?;
    serde_json::from_slice(&data)
        .map(Some)
        .map_err(io::Error::other)
}
fn write_reply(reply: &Reply) -> io::Result<()> {
    let bytes = serde_json::to_vec(reply).map_err(io::Error::other)?;
    let len = u32::try_from(bytes.len()).map_err(io::Error::other)?;
    let mut out = io::stdout().lock();
    out.write_all(&len.to_le_bytes())?;
    out.write_all(&bytes)?;
    out.flush()
}

fn worker(id: &str) {
    if !valid_id(id) {
        return;
    }
    let Ok(r) = ensure_root() else {
        return;
    };
    let Ok(_queue_lock) = acquire_lock(r.join("worker.lock"), true) else {
        mark_worker_failure(&r, id, "queue-timeout");
        return;
    };
    let Ok(_job_lock) = acquire_lock(r.join("jobs").join(format!("{id}.lock")), true) else {
        mark_worker_failure(&r, id, "queue-timeout");
        return;
    };
    let mut job = match load_job(&r, id) {
        Ok(v) => v,
        Err(_) => return,
    };
    if job.status != "queued" {
        return;
    }
    job.status = "extracting".into();
    job.worker_pid = Some(std::process::id());
    let state = state_path(&r, id);
    if let Err(error) = persist_extracting_state(&state, &mut job) {
        eprintln!(
            "QueueCat worker could not persist extracting state: {:?}",
            error.kind()
        );
        return;
    }
    drop(_job_lock);
    let outcome = run_extraction(&r, &job);
    match outcome {
        Ok(dir) => {
            job.status = "complete".into();
            job.output_dir = Some(user_path(&dir));
            job.error_code = None;
        }
        Err(code) => {
            job.status = "failed".into();
            job.error_code = Some(code.into());
        }
    }
    job.worker_pid = None;
    if let Err(error) = persist_terminal_job(&r, id, &job) {
        // Never silently abandon the result after extraction. The persisted
        // extracting state will reconcile to worker-lost if storage stays
        // unavailable; the nonzero child exit also makes this failure explicit.
        eprintln!(
            "QueueCat worker could not persist terminal state: {:?}",
            error.kind()
        );
        std::process::exit(1);
    }
}

fn persist_terminal_job(r: &Path, id: &str, job: &Job) -> io::Result<()> {
    let _job_lock = acquire_lock(r.join("jobs").join(format!("{id}.lock")), true)?;
    atomic_json(&state_path(r, id), job)
}

fn persist_extracting_state(path: &Path, job: &mut Job) -> io::Result<()> {
    persist_extracting_state_with(path, job, atomic_json)
}
fn persist_extracting_state_with(
    path: &Path,
    job: &mut Job,
    mut persist: impl FnMut(&Path, &Job) -> io::Result<()>,
) -> io::Result<()> {
    match persist(path, job) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            job.status = "failed".into();
            job.error_code = Some("job-state-failed".into());
            job.worker_pid = None;
            persist(path, job)?;
            Err(first_error)
        }
    }
}

fn mark_worker_failure(r: &Path, id: &str, code: &str) {
    let Ok(_lock) = acquire_lock(r.join("jobs").join(format!("{id}.lock")), false) else {
        return;
    };
    let Ok(mut job) = load_job(r, id) else {
        return;
    };
    if matches!(job.status.as_str(), "queued" | "extracting")
        && job.worker_pid == Some(std::process::id())
    {
        job.status = "failed".into();
        job.error_code = Some(code.into());
        job.worker_pid = None;
        let _ = atomic_json(&state_path(r, id), &job);
    }
}

fn run_extraction(r: &Path, job: &Job) -> Result<PathBuf, &'static str> {
    let seven = seven_zip_path(r).ok_or("seven-zip-unavailable")?;
    let source = validate_archive_paths(&job.paths).map_err(|_| "source-changed")?;
    let _source_guards = lock_sources(&source).map_err(|_| "source-changed")?;
    if fingerprints(&source).map_err(|_| "source-changed")? != job.source_fingerprints {
        return Err("source-changed");
    }
    let secret_file = read_secret_blob(r, &job.secret_id)?;
    let password = unprotect(&secret_file).map_err(|_| "secret-unavailable")?;
    if password.len() > MAX_PASSWORD {
        return Err("secret-invalid");
    }
    let pass = String::from_utf8(password).map_err(|_| "secret-invalid")?;
    let original_archive = source.first().ok_or("source-changed")?;
    let parent = original_archive.parent().ok_or("source-changed")?;
    let input_stage = create_input_stage(parent, &source)?;
    let _input_cleanup = DirectoryCleanup(input_stage.clone());
    let staged_paths: Vec<PathBuf> = source
        .iter()
        .map(|p| input_stage.join(p.file_name().unwrap()))
        .collect();
    if fingerprints(&source).map_err(|_| "source-changed")? != job.source_fingerprints {
        return Err("source-changed");
    }
    let archive = staged_paths.first().ok_or("source-changed")?;
    let listing = bounded_7z(&seven, &["l", "-slt"], archive, &pass)?;
    let unpacked_size = inspect_listing(&String::from_utf8_lossy(&listing))?;
    let free = available_space(parent).ok_or("space-check-unavailable")?;
    if free < unpacked_size.saturating_add(64 * 1024 * 1024) {
        return Err("insufficient-space");
    }
    run_7z_quiet(&seven, "t", archive, &pass).map_err(|error| {
        if error.kind() == io::ErrorKind::TimedOut {
            "engine-timeout"
        } else {
            "archive-test-failed"
        }
    })?;
    let base = archive
        .file_stem()
        .and_then(|x| x.to_str())
        .filter(|s| !s.is_empty())
        .ok_or("source-changed")?;
    let mut staging = None;
    for n in 0..1000u32 {
        let candidate = parent.join(format!(
            ".{base}.queuecat-staging-{}-{n}",
            std::process::id()
        ));
        match fs::create_dir(&candidate) {
            Ok(()) => {
                staging = Some(candidate);
                break;
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("output-create-failed"),
        }
    }
    let staging = staging.ok_or("output-create-failed")?;
    let _output_cleanup = DirectoryCleanup(staging.clone());
    if let Err(error) = run_7z_quiet_extract(&seven, &staging, archive, &pass) {
        let _ = fs::remove_dir_all(&staging);
        return Err(if error.kind() == io::ErrorKind::TimedOut {
            "engine-timeout"
        } else {
            "extract-failed"
        });
    }
    if tree_has_link_or_reparse(&staging).map_err(|_| "output-check-failed")? {
        let _ = fs::remove_dir_all(&staging);
        return Err("unsafe-output");
    }
    if fingerprints(&source).map_err(|_| "source-changed")? != job.source_fingerprints {
        let _ = fs::remove_dir_all(&staging);
        return Err("source-changed");
    }
    let mut final_dir = None;
    for n in 0..1000u32 {
        let suffix = if n == 0 {
            String::new()
        } else {
            format!(" ({n})")
        };
        let candidate = parent.join(format!("{base} (extracted){suffix}"));
        match rename_no_replace(&staging, &candidate) {
            Ok(()) => {
                final_dir = Some(candidate);
                break;
            }
            Err(e)
                if e.kind() == io::ErrorKind::AlreadyExists
                    || e.kind() == io::ErrorKind::PermissionDenied
                    || matches!(e.raw_os_error(), Some(80) | Some(183)) =>
            {
                continue;
            }
            Err(_) => {
                let _ = fs::remove_dir_all(&staging);
                return Err("output-finalize-failed");
            }
        }
    }
    final_dir.ok_or_else(|| {
        let _ = fs::remove_dir_all(&staging);
        "output-finalize-failed"
    })
}
#[cfg(windows)]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileW;
    let from_w: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_w: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileW(from_w.as_ptr(), to_w.as_ptr()) } == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}
#[cfg(windows)]
fn lock_sources(paths: &[PathBuf]) -> io::Result<Vec<File>> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
    paths
        .iter()
        .map(|p| {
            OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ)
                .open(p)
        })
        .collect()
}
#[cfg(not(windows))]
fn lock_sources(paths: &[PathBuf]) -> io::Result<Vec<File>> {
    paths.iter().map(File::open).collect()
}

struct DirectoryCleanup(PathBuf);
impl Drop for DirectoryCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn create_input_stage(parent: &Path, paths: &[PathBuf]) -> Result<PathBuf, &'static str> {
    let total_bytes = paths
        .iter()
        .try_fold(0u64, |sum, p| sum.checked_add(fs::metadata(p).ok()?.len()))
        .ok_or("source-unavailable")?;
    if total_bytes > 100 * 1024 * 1024 * 1024 {
        return Err("input-too-large");
    }
    let mut stage = None;
    for n in 0..1000u32 {
        let candidate = parent.join(format!(".queuecat-input-{}-{n}", std::process::id()));
        match fs::create_dir(&candidate) {
            Ok(()) => {
                stage = Some(candidate);
                break;
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("input-stage-failed"),
        }
    }
    let stage = stage.ok_or("input-stage-failed")?;
    for source in paths {
        let meta = match fs::symlink_metadata(source) {
            Ok(m) if m.is_file() && !m.file_type().is_symlink() && !is_reparse(&m) => m,
            _ => {
                let _ = fs::remove_dir_all(&stage);
                return Err("source-changed");
            }
        };
        let name = match source.file_name() {
            Some(v) => v,
            None => {
                let _ = fs::remove_dir_all(&stage);
                return Err("source-changed");
            }
        };
        let dest = stage.join(name);
        if fs::hard_link(source, &dest).is_err() {
            if available_space(parent)
                .is_none_or(|free| free < meta.len().saturating_add(64 * 1024 * 1024))
            {
                let _ = fs::remove_dir_all(&stage);
                return Err("insufficient-space");
            }
            if fs::copy(source, &dest).is_err() {
                let _ = fs::remove_dir_all(&stage);
                return Err("input-stage-failed");
            }
        }
    }
    Ok(stage)
}
#[cfg(windows)]
fn available_space(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut free = 0u64;
    (unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } != 0)
        .then_some(free)
}
#[cfg(not(windows))]
fn available_space(_: &Path) -> Option<u64> {
    None
}

#[cfg(windows)]
struct ChildJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(not(windows))]
struct ChildJob;

#[cfg(windows)]
impl Drop for ChildJob {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(windows)]
fn contain_child(child: &Child) -> io::Result<ChildJob> {
    use std::{mem::size_of, os::windows::io::AsRawHandle, ptr::null};
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, SetInformationJobObject,
        },
    };
    let handle = unsafe { CreateJobObjectW(null(), null()) };
    if handle.is_null() {
        return Err(io::Error::last_os_error());
    }
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let configured = unsafe {
        SetInformationJobObject(
            handle,
            9, // JobObjectExtendedLimitInformation
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    let assigned = configured != 0
        && unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as _) } != 0;
    if !assigned {
        let error = io::Error::last_os_error();
        unsafe { CloseHandle(handle) };
        return Err(error);
    }
    Ok(ChildJob(handle))
}

#[cfg(not(windows))]
fn contain_child(_: &Child) -> io::Result<ChildJob> {
    Ok(ChildJob)
}

#[cfg(windows)]
fn terminate_child_job(job: &ChildJob) {
    unsafe {
        windows_sys::Win32::System::JobObjects::TerminateJobObject(job.0, 1);
    }
}
#[cfg(not(windows))]
fn terminate_child_job(_: &ChildJob) {}

fn wait_child(child: &mut Child, job: &ChildJob, timeout: Duration) -> io::Result<ExitStatus> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                terminate_child_job(job);
                let _ = child.kill();
                let _ = child.wait();
                return Err(io::Error::new(io::ErrorKind::TimedOut, "engine timeout"));
            }
            Err(error) => {
                terminate_child_job(job);
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }
    }
}

fn run_7z_quiet(exe: &Path, operation: &str, archive: &Path, password: &str) -> io::Result<()> {
    run_7z(exe, operation, None, archive, password)
}
fn run_7z_quiet_extract(
    exe: &Path,
    output: &Path,
    archive: &Path,
    password: &str,
) -> io::Result<()> {
    run_7z(exe, "x", Some(output), archive, password)
}
fn run_7z(
    exe: &Path,
    operation: &str,
    output: Option<&Path>,
    archive: &Path,
    password: &str,
) -> io::Result<()> {
    let mut cmd = Command::new(exe);
    cmd.arg(operation).arg("-y");
    if operation == "x" {
        cmd.arg("-aos");
    }
    if let Some(dir) = output {
        cmd.arg(format!("-o{}", dir.display()));
    }
    cmd.arg(format!("-p{password}"))
        .arg(archive)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd.spawn()?;
    let job = match contain_child(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let status = wait_child(&mut child, &job, ENGINE_TIMEOUT)?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other("7-Zip operation failed"))
    }
}
fn bounded_7z(
    exe: &Path,
    op: &[&str],
    archive: &Path,
    password: &str,
) -> Result<Vec<u8>, &'static str> {
    let mut c = Command::new(exe);
    for a in op {
        c.arg(a);
    }
    c.arg(format!("-p{password}"))
        .arg(archive)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    let mut child = c.spawn().map_err(|_| "seven-zip-failed")?;
    let job = match contain_child(&child) {
        Ok(job) => job,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("seven-zip-failed");
        }
    };
    let stdout = child.stdout.take().ok_or("seven-zip-failed")?;
    let (tx, rx) = mpsc::sync_channel(1);
    let reader = thread::spawn(move || {
        let mut out = Vec::new();
        let result = stdout
            .take((MAX_LISTING + 1) as u64)
            .read_to_end(&mut out)
            .map(|_| out);
        let _ = tx.send(result);
    });
    let deadline = Instant::now() + ENGINE_TIMEOUT;
    let mut listing = None;
    loop {
        match rx.try_recv() {
            Ok(Ok(bytes)) if bytes.len() > MAX_LISTING => {
                terminate_child_job(&job);
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("archive-listing-too-large");
            }
            Ok(Ok(bytes)) => listing = Some(bytes),
            Ok(Err(_)) => {
                terminate_child_job(&job);
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("seven-zip-failed");
            }
            Err(mpsc::TryRecvError::Disconnected) if listing.is_none() => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("seven-zip-failed");
            }
            _ => {}
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if listing.is_none() {
                    terminate_child_job(&job);
                    listing = rx
                        .recv_timeout(Duration::from_secs(5))
                        .ok()
                        .and_then(Result::ok);
                }
                let _ = reader.join();
                if !status.success() {
                    return Err("archive-preflight-failed");
                }
                return listing.ok_or("seven-zip-failed");
            }
            Err(_) => {
                terminate_child_job(&job);
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("seven-zip-failed");
            }
            Ok(None) if Instant::now() >= deadline => {
                terminate_child_job(&job);
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("engine-timeout");
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
        }
    }
}
fn inspect_listing(listing: &str) -> Result<u64, &'static str> {
    let mut entries = 0usize;
    let mut total_size = 0u64;
    let mut entry_section = false;
    for line in listing.lines() {
        if line.trim() == "----------" {
            entry_section = true;
            continue;
        }
        if !entry_section {
            continue;
        }
        if let Some(size) = line
            .strip_prefix("Size = ")
            .and_then(|s| s.parse::<u64>().ok())
        {
            total_size = total_size.checked_add(size).ok_or("archive-too-large")?;
            if total_size > 100 * 1024 * 1024 * 1024 {
                return Err("archive-too-large");
            }
        }
        let Some(value) = line.strip_prefix("Path = ") else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        entries += 1;
        if entries > 100_000 {
            return Err("too-many-entries");
        }
        let normalized = value.replace('\\', "/");
        let normalized = normalized.trim_end_matches('/');
        if normalized.is_empty()
            || normalized.starts_with('/')
            || normalized.starts_with("//")
            || normalized.contains(':')
            || normalized.split('/').any(|p| p == ".." || p.is_empty())
        {
            return Err("unsafe-archive-path");
        }
        for part in normalized.split('/') {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            if [
                "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$", "COM1", "COM2", "COM3", "COM4",
                "COM5", "COM6", "COM7", "COM8", "COM9", "COM¹", "COM²", "COM³", "LPT1", "LPT2",
                "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "LPT¹", "LPT²", "LPT³",
            ]
            .contains(&stem.as_str())
                || part.ends_with('.')
                || part.ends_with(' ')
                || part.chars().any(|c| c < ' ' || "<>\"|?*".contains(c))
            {
                return Err("unsafe-archive-path");
            }
        }
    }
    if listing.lines().any(|line| {
        ["Symbolic Link = ", "Hard Link = "].iter().any(|field| {
            line.strip_prefix(field)
                .is_some_and(|target| !target.trim().is_empty())
        })
    }) {
        return Err("archive-links-not-allowed");
    }
    Ok(total_size)
}
fn tree_has_link_or_reparse(dir: &Path) -> io::Result<bool> {
    for e in fs::read_dir(dir)? {
        let e = e?;
        let m = fs::symlink_metadata(e.path())?;
        if m.file_type().is_symlink() || is_reparse(&m) {
            return Ok(true);
        }
        if m.is_dir() && tree_has_link_or_reparse(&e.path())? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.get(1).map(String::as_str) == Some("--worker") {
        if let Some(id) = args.get(2) {
            worker(id);
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("--protocol-smoke") {
        let mut out = io::stdout().lock();
        let _ = out.write_all(HOST_NAME.as_bytes());
        return;
    }
    loop {
        match std::panic::catch_unwind(|| read_request()) {
            Ok(Ok(Some(request))) => {
                let reply = std::panic::catch_unwind(|| handle(request))
                    .unwrap_or_else(|_| Reply::error("internal-error"));
                if write_reply(&reply).is_err() {
                    break;
                }
            }
            Ok(Ok(None)) => break,
            _ => {
                let _ = write_reply(&Reply::error("invalid-request"));
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_ids() {
        assert!(valid_id("a_A-9"));
        assert!(!valid_id("../x"));
        assert!(!valid_id(""));
        assert!(!valid_id(&"x".repeat(129)));
    }
    #[test]
    fn normalizes_extended_and_regular_unc_paths_identically() {
        let extended = r"\\?\UNC\server\share\folder\archive.zip";
        let ordinary = r"\\server\share\folder\archive.zip";
        assert_eq!(
            request_path_key_from_normalized(extended),
            request_path_key_from_normalized(ordinary)
        );
        assert_eq!(
            request_path_key_from_normalized(r"\\?\C:\Folder\archive.zip"),
            request_path_key_from_normalized(r"C:\Folder\archive.zip")
        );
    }
    #[test]
    fn accepts_only_known_archive_shapes() {
        for n in [
            "one.zip",
            "a.part1.rar",
            "a.part01.rar",
            "my.part.rar",
            "my.partial.rar",
            "my.partial.7z.001",
            "my.partial.zip.001",
            "a.7z.001",
            "a.zip.001",
            "a.r00",
            "thing.rar",
            "a.7z",
        ] {
            assert!(supported_archive_name(n), "{n}");
        }
        for n in ["a.exe", "a.rar.exe", "a.7z.000", "a.part0.rar", "a.zip.000"] {
            assert!(!supported_archive_name(n), "{n}");
        }
    }
    #[test]
    fn rejects_unsafe_archive_paths() {
        for n in [
            "Path = ../x",
            "Path = C:/x",
            "Path = /etc/x",
            "Path = dir/../x",
            "Path = con.txt",
        ] {
            assert!(inspect_listing(&format!("----------\n{n}")).is_err(), "{n}");
        }
        assert!(inspect_listing("----------\nPath = folder/file.txt").is_ok());
        assert!(inspect_listing("----------\nPath = folder/").is_ok());
    }
    #[test]
    fn empty_rar_link_metadata_is_allowed_but_link_targets_are_rejected() {
        let ordinary_rar5_entry =
            "----------\nPath = regular.bin\nSize = 12\nSymbolic Link = \nHard Link = \n";
        assert_eq!(inspect_listing(ordinary_rar5_entry), Ok(12));

        for link_field in [
            "Symbolic Link = target.txt",
            "Hard Link = target.txt",
            "Symbolic Link =   target.txt  ",
            "Hard Link =   target.txt  ",
        ] {
            let listing = format!("----------\nPath = entry\n{link_field}\n");
            assert_eq!(
                inspect_listing(&listing),
                Err("archive-links-not-allowed"),
                "{link_field}"
            );
        }
    }
    #[test]
    fn protocol_uses_chrome_little_endian_length_prefix() {
        let b = serde_json::to_vec(&Reply::error("x")).unwrap();
        assert_eq!(
            u32::from_le_bytes((b.len() as u32).to_le_bytes()) as usize,
            b.len()
        );
    }
    #[test]
    fn reject_unknown_request_fields_and_ops() {
        assert!(
            serde_json::from_str::<Request>(
                r#"{"op":"start","id":"x","paths":[],"secretId":"s","admin":true}"#
            )
            .is_err()
        );
        assert!(serde_json::from_str::<Request>(r#"{"op":"run","path":"x"}"#).is_err());
    }
    #[test]
    fn accepts_v1_camel_case_fields_only() {
        assert!(
            serde_json::from_str::<Request>(
                r#"{"op":"start","id":"x","paths":["C:\\x.zip"],"secretId":"s"}"#
            )
            .is_ok()
        );
        assert!(
            serde_json::from_str::<Request>(
                r#"{"op":"start","id":"x","paths":[],"secret_id":"s"}"#
            )
            .is_err()
        );
    }
    #[test]
    fn volume_sets_are_contiguous_and_share_a_basename() {
        assert!(valid_volume_set(&[
            PathBuf::from("a.7z.001"),
            PathBuf::from("a.7z.002")
        ]));
        assert!(!valid_volume_set(&[
            PathBuf::from("a.7z.001"),
            PathBuf::from("b.7z.002")
        ]));
        assert!(!valid_volume_set(&[
            PathBuf::from("a.7z.001"),
            PathBuf::from("a.7z.003")
        ]));
        assert!(valid_volume_set(&[
            PathBuf::from("a.part01.rar"),
            PathBuf::from("a.part02.rar")
        ]));
        assert!(valid_volume_set(&[
            PathBuf::from("a.part1.rar"),
            PathBuf::from("a.part2.rar")
        ]));
        assert!(valid_volume_set(&[
            PathBuf::from("a.part001.rar"),
            PathBuf::from("a.part002.rar")
        ]));
        assert!(!valid_volume_set(&[
            PathBuf::from("a.part02.rar"),
            PathBuf::from("a.part03.rar")
        ]));
        assert!(!valid_volume_set(&[
            PathBuf::from("a.part0.rar"),
            PathBuf::from("a.part1.rar")
        ]));
        assert!(valid_volume_set(&[
            PathBuf::from("a.zip.002"),
            PathBuf::from("a.zip.001")
        ]));
        assert!(!valid_volume_set(&[
            PathBuf::from("a.zip.001"),
            PathBuf::from("b.zip.002")
        ]));
        assert!(valid_volume_set(&[
            PathBuf::from("a.r01"),
            PathBuf::from("a.rar"),
            PathBuf::from("a.r00")
        ]));
        assert!(!valid_volume_set(&[
            PathBuf::from("a.rar"),
            PathBuf::from("a.r01")
        ]));
        assert_eq!(volume_index("a.r00"), 2);
        assert_eq!(volume_index("a.r01"), 3);
        assert_eq!(
            volume_info("my.part01.rar"),
            Some(("part-rar:my".into(), 1))
        );
        assert_eq!(volume_info("my.part1.rar"), Some(("part-rar:my".into(), 1)));
        assert_eq!(
            volume_info("my.part001.rar"),
            Some(("part-rar:my".into(), 1))
        );
        assert_eq!(part_rar_info("my.partfoo.rar"), None);
        assert_eq!(part_rar_info("my.part0.rar"), None);
        assert_eq!(
            volume_info("my.part.rar"),
            Some(("legacy-rar:my.part".into(), 1))
        );
        assert_eq!(
            volume_info("my.partial.rar"),
            Some(("legacy-rar:my.partial".into(), 1))
        );
        assert_eq!(
            volume_info("my.partial.7z.001"),
            Some(("7z:my.partial".into(), 1))
        );
        assert_eq!(
            volume_info("my.partial.zip.001"),
            Some(("zip:my.partial".into(), 1))
        );
    }
    #[test]
    fn secret_ttl_uses_seven_day_file_age() {
        let modified = UNIX_EPOCH + Duration::from_secs(1000);
        let fresh = modified + SECRET_TTL - Duration::from_secs(1);
        let expired = modified + SECRET_TTL;
        assert!(!secret_expired_at(modified, fresh));
        assert!(secret_expired_at(modified, expired));
        assert!(secret_expired_at(expired, modified));
    }
    #[test]
    fn cleanup_removes_only_a_bounded_batch_of_expired_secrets() {
        let root = env::temp_dir().join(format!(
            "queuecat-secret-cleanup-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let secrets = root.join("secrets");
        fs::create_dir_all(&secrets).unwrap();
        for i in 0..SECRET_CLEANUP_BATCH + 1 {
            fs::write(secrets.join(format!("secret{i}.bin")), b"encrypted").unwrap();
        }
        let old = UNIX_EPOCH + Duration::from_secs(1);
        for entry in fs::read_dir(&secrets).unwrap() {
            let file = OpenOptions::new()
                .write(true)
                .open(entry.unwrap().path())
                .unwrap();
            file.set_times(fs::FileTimes::new().set_modified(old))
                .unwrap();
        }
        cleanup_expired_secrets(&root);
        assert_eq!(fs::read_dir(&secrets).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cleanup_cursor_advances_past_fresh_files_and_recovers_from_corruption() {
        let root = env::temp_dir().join(format!(
            "queuecat-secret-cursor-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let secrets = root.join("secrets");
        fs::create_dir_all(&secrets).unwrap();
        for i in 0..SECRET_CLEANUP_BATCH + 1 {
            fs::write(secrets.join(format!("fresh{i:03}.bin")), b"encrypted").unwrap();
        }
        for i in 0..SECRET_CLEANUP_BATCH {
            fs::write(secrets.join(format!("ineligible{i:03}.txt")), b"ignored").unwrap();
        }
        let expired = secrets.join("zz-expired.bin");
        fs::write(&expired, b"encrypted").unwrap();
        let old = UNIX_EPOCH + Duration::from_secs(1);
        OpenOptions::new()
            .write(true)
            .open(&expired)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(old))
            .unwrap();
        fs::write(root.join("secret-cleanup.cursor"), b"../../corrupt").unwrap();

        cleanup_expired_secrets(&root);
        assert!(
            expired.exists(),
            "the first bounded pass should stop before the tail"
        );
        assert_eq!(
            fs::read_to_string(root.join("secret-cleanup.cursor")).unwrap(),
            "fresh127"
        );

        // Mutations between passes must not strand the cursor or block the
        // tail behind unrelated filenames.
        fs::remove_file(secrets.join("fresh005.bin")).unwrap();
        fs::write(secrets.join("fresh130.bin"), b"encrypted").unwrap();
        cleanup_expired_secrets(&root);
        assert!(
            !expired.exists(),
            "a later bounded pass must reach the tail"
        );
        assert!(secrets.join("ineligible000.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn existing_job_replay_checks_paths_secret_and_source_fingerprint() {
        let root = env::temp_dir().join(format!(
            "queuecat-existing-job-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("fixture.7z");
        fs::write(&archive, b"archive").unwrap();
        let fingerprints = fingerprints(std::slice::from_ref(&archive)).unwrap();
        let path = archive.to_string_lossy().into_owned();
        let job = Job {
            id: "replay".into(),
            paths: vec![path.clone()],
            source_fingerprints: fingerprints,
            secret_id: "password".into(),
            status: "complete".into(),
            output_dir: Some(root.to_string_lossy().into_owned()),
            error_code: None,
            worker_pid: None,
        };
        assert!(existing_job_matches_request(
            &job,
            std::slice::from_ref(&path),
            "password"
        ));
        assert!(!existing_job_matches_request(
            &job,
            std::slice::from_ref(&path),
            "other"
        ));
        assert!(!existing_job_matches_request(
            &job,
            &[root.join("different.7z").to_string_lossy().into_owned()],
            "password"
        ));

        fs::write(&archive, b"different archive").unwrap();
        assert!(!existing_job_matches_request(
            &job,
            std::slice::from_ref(&path),
            "password"
        ));
        fs::remove_file(&archive).unwrap();
        assert!(existing_job_matches_request(
            &job,
            std::slice::from_ref(&path),
            "password"
        ));
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn terminal_lock_holder_child() {
        let Some(lock_path) = env::var_os("QUEUECAT_TEST_JOB_LOCK") else {
            return;
        };
        let ready_path = PathBuf::from(env::var_os("QUEUECAT_TEST_LOCK_READY").unwrap());
        let release_path = PathBuf::from(env::var_os("QUEUECAT_TEST_LOCK_RELEASE").unwrap());
        let _lock = acquire_lock(PathBuf::from(lock_path), false).unwrap();
        fs::write(ready_path, b"locked").unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        while !release_path.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            release_path.exists(),
            "parent did not release the test lock"
        );
    }
    #[cfg(windows)]
    #[test]
    fn terminal_commit_waits_for_job_lock_and_persists_complete_state() {
        let root = env::temp_dir().join(format!(
            "queuecat-terminal-lock-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("jobs")).unwrap();
        let id = "terminal-lock";
        let lock_path = root.join("jobs").join(format!("{id}.lock"));
        let ready_path = root.join("lock-ready");
        let release_path = root.join("lock-release");
        let mut job = Job {
            id: id.into(),
            paths: Vec::new(),
            source_fingerprints: Vec::new(),
            secret_id: "secret".into(),
            status: "extracting".into(),
            output_dir: None,
            error_code: None,
            worker_pid: Some(std::process::id()),
        };
        atomic_json(&state_path(&root, id), &job).unwrap();

        let mut holder = Command::new(env::current_exe().unwrap())
            .args([
                "--exact",
                "tests::terminal_lock_holder_child",
                "--nocapture",
            ])
            .env("QUEUECAT_TEST_JOB_LOCK", &lock_path)
            .env("QUEUECAT_TEST_LOCK_READY", &ready_path)
            .env("QUEUECAT_TEST_LOCK_RELEASE", &release_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !ready_path.exists() && Instant::now() < deadline {
            if holder.try_wait().unwrap().is_some() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        if !ready_path.exists() {
            let _ = holder.kill();
            let _ = holder.wait();
            panic!("separate process did not acquire the job lock");
        }

        job.status = "complete".into();
        job.output_dir = Some(root.to_string_lossy().into_owned());
        job.worker_pid = None;
        let root_for_writer = root.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (saved_tx, saved_rx) = mpsc::channel();
        let writer = thread::spawn(move || {
            started_tx.send(()).unwrap();
            saved_tx
                .send(persist_terminal_job(&root_for_writer, id, &job))
                .unwrap();
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let early_result = saved_rx.recv_timeout(Duration::from_millis(150));
        let waited_for_lock = matches!(early_result, Err(mpsc::RecvTimeoutError::Timeout));
        fs::write(&release_path, b"release").unwrap();
        let save_result = match early_result {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                saved_rx.recv_timeout(Duration::from_secs(5)).unwrap()
            }
            Err(error) => panic!("terminal writer channel failed: {error}"),
        };
        writer.join().unwrap();
        assert!(holder.wait().unwrap().success(), "lock-holder child failed");
        assert!(
            waited_for_lock,
            "terminal state write bypassed the held job lock"
        );
        save_result.unwrap();
        let saved = load_job(&root, id).unwrap();
        assert_eq!(saved.status, "complete");
        assert_eq!(
            saved.output_dir.as_deref(),
            Some(root.to_string_lossy().as_ref())
        );
        assert_eq!(saved.error_code, None);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn reading_expired_secret_deletes_and_rejects_it() {
        let root = env::temp_dir().join(format!(
            "queuecat-secret-read-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let secrets = root.join("secrets");
        fs::create_dir_all(&secrets).unwrap();
        let secret = secrets.join("expired.bin");
        fs::write(&secret, b"dpapi-ciphertext").unwrap();
        let old = SystemTime::now() - SECRET_TTL - Duration::from_secs(1);
        OpenOptions::new()
            .write(true)
            .open(&secret)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(old))
            .unwrap();
        assert_eq!(read_secret_blob(&root, "expired"), Err("secret-expired"));
        assert!(!secret.exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn worker_spawn_retries_without_breakaway_only_on_access_denied() {
        let mut flags = Vec::new();
        let result = spawn_with_breakaway_retry(|breakaway| {
            flags.push(breakaway);
            if breakaway {
                Err(io::Error::from_raw_os_error(
                    windows_sys::Win32::Foundation::ERROR_ACCESS_DENIED as i32,
                ))
            } else {
                Ok("spawned")
            }
        })
        .unwrap();
        assert_eq!(result, "spawned");
        assert_eq!(flags, [true, false]);

        let mut calls = 0;
        let error = spawn_with_breakaway_retry::<()>(|_| {
            calls += 1;
            Err(io::Error::other("other spawn failure"))
        })
        .unwrap_err();
        assert_eq!(error.to_string(), "other spawn failure");
        assert_eq!(calls, 1);
    }
    #[test]
    fn missing_and_corrupt_job_states_have_different_errors() {
        assert_eq!(
            job_load_error_code(&io::Error::from(io::ErrorKind::NotFound)),
            "job-not-found"
        );
        assert_eq!(
            job_load_error_code(&io::Error::from(io::ErrorKind::InvalidData)),
            "job-state-invalid"
        );
    }
    #[test]
    fn atomic_writes_remove_temp_files_after_write_sync_and_replace_failures() {
        let root = env::temp_dir().join(format!(
            "queuecat-atomic-cleanup-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("state.json");
        let temp = target.with_extension(format!("tmp-{}", std::process::id()));

        let write_failure = atomic_write_with(
            &target,
            |_| Err(io::Error::other("injected write failure")),
            File::sync_all,
            replace_file,
        );
        assert!(write_failure.is_err());
        assert!(!temp.exists());

        let sync_failure = atomic_write_with(
            &target,
            |file| file.write_all(b"partial"),
            |_| Err(io::Error::other("injected sync failure")),
            replace_file,
        );
        assert!(sync_failure.is_err());
        assert!(!temp.exists());

        let replace_failure = atomic_write_with(
            &target,
            |file| file.write_all(b"complete"),
            File::sync_all,
            |_, _| Err(io::Error::other("injected replace failure")),
        );
        assert!(replace_failure.is_err());
        assert!(!temp.exists());

        let directory_target = root.join("blocked-target");
        fs::create_dir(&directory_target).unwrap();
        assert!(atomic_bytes(&directory_target, b"cannot replace directory").is_err());
        assert!(
            !directory_target
                .with_extension(format!("tmp-{}", std::process::id()))
                .exists()
        );

        // A same-process retry must not be blocked by a leftover PID-named temp.
        atomic_bytes(&target, b"retry succeeds").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"retry succeeds");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn extracting_state_failure_is_recorded_and_prevents_extraction() {
        let root = env::temp_dir().join(format!(
            "queuecat-extracting-state-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let mut job = Job {
            id: "initial-state-failure".into(),
            paths: Vec::new(),
            source_fingerprints: Vec::new(),
            secret_id: "secret".into(),
            status: "extracting".into(),
            output_dir: None,
            error_code: None,
            worker_pid: Some(std::process::id()),
        };
        let mut attempts = 0;
        let mut recorded = None;
        let result = persist_extracting_state_with(&root.join("job.json"), &mut job, |_, state| {
            attempts += 1;
            if attempts == 1 {
                Err(io::Error::other("injected first write failure"))
            } else {
                recorded = Some(state.clone());
                Ok(())
            }
        });
        assert!(
            result.is_err(),
            "a failed extracting-state write must stop the worker"
        );
        assert_eq!(attempts, 2, "the failed state should be retried once");
        let recorded = recorded.unwrap();
        assert_eq!(recorded.status, "failed");
        assert_eq!(recorded.error_code.as_deref(), Some("job-state-failed"));
        assert_eq!(recorded.worker_pid, None);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn worker_admission_counts_live_waiters_and_fails_closed_on_corruption() {
        let root = env::temp_dir().join(format!(
            "queuecat-admission-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let jobs = root.join("jobs");
        fs::create_dir_all(&jobs).unwrap();
        let job = Job {
            id: "live-waiter".into(),
            paths: Vec::new(),
            source_fingerprints: Vec::new(),
            secret_id: "secret".into(),
            status: "queued".into(),
            output_dir: None,
            error_code: None,
            worker_pid: Some(std::process::id()),
        };
        atomic_json(&state_path(&root, &job.id), &job).unwrap();
        assert_eq!(active_worker_count(&root).unwrap(), 1);

        let mut terminal = job.clone();
        terminal.id = "terminal".into();
        terminal.status = "complete".into();
        atomic_json(&state_path(&root, &terminal.id), &terminal).unwrap();
        assert_eq!(active_worker_count(&root).unwrap(), 1);

        fs::write(jobs.join("damaged.json"), b"not-json").unwrap();
        assert_eq!(active_worker_count(&root).unwrap(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn child_timeout_terminates_and_reaps_process() {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/C", "ping -n 8 127.0.0.1 > nul"])
            .creation_flags(0x08000000);
        let mut child = cmd.spawn().unwrap();
        let job = contain_child(&child).unwrap();
        let error = wait_child(&mut child, &job, Duration::from_millis(100)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(child.try_wait().unwrap().is_some());
    }
}
