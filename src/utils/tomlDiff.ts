import { parse, stringify } from "smol-toml";

/**
 * 对 TOML 表递归排序，保留数组顺序和日期类型。
 * @param value - TOML 解析值。
 * @returns 排序后的等价值。
 */
function sortTomlValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortTomlValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortTomlValue(item)]),
    );
  }
  return value;
}

/**
 * 比较 TOML 配置项，生成忽略排版差异的双栏文本和增删改计数。
 * @param original - 磁盘或已保存的 TOML。
 * @param modified - 准备应用的 TOML。
 * @returns 规范化的只读展示文本、计数；无效 TOML 保留原始文本。
 */
export function compareToml(original: string, modified: string) {
  const counts = { added: 0, modified: 0, removed: 0 };
  try {
    const before = parse(original);
    const after = parse(modified);
    /**
     * 递归统计两个表的叶子变更，数组和类型替换计为一项。
     * @param left - 原配置表。
     * @param right - 新配置表。
     * @returns 无返回值。
     */
    const visit = (
      left: Record<string, unknown>,
      right: Record<string, unknown>,
    ): void => {
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
          if (
            a &&
            b &&
            typeof a === "object" &&
            typeof b === "object" &&
            !Array.isArray(a) &&
            !Array.isArray(b) &&
            !(a instanceof Date) &&
            !(b instanceof Date)
          ) {
            visit(a as Record<string, unknown>, b as Record<string, unknown>);
          } else if (
            stringify({ value: sortTomlValue(a) }) !==
            stringify({ value: sortTomlValue(b) })
          )
            counts.modified += 1;
        }
      }
    };
    visit(before, after);
    return {
      original: stringify(sortTomlValue(before) as Record<string, unknown>),
      modified: stringify(sortTomlValue(after) as Record<string, unknown>),
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
