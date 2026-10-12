import React from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { CommonConfigEditor } from "./CommonConfigEditor";
import { LayeredConfigTabs } from "./LayeredConfigTabs";
import type { LayeredConfigState } from "./hooks";

interface ClaudeConfigEditorProps {
  value: string;
  onChange: (value: string) => void;
  layered: LayeredConfigState;
}

/**
 * Claude 双层配置：服务商配置、通用配置和应用预览三个页面。
 * @param props - 服务商配置草稿和分层配置控制器。
 * @returns Claude 配置编辑界面。
 */
const ClaudeConfigEditor: React.FC<ClaudeConfigEditorProps> = ({
  value,
  onChange,
  layered,
}) => {
  const { t } = useTranslation();
  const busy = layered.savingTab !== null;

  return (
    <LayeredConfigTabs
      layered={layered}
      language="json"
      label={<Label htmlFor="settingsConfig">{t("provider.configJson")}</Label>}
      providerContent={
        <CommonConfigEditor
          value={value}
          onChange={onChange}
          hideLabel
          hint={t("claudeConfig.layers.providerHint")}
          readOnly={busy}
        />
      }
      commonHint={t("claudeConfig.layers.commonHint")}
      rawDiffFallback={t("claudeConfig.layers.rawDiffFallback")}
    />
  );
};

export default ClaudeConfigEditor;
