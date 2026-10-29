use serde::Serialize;
use std::fs;
use std::path::Path;

/// Папки, которые не показываем в дереве.
const IGNORED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "bin", "obj"];

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
            if name.starts_with('.') || IGNORED_DIRS.contains(&name.as_str()) {
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
        .invoke_handler(tauri::generate_handler![read_tree, read_file, initial_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
