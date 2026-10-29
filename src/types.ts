export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: TreeNode[];
}

export interface Heading {
  id: string;
  level: number;
  text: string;
  /** Номер строки в исходнике (с нуля), чтобы в редакторе перейти к заголовку. */
  line: number;
}
