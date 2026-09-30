import { expect, it, vi } from "vitest";

/**
 * 验证 JSON 语言服务延迟加载后，拖放组件的依赖仍可从服务容器获取。
 * @returns {Promise<void>} 完成 Monaco 模块加载和依赖解析检查的 Promise。
 */
async function verifyDeferredJsonServices() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  );
  try {
    await import("@/lib/monaco");
    const { getSingletonServiceDescriptors } = await import(
      "monaco-editor/platform/instantiation/common/extensions.js"
    );
    const { StandaloneServices } = await import(
      "monaco-editor/editor/standalone/browser/standaloneServices.js"
    );
    const services = new Map();
    for (const [id] of getSingletonServiceDescriptors()) {
      services.set(id.toString(), id);
    }
    await import("monaco-editor/languages/features/json/jsonMode.js");
    for (const [id] of getSingletonServiceDescriptors()) {
      expect(
        services.has(id.toString()),
        `Service registered too late: ${id}`,
      ).toBe(true);
    }
    expect(services.has("treeViewsDndService")).toBe(true);
    expect(
      StandaloneServices.get(services.get("treeViewsDndService")),
    ).toHaveProperty("removeDragOperationTransfer", expect.any(Function));
  } finally {
    vi.unstubAllGlobals();
  }
}

it(
  "resolves drag-and-drop dependencies after JSON loads",
  verifyDeferredJsonServices,
  20000,
);
