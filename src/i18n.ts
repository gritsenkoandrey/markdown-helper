// Переводы интерфейса. Английский основной: если строки нет в другом языке, берётся английская.
// Значение-массив — формы множественного числа (см. tn).

export type Lang = "en" | "ru";
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "ru", label: "RU" },
];

type Entry = string | readonly string[];

const en = {
  "tab.files": "Files",
  "tab.search": "Search",
  "tab.searchTitle": "Search in folder (Ctrl+Shift+F)",
  "sidebar.newDocument": "New document (right-click a folder to create inside it)",
  "sidebar.openFolder": "Open folder",
  "sidebar.refresh": "Refresh",
  "sidebar.noFolder": "No folder",
  "sidebar.noMarkdown": "No .md files in this folder",
  "sidebar.openPrompt": "Open a folder with markdown files",
  "sidebar.language": "Interface language",

  "favorites.title": "Favorites",
  "favorites.empty": "Click ☆ next to a folder to pin it here",
  "favorites.add": "Add to favorites",
  "favorites.remove": "Remove from favorites",

  "menu.newDocument": "New document",
  "menu.newFolder": "New folder",
  "menu.addFavorite": "☆ Add to favorites",
  "menu.removeFavorite": "★ Remove from favorites",
  "menu.rename": "Rename",
  "menu.delete": "Move to Recycle Bin",

  "tree.empty": "This folder is empty. Right-click or press “+” to create a document.",
  "tree.documentName": "Document name",
  "tree.folderName": "Folder name",

  "toolbar.back": "Back (Alt+←)",
  "toolbar.forward": "Forward (Alt+→)",
  "toolbar.unsaved": "Unsaved changes",
  "toolbar.save": "Save",
  "toolbar.saveTitle": "Save (Ctrl+S)",
  "toolbar.view": "View",
  "toolbar.edit": "Edit",
  "toolbar.toggleTitle": "Switch mode (Ctrl+E)",
  "toolbar.quickOpen": "Go to file (Ctrl+P)",
  "toolbar.find": "Find in document (Ctrl+F)",

  "empty.selectFile": "Select a file on the left",
  "empty.openFolder": "Open folder",
  "empty.hints": "Ctrl+P — go to file · Ctrl+Shift+F — search folder · Ctrl+F — find in document · Ctrl+E — edit",

  "outline.title": "Contents",
  "outline.empty": "No headings",

  "drop.hint": "Drop to open a folder or .md file",

  "find.placeholder": "Find in document",
  "find.count": "{current} of {total}",
  "find.none": "No matches",
  "find.previous": "Previous (Shift+Enter)",
  "find.next": "Next (Enter)",
  "find.close": "Close (Esc)",

  "quickOpen.placeholder": "Go to file…",
  "search.placeholder": "Search in folder",
  "search.nothing": "Nothing found",
  "search.summary": "{matches} in {files}",
  "search.matches": ["{n} match", "{n} matches"],
  "search.files": ["{n} file", "{n} files"],

  "dialog.cancel": "Cancel",
  "dialog.save": "Save",
  "dialog.dontSave": "Don't save",
  "dialog.unsavedTitle": "Unsaved changes",
  "dialog.unsavedMessage": "Save changes to “{name}”?",
  "dialog.conflictTitle": "File changed on disk",
  "dialog.conflictMessage": "“{name}” was changed by another program, and you have unsaved edits.",
  "dialog.loadFromDisk": "Load from disk",
  "dialog.keepMine": "Keep my edits",
  "dialog.deleteTitle": "Move to Recycle Bin?",
  "dialog.deleteFolder": "Folder “{name}” and everything in it will be moved to the Recycle Bin.",
  "dialog.deleteFile": "File “{name}” will be moved to the Recycle Bin.",
  "dialog.delete": "Delete",

  "error.missing": "Not found: {path}. It may have been moved or deleted.",
  "error.notOpenable": "Only a folder or a markdown file can be opened, not “{name}”",
  // Коды ошибок из Rust (AppError в src-tauri/src/lib.rs).
  "error.folder_not_found": "Folder not found: {arg}",
  "error.read_failed": "Couldn't read {arg}: {detail}",
  "error.not_markdown": "Only markdown files can be saved: {arg}",
  "error.invalid_path": "Invalid path: {arg}",
  "error.save_failed": "Couldn't save {arg}: {detail}",
  "error.no_root": "No folder is open",
  "error.root_unavailable": "The folder is unavailable: {detail}",
  "error.path_unavailable": "The path is unavailable: {detail}",
  "error.outside_root": "This is only allowed inside the open folder",
  "error.name_empty": "Enter a name",
  "error.name_char": "A name can't contain “{arg}”",
  "error.name_dot": "A name can't end with a dot",
  "error.name_reserved": "“{arg}” is a reserved name in Windows",
  "error.exists": "“{arg}” already exists",
  "error.create_failed": "Couldn't create “{arg}”: {detail}",
  "error.create_folder_failed": "Couldn't create folder “{arg}”: {detail}",
  "error.rename_failed": "Couldn't rename: {detail}",
  "error.trash_failed": "Couldn't move to the Recycle Bin: {detail}",
  "error.internal": "{detail}",
} satisfies Record<string, Entry>;

