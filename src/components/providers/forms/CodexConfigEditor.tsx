import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import JsonEditor from "@/components/JsonEditor";
import MonacoEditor from "@/components/MonacoEditor";
import { useDarkMode } from "@/hooks/useDarkMode";
import { compareToml } from "@/utils/tomlDiff";
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
  configError: string;
  layered: CodexLayeredConfigState;
}

interface TabActionsProps {
  error?: string;
  dirty: boolean;
  saving: boolean;
  saveDisabled: boolean;
  saveLabel: string;
  onSave: () => void;
  onReset?: () => void;
  extra?: React.ReactNode;
}

/**
 * 展示单个配置层的保存、撤销及错误状态。
 * @param props - 操作状态、明确的保存文案和回调。
 * @returns 配置层操作栏。
 */
const TabActions: React.FC<TabActionsProps> = ({
  error,
  dirty,
  saving,
  saveDisabled,
  saveLabel,
  onSave,
  onReset,
  extra,
}) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap text-xs text-destructive"
        >
          {error}
        </p>
      )}
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
            {t("codexConfig.layers.revert")}
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
          {saveLabel}
        </Button>
      </div>
    </div>
  );
};

/**
 * 标记配置页存在未保存的草稿。
 * @param props - 是否显示标记。
 * @returns 带说明的状态标记。
 */
const DirtyMark: React.FC<{ show: boolean }> = ({ show }) => {
  const { t } = useTranslation();
  return show ? (
    <span
      className="ml-1 text-amber-500"
      title={t("codexConfig.layers.unsaved")}
    >
      •
    </span>
  ) : null;
};

