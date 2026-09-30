import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { parse as parseToml } from "smol-toml";
import {
  codexConfigApi,
  configApi,
  providersApi,
  settingsApi,
} from "@/lib/api";
import type { ProviderMeta } from "@/types";
import { extractErrorMessage } from "@/utils/errorUtils";
import { normalizeTomlText } from "@/utils/textNormalization";

export type CodexConfigTab = "live" | "provider" | "common" | "final";

interface UseCodexLayeredConfigProps {
  enabled: boolean;
  providerId?: string;
  isEditMode: boolean;
  isProxyTakeover: boolean;
  initialMeta?: ProviderMeta;
  /** 服务商配置草稿（与表单字段共享同一份 TOML 文本） */
  providerDraft: string;
  /** 保存服务商配置前的规范化（wire_api、默认模型等，与表单保存保持一致） */
  normalizeProviderConfig: (config: string) => string;
  onProviderDraftChange: (config: string) => void;
}

const PREVIEW_DEBOUNCE_MS = 300;

const tomlSyntaxError = (text: string): string => {
  if (!text.trim()) return "";
  try {
    parseToml(normalizeTomlText(text));
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/**
 * 管理配置层草稿、磁盘基线和应用预览，应用前检查外部变更。
 * @param props - 服务商身份、初始配置和草稿更新方法。
 * @returns 各配置层状态、预览结果及保存操作。
 */
export function useCodexLayeredConfig({
  enabled,
  providerId,
  isEditMode,
  isProxyTakeover,
  initialMeta,
  providerDraft,
  normalizeProviderConfig,
  onProviderDraftChange,
}: UseCodexLayeredConfigProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canSaveTabs = enabled && isEditMode && !!providerId;

  const [savingTab, setSavingTab] = useState<CodexConfigTab | null>(null);
  // 标签页保存后不立即刷新供应商列表：列表数据变化会重置编辑表单里其他未保存的草稿，
  // 关闭编辑页时再统一刷新。
  const needsInvalidateRef = useRef(false);

  // ---------- 服务商配置 ----------
  const [savedProviderConfig, setSavedProviderConfig] = useState<string>(
    () => initialMeta?.codexConfigLayers?.providerConfig ?? providerDraft,
  );
  const hasSyncedInitialProviderRef = useRef(false);
  useEffect(() => {
    // 编辑模式下草稿由 useCodexConfigState 异步初始化，首个非空值作为已保存基线
    if (hasSyncedInitialProviderRef.current) return;
    if (initialMeta?.codexConfigLayers) {
      setSavedProviderConfig(initialMeta.codexConfigLayers.providerConfig);
      hasSyncedInitialProviderRef.current = true;
    } else if (providerDraft) {
      setSavedProviderConfig(providerDraft);
      hasSyncedInitialProviderRef.current = true;
    }
  }, [initialMeta, providerDraft]);
  const isProviderDirty = canSaveTabs && providerDraft !== savedProviderConfig;
  const [providerSaveError, setProviderSaveError] = useState("");

  // ---------- 通用配置 ----------
  const [savedCommonConfig, setSavedCommonConfig] = useState("");
  const [commonDraft, setCommonDraftState] = useState("");
  const [commonLoading, setCommonLoading] = useState(true);
  const [commonLoadError, setCommonLoadError] = useState("");
  const [commonError, setCommonError] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const isCommonDirty = commonDraft !== savedCommonConfig;

  // ---------- 最终配置 ----------
  const [savedFinalConfig, setSavedFinalConfig] = useState<string | null>(null);
  const [finalPreview, setFinalPreview] = useState("");
  const [finalError, setFinalError] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [finalApplyError, setFinalApplyError] = useState("");
  const [finalSaveError, setFinalSaveError] = useState("");
  const applyingRef = useRef(false);
  const previewSeqRef = useRef(0);

  // ---------- 当前配置 ----------
  const [isCurrent, setIsCurrent] = useState(false);
  const [currentProviderName, setCurrentProviderName] = useState("");
  const [configPath, setConfigPath] = useState("config.toml");
  const [liveText, setLiveText] = useState("");
  const [liveDraft, setLiveDraft] = useState("");
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState("");
  const [liveSaveError, setLiveSaveError] = useState("");
  const isLiveDirty = liveDraft !== liveText;
  const isLiveEditable =
    canSaveTabs && isCurrent && !isProxyTakeover && !liveLoading && !liveError;

  const loadCommonConfig = useCallback(async () => {
    setCommonLoading(true);
    setCommonLoadError("");
    try {
      const snippet = (await configApi.getCommonConfigSnippet("codex")) ?? "";
      setSavedCommonConfig(snippet);
      setCommonDraftState(snippet);
    } catch (error) {
      setCommonLoadError(extractErrorMessage(error) || String(error));
    } finally {
      setCommonLoading(false);
    }
  }, []);

  const loadLiveConfig = useCallback(async () => {
    setLiveLoading(true);
    setLiveError("");
    try {
      const text = await codexConfigApi.readLiveConfig();
      setLiveText(text);
      setLiveDraft(text);
    } catch (error) {
      setLiveText("");
      setLiveDraft("");
      setLiveError(extractErrorMessage(error) || String(error));
    } finally {
      setLiveLoading(false);
    }
  }, []);

  const loadProviderState = useCallback(async () => {
    try {
      const [providers, currentId] = await Promise.all([
        providersApi.getAll("codex"),
        providersApi.getCurrent("codex"),
      ]);
      setIsCurrent(!!providerId && currentId === providerId);
      setCurrentProviderName(providers[currentId]?.name ?? "");
      if (providerId) {
        const stored = providers[providerId];
        const config = stored?.settingsConfig?.config;
        setSavedFinalConfig(typeof config === "string" ? config : "");
      }
    } catch (error) {
      console.error("加载 Codex 供应商状态失败:", error);
    }
  }, [providerId]);

  useEffect(() => {
    if (!enabled) return;
    void loadCommonConfig();
    void loadLiveConfig();
    void loadProviderState();
    void settingsApi
      .getConfigDir("codex")
      .then((directory) => {
        setConfigPath(`${directory.replace(/[\\/]$/, "")}/config.toml`);
      })
      .catch(() => {});
  }, [enabled, loadCommonConfig, loadLiveConfig, loadProviderState]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      if (needsInvalidateRef.current) {
        void queryClient.invalidateQueries({
          queryKey: ["providers", "codex"],
        });
      }
    };
  }, [enabled, queryClient]);

  // 最终配置实时预览：服务商草稿 + 通用配置草稿，走后端同一套合并逻辑
  useEffect(() => {
    if (!enabled || commonLoading) return;
    const seq = ++previewSeqRef.current;
    setIsPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const merged = await codexConfigApi.preview(commonDraft, providerDraft);
        if (seq !== previewSeqRef.current) return;
        setFinalPreview(merged);
        setFinalError("");
      } catch (error) {
        if (seq !== previewSeqRef.current) return;
        setFinalError(extractErrorMessage(error) || String(error));
      } finally {
        if (seq === previewSeqRef.current) setIsPreviewing(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      previewSeqRef.current += 1;
    };
  }, [enabled, commonLoading, commonDraft, providerDraft]);

  const setCommonDraft = useCallback((value: string) => {
    setCommonDraftState(value);
    setCommonError("");
  }, []);

  const saveProviderConfig = useCallback(async () => {
    if (!canSaveTabs || !providerId) return;
    const normalized = normalizeProviderConfig(providerDraft);
    const syntaxError = tomlSyntaxError(normalized);
    if (syntaxError) {
      setProviderSaveError(syntaxError);
      return;
    }
    setSavingTab("provider");
    setProviderSaveError("");
    try {
      await codexConfigApi.saveProviderConfig(providerId, normalized);
      needsInvalidateRef.current = true;
      setSavedProviderConfig(normalized);
      if (normalized !== providerDraft) {
        onProviderDraftChange(normalized);
      }
      toast.success(
        t("codexConfig.layers.providerSaved", {
          defaultValue: "服务商配置已保存",
        }),
      );
    } catch (error) {
      setProviderSaveError(extractErrorMessage(error) || String(error));
    } finally {
      setSavingTab(null);
    }
  }, [
    canSaveTabs,
    providerId,
    providerDraft,
    normalizeProviderConfig,
    onProviderDraftChange,
    t,
  ]);

  const resetProviderConfig = useCallback(() => {
    setProviderSaveError("");
    onProviderDraftChange(savedProviderConfig);
  }, [onProviderDraftChange, savedProviderConfig]);

  const saveCommonConfig = useCallback(async () => {
    if (commonLoading || commonLoadError) return;
    const syntaxError = tomlSyntaxError(commonDraft);
    if (syntaxError) {
      setCommonError(syntaxError);
      return;
    }
    setSavingTab("common");
    setCommonError("");
    try {
      await configApi.setCommonConfigSnippet("codex", commonDraft);
      needsInvalidateRef.current = true;
      setSavedCommonConfig(commonDraft);
      toast.success(
        t("codexConfig.layers.commonSaved", {
          defaultValue: "通用配置已保存，各服务商保存最终配置后生效",
        }),
      );
    } catch (error) {
      setCommonError(extractErrorMessage(error) || String(error));
    } finally {
      setSavingTab(null);
    }
  }, [commonDraft, commonLoadError, commonLoading, t]);

  const resetCommonConfig = useCallback(() => {
    setCommonError("");
    setCommonDraftState(savedCommonConfig);
  }, [savedCommonConfig]);

  // 从服务商配置草稿提取通用部分，只修改通用配置草稿
  const extractCommonConfig = useCallback(async () => {
    setIsExtracting(true);
    setCommonError("");
    try {
      const extracted = await configApi.extractCommonConfigSnippet("codex", {
        settingsConfig: JSON.stringify({ config: providerDraft ?? "" }),
      });
      if (!extracted || !extracted.trim()) {
        setCommonError(t("codexConfig.extractNoCommonConfig"));
        return;
      }
      setCommonDraftState(extracted);
    } catch (error) {
      setCommonError(
        t("codexConfig.extractFailed", {
          error: extractErrorMessage(error) || String(error),
        }),
      );
    } finally {
      setIsExtracting(false);
    }
  }, [providerDraft, t]);

  const canSaveFinal =
    canSaveTabs &&
    !savingTab &&
    !isLiveDirty &&
    !isProxyTakeover &&
    (!isCurrent || (!liveLoading && !liveError)) &&
    !tomlSyntaxError(providerDraft) &&
    !tomlSyntaxError(commonDraft) &&
    !commonLoading &&
    !commonLoadError &&
    !finalError &&
    !isPreviewing;

  /**
   * 保存当前草稿并应用已预览的合并结果，发现外部修改时刷新基线。
   * @returns 保存流程完成的 Promise。
   */
  const saveFinalConfig = useCallback(async () => {
    if (!canSaveFinal || !providerId || applyingRef.current) return;
    applyingRef.current = true;
    setSavingTab("final");
    setFinalApplyError("");
    setFinalSaveError("");
    try {
      const currentId = await providersApi.getCurrent("codex");
      if ((currentId === providerId) !== isCurrent) {
        await Promise.all([loadProviderState(), loadLiveConfig()]);
        setFinalSaveError(t("codexConfig.layers.providerChanged"));
        return;
      }
      if (isCurrent) {
        const latest = await codexConfigApi.readLiveConfig();
        if (latest !== liveText) {
          setLiveText(latest);
          setLiveDraft(latest);
          setFinalSaveError(t("codexConfig.layers.diskChanged"));
          return;
        }
      }
      const latestCommon =
        (await configApi.getCommonConfigSnippet("codex")) ?? "";
      if (latestCommon !== savedCommonConfig) {
        setSavedCommonConfig(latestCommon);
        if (!isCommonDirty) setCommonDraftState(latestCommon);
        setFinalSaveError(t("codexConfig.layers.commonChanged"));
        return;
      }
      const normalized = normalizeProviderConfig(providerDraft);
      if (normalized !== providerDraft) {
        onProviderDraftChange(normalized);
        setFinalSaveError(t("codexConfig.layers.previewUpdated"));
        return;
      }
      if (isProviderDirty) {
        await codexConfigApi.saveProviderConfig(providerId, normalized);
        needsInvalidateRef.current = true;
        setSavedProviderConfig(normalized);
      }
      if (isCommonDirty) {
        await configApi.setCommonConfigSnippet("codex", commonDraft);
        needsInvalidateRef.current = true;
        setSavedCommonConfig(commonDraft);
      }
      const result = await codexConfigApi.saveFinalConfig(providerId, {
        expectedLiveConfig: isCurrent ? liveText : undefined,
        expectedIsCurrent: isCurrent,
        expectedFinalConfig: finalPreview,
      });
      needsInvalidateRef.current = true;
      await loadProviderState();
      if (result.applyError) {
        setFinalApplyError(result.applyError);
        toast.error(
          t("codexConfig.layers.savedButApplyFailed", {
            defaultValue: "已保存，应用失败：{{error}}",
            error: result.applyError,
          }),
        );
        return;
      }
      if (result.isCurrent) {
        await loadLiveConfig();
      }
      toast.success(
        result.isCurrent
          ? t("codexConfig.layers.finalSavedApplied", {
              defaultValue: "最终配置已保存并写入当前配置",
            })
          : t("codexConfig.layers.finalSaved", {
              defaultValue: "最终配置已保存，切换到该服务商时生效",
            }),
      );
    } catch (error) {
      setFinalSaveError(extractErrorMessage(error) || String(error));
      await Promise.all([loadLiveConfig(), loadProviderState()]);
    } finally {
      applyingRef.current = false;
      setSavingTab(null);
    }
  }, [
    canSaveFinal,
    providerId,
    isCurrent,
    liveText,
    savedCommonConfig,
    isCommonDirty,
    isProviderDirty,
    commonDraft,
    providerDraft,
    normalizeProviderConfig,
    onProviderDraftChange,
    finalPreview,
    loadLiveConfig,
    loadProviderState,
    t,
  ]);

  /**
   * 保存高级入口中的磁盘草稿，写入前核对读取基线。
   * @returns 保存完成的 Promise。
   */
  const saveLiveConfig = useCallback(async () => {
    if (!isLiveEditable || !providerId) return;
    const syntaxError = tomlSyntaxError(liveDraft);
    if (syntaxError) {
      setLiveSaveError(syntaxError);
      return;
    }
    setSavingTab("live");
    setLiveSaveError("");
    try {
      const latest = await codexConfigApi.readLiveConfig();
      if (latest !== liveText) {
        setLiveText(latest);
        setLiveSaveError(t("codexConfig.layers.diskChangedWithDraft"));
        return;
      }
      await codexConfigApi.saveLiveConfig(providerId, liveDraft, liveText);
      needsInvalidateRef.current = true;
      await Promise.all([loadLiveConfig(), loadProviderState()]);
      toast.success(
        t("codexConfig.layers.liveSaved", {
          defaultValue: "当前配置已保存",
        }),
      );
    } catch (error) {
      setLiveSaveError(extractErrorMessage(error) || String(error));
    } finally {
      setSavingTab(null);
    }
  }, [
    isLiveEditable,
    providerId,
    liveDraft,
    liveText,
    loadLiveConfig,
    loadProviderState,
    t,
  ]);

  const resetLiveConfig = useCallback(() => {
    setLiveSaveError("");
    setLiveDraft(liveText);
  }, [liveText]);

  return {
    canSaveTabs,
    savingTab,
    // 服务商配置
    isProviderDirty,
    providerSaveError,
    saveProviderConfig,
    resetProviderConfig,
    // 通用配置
    commonDraft,
    setCommonDraft,
    isCommonDirty,
    commonLoading,
    commonLoadError,
    commonError,
    isExtracting,
    saveCommonConfig,
    resetCommonConfig,
    extractCommonConfig,
    // 最终配置
    finalPreview,
    finalError,
    finalApplyError,
    finalSaveError,
    savedFinalConfig,
    isPreviewing,
    isFinalDirty:
      savedFinalConfig !== null &&
      !finalError &&
      finalPreview !== savedFinalConfig,
    canSaveFinal,
    saveFinalConfig,
    // 当前配置
    isCurrent,
    currentProviderName,
    configPath,
    liveText,
    liveDraft,
    setLiveDraft,
    liveLoading,
    liveError,
    liveSaveError,
    isLiveDirty,
    isLiveEditable,
    saveLiveConfig,
    resetLiveConfig,
    reloadLiveConfig: loadLiveConfig,
  };
}

export type CodexLayeredConfigState = ReturnType<typeof useCodexLayeredConfig>;
