# MD Reader

**English** · [Русский](README.ru.md)

A fast markdown viewer and editor for Windows. Open a folder and read your documents with a file tree, table of contents and search. Switch to the editor when you need to fix something.

Built with [Tauri 2](https://tauri.app), React and TypeScript. The installer is about 4 MB.

## Features

- **Folder tree:** shows only `.md` and `.markdown` files and hides service folders (`.git`, `node_modules`, etc.).
- **GitHub-flavored markdown:** tables, lists, quotes, images with relative paths.
- **Code highlighting** in code blocks via [Shiki], for both light and dark themes.
- **Table of contents** built from headings, with the current section highlighted.
- **Links:** links to other `.md` files (including `file.md#section`) open inside the app; external links open in the browser.
- **Search** in the document and across the whole folder, plus quick file switching.
- **Back / forward** navigation history.
- **Live reload:** if a file is changed by another program, the document and tree update automatically.
- **Editing** with [CodeMirror 6]:
  - keeps the original file format (CRLF/LF, BOM);
  - writes files atomically;
  - protects unsaved changes.
- **File management:** create documents and folders, rename, move to the Recycle Bin.
- **Favorite folders** above the tree for quick switching between projects.
- **Single instance:** double-clicking a `.md` file while the app is open shows it in the existing window.
- **Drag & drop** a folder or `.md` file onto the window.
- **Resizable side panels:** drag the edge of the file tree or the table of contents; the width is remembered.
- Light and dark theme that follows Windows settings.
- **English and Russian interface:** EN / RU switch in the table of contents header.

[Shiki]: https://shiki.style
[CodeMirror 6]: https://codemirror.net

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+P` | Go to file |
| `Ctrl+Shift+F` | Search in folder |
| `Ctrl+F` | Find in document (find and replace in the editor) |
| `Ctrl+E` | Switch between view and edit |
| `Ctrl+S` | Save |
| `Alt+←` / `Alt+→` | Back / forward (in view mode; side mouse buttons work too) |
| `Enter` / `Shift+Enter` | Next / previous match when finding in a document |
| `Esc` | Close search, a menu or a dialog |

Right-click in the tree for a menu: new document, new folder, add to favorites, rename, move to the Recycle Bin.

Favorite folders are listed above the tree; click one to open it. The star next to the current folder's name adds it to favorites or removes it. Clicking the name itself collapses and expands the tree.

Drag the edge of a side panel to resize it, or double-click the edge to restore the default width. With the edge focused (Tab), the arrow keys work too.

## Development requirements

- [Node.js](https://nodejs.org) LTS
- [Rust](https://rustup.rs) (stable)
- Visual Studio Build Tools with the "Desktop development with C++" workload
- WebView2 (already included in Windows 11 and up-to-date Windows 10)

See the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for details.

Install dependencies once:

```bash
npm install
```

## Running in development

```bash
npm run tauri dev
```

- The app window opens.
- Interface changes (`src/`) are applied on the fly.
- Rust changes (`src-tauri/`) rebuild and restart the app automatically.
- The first run takes longer because Rust dependencies are compiled.

**WebView developer tools** (console, element inspector): right-click the document → "Inspect". Only available in development; release builds don't include them.

**Port 1420.** Vite runs on this port. If startup fails with `Port 1420 is already in use`, a process from a previous run is still alive. Stop it:

```bash
powershell -c 'Get-NetTCPConnection -LocalPort 1420 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }'
```

**Interface only.** `npm run dev` runs the interface in a browser without the Rust side. Tauri commands (reading files, etc.) won't work there.

**Check Rust without running:**

```bash
cd src-tauri && cargo check
```

**Check TypeScript types:**

```bash
npx tsc --noEmit
```

**Single instance during development.** While `npm run tauri dev` is running, the installed MD Reader won't open its own window. Double-clicking a `.md` file sends it to the development window, because both count as the same app. Close the development window before regular use.

## Building

```bash
npm run tauri build
```

The first build takes 5–10 minutes because Rust is compiled with full optimization. Output:

| File | What it is |
|---|---|
| `src-tauri/target/release/bundle/nsis/MD Reader_<version>_x64-setup.exe` | Installer |
| `src-tauri/target/release/md-reader.exe` | The app itself, runs without installation |

`md-reader.exe` is self-contained: the interface is embedded and only WebView2 is required. You can copy it anywhere and run it from there. It won't have the `.md` file association or a Start menu shortcut, though.

The app version is set in `src-tauri/tauri.conf.json` (`version`) and in `package.json`.

## Installation

Run `MD Reader_<version>_x64-setup.exe`. The installer:

- installs the app into the user profile (no administrator rights needed);
- adds a Start menu shortcut and an entry in Windows "Apps" for uninstalling;
- associates `.md` and `.markdown` with MD Reader;
- uses English or Russian depending on the Windows language.

If Windows still opens `.md` files in another program: right-click a file → "Open with" → "Choose another app" → MD Reader → "Always".

The app isn't code-signed, so Windows SmartScreen may show a warning: "More info" → "Run anyway".

To update, build a new version and run its installer over the old one.

**Settings** (last opened folder, favorite folders, interface language, panel widths) are stored in `%LOCALAPPDATA%\com.local.mdreader` and survive reinstallation.

## Project structure

```
src/                      interface (React + TypeScript)
  App.tsx                 main window: state, navigation, modes, shortcuts
  markdown.ts             markdown rendering, headings for the table of contents
  highlight.ts            code highlighting (Shiki)
  fileFormat.ts           keeps CRLF/LF and BOM when editing
  paths.ts                Windows path helpers
  folders.ts              favorite folders
  i18n.ts                 interface translations (en, ru)
  components/
    FileTree.tsx          file tree, name input for create/rename
    Outline.tsx           table of contents
    SourceEditor.tsx      editor (CodeMirror 6)
    FindBar.tsx           find in document
    SearchPanel.tsx       search in folder
    QuickOpen.tsx         go to file (Ctrl+P)
    ContextMenu.tsx       tree context menu
    FavoritesList.tsx     favorite folders list
    ConfirmDialog.tsx     confirmation dialogs
    Resizer.tsx           drag handle for resizing side panels
src-tauri/                Rust side (Tauri)
  src/lib.rs              commands: tree, read/write, search, folder watching,
                          create/rename/delete, single instance
  tauri.conf.json         window, installer and .md association settings
  capabilities/           permissions for the interface
samples/                  sample documents
```

## Translations

All interface strings live in `src/i18n.ts`. English is the primary language: if a string is missing in another language, the English one is shown.

- **New string:** add the key to the `en` dictionary, then to `ru`. TypeScript won't compile until `ru` has every key from `en`. Use `t("key")` in code, and `tn("key", n)` for strings with a number (plural forms are given as an array).
- **Rust errors** arrive as codes (`AppError` in `src-tauri/src/lib.rs`); their text comes from the `error.<code>` keys.
- **New language:** add a dictionary, add its code to the `Lang` type and the `LANGUAGES` list, and add its plural rule to `pluralIndex`.

## License

[MIT](LICENSE)