/**
 * 提供服务商、通用配置和应用预览三个页面，统一展示保存与应用状态。
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
  const isDarkMode = useDarkMode();
  const [tab, setTab] = useState("provider");
  const [previewMode, setPreviewMode] = useState("diff");
  const [editDisk, setEditDisk] = useState(false);
  const { canSaveTabs, savingTab } = layered;
  const hasDrafts = layered.isProviderDirty || layered.isCommonDirty;
  const baseline = layered.isCurrent
    ? layered.liveText
    : (layered.savedFinalConfig ?? "");
  const comparison = useMemo(
    () => compareToml(baseline, layered.finalPreview),
    [baseline, layered.finalPreview],
  );
  const comparisonUnavailable = layered.isCurrent
    ? layered.liveLoading || !!layered.liveError
    : canSaveTabs && layered.savedFinalConfig === null;
  const busy = savingTab !== null;
  const pending =
    hasDrafts ||
    layered.isFinalDirty ||
    !comparison.equal ||
    !!layered.finalApplyError;
  const applyLabel = layered.isCurrent
    ? t(
        hasDrafts
          ? "codexConfig.layers.saveAndApply"
          : "codexConfig.layers.applyToFile",
      )
    : t("codexConfig.layers.savePending");
  const status = hasDrafts
    ? t("codexConfig.layers.draftsUnsaved")
    : layered.isPreviewing || comparisonUnavailable
      ? t("common.loading")
      : layered.finalError
        ? t("codexConfig.layers.previewInvalid")
        : pending
          ? t(
              layered.isCurrent
                ? "codexConfig.layers.savedNotApplied"
                : "codexConfig.layers.pendingSnapshot",
            )
          : t(
              layered.isCurrent
                ? "codexConfig.layers.matchesDisk"
                : "codexConfig.layers.matchesSaved",
            );

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

      <div className="min-w-0 space-y-3">
        <span className="block text-sm font-medium text-foreground">
          {t("codexConfig.configToml")}
        </span>
        <p className="text-xs text-muted-foreground">
          {t("codexConfig.layers.sharedHint")}
        </p>
        <fieldset disabled={busy} className="min-w-0">
          <Tabs value={tab} onValueChange={setTab} className="w-full min-w-0">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="provider" className="min-w-0">
                {t("codexConfig.layers.providerTab")}
                <DirtyMark show={layered.isProviderDirty} />
              </TabsTrigger>
              <TabsTrigger value="common" className="min-w-0">
                {t("codexConfig.layers.commonTab")}
                <DirtyMark show={layered.isCommonDirty} />
              </TabsTrigger>
              <TabsTrigger value="preview" className="min-w-0">
                {t("codexConfig.layers.previewTab")}
                <DirtyMark show={layered.isFinalDirty} />
              </TabsTrigger>
            </TabsList>

            <TabsContent value="provider" className="space-y-3">
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
              {canSaveTabs && (
                <TabActions
                  error={layered.providerSaveError}
                  dirty={layered.isProviderDirty}
                  saving={busy}
                  saveDisabled={!layered.isProviderDirty || !!configError}
                  saveLabel={t("codexConfig.layers.saveProvider")}
                  onSave={() => void layered.saveProviderConfig()}
                  onReset={layered.resetProviderConfig}
                />
              )}
            </TabsContent>

            <TabsContent value="common" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("codexConfig.layers.commonHint")}
              </p>
              {layered.commonLoading ? (
                <p className="py-6 text-sm text-muted-foreground">
                  {t("common.loading")}
                </p>
              ) : layered.commonLoadError ? (
                <p role="alert" className="text-xs text-destructive">
                  {t("codexConfig.layers.commonLoadFailed", {
                    error: layered.commonLoadError,
                  })}
                </p>
              ) : (
                <JsonEditor
                  value={layered.commonDraft}
                  onChange={layered.setCommonDraft}
                  darkMode={isDarkMode}
                  rows={12}
                  showValidation={false}
                  language="toml"
                  readOnly={busy}
                />
              )}
              <TabActions
                error={layered.commonError}
                dirty={layered.isCommonDirty}
                saving={busy}
                saveDisabled={
                  layered.commonLoading ||
                  !!layered.commonLoadError ||
                  !layered.isCommonDirty
                }
                saveLabel={t("codexConfig.layers.saveCommon")}
                onSave={() => void layered.saveCommonConfig()}
                onReset={layered.resetCommonConfig}
                extra={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void layered.extractCommonConfig()}
                    disabled={
                      busy ||
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
                    {t("codexConfig.layers.extractFromProvider")}
                  </Button>
                }
              />
            </TabsContent>

            <TabsContent value="preview" className="min-w-0 space-y-3">
              <p className="break-all text-xs text-muted-foreground">
                {layered.isCurrent
                  ? t("codexConfig.layers.targetFile", {
                      path: layered.configPath,
                    })
                  : t("codexConfig.layers.finalOtherHint")}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  className="flex gap-1"
                  role="group"
                  aria-label={t("codexConfig.layers.previewTab")}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant={previewMode === "diff" ? "secondary" : "ghost"}
                    aria-pressed={previewMode === "diff"}
                    onClick={() => setPreviewMode("diff")}
                  >
                    {t("codexConfig.layers.diffOnly")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={previewMode === "full" ? "secondary" : "ghost"}
                    aria-pressed={previewMode === "full"}
                    onClick={() => setPreviewMode("full")}
                  >
                    {t("codexConfig.layers.fullResult")}
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || layered.liveLoading || layered.isLiveDirty}
                  onClick={() => void layered.reloadLiveConfig()}
                >
                  {t("codexConfig.layers.reload")}
                </Button>
              </div>
              {layered.isPreviewing ? (
                <p role="status" className="py-6 text-sm text-muted-foreground">
                  {t("common.loading")}
                </p>
              ) : layered.finalError ? (
                <p
                  role="alert"
                  className="whitespace-pre-wrap text-xs text-destructive"
                >
                  {layered.finalError}
                </p>
              ) : previewMode === "full" ? (
                <MonacoEditor
                  value={layered.finalPreview}
                  language="toml"
                  darkMode={isDarkMode}
                  height={360}
                  readOnly
                />
              ) : comparisonUnavailable ? (
                <p role="status" className="text-xs text-destructive">
                  {layered.liveError || t("common.loading")}
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {comparison.error
                      ? t("codexConfig.layers.rawDiffFallback")
                      : comparison.equal
                        ? t(
                            layered.isCurrent
                              ? "codexConfig.layers.matchesDisk"
                              : "codexConfig.layers.matchesSaved",
                          )
                        : t(
                            "codexConfig.layers.diffSummary",
                            comparison.counts,
                          )}
                  </p>
                  {!comparison.error && (
                    <p className="text-xs text-muted-foreground">
                      {t("codexConfig.layers.semanticDiffHint")}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-xs font-medium">
                    <span>
                      {t(
                        layered.isCurrent
                          ? "codexConfig.layers.diskFile"
                          : "codexConfig.layers.savedSnapshot",
                      )}
                    </span>
                    <span>{t("codexConfig.layers.plannedResult")}</span>
                  </div>
                  <MonacoEditor
                    original={comparison.original}
                    value={comparison.modified}
                    language="toml"
                    darkMode={isDarkMode}
                    height={360}
                    readOnly
                  />
                </>
              )}

              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-xs font-medium">
                  {t("codexConfig.layers.diskAdvanced")}
                  <DirtyMark show={layered.isLiveDirty} />
                </summary>
                <div className="mt-3 space-y-3">
                  <p className="break-all text-xs text-muted-foreground">
                    {layered.configPath}
                  </p>
                  {layered.liveLoading ? (
                    <p className="text-xs">{t("common.loading")}</p>
                  ) : layered.liveError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {layered.liveError}
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {t("codexConfig.layers.directEditHint")}
                      </p>
                      {layered.isLiveEditable && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || layered.isLiveDirty}
                          onClick={() => setEditDisk(!editDisk)}
                        >
                          {t(
                            editDisk
                              ? "codexConfig.layers.readOnlyFile"
                              : "codexConfig.layers.editFile",
                          )}
                        </Button>
                      )}
                      <MonacoEditor
                        value={layered.liveDraft}
                        onChange={layered.setLiveDraft}
                        language="toml"
                        darkMode={isDarkMode}
                        height={300}
                        readOnly={!editDisk || !layered.isLiveEditable || busy}
                      />
                      {editDisk && (
                        <TabActions
                          error={layered.liveSaveError}
                          dirty={layered.isLiveDirty}
                          saving={busy}
                          saveDisabled={
                            !layered.isLiveEditable || !layered.isLiveDirty
                          }
                          saveLabel={t("codexConfig.layers.saveDisk")}
                          onSave={() => void layered.saveLiveConfig()}
                          onReset={layered.resetLiveConfig}
                        />
                      )}
                    </>
                  )}
                </div>
              </details>
            </TabsContent>
          </Tabs>
        </fieldset>

        <div className="sticky bottom-0 z-10 space-y-2 rounded-md border border-border bg-background p-3">
          <p role="status" className="text-xs text-muted-foreground">
            {status}
          </p>
          {layered.finalSaveError && (
            <p
              role="alert"
              className="whitespace-pre-wrap text-xs text-destructive"
            >
              {layered.finalSaveError}
            </p>
          )}
          {layered.finalApplyError && (
            <p role="alert" className="text-xs text-destructive">
              {t("codexConfig.layers.savedButApplyFailed", {
                error: layered.finalApplyError,
              })}
            </p>
          )}
          {layered.isLiveDirty && (
            <p className="text-xs text-amber-600">
              {t("codexConfig.layers.diskDraftPending")}
            </p>
          )}
          {canSaveTabs ? (
            <div className="flex flex-wrap justify-end gap-2">
              {tab !== "preview" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTab("preview")}
                >
                  {t("codexConfig.layers.viewPreview")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                disabled={
                  !layered.canSaveFinal || !pending || comparisonUnavailable
                }
                onClick={() => void layered.saveFinalConfig()}
                className="gap-1.5"
              >
                {savingTab === "final" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {applyLabel}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("codexConfig.layers.finalNewHint")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CodexConfigEditor;
