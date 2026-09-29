import React from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import JsonEditor from "@/components/JsonEditor";
import { useDarkMode } from "@/hooks/useDarkMode";
import { CodexAuthSection, CodexConfigSection } from "./CodexConfigSections";
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

  configError: string; // 服务商配置 TOML 错误提示

  layered: CodexLayeredConfigState;
}

interface TabActionsProps {
  error?: string;
  dirty: boolean;
  saving: boolean;
  saveDisabled: boolean;
  onSave: () => void;
  onReset?: () => void;
  extra?: React.ReactNode;
  note?: React.ReactNode;
}

const TabActions: React.FC<TabActionsProps> = ({
  error,
  dirty,
  saving,
  saveDisabled,
  onSave,
  onReset,
  extra,
  note,
}) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap">
          {error}
        </p>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {extra}
        {onReset && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={!dirty || saving}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("codexConfig.layers.revert", { defaultValue: "撤销修改" })}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={saveDisabled || saving}
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
};

const DirtyMark: React.FC<{ show: boolean }> = ({ show }) => {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <span
      className="ml-1 text-amber-500"
      title={t("codexConfig.layers.unsaved", { defaultValue: "有未保存的修改" })}
    >
      •
    </span>
  );
};

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
  const isDarkMode = useDarkMode();
  const { canSaveTabs, savingTab } = layered;

  const liveNote = !canSaveTabs
    ? t("codexConfig.layers.liveReadOnlyNew", {
        defaultValue: "新建的服务商尚未启用，当前配置仅供查看。",
      })
    : isProxyTakeover
      ? t("codexConfig.layers.liveReadOnlyTakeover", {
          defaultValue: "代理接管期间当前配置由代理管理，仅供查看。",
        })
      : !layered.isCurrent
        ? t("codexConfig.layers.liveReadOnlyOther", {
            defaultValue: "当前配置属于正在使用的服务商 {{name}}，仅供查看。",
            name: layered.currentProviderName || "-",
          })
        : undefined;

  const finalNote = !canSaveTabs
    ? t("codexConfig.layers.finalNewHint", {
        defaultValue: "新建服务商时，提交表单会按此结果创建最终配置。",
      })
    : layered.isProviderDirty || layered.isCommonDirty
      ? t("codexConfig.layers.finalNeedsLayersSaved", {
          defaultValue: "请先保存“服务商配置”和“通用配置”标签页中的修改。",
        })
      : layered.isCurrent
        ? t("codexConfig.layers.finalCurrentHint", {
            defaultValue: "保存后立即覆盖当前配置文件。",
          })
        : t("codexConfig.layers.finalOtherHint", {
            defaultValue: "该服务商未启用，保存后在切换到它时生效。",
          });

  return (
    <div className="space-y-6">
      {isProxyTakeover && (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t("codexConfig.proxyTakeoverStorageNotice")}
          </p>
        </div>
      )}

      {/* Auth JSON Section：随表单保存按钮保存 */}
      <CodexAuthSection
        value={authValue}
        onChange={onAuthChange}
        onBlur={onAuthBlur}
        error={authError}
        isProxyTakeover={isProxyTakeover}
      />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="block text-sm font-medium text-foreground">
            {t("codexConfig.configToml")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("codexConfig.layers.sharedHint", {
            defaultValue:
              "通用配置由所有 Codex 服务商共享；各服务商在“最终配置”页保存后生效。",
          })}
        </p>

        <Tabs defaultValue="provider" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="live" className="min-w-0">
              {t("codexConfig.layers.liveTab", { defaultValue: "当前配置" })}
              <DirtyMark show={layered.isLiveDirty} />
            </TabsTrigger>
            <TabsTrigger value="provider" className="min-w-0">
              {t("codexConfig.layers.providerTab", {
                defaultValue: "服务商配置",
              })}
              <DirtyMark show={layered.isProviderDirty} />
            </TabsTrigger>
            <TabsTrigger value="common" className="min-w-0">
              {t("codexConfig.layers.commonTab", { defaultValue: "通用配置" })}
              <DirtyMark show={layered.isCommonDirty} />
            </TabsTrigger>
            <TabsTrigger value="final" className="min-w-0">
              {t("codexConfig.layers.finalTab", { defaultValue: "最终配置" })}
              <DirtyMark show={layered.isFinalDirty} />
            </TabsTrigger>
          </TabsList>

          {/* 当前配置：真实 config.toml */}
          <TabsContent value="live" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("codexConfig.layers.liveHint", {
                defaultValue:
                  "磁盘上真实的 config.toml。保存后直接写回文件，并同步为当前服务商的最终配置。",
              })}
            </p>
            {layered.liveLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading", { defaultValue: "加载中..." })}
              </div>
            ) : layered.liveError ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 dark:border-red-800 p-3">
                <p className="text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap">
                  {layered.liveError}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void layered.reloadLiveConfig()}
                >
                  {t("codexConfig.layers.reload", { defaultValue: "重新读取" })}
                </Button>
              </div>
            ) : (
              <JsonEditor
                value={layered.liveDraft}
                onChange={layered.setLiveDraft}
                darkMode={isDarkMode}
                rows={12}
                showValidation={false}
                language="javascript"
                readOnly={!layered.isLiveEditable}
              />
            )}
            <TabActions
              error={layered.liveSaveError}
              note={liveNote}
              dirty={layered.isLiveDirty}
              saving={savingTab === "live"}
              saveDisabled={!layered.isLiveEditable || !layered.isLiveDirty}
              onSave={() => void layered.saveLiveConfig()}
              onReset={layered.resetLiveConfig}
            />
          </TabsContent>

          {/* 服务商配置 */}
          <TabsContent value="provider" className="space-y-3">
            <CodexConfigSection
              value={configValue}
              onChange={onConfigChange}
              providerName={providerName}
              showRemoteCompaction={showRemoteCompaction}
              configError={configError}
              isProxyTakeover={isProxyTakeover}
              label={null}
              hint={t("codexConfig.layers.providerHint", {
                defaultValue:
                  "该服务商独立的配置，会按键覆盖通用配置。保存后不会立即生效，需在“最终配置”页保存。",
              })}
            />
            {canSaveTabs && (
              <TabActions
                error={layered.providerSaveError}
                dirty={layered.isProviderDirty}
                saving={savingTab === "provider"}
                saveDisabled={!layered.isProviderDirty}
                onSave={() => void layered.saveProviderConfig()}
                onReset={layered.resetProviderConfig}
              />
            )}
          </TabsContent>

          {/* 通用配置 */}
          <TabsContent value="common" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("codexConfig.layers.commonHint", {
                defaultValue:
                  "所有 Codex 服务商共享。保存后不会改变任何服务商的最终配置，各服务商保存最终配置时采用。",
              })}
            </p>
            {layered.commonLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading", { defaultValue: "加载中..." })}
              </div>
            ) : layered.commonLoadError ? (
              <p className="text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap">
                {t("codexConfig.layers.commonLoadFailed", {
                  defaultValue: "加载通用配置失败：{{error}}",
                  error: layered.commonLoadError,
                })}
              </p>
            ) : (
              <JsonEditor
                value={layered.commonDraft}
                onChange={layered.setCommonDraft}
                placeholder={`# Common Codex config\n# Add your common TOML configuration here`}
                darkMode={isDarkMode}
                rows={12}
                showValidation={false}
                language="javascript"
              />
            )}
            <TabActions
              error={layered.commonError}
              dirty={layered.isCommonDirty}
              saving={savingTab === "common"}
              saveDisabled={
                layered.commonLoading ||
                !!layered.commonLoadError ||
                !layered.isCommonDirty
              }
              onSave={() => void layered.saveCommonConfig()}
              onReset={layered.resetCommonConfig}
              extra={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void layered.extractCommonConfig()}
                  disabled={
                    layered.isExtracting ||
                    layered.commonLoading ||
                    !!layered.commonLoadError
                  }
                  className="gap-1.5"
                >
                  {layered.isExtracting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {t("codexConfig.layers.extractFromProvider", {
                    defaultValue: "从服务商配置提取",
                  })}
                </Button>
              }
            />
          </TabsContent>

          {/* 最终配置：只读合并结果 */}
          <TabsContent value="final" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("codexConfig.layers.finalHint", {
                defaultValue:
                  "只读：通用配置 + 服务商配置的合并结果，服务商配置优先。",
              })}
            </p>
            {layered.finalError ? (
              <p className="text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap">
                {layered.finalError}
              </p>
            ) : (
              <JsonEditor
                value={layered.finalPreview}
                onChange={() => {}}
                darkMode={isDarkMode}
                rows={12}
                showValidation={false}
                language="javascript"
                readOnly
              />
            )}
            {canSaveTabs ? (
              <TabActions
                error={
                  layered.finalApplyError
                    ? t("codexConfig.layers.savedButApplyFailed", {
                        defaultValue: "已保存，应用失败：{{error}}",
                        error: layered.finalApplyError,
                      })
                    : undefined
                }
                note={finalNote}
                dirty={layered.isFinalDirty}
                saving={savingTab === "final"}
                saveDisabled={!layered.canSaveFinal}
                onSave={() => void layered.saveFinalConfig()}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{finalNote}</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default CodexConfigEditor;
