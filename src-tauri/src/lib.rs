use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Папки, которые не показываем в дереве.
const IGNORED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "bin", "obj"];

/// Ограничения поиска по папке, чтобы огромные папки не подвешивали интерфейс.
const MAX_SEARCH_FILES: usize = 200;
const MAX_MATCHES_PER_FILE: usize = 20;
const MAX_LINE_CHARS: usize = 200;

/// Текущий наблюдатель за открытой папкой. Новый заменяет старый.
#[derive(Default)]
struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher>>>);

/// Открытая папка. Создавать, переименовывать и удалять разрешено только внутри неё.
#[derive(Default)]
struct RootState(Mutex<Option<PathBuf>>);

fn is_skipped_dir(name: &str) -> bool {
    name.starts_with('.') || IGNORED_DIRS.contains(&name)
}

#[derive(Serialize)]
struct TreeNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<TreeNode>,
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

/// Рекурсивно собирает дерево. Папки без markdown-файлов внутри отбрасываются,
/// кроме совсем пустых: их, скорее всего, только что создали под новые документы.
fn build_tree(dir: &Path, is_root: bool) -> Option<TreeNode> {
    let entries = fs::read_dir(dir).ok()?;
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let mut has_entries = false;

    for entry in entries.flatten() {
        has_entries = true;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(file_type) = entry.file_type() else { continue };

        if file_type.is_dir() {
            if is_skipped_dir(&name) {
                continue;
            }
            if let Some(node) = build_tree(&path, false) {
                dirs.push(node);
            }
        } else if file_type.is_file() && is_markdown(&path) {
            files.push(TreeNode {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    if !is_root && has_entries && dirs.is_empty() && files.is_empty() {
        return None;
    }

    let by_name = |a: &TreeNode, b: &TreeNode| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    dirs.sort_by(by_name);
    files.sort_by(by_name);
    dirs.extend(files);

    Some(TreeNode {
        name: dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| dir.to_string_lossy().into_owned()),
        path: dir.to_string_lossy().into_owned(),
        is_dir: true,
        children: dirs,
    })
}

#[tauri::command]
async fn read_tree(root: String) -> Result<Option<TreeNode>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("Папка не найдена: {root}"));
    }
    Ok(build_tree(root_path, true))
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать {path}: {e}"))
}

/// Атомарная запись: пишем во временный файл рядом и подменяем им оригинал,
/// чтобы сбой посреди записи не оставил документ обрезанным.
#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !is_markdown(&target) {
        return Err(format!("Можно сохранять только markdown-файлы: {path}"));
    }
    let (Some(dir), Some(name)) = (target.parent(), target.file_name()) else {
        return Err(format!("Некорректный путь: {path}"));
    };
    // Имя с точкой в начале: наблюдатель за папкой такие файлы пропускает.
    let tmp = dir.join(format!(".{}.md-reader-tmp", name.to_string_lossy()));

    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("Не удалось сохранить {path}: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Не удалось сохранить {path}: {e}")
    })
}

#[derive(Serialize)]
struct SearchMatch {
    line: usize,
    text: String,
}

#[derive(Serialize)]
struct SearchResult {
    path: String,
    matches: Vec<SearchMatch>,
}

fn collect_markdown_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else { continue };
        if file_type.is_dir() {
            if !is_skipped_dir(&entry.file_name().to_string_lossy()) {
                collect_markdown_files(&path, out);
            }
        } else if file_type.is_file() && is_markdown(&path) {
            out.push(path);
        }
    }
}

/// Поиск подстроки без учёта регистра по всем markdown-файлам папки.
fn search(root: &Path, query: &str) -> Vec<SearchResult> {
    let needle = query.to_lowercase();
    let mut files = Vec::new();
    collect_markdown_files(root, &mut files);
    files.sort();

    let mut results = Vec::new();
    for path in files {
        let Ok(content) = fs::read_to_string(&path) else { continue };
        let matches: Vec<SearchMatch> = content
            .lines()
            .enumerate()
            .filter(|(_, line)| line.to_lowercase().contains(&needle))
            .take(MAX_MATCHES_PER_FILE)
            .map(|(i, line)| SearchMatch {
                line: i + 1,
                text: line.trim().chars().take(MAX_LINE_CHARS).collect(),
            })
            .collect();
        if !matches.is_empty() {
            results.push(SearchResult {
                path: path.to_string_lossy().into_owned(),
                matches,
            });
            if results.len() >= MAX_SEARCH_FILES {
                break;
            }
        }
    }
    results
}

#[tauri::command]
async fn search_folder(root: String, query: String) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || search(Path::new(&root), &query))
        .await
        .map_err(|e| e.to_string())
}

/// Следит за папкой и шлёт во фронтенд событие "fs-changed" со списком изменённых путей.
#[tauri::command]
fn watch_folder(
    app: AppHandle,
    state: State<WatcherState>,
    root_state: State<RootState>,
    root: String,
) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    let watch_root = root_path.clone();

    let mut debouncer = new_debouncer(Duration::from_millis(300), move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let paths: Vec<String> = events
            .into_iter()
            .map(|event| event.path)
            .filter(|path| {
                // Изменения внутри .git, node_modules и т.п. нас не интересуют.
                let relative = path.strip_prefix(&watch_root).unwrap_or(path);
                !relative
                    .components()
                    .any(|c| is_skipped_dir(&c.as_os_str().to_string_lossy()))
            })
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
        if !paths.is_empty() {
            let _ = app.emit("fs-changed", paths);
        }
    })
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(debouncer);
    *root_state.0.lock().map_err(|e| e.to_string())? = Some(root_path);
    Ok(())
}

