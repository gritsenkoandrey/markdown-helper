import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";

export interface SourceEditorHandle {
  /** Заменить текст целиком (файл изменился на диске). */
  setText: (text: string) => void;
  /** Перейти к строке (с нуля) и поставить туда курсор. */
  scrollToLine: (line: number) => void;
}

interface Props {
  initialText: string;
  /** Поставить курсор в конец (новый документ — сразу писать под заголовком). */
  cursorAtEnd?: boolean;
  /** Переводы панели поиска CodeMirror для текущего языка. */
  phrases: Record<string, string>;
  onChange: (text: string) => void;
}

// Цвета берём из CSS-переменных, поэтому тема переключается вместе с остальным интерфейсом.
const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    color: "var(--text)",
    backgroundColor: "var(--bg)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: '"Cascadia Code", Consolas, monospace',
    lineHeight: "1.65",
  },
  ".cm-content": {
    padding: "24px max(40px, calc((100% - 860px) / 2)) 80px",
    caretColor: "var(--accent)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--bg-hover) 50%, transparent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--bg-active)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--find-bg) 45%, transparent)" },
  ".cm-searchMatch": { backgroundColor: "var(--find-bg)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--find-current-bg)" },
  ".cm-panels": {
    color: "var(--text)",
    backgroundColor: "var(--bg-panel)",
    fontFamily: "inherit",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 8px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": { fontSize: "12.5px" },
  ".cm-panel.cm-search label": { color: "var(--text-muted)" },
  ".cm-textfield": {
    color: "var(--text)",
    backgroundColor: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "3px 6px",
  },
  ".cm-textfield:focus": { outline: "none", borderColor: "var(--accent)" },
  ".cm-button": {
    color: "var(--text)",
    backgroundImage: "none",
    backgroundColor: "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "2px 8px",
  },
  ".cm-button:hover": { backgroundColor: "var(--bg-active)" },
  ".cm-button:active": { backgroundImage: "none" },
  ".cm-panel.cm-search [name=close]": { color: "var(--text-muted)", fontSize: "16px" },
});

const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.35em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.2em", fontWeight: "700" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.monospace, color: "var(--syn-code)" },
  { tag: t.quote, color: "var(--text-muted)" },
  // Служебные символы разметки: #, *, `, >, -, [ ] и т.п.
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: "var(--text-muted)" },
  // Код внутри ``` блоков.
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.typeName, t.className], color: "var(--syn-function)" },
]);

export const SourceEditor = forwardRef<SourceEditorHandle, Props>(function SourceEditor(
  { initialText, cursorAtEnd, phrases, onChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Редактор создаётся один раз; новый файл открывается через новый key у компонента.
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: initialText,
        selection: cursorAtEnd ? { anchor: initialText.length } : undefined,
        extensions: [
          EditorState.phrases.of(phrases),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(highlightStyle),
          theme,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    setText(text) {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === text) return;
      // Меняем только отличающийся кусок, тогда CodeMirror сам сдвинет курсор куда нужно.
      let start = 0;
      while (start < current.length && start < text.length && current[start] === text[start]) start++;
      let end = 0;
      while (
        end < current.length - start &&
        end < text.length - start &&
        current[current.length - 1 - end] === text[text.length - 1 - end]
      ) {
        end++;
      }
      view.dispatch({
        changes: { from: start, to: current.length - end, insert: text.slice(start, text.length - end) },
      });
    },
    scrollToLine(line) {
      const view = viewRef.current;
      if (!view) return;
      const target = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: target.from },
        effects: EditorView.scrollIntoView(target.from, { y: "start", yMargin: 24 }),
      });
      view.focus();
    },
  }));

  return <div className="source-editor" ref={hostRef} />;
});