export type Key = keyof typeof en;

const ru: { [K in Key]: Entry } = {
  "tab.files": "Файлы",
  "tab.search": "Поиск",
  "tab.searchTitle": "Поиск по папке (Ctrl+Shift+F)",
  "sidebar.newDocument": "Новый документ (правый клик по папке — создать внутри неё)",
  "sidebar.openFolder": "Открыть папку",
  "sidebar.refresh": "Обновить",
  "sidebar.noFolder": "Нет папки",
  "sidebar.noMarkdown": "В папке нет .md файлов",
  "sidebar.openPrompt": "Откройте папку с markdown-файлами",
  "sidebar.language": "Язык интерфейса",

  "favorites.title": "Избранное",
  "favorites.empty": "Нажмите ☆ у папки, чтобы закрепить её здесь",
  "favorites.add": "Добавить в избранное",
  "favorites.remove": "Убрать из избранного",

  "menu.newDocument": "Новый документ",
  "menu.newFolder": "Новая папка",
  "menu.addFavorite": "☆ Добавить в избранное",
  "menu.removeFavorite": "★ Убрать из избранного",
  "menu.rename": "Переименовать",
  "menu.delete": "Удалить в Корзину",

  "tree.empty": "Папка пуста. Правый клик или «+», чтобы создать документ.",
  "tree.documentName": "Имя документа",
  "tree.folderName": "Имя папки",

  "toolbar.back": "Назад (Alt+←)",
  "toolbar.forward": "Вперёд (Alt+→)",
  "toolbar.unsaved": "Есть несохранённые изменения",
  "toolbar.save": "Сохранить",
  "toolbar.saveTitle": "Сохранить (Ctrl+S)",
  "toolbar.view": "Просмотр",
  "toolbar.edit": "Редактировать",
  "toolbar.toggleTitle": "Переключить режим (Ctrl+E)",
  "toolbar.quickOpen": "Перейти к файлу (Ctrl+P)",
  "toolbar.find": "Найти в документе (Ctrl+F)",

  "empty.selectFile": "Выберите файл слева",
  "empty.openFolder": "Открыть папку",
  "empty.hints":
    "Ctrl+P — перейти к файлу · Ctrl+Shift+F — поиск по папке · Ctrl+F — поиск в документе · Ctrl+E — редактирование",

  "outline.title": "Оглавление",
  "outline.empty": "Нет заголовков",

  "drop.hint": "Отпустите, чтобы открыть папку или .md файл",

  "find.placeholder": "Найти в документе",
  "find.count": "{current} из {total}",
  "find.none": "Нет совпадений",
  "find.previous": "Предыдущее (Shift+Enter)",
  "find.next": "Следующее (Enter)",
  "find.close": "Закрыть (Esc)",

  "quickOpen.placeholder": "Перейти к файлу…",
  "search.placeholder": "Поиск по папке",
  "search.nothing": "Ничего не найдено",
  "search.summary": "{matches} в {files}",
  "search.matches": ["{n} совпадение", "{n} совпадения", "{n} совпадений"],
  "search.files": ["{n} файле", "{n} файлах", "{n} файлах"],

  "dialog.cancel": "Отмена",
  "dialog.save": "Сохранить",
  "dialog.dontSave": "Не сохранять",
  "dialog.unsavedTitle": "Несохранённые изменения",
  "dialog.unsavedMessage": "Сохранить изменения в «{name}»?",
  "dialog.conflictTitle": "Файл изменён на диске",
  "dialog.conflictMessage": "«{name}» изменили в другой программе, а у вас есть несохранённые правки.",
  "dialog.loadFromDisk": "Загрузить с диска",
  "dialog.keepMine": "Оставить мои правки",
  "dialog.deleteTitle": "Удалить в Корзину?",
  "dialog.deleteFolder": "Папка «{name}» со всем содержимым будет перемещена в Корзину.",
  "dialog.deleteFile": "Файл «{name}» будет перемещён в Корзину.",
  "dialog.delete": "Удалить",

  "error.missing": "Не найдено: {path}. Возможно, папку переместили или удалили.",
  "error.notOpenable": "Открыть можно папку или markdown-файл, а не «{name}»",
  "error.folder_not_found": "Папка не найдена: {arg}",
  "error.read_failed": "Не удалось прочитать {arg}: {detail}",
  "error.not_markdown": "Можно сохранять только markdown-файлы: {arg}",
  "error.invalid_path": "Некорректный путь: {arg}",
  "error.save_failed": "Не удалось сохранить {arg}: {detail}",
  "error.no_root": "Папка не открыта",
  "error.root_unavailable": "Папка недоступна: {detail}",
  "error.path_unavailable": "Путь недоступен: {detail}",
  "error.outside_root": "Операция возможна только внутри открытой папки",
  "error.name_empty": "Введите имя",
  "error.name_char": "Имя не может содержать символ «{arg}»",
  "error.name_dot": "Имя не может заканчиваться точкой",
  "error.name_reserved": "Имя «{arg}» зарезервировано Windows",
  "error.exists": "«{arg}» уже существует",
  "error.create_failed": "Не удалось создать «{arg}»: {detail}",
  "error.create_folder_failed": "Не удалось создать папку «{arg}»: {detail}",
  "error.rename_failed": "Не удалось переименовать: {detail}",
  "error.trash_failed": "Не удалось удалить в Корзину: {detail}",
  "error.internal": "{detail}",
};