/// Первый аргумент командной строки, который можно открыть: папка или markdown-файл.
fn path_from_args(args: impl IntoIterator<Item = String>, cwd: Option<&Path>) -> Option<String> {
    args.into_iter()
        .filter(|arg| !arg.starts_with('-'))
        .map(|arg| {
            let path = PathBuf::from(arg);
            match cwd {
                Some(cwd) if path.is_relative() => cwd.join(path),
                _ => path,
            }
        })
        .find(|path| path.is_dir() || (path.is_file() && is_markdown(path)))
        .map(|path| path.to_string_lossy().into_owned())
}

/// Путь, переданный при запуске (двойной клик по .md в проводнике).
#[tauri::command]
fn initial_path() -> Option<String> {
    let cwd = std::env::current_dir().ok();
    path_from_args(std::env::args().skip(1), cwd.as_deref())
}

/// Что лежит по пути: "dir", "markdown" или "other" (для перетаскивания в окно).
#[tauri::command]
fn path_kind(path: String) -> &'static str {
    let path = Path::new(&path);
    if path.is_dir() {
        "dir"
    } else if path.is_file() && is_markdown(path) {
        "markdown"
    } else {
        "other"
    }
}

/// Проверяет, что путь существует и лежит внутри открытой папки.
fn ensure_inside_root(state: &RootState, path: &Path, allow_root: bool) -> Result<PathBuf, String> {
    let root = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Папка не открыта")?;
    let root = fs::canonicalize(&root).map_err(|e| format!("Папка недоступна: {e}"))?;
    let full = fs::canonicalize(path).map_err(|e| format!("Путь недоступен: {e}"))?;
    if !full.starts_with(&root) || (!allow_root && full == root) {
        return Err("Операция возможна только внутри открытой папки".into());
    }
    Ok(PathBuf::from(path))
}

/// Проверяет имя файла или папки по правилам Windows.
fn validate_name(name: &str) -> Result<String, String> {
    const FORBIDDEN: &str = "<>:\"/\\|?*";
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err("Введите имя".into());
    }
    if let Some(c) = name.chars().find(|c| FORBIDDEN.contains(*c) || c.is_control()) {
        return Err(format!("Имя не может содержать символ «{c}»"));
    }
    if name.ends_with('.') {
        return Err("Имя не может заканчиваться точкой".into());
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        return Err(format!("Имя «{name}» зарезервировано Windows"));
    }
    Ok(name.to_string())
}

fn already_exists(name: &str) -> String {
    format!("«{name}» уже существует")
}

/// Создаёт markdown-файл с заголовком. Существующий файл не перезаписывается.
#[tauri::command]
fn create_file(root: State<RootState>, dir: String, name: String) -> Result<String, String> {
    let dir = ensure_inside_root(&root, Path::new(&dir), true)?;
    let mut name = validate_name(&name)?;
    if !is_markdown(Path::new(&name)) {
        name.push_str(".md");
    }
    let path = dir.join(&name);
    let title = Path::new(&name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| match e.kind() {
            ErrorKind::AlreadyExists => already_exists(&name),
            _ => format!("Не удалось создать «{name}»: {e}"),
        })?;
    file.write_all(format!("# {title}\n\n").as_bytes())
        .map_err(|e| format!("Не удалось записать «{name}»: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn create_folder(root: State<RootState>, dir: String, name: String) -> Result<String, String> {
    let dir = ensure_inside_root(&root, Path::new(&dir), true)?;
    let name = validate_name(&name)?;
    let path = dir.join(&name);
    fs::create_dir(&path).map_err(|e| match e.kind() {
        ErrorKind::AlreadyExists => already_exists(&name),
        _ => format!("Не удалось создать папку «{name}»: {e}"),
    })?;
    Ok(path.to_string_lossy().into_owned())
}

/// Переименовывает файл или папку. У markdown-файла расширение сохраняется, если его не указали.
#[tauri::command]
fn rename_path(root: State<RootState>, path: String, new_name: String) -> Result<String, String> {
    let path = ensure_inside_root(&root, Path::new(&path), false)?;
    let mut new_name = validate_name(&new_name)?;
    if path.is_file() && is_markdown(&path) && !is_markdown(Path::new(&new_name)) {
        new_name.push_str(".md");
    }
    let target = path.with_file_name(&new_name);
    let old_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    // Смена только регистра букв на Windows — тот же файл, это разрешено.
    let same_file = old_name.to_lowercase() == new_name.to_lowercase();
    if target.exists() && !same_file {
        return Err(already_exists(&new_name));
    }
    fs::rename(&path, &target).map_err(|e| format!("Не удалось переименовать: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

/// Удаляет в Корзину, а не насовсем.
#[tauri::command]
fn delete_path(root: State<RootState>, path: String) -> Result<(), String> {
    let path = ensure_inside_root(&root, Path::new(&path), false)?;
    trash::delete(&path).map_err(|e| format!("Не удалось удалить в Корзину: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Должен быть первым: повторный запуск передаёт путь уже открытому окну.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(path) = path_from_args(args.into_iter().skip(1), Some(Path::new(&cwd))) {
                let _ = app.emit("open-path", path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState::default())
        .manage(RootState::default())
        .invoke_handler(tauri::generate_handler![
            read_tree,
            read_file,
            write_file,
            initial_path,
            path_kind,
            create_file,
            create_folder,
            rename_path,
            delete_path,
            search_folder,
            watch_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
