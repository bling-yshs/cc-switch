import * as monaco from "monaco-editor/editor/editor.api.js";
// JSON 语言服务会加载全部编辑功能，需在 TOML 配置触发服务初始化前完成注册。
import "monaco-editor/features/register.all.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker.js?worker";
import { jsonDefaults } from "monaco-editor/languages/features/json/register.js";
import "monaco-editor/languages/definitions/javascript/register.js";
import "monaco-editor/languages/definitions/markdown/register.js";
import "monaco-editor/languages/definitions/ini/register.js";

globalThis.MonacoEnvironment = {
  /**
   * 从应用资源创建语言服务 Worker，支持离线桌面环境。
   * @param _moduleId - Monaco 请求的模块标识。
   * @param label - 语言服务类型。
   * @returns 本地 Worker 实例。
   */
  getWorker(_moduleId, label) {
    return label === "json" ? new JsonWorker() : new EditorWorker();
  },
};

// JSON 对象校验由编辑器实例按 showValidation 控制。
jsonDefaults.setDiagnosticsOptions({
  validate: false,
  enableSchemaRequest: false,
});

monaco.languages.register({ id: "toml", extensions: [".toml"] });
monaco.languages.setLanguageConfiguration("toml", {
  comments: { lineComment: "#" },
  brackets: [
    ["[", "]"],
    ["{", "}"],
  ],
  autoClosingPairs: [
    { open: "[", close: "]" },
    { open: "{", close: "}" },
    { open: '"', close: '"', notIn: ["string", "comment"] },
    { open: "'", close: "'", notIn: ["string", "comment"] },
  ],
});
monaco.languages.setMonarchTokensProvider("toml", {
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/"""/, "string", "@multilineBasic"],
      [/'''/, "string", "@multilineLiteral"],
      [/"(?:[^"\\]|\\.)*"(?=\s*=)/, "key"],
      [/'[^']*'(?=\s*=)/, "key"],
      [/"/, "string", "@basic"],
      [/'[^']*'/, "string"],
      [/^\s*\[\[?.*?\]\]?/, "type.identifier"],
      [/[\w-]+(?=\s*[.=])/, "key"],
      [/\b(?:true|false)\b/, "keyword"],
      [/[+-]?(?:inf|nan)\b/, "number"],
      [/[+-]?\d[\w.:+-]*/, "number"],
      [/[=.,]/, "delimiter"],
      [/[\[\]{}]/, "@brackets"],
    ],
    basic: [
      [/\\(?:[btnfr"\\]|u[\da-fA-F]{4}|U[\da-fA-F]{8})/, "string.escape"],
      [/"/, "string", "@pop"],
      [/[^"\\]+/, "string"],
      [/\\./, "string.escape.invalid"],
    ],
    multilineBasic: [
      [/"""/, "string", "@pop"],
      [/\\./, "string.escape"],
      [/[^"\\]+|"/, "string"],
    ],
    multilineLiteral: [
      [/'''/, "string", "@pop"],
      [/[^']+|'/, "string"],
    ],
  },
});

export { monaco };
