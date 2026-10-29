use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Папки, которые не показываем в дереве.
const IGNORED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "bin", "obj"];

/// Ограничения поиска по папке, чтобы огромные папки не подвешивали интерфейс.
const MAX_SEARCH_FILES: usize = 200;
const MAX_MATCHES_PER_FILE: usize = 20;
const MAX_LINE_CHARS: usize = 200;

/// Текущий наблюдатель за открытой папкой. Новый заменяет старый.
#[derive(Default)]
struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher>>>);

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

/// Рекурсивно собирает дерево. Папки без markdown-файлов внутри отбрасываются.
fn build_tree(dir: &Path) -> Option<TreeNode> {
    let entries = fs::read_dir(dir).ok()?;
    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(file_type) = entry.file_type() else { continue };

        if file_type.is_dir() {
            if is_skipped_dir(&name) {
                continue;
            }
            if let Some(node) = build_tree(&path) {
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

    if dirs.is_empty() && files.is_empty() {
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
    Ok(build_tree(root_path))
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать {path}: {e}"))
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
fn watch_folder(app: AppHandle, state: State<WatcherState>, root: String) -> Result<(), String> {
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
    Ok(())
}

/// Путь к файлу, переданный при запуске (двойной клик по .md в проводнике).
#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && is_markdown(Path::new(arg)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            read_tree,
            read_file,
            initial_file,
            search_folder,
            watch_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
