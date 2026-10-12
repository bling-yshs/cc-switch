import React from "react";
import { useTranslation } from "react-i18next";
import { CodexAuthSection, CodexConfigSection } from "./CodexConfigSections";
import { LayeredConfigTabs } from "./LayeredConfigTabs";
import type { CodexLayeredConfigState } from "./hooks";

interface CodexConfigEditorProps {
  authValue: string;
  configValue: string;
  providerName?: string;
  showRemoteCompaction?: boolean;
  isProxyTakeover?: boolean;
  onAuthChange: (value: string) => void;
  onConfigChange: (value: string) => void;
  onAuthBlur?: () => void;
  authError: string;
  configError: string;
  layered: CodexLayeredConfigState;
}

/**
 * 认证信息 + 服务商、通用配置和应用预览三个页面。
 * @param props - 认证信息、配置草稿和分层配置控制器。
 * @returns Codex 配置编辑界面。
 */
const CodexConfigEditor: React.FC<CodexConfigEditorProps> = ({
  authValue,
  configValue,
  providerName,
  showRemoteCompaction,
  isProxyTakeover = false,
  onAuthChange,
  onConfigChange,
  onAuthBlur,
  authError,
  configError,
  layered,
}) => {
  const { t } = useTranslation();
  const busy = layered.savingTab !== null;

  return (
    <div className="min-w-0 space-y-6">
      {isProxyTakeover && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t("codexConfig.proxyTakeoverStorageNotice")}
          </p>
        </div>
      )}
      <CodexAuthSection
        value={authValue}
        onChange={onAuthChange}
        onBlur={onAuthBlur}
        error={authError}
        isProxyTakeover={isProxyTakeover}
      />

      <LayeredConfigTabs
        layered={layered}
        language="toml"
        label={
          <span className="block text-sm font-medium text-foreground">
            {t("codexConfig.configToml")}
          </span>
        }
        providerContent={
          <CodexConfigSection
            value={configValue}
            onChange={onConfigChange}
            providerName={providerName}
            showRemoteCompaction={showRemoteCompaction}
            configError={configError}
            isProxyTakeover={isProxyTakeover}
            label={null}
            hint={t("codexConfig.layers.providerHint")}
            readOnly={busy}
          />
        }
        providerSaveDisabled={!!configError}
        commonHint={t("codexConfig.layers.commonHint")}
        rawDiffFallback={t("codexConfig.layers.rawDiffFallback")}
      />
    </div>
  );
};

export default CodexConfigEditor;
