import {
  useLayeredConfig,
  type LayeredConfigState,
  type UseLayeredConfigProps,
} from "./useLayeredConfig";

export type { CodexConfigTab } from "./useLayeredConfig";

/**
 * Codex 双层配置（TOML）。
 * @param props - 服务商身份、初始配置和草稿更新方法。
 * @returns 各配置层状态、预览结果及保存操作。
 */
export function useCodexLayeredConfig(
  props: Omit<UseLayeredConfigProps, "appId">,
): LayeredConfigState {
  return useLayeredConfig({ ...props, appId: "codex" });
}

export type CodexLayeredConfigState = LayeredConfigState;
