type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * 对 JSON 对象递归排序，保留数组顺序。
 * @param value - JSON 解析值。
 * @returns 排序后的等价值。
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }
  return value;
}

/**
 * 比较 JSON 配置项，生成忽略排版和键顺序差异的双栏文本和增删改计数。
 * @param original - 磁盘或已保存的 JSON。
 * @param modified - 准备应用的 JSON。
 * @returns 规范化的只读展示文本、计数；无效 JSON 保留原始文本。
 */
export function compareJson(original: string, modified: string) {
  const counts = { added: 0, modified: 0, removed: 0 };
  try {
    const before: unknown = JSON.parse(original.trim() ? original : "{}");
    const after: unknown = JSON.parse(modified.trim() ? modified : "{}");
    if (!isRecord(before) || !isRecord(after)) {
      throw new Error("JSON root must be an object");
    }
    /**
     * 递归统计两个对象的叶子变更，数组和类型替换计为一项。
     * @param left - 原配置对象。
     * @param right - 新配置对象。
     * @returns 无返回值。
     */
    const visit = (left: JsonRecord, right: JsonRecord): void => {
      for (const key of new Set([
        ...Object.keys(left),
        ...Object.keys(right),
      ])) {
        if (!Object.prototype.hasOwnProperty.call(left, key)) counts.added += 1;
        else if (!Object.prototype.hasOwnProperty.call(right, key))
          counts.removed += 1;
        else {
          const a = left[key];
          const b = right[key];
          if (isRecord(a) && isRecord(b)) {
            visit(a, b);
          } else if (
            JSON.stringify(sortJsonValue(a)) !==
            JSON.stringify(sortJsonValue(b))
          )
            counts.modified += 1;
        }
      }
    };
    visit(before, after);
    return {
      original: JSON.stringify(sortJsonValue(before), null, 2),
      modified: JSON.stringify(sortJsonValue(after), null, 2),
      counts,
      equal: !counts.added && !counts.modified && !counts.removed,
      error: "",
    };
  } catch (error) {
    return {
      original,
      modified,
      counts,
      equal: original === modified,
      error: String(error),
    };
  }
}
