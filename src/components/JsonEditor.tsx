import { useTranslation } from "react-i18next";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import MonacoEditor, { type MonacoEditorProps } from "./MonacoEditor";
import { formatJSON } from "@/utils/formatters";

interface JsonEditorProps
  extends Omit<MonacoEditorProps, "original" | "minHeight" | "onChange"> {
  onChange: (value: string) => void;
  rows?: number;
}

/**
 * 配置文本编辑器，保留 JSON 对象校验、格式化与原有表单接口。
 * @param props - 受控配置文本、编辑回调与展示参数。
 * @returns Monaco 配置编辑器和 JSON 格式化按钮。
 */
export default function JsonEditor({
  rows = 3,
  language = "json",
  showValidation = true,
  height,
  ...props
}: JsonEditorProps) {
  const { t } = useTranslation();
  const isFullHeight = height === "100%";

  /**
   * 格式化当前 JSON，并将结果交给表单保存。
   * @returns 无返回值。
   */
  const handleFormat = () => {
    if (!props.value.trim()) return;
    try {
      props.onChange(formatJSON(props.value));
      toast.success(t("common.formatSuccess", { defaultValue: "格式化成功" }), {
        closeButton: true,
      });
    } catch (error) {
      toast.error(
        t("common.formatError", {
          defaultValue: "格式化失败：{{error}}",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  return (
    <div
      className={
        isFullHeight ? "flex h-full min-h-0 flex-col" : "w-full min-w-0"
      }
    >
      <MonacoEditor
        {...props}
        language={language}
        showValidation={showValidation}
        height={height}
        minHeight={Math.max(1, rows) * 20 + 16}
        className={isFullHeight ? "flex-1 min-h-0" : undefined}
      />
      {language === "json" && !props.readOnly && (
        <button
          type="button"
          onClick={handleFormat}
          className="mt-2 inline-flex shrink-0 items-center gap-1.5 self-start px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <Wand2 className="h-3.5 w-3.5" />
          {t("common.format", { defaultValue: "格式化" })}
        </button>
      )}
    </div>
  );
}
