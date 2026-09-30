import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import JsonEditor from "@/components/JsonEditor";
import {
  mapPositionByContext,
  minimalTextChange,
} from "@/utils/editorTextChange";

vi.mock("@/components/MonacoEditor", () => ({ default: () => <div /> }));

describe("JsonEditor", () => {
  it("formats JSON through the controlled callback", () => {
    const onChange = vi.fn();
    render(<JsonEditor value={'{"a":1}'} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith('{\n  "a": 1\n}');
  });

  it("does not offer a write action for read-only previews", () => {
    render(<JsonEditor value="{}" onChange={vi.fn()} readOnly />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    [
      '{\n  "a": 1,\n  "b": 2\n}',
      '{\n  "a": 1,\n  "added": true,\n  "b": 2\n}',
    ],
    ['{"a":1,"b":2,"c":3}', '{"a":100,"b":2,"c":300}'],
  ])(
    "keeps the cursor at unchanged context during normalization",
    (original, normalized) => {
      expect(
        mapPositionByContext(original, normalized, original.indexOf('"b"') + 1),
      ).toBe(normalized.indexOf('"b"') + 1);
      const change = minimalTextChange(original, normalized);
      expect(
        original.slice(0, change.from) +
          change.insert +
          original.slice(change.to),
      ).toBe(normalized);
    },
  );
});
