import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { TreeNode } from "../types";
import { t } from "../i18n";

/** Что сейчас вводится прямо в дереве: имя нового файла/папки или новое имя при переименовании. */
export type TreeEdit =
  | { kind: "new-file" | "new-folder"; dir: string }
  | { kind: "rename"; path: string; name: string };

export interface TreeActions {
  currentFile: string | null;
  edit: TreeEdit | null;
  onOpen: (path: string) => void;
  /** Возвращает текст ошибки, если не получилось, иначе null. */
  onEditSubmit: (value: string) => Promise<string | null>;
  onEditCancel: () => void;
  /** node === null — клик по пустому месту (корень папки). */
  onContextMenu: (e: MouseEvent, node: TreeNode | null) => void;
}

interface Props {
  root: TreeNode;
  actions: TreeActions;
}

const indent = (depth: number) => ({ paddingLeft: 8 + depth * 14 });

function isNewIn(edit: TreeEdit | null, dir: string) {
  return edit !== null && edit.kind !== "rename" && edit.dir === dir;
}

export function FileTree({ root, actions }: Props) {
  return (
    <div className="tree-area" onContextMenu={(e) => actions.onContextMenu(e, null)}>
      <ul className="tree">
        {isNewIn(actions.edit, root.path) && <NewItemInput depth={0} actions={actions} />}
        {root.children.map((node) => (
          <TreeItem key={node.path} node={node} depth={0} actions={actions} />
        ))}
      </ul>
      {root.children.length === 0 && !actions.edit && (
        <p className="muted">{t("tree.empty")}</p>
      )}
    </div>
  );
}

interface ItemProps {
  node: TreeNode;
  depth: number;
  actions: TreeActions;
}

function TreeItem({ node, depth, actions }: ItemProps) {
  const { currentFile, edit } = actions;
  // Папка раскрыта сразу, если внутри неё открытый файл.
  const [expanded, setExpanded] = useState(
    () => depth === 0 || (currentFile?.startsWith(node.path + "\\") ?? false),
  );
  const creatingHere = node.is_dir && isNewIn(edit, node.path);

  // Создаём что-то внутри свёрнутой папки — раскрываем её.
  useEffect(() => {
    if (creatingHere) setExpanded(true);
  }, [creatingHere]);

  const onContextMenu = (e: MouseEvent) => {
    e.stopPropagation();
    actions.onContextMenu(e, node);
  };

  if (edit?.kind === "rename" && edit.path === node.path) {
    return (
      <NameInput
        initial={edit.name}
        selectStem={!node.is_dir}
        depth={depth}
        onSubmit={actions.onEditSubmit}
        onCancel={actions.onEditCancel}
      />
    );
  }

  if (!node.is_dir) {
    return (
      <li>
        <button
          className={"tree-row file" + (node.path === currentFile ? " active" : "")}
          style={indent(depth)}
          onClick={() => actions.onOpen(node.path)}
          onContextMenu={onContextMenu}
          title={node.path}
        >
          {node.name.replace(/\.(md|markdown)$/i, "")}
        </button>
      </li>
    );
  }

  return (
    <li>
      <button
        className="tree-row dir"
        style={indent(depth)}
        onClick={() => setExpanded(!expanded)}
        onContextMenu={onContextMenu}
      >
        <span className={"chevron" + (expanded ? " open" : "")}>▸</span>
        {node.name}
      </button>
      {expanded && (
        <ul className="tree">
          {creatingHere && <NewItemInput depth={depth + 1} actions={actions} />}
          {node.children.map((child) => (
            <TreeItem key={child.path} node={child} depth={depth + 1} actions={actions} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NewItemInput({ depth, actions }: { depth: number; actions: TreeActions }) {
  return (
    <NameInput
      initial=""
      selectStem={false}
      depth={depth}
      placeholder={actions.edit?.kind === "new-folder" ? t("tree.folderName") : t("tree.documentName")}
      onSubmit={actions.onEditSubmit}
      onCancel={actions.onEditCancel}
    />
  );
}

interface NameInputProps {
  initial: string;
  /** Выделить имя без расширения, как в проводнике. */
  selectStem: boolean;
  depth: number;
  placeholder?: string;
  onSubmit: (value: string) => Promise<string | null>;
  onCancel: () => void;
}

function NameInput({ initial, selectStem, depth, placeholder, onSubmit, onCancel }: NameInputProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter и потеря фокуса не должны отправить имя дважды.
  const busyRef = useRef(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dot = selectStem ? initial.lastIndexOf(".") : -1;
    input.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial, selectStem]);

  const submit = async () => {
    if (busyRef.current || doneRef.current) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === initial) {
      doneRef.current = true;
      onCancel();
      return;
    }
    busyRef.current = true;
    const result = await onSubmit(trimmed);
    busyRef.current = false;
    if (result) {
      setError(result);
      inputRef.current?.focus();
    } else {
      doneRef.current = true;
    }
  };

  return (
    <li className="tree-input" style={indent(depth)}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            doneRef.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          // Ушли из поля после ошибки — не настаиваем, просто отменяем.
          if (error && !doneRef.current) {
            doneRef.current = true;
            onCancel();
          } else {
            submit();
          }
        }}
        onContextMenu={(e) => e.stopPropagation()}
      />
      {error && <div className="tree-input-error">{error}</div>}
    </li>
  );
}
