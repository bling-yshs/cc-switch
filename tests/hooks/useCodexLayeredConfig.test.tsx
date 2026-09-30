import { useState, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCodexLayeredConfig } from "@/components/providers/forms/hooks/useCodexLayeredConfig";

const api = vi.hoisted(() => ({
  preview: vi.fn(),
  saveProviderConfig: vi.fn(),
  saveFinalConfig: vi.fn(),
  readLiveConfig: vi.fn(),
  saveLiveConfig: vi.fn(),
  getAll: vi.fn(),
  getCurrent: vi.fn(),
  getCommonConfigSnippet: vi.fn(),
  setCommonConfigSnippet: vi.fn(),
  getConfigDir: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  codexConfigApi: api,
  configApi: api,
  providersApi: api,
  settingsApi: api,
}));

const initial = 'model = "old"';

/**
 * 挂载真实配置控制器，以 React 草稿状态模拟编辑表单。
 * @returns Hook 测试句柄。
 */
function mountConfig() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(
    () => {
      const [providerDraft, onProviderDraftChange] = useState(initial);
      return {
        ...useCodexLayeredConfig({
          enabled: true,
          providerId: "a",
          isEditMode: true,
          isProxyTakeover: false,
          initialMeta: {
            codexConfigLayers: { providerConfig: initial, commonConfig: "" },
          },
          providerDraft,
          onProviderDraftChange,
          normalizeProviderConfig: (value) => value,
        }),
        editProvider: onProviderDraftChange,
      };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getCurrent.mockResolvedValue("a");
  api.getAll.mockResolvedValue({
    a: { name: "A", settingsConfig: { config: initial } },
  });
  api.readLiveConfig.mockResolvedValue(initial);
  api.getCommonConfigSnippet.mockResolvedValue("");
  api.getConfigDir.mockResolvedValue("/test/codex");
  api.preview.mockImplementation(async (common, provider) =>
    [common, provider].filter(Boolean).join("\n"),
  );
  api.saveFinalConfig.mockResolvedValue({ isCurrent: true, applied: true });
});

describe("Codex apply preview", () => {
  it("refreshes the disk baseline and blocks applying after an external edit", async () => {
    const { result } = mountConfig();
    await waitFor(() => expect(result.current.canSaveFinal).toBe(true));
    api.readLiveConfig.mockResolvedValue('model = "external"');
    await act(() => result.current.saveFinalConfig());
    expect(api.saveFinalConfig).not.toHaveBeenCalled();
    expect(result.current.liveText).toBe('model = "external"');
    expect(result.current.finalSaveError).toBe(
      "codexConfig.layers.diskChanged",
    );
  });

  it("saves both drafts before applying exactly the previewed result", async () => {
    const { result } = mountConfig();
    await waitFor(() => expect(result.current.canSaveFinal).toBe(true));
    act(() => {
      result.current.editProvider('model = "new"');
      result.current.setCommonDraft('effort = "high"');
    });
    await waitFor(() => expect(result.current.canSaveFinal).toBe(true));
    await act(() => result.current.saveFinalConfig());
    expect(api.saveProviderConfig).toHaveBeenCalledWith("a", 'model = "new"');
    expect(api.setCommonConfigSnippet).toHaveBeenCalledWith(
      "codex",
      'effort = "high"',
    );
    expect(api.saveFinalConfig).toHaveBeenCalledWith("a", {
      expectedLiveConfig: initial,
      expectedIsCurrent: true,
      expectedFinalConfig: 'effort = "high"\nmodel = "new"',
    });
    expect(api.saveProviderConfig.mock.invocationCallOrder[0]).toBeLessThan(
      api.setCommonConfigSnippet.mock.invocationCallOrder[0],
    );
    expect(api.setCommonConfigSnippet.mock.invocationCallOrder[0]).toBeLessThan(
      api.saveFinalConfig.mock.invocationCallOrder[0],
    );
    expect(result.current.isProviderDirty).toBe(false);
    expect(result.current.isCommonDirty).toBe(false);
  });

  it("keeps the common draft and stops applying when saving it fails", async () => {
    const { result } = mountConfig();
    await waitFor(() => expect(result.current.canSaveFinal).toBe(true));
    act(() => result.current.setCommonDraft('effort = "high"'));
    await waitFor(() => expect(result.current.canSaveFinal).toBe(true));
    api.setCommonConfigSnippet.mockRejectedValue(new Error("write failed"));
    await act(() => result.current.saveFinalConfig());
    expect(api.saveFinalConfig).not.toHaveBeenCalled();
    expect(result.current.commonDraft).toBe('effort = "high"');
    expect(result.current.isCommonDirty).toBe(true);
    expect(result.current.finalSaveError).toBe("write failed");
  });

  it("saves an inactive provider with a guard against activation during the request", async () => {
    api.getCurrent.mockResolvedValue("b");
    api.saveFinalConfig.mockResolvedValue({ isCurrent: false, applied: false });
    const { result } = mountConfig();
    await waitFor(() => expect(result.current.canSaveFinal).toBe(true));
    await act(() => result.current.saveFinalConfig());
    expect(api.saveFinalConfig).toHaveBeenCalledWith("a", {
      expectedIsCurrent: false,
      expectedLiveConfig: undefined,
      expectedFinalConfig: initial,
    });
  });

  it("blocks applying when the active provider changes after previewing", async () => {
    const { result } = mountConfig();
    await waitFor(() => expect(result.current.canSaveFinal).toBe(true));
    api.getCurrent.mockResolvedValue("b");
    await act(() => result.current.saveFinalConfig());
    expect(api.saveFinalConfig).not.toHaveBeenCalled();
    expect(result.current.finalSaveError).toBe(
      "codexConfig.layers.providerChanged",
    );
  });
});