const dictionaries: Record<Lang, { [K in Key]: Entry }> = { en, ru };

const LANG_KEY = "md-reader:lang";

function loadLanguage(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "en" || stored === "ru") return stored;
  } catch {
    // Хранилище недоступно — используем английский.
  }
  return "en";
}

let current: Lang = loadLanguage();
document.documentElement.lang = current;

export function getLanguage(): Lang {
  return current;
}

/** Меняет язык. Перерисовку интерфейса запускает App, храня язык в своём состоянии. */
export function setLanguage(lang: Lang) {
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Не критично: язык просто не запомнится.
  }
}

type Params = Record<string, string | number>;

function format(template: string, params?: Params): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params && params[name] !== undefined ? String(params[name]) : match,
  );
}

function lookup(key: Key): Entry {
  return dictionaries[current][key] ?? en[key];
}

export function t(key: Key, params?: Params): string {
  const entry = lookup(key);
  return format(typeof entry === "string" ? entry : entry[0], params);
}

/** Индекс формы множественного числа: en — 1 / много; ru — 1 / 2–4 / 5+. */
function pluralIndex(n: number): number {
  if (current !== "ru") return n === 1 ? 0 : 1;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

/** Строка с числом в нужной форме: tn("search.files", 3) → "3 files". */
export function tn(key: Key, n: number, params?: Params): string {
  const entry = lookup(key);
  const forms = typeof entry === "string" ? [entry] : entry;
  return format(forms[Math.min(pluralIndex(n), forms.length - 1)], { n, ...params });
}

interface AppError {
  code: string;
  arg?: string;
  detail?: string;
}

function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && typeof (value as AppError).code === "string";
}

/** Текст ошибки на текущем языке: Rust присылает код, а не готовую фразу. */
export function formatError(error: unknown): string {
  if (!isAppError(error)) return String(error);
  const key = `error.${error.code}`;
  if (!(key in en)) return error.detail ?? error.code;
  return t(key as Key, { arg: error.arg ?? "", detail: error.detail ?? "" });
}

/** Переводы панели поиска CodeMirror. */
export const codeMirrorPhrases: Record<Lang, Record<string, string>> = {
  en: {},
  ru: {
    Find: "Найти",
    Replace: "Заменить",
    next: "далее",
    previous: "назад",
    all: "все",
    "match case": "учитывать регистр",
    regexp: "рег. выражение",
    "by word": "целое слово",
    replace: "заменить",
    "replace all": "заменить все",
    close: "закрыть",
    "current match": "текущее совпадение",
    "on line": "в строке",
    "Go to line": "Перейти к строке",
    go: "перейти",
    "replaced match on line $": "заменено совпадение в строке $",
    "replaced $ matches": "заменено совпадений: $",
  },
};
