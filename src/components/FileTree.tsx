import { useState } from "react";
import type { TreeNode } from "../types";

interface Props {
  root: TreeNode;
  currentFile: string | null;
  onOpen: (path: string) => void;
}

export function FileTree({ root, currentFile, onOpen }: Props) {
  return (
    <ul className="tree">
      {root.children.map((node) => (
        <TreeItem key={node.path} node={node} depth={0} currentFile={currentFile} onOpen={onOpen} />
      ))}
    </ul>
  );
}

interface ItemProps {
  node: TreeNode;
  depth: number;
  currentFile: string | null;
  onOpen: (path: string) => void;
}

function TreeItem({ node, depth, currentFile, onOpen }: ItemProps) {
  // Папка раскрыта сразу, если внутри неё открытый файл.
  const [expanded, setExpanded] = useState(
    () => depth === 0 || (currentFile?.startsWith(node.path + "\\") ?? false),
  );
  const indent = { paddingLeft: 8 + depth * 14 };

  if (!node.is_dir) {
    return (
      <li>
        <button
          className={"tree-row file" + (node.path === currentFile ? " active" : "")}
          style={indent}
          onClick={() => onOpen(node.path)}
          title={node.path}
        >
          {node.name.replace(/\.(md|markdown)$/i, "")}
        </button>
      </li>
    );
  }

  return (
    <li>
      <button className="tree-row dir" style={indent} onClick={() => setExpanded(!expanded)}>
        <span className={"chevron" + (expanded ? " open" : "")}>▸</span>
        {node.name}
      </button>
      {expanded && (
        <ul className="tree">
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              currentFile={currentFile}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
