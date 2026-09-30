import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MonacoEditor from "@/components/MonacoEditor";

const mocks = vi.hoisted(() => {
  const model = { getValue: vi.fn(), dispose: vi.fn() };
  const editor = {
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    onDidContentSizeChange: vi.fn(
      (_listener: (event: { contentHeight: number }) => void) => ({
        dispose: vi.fn(),
      }),
    ),
    getContentHeight: vi.fn(),
    updateOptions: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    model,
    editor,
    monaco: {
      editor: {
        createModel: vi.fn(),
        create: vi.fn(() => editor),
        setTheme: vi.fn(),
        setModelLanguage: vi.fn(),
        setModelMarkers: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/monaco", () => ({ monaco: mocks.monaco }));

beforeEach(() => {
  mocks.monaco.editor.createModel.mockImplementation((value: string) => {
    mocks.model.getValue.mockReturnValue(value);
    return mocks.model;
  });
  mocks.editor.getContentHeight.mockReturnValue(6000);
});

describe("Monaco editor scrolling", () => {
  it("bounds long documents and subsequent content growth without recreating the editor", async () => {
    const { container } = render(<MonacoEditor value={"line\n".repeat(300)} />);
    await waitFor(() => expect(mocks.editor.updateOptions).toHaveBeenCalled());
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveStyle({
      height: "6000px",
      maxHeight: "min(480px, 60vh)",
    });

    act(() =>
      mocks.editor.onDidContentSizeChange.mock.calls[0][0]({
        contentHeight: 12000,
      }),
    );

    expect(wrapper).toHaveStyle({
      height: "12000px",
      maxHeight: "min(480px, 60vh)",
    });
    expect(mocks.monaco.editor.create).toHaveBeenCalledTimes(1);
  });

  it("allows wheel input and releases it to the parent at scroll boundaries", async () => {
    render(<MonacoEditor value="long document" />);
    await waitFor(() => expect(mocks.monaco.editor.create).toHaveBeenCalled());
    expect(mocks.monaco.editor.create).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        scrollbar: {
          vertical: "auto",
          handleMouseWheel: true,
          alwaysConsumeMouseWheel: false,
        },
      }),
    );
  });

  it("keeps short documents compact and honors a caller's custom height limit", async () => {
    mocks.editor.getContentHeight.mockReturnValue(56);
    const { container } = render(
      <MonacoEditor value="short" minHeight={36} maxHeight={240} />,
    );
    await waitFor(() => expect(mocks.editor.updateOptions).toHaveBeenCalled());
    expect(container.firstElementChild).toHaveStyle({
      height: "56px",
      minHeight: "36px",
      maxHeight: "240px",
    });
  });

  it.each([360, "100%"])(
    "preserves explicit height %s during content growth",
    async (height) => {
      const { container } = render(
        <MonacoEditor value="long document" height={height} />,
      );
      await waitFor(() =>
        expect(mocks.editor.updateOptions).toHaveBeenCalled(),
      );
      act(() =>
        mocks.editor.onDidContentSizeChange.mock.calls[0][0]({
          contentHeight: 12000,
        }),
      );
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.style.height).toBe(
        typeof height === "number" ? `${height}px` : height,
      );
      expect(wrapper.style.maxHeight).toBe("");
    },
  );
});
