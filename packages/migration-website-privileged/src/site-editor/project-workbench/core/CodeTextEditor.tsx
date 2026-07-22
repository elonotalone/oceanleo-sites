"use client";

import { useEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import {
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import type { WebsiteDiagnostic } from "./contracts";
import { sourceLanguage } from "./source-model";

export interface CodeTextEditorProps {
  path: string;
  value: string;
  externalVersion: string;
  readOnly?: boolean;
  diagnostics: WebsiteDiagnostic[];
  jumpTo?: { line: number; column: number; nonce: number } | null;
  onChange: (value: string) => void;
  onSave: () => void;
}

interface RetainedState {
  state: EditorState;
  externalVersion: string;
}

function languageForPath(path: string): Extension {
  const lower = path.toLowerCase();
  if (/\.(?:tsx?|jsx?)$/.test(lower)) {
    return javascript({
      typescript: /\.tsx?$/.test(lower),
      jsx: /\.[jt]sx$/.test(lower),
    });
  }
  if (lower.endsWith(".json")) return json();
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return css();
  if (lower.endsWith(".html") || lower.endsWith(".svg")) return html();
  return [];
}

function diagnosticPosition(
  state: EditorState,
  line: number,
  column: number,
): number {
  const boundedLine = Math.min(Math.max(1, line), state.doc.lines);
  const row = state.doc.line(boundedLine);
  return Math.min(row.to, row.from + Math.max(0, column - 1));
}

function codeMirrorDiagnostics(
  state: EditorState,
  diagnostics: WebsiteDiagnostic[],
): Diagnostic[] {
  return diagnostics.map((item) => {
    const from = diagnosticPosition(state, item.line, item.column);
    const to =
      item.end_line && item.end_column
        ? Math.max(
            from,
            diagnosticPosition(state, item.end_line, item.end_column),
          )
        : Math.min(state.doc.length, from + 1);
    return {
      from,
      to,
      severity: item.severity,
      message: item.message,
      source: [item.source, item.code].filter(Boolean).join(" "),
    };
  });
}

export function CodeTextEditor({
  path,
  value,
  externalVersion,
  readOnly = false,
  diagnostics,
  jumpTo = null,
  onChange,
  onSave,
}: CodeTextEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const retainedRef = useRef(new Map<string, RetainedState>());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const readOnlyRef = useRef(readOnly);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const editableCompartmentRef = useRef(new Compartment());
  const activeVersionRef = useRef(externalVersion);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const retained = retainedRef.current.get(path);
    activeVersionRef.current = externalVersion;
    const createState = () =>
      EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([
            indentWithTab,
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                if (!readOnlyRef.current) onSaveRef.current();
                return true;
              },
            },
          ]),
          languageForPath(path),
          lintGutter(),
          oneDark,
          readOnlyCompartmentRef.current.of(EditorState.readOnly.of(readOnly)),
          editableCompartmentRef.current.of(EditorView.editable.of(!readOnly)),
          EditorView.contentAttributes.of({
            "aria-label": `Source editor for ${path}`,
            spellcheck: "false",
            autocapitalize: "off",
            autocomplete: "off",
          }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "12px" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            },
            ".cm-content": { minHeight: "100%", padding: "12px 0" },
            ".cm-line": { lineHeight: "20px" },
          }),
          EditorView.updateListener.of((update) => {
            retainedRef.current.set(path, {
              state: update.state,
              externalVersion: activeVersionRef.current,
            });
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              setCursor({ line: line.number, column: head - line.from + 1 });
            }
          }),
        ],
      });
    const state =
      retained && retained.externalVersion === externalVersion
        ? retained.state
        : createState();
    const view = new EditorView({ state, parent: mount });
    viewRef.current = view;
    view.dispatch(
      setDiagnostics(view.state, codeMirrorDiagnostics(view.state, diagnostics)),
    );
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    setCursor({ line: line.number, column: head - line.from + 1 });
    return () => {
      retainedRef.current.set(path, {
        state: view.state,
        externalVersion: activeVersionRef.current,
      });
      if (viewRef.current === view) viewRef.current = null;
      view.destroy();
    };
    // A path switch restores that file's own EditorState. Prop callbacks and
    // ordinary controlled-value echoes deliberately do not recreate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        readOnlyCompartmentRef.current.reconfigure(
          EditorState.readOnly.of(readOnly),
        ),
        editableCompartmentRef.current.reconfigure(
          EditorView.editable.of(!readOnly),
        ),
      ],
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (activeVersionRef.current === externalVersion) return;
    activeVersionRef.current = externalVersion;
    if (view.state.doc.toString() === value) {
      retainedRef.current.set(path, {
        state: view.state,
        externalVersion,
      });
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: 0 },
      annotations: Transaction.addToHistory.of(false),
    });
    retainedRef.current.set(path, {
      state: view.state,
      externalVersion,
    });
  }, [externalVersion, path, value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(
      setDiagnostics(view.state, codeMirrorDiagnostics(view.state, diagnostics)),
    );
  }, [diagnostics, path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !jumpTo) return;
    const position = diagnosticPosition(
      view.state,
      jumpTo.line,
      jumpTo.column,
    );
    view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: "center" }),
    });
    view.focus();
  }, [jumpTo]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#171717] text-zinc-200">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-white/10 bg-[#202020] px-3">
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-300">
          {sourceLanguage(path)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">
          {path}
        </span>
        <span className="hidden text-[9px] text-zinc-500 sm:inline">
          ⌘F search · ⌘S save
        </span>
      </div>
      <div ref={mountRef} className="min-h-0 flex-1 overflow-hidden" />
      <div className="flex h-6 shrink-0 items-center justify-end gap-3 border-t border-white/10 bg-[#202020] px-3 font-mono text-[9px] text-zinc-500">
        <span>
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span>{new TextEncoder().encode(value).byteLength} bytes</span>
      </div>
    </div>
  );
}
