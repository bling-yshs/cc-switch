import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor/editor/editor.api";
import { useTranslation } from "react-i18next";
import {
  minimalTextChange,
  mapPositionByContext,
} from "@/utils/editorTextChange";

export interface MonacoEditorProps {
  id?: string;
  ariaLabel?: string;
  value: string;
  onChange?: (value: string) => void;
  original?: string;
  language?: "json" | "javascript" | "toml" | "ini" | "markdown";
  placeholder?: string;
  darkMode?: boolean;
  readOnly?: boolean;
  showValidation?: boolean;
  showMinimap?: boolean;
  hideUnchangedRegions?: boolean;
  className?: string;
  height?: string | number;
  minHeight?: string | number;
  maxHeight?: string | number;
}

/**
 * 管理内置 Monaco 文本与双栏差异编辑器，限制自动高度并支持内部滚动。
 * @param props - 内容、语言、外观和编辑回调。
 * @returns 编辑器容器及加载或失败状态。
 */
export default function MonacoEditor(props: MonacoEditorProps) {
  const { t } = useTranslation();
  const { id, className = "", height, minHeight = "300px", maxHeight } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const instanceRef = useRef<{
    monaco: typeof Monaco;
    editor: Monaco.editor.IStandaloneCodeEditor;
    diff?: Monaco.editor.IStandaloneDiffEditor;
    model: Monaco.editor.ITextModel;
    original?: Monaco.editor.ITextModel;
    syncing: boolean;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [contentHeight, setContentHeight] = useState(0);
  const isDiff = props.original !== undefined;

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    setReady(false);
    setLoadError("");
    void import("@/lib/monaco")
      .then(({ monaco }) => {
        if (disposed || !containerRef.current) return;
        const current = propsRef.current;
        const model = monaco.editor.createModel(
          current.value,
          current.language ?? "markdown",
        );
        const options: Monaco.editor.IStandaloneEditorConstructionOptions = {
          automaticLayout: true,
          fontFamily: "Consolas, 'Liberation Mono', Menlo, monospace",
          fontSize: 14,
          lineHeight: 20,
          padding: { top: 8, bottom: 8 },
          scrollBeyondLastLine: false,
          scrollbar: {
            vertical: "auto",
            handleMouseWheel: true,
            alwaysConsumeMouseWheel: false,
          },
          minimap: { enabled: false },
          wordWrap: "on",
          tabSize: 2,
          fixedOverflowWidgets: true,
          stickyScroll: { enabled: false },
          readOnly: current.readOnly || isDiff,
          theme: current.darkMode ? "vs-dark" : "vs",
          ariaLabel: current.ariaLabel,
          placeholder: current.placeholder,
        };
        const original = isDiff
          ? monaco.editor.createModel(
              current.original ?? "",
              current.language ?? "markdown",
            )
          : undefined;
        const diff = original
          ? monaco.editor.createDiffEditor(containerRef.current, {
              ...options,
              readOnly: true,
              originalEditable: false,
              renderSideBySide: true,
              useInlineViewWhenSpaceIsLimited: false,
              renderOverviewRuler: false,
              enableSplitViewResizing: true,
            })
          : undefined;
        if (diff && original) diff.setModel({ original, modified: model });
        const editor =
          diff?.getModifiedEditor() ??
          monaco.editor.create(containerRef.current, { ...options, model });
        const instance = {
          monaco,
          editor,
          diff,
          model,
          original,
          syncing: false,
        };
        instanceRef.current = instance;
        const changeListener = editor.onDidChangeModelContent(() => {
          if (!instance.syncing && !propsRef.current.readOnly && !isDiff) {
            propsRef.current.onChange?.(model.getValue());
          }
        });
        const sizeListener = editor.onDidContentSizeChange((event) =>
          setContentHeight(event.contentHeight),
        );
        setContentHeight(editor.getContentHeight());
        setReady(true);
        cleanup = () => {
          changeListener.dispose();
          sizeListener.dispose();
          if (diff) diff.dispose();
          else editor.dispose();
          model.dispose();
          original?.dispose();
          instanceRef.current = null;
        };
      })
      .catch((error: unknown) => {
        if (!disposed) setLoadError(String(error));
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [isDiff]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!ready || !instance) return;
    const { monaco, editor, diff, model, original } = instance;
    const language = props.language ?? "markdown";
    monaco.editor.setTheme(props.darkMode ? "vs-dark" : "vs");
    monaco.editor.setModelLanguage(model, language);
    if (original) monaco.editor.setModelLanguage(original, language);
    const options = {
      readOnly: props.readOnly || isDiff,
      ariaLabel:
        props.ariaLabel ?? (language === "markdown" ? "Markdown" : language),
      placeholder: props.placeholder,
      minimap: { enabled: props.showMinimap ?? false },
    };
    editor.updateOptions(options);
    diff?.updateOptions({
      ...options,
      readOnly: true,
      hideUnchangedRegions: { enabled: props.hideUnchangedRegions ?? true },
    });
  }, [
    ready,
    isDiff,
    props.darkMode,
    props.language,
    props.readOnly,
    props.ariaLabel,
    props.placeholder,
    props.showMinimap,
    props.hideUnchangedRegions,
  ]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!ready || !instance) return;
    const { monaco, editor, model, original } = instance;
    const current = model.getValue();
    if (current !== props.value) {
      const change = minimalTextChange(current, props.value);
      const start = model.getPositionAt(change.from);
      const end = model.getPositionAt(change.to);
      const selections = editor.getSelections()?.map((selection) => ({
        anchor: mapPositionByContext(
          current,
          props.value,
          model.getOffsetAt(selection.getSelectionStart()),
        ),
        head: mapPositionByContext(
          current,
          props.value,
          model.getOffsetAt(selection.getPosition()),
        ),
      }));
      const scrollTop = editor.getScrollTop();
      const scrollLeft = editor.getScrollLeft();
      instance.syncing = true;
      try {
        editor.executeEdits("external-value", [
          {
            range: new monaco.Range(
              start.lineNumber,
              start.column,
              end.lineNumber,
              end.column,
            ),
            text: change.insert,
          },
        ]);
        const fallback = editor.getSelections();
        if (selections && fallback)
          editor.setSelections(
            selections.map((selection, index) => {
              const anchor =
                selection.anchor === null
                  ? fallback[index].getSelectionStart()
                  : model.getPositionAt(selection.anchor);
              const head =
                selection.head === null
                  ? fallback[index].getPosition()
                  : model.getPositionAt(selection.head);
              return new monaco.Selection(
                anchor.lineNumber,
                anchor.column,
                head.lineNumber,
                head.column,
              );
            }),
          );
        editor.setScrollPosition({ scrollTop, scrollLeft });
      } finally {
        instance.syncing = false;
      }
    }
    if (original && original.getValue() !== props.original)
      original.setValue(props.original ?? "");
    const markers: Monaco.editor.IMarkerData[] = [];
    if (
      props.showValidation &&
      props.language === "json" &&
      props.value.trim()
    ) {
      let message = "";
      try {
        const parsed = JSON.parse(props.value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          message = t("jsonEditor.mustBeObject");
      } catch (error) {
        message =
          error instanceof Error ? error.message : t("jsonEditor.invalidJson");
      }
      if (message)
        markers.push({
          ...model.getFullModelRange(),
          message,
          severity: monaco.MarkerSeverity.Error,
        });
    }
    monaco.editor.setModelMarkers(model, "configuration", markers);
  }, [
    ready,
    props.value,
    props.original,
    props.showValidation,
    props.language,
    t,
  ]);

  return (
    <div
      id={id}
      tabIndex={-1}
      onFocus={(event) => {
        if (event.target === event.currentTarget)
          instanceRef.current?.editor.focus();
      }}
      className={`relative min-w-0 overflow-hidden rounded-md border border-border focus-within:border-primary ${className}`}
      style={{
        height: height ?? Math.max(contentHeight, 36),
        minHeight: height === undefined ? minHeight : undefined,
        maxHeight:
          maxHeight ?? (height === undefined ? "min(480px, 60vh)" : undefined),
      }}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && (
        <p className="relative p-3 text-xs text-muted-foreground" role="status">
          {loadError || t("common.loading")}
        </p>
      )}
    </div>
  );
}
