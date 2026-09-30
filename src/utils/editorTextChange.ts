/**
 * 定位文本变化的最小连续区间，用于保留编辑器撤销记录。
 * @param current - 当前文本。
 * @param next - 外部更新后的文本。
 * @returns 替换区间和插入内容。
 */
export function minimalTextChange(current: string, next: string) {
  let from = 0;
  const sharedLength = Math.min(current.length, next.length);
  while (from < sharedLength && current[from] === next[from]) from += 1;
  let to = current.length;
  let nextTo = next.length;
  while (to > from && nextTo > from && current[to - 1] === next[nextTo - 1]) {
    to -= 1;
    nextTo -= 1;
  }
  return { from, to, insert: next.slice(from, nextTo) };
}

/**
 * 使用光标附近的唯一上下文定位规范化后的光标，支持多处同时变更。
 * @param current - 更新前文本。
 * @param next - 更新后文本。
 * @param position - 更新前字符偏移。
 * @returns 更新后偏移，找不到上下文时返回 null。
 */
export function mapPositionByContext(
  current: string,
  next: string,
  position: number,
): number | null {
  if (position <= 0) return 0;
  if (position >= current.length) return next.length;
  for (const direction of ["right", "left"] as const) {
    const limit = Math.min(
      96,
      direction === "right" ? current.length - position : position,
    );
    for (let length = limit; length > 0; length -= 1) {
      const context =
        direction === "right"
          ? current.slice(position, position + length)
          : current.slice(position - length, position);
      const index = next.indexOf(context);
      if (index >= 0 && next.indexOf(context, index + 1) < 0) {
        return direction === "right" ? index : index + length;
      }
    }
  }
  return null;
}
