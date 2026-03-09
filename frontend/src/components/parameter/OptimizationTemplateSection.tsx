import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  OPTIMIZATION_EXAMPLE_TEMPLATE_ID,
  OPTIMIZATION_TEMP_TEMPLATE_ID,
  OptimizationTemplate,
  resolveOptimizationTemplates
} from "../../lib/exampleTemplateResolver";
import { STORAGE_KEYS, writePlain } from "../../lib/storage";
import { OptimizationConfig } from "../../types";
import InputDialog from "../ui/InputDialog";

interface Props {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
  compact?: boolean;
  selectedTemplateId?: string;
  onSelectedTemplateIdChange?: (value: string) => void;
  onSelectedTemplateNameChange?: (name: string) => void;
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default function OptimizationTemplateSection({
  config,
  onChange,
  compact = false,
  selectedTemplateId: controlledSelectedTemplateId,
  onSelectedTemplateIdChange,
  onSelectedTemplateNameChange
}: Props) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const initialConfigRef = useRef(config);
  const [templates, setTemplates] = useState<OptimizationTemplate[]>([]);
  const [selectedTemplateIdState, setSelectedTemplateIdState] = useState<string>("");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogDefaultName, setSaveDialogDefaultName] = useState("我的优化模板");

  const selectedTemplateId = controlledSelectedTemplateId ?? selectedTemplateIdState;

  const updateSelectedTemplateId = useCallback(
    (value: string) => {
      if (controlledSelectedTemplateId === undefined) {
        setSelectedTemplateIdState(value);
      }
      onSelectedTemplateIdChange?.(value);
    },
    [controlledSelectedTemplateId, onSelectedTemplateIdChange]
  );

  useEffect(() => {
    const loaded = resolveOptimizationTemplates(initialConfigRef.current);
    setTemplates(loaded);
    const defaultSelection =
      loaded.find((item) => item.id === OPTIMIZATION_TEMP_TEMPLATE_ID)?.id ??
      loaded[0]?.id ??
      OPTIMIZATION_EXAMPLE_TEMPLATE_ID;
    updateSelectedTemplateId(defaultSelection);
  }, [updateSelectedTemplateId]);

  useEffect(() => {
    if (!onSelectedTemplateNameChange) {
      return;
    }
    const selected = templates.find((item) => item.id === selectedTemplateId);
    onSelectedTemplateNameChange(selected?.name ?? "示例模板");
  }, [onSelectedTemplateNameChange, selectedTemplateId, templates]);

  const updateTemplates = (next: OptimizationTemplate[], preferredTemplateId?: string) => {
    writePlain(STORAGE_KEYS.optimizationTemplates, next);
    const normalized = resolveOptimizationTemplates(config);
    setTemplates(normalized);
    const preferred = preferredTemplateId ?? selectedTemplateId;
    if (!normalized.length) {
      updateSelectedTemplateId("");
      return;
    }
    if (preferred && normalized.some((item) => item.id === preferred)) {
      updateSelectedTemplateId(preferred);
      return;
    }
    updateSelectedTemplateId(normalized[0].id);
  };

  const handleSaveTemplate = () => {
    if (
      !selectedTemplateId ||
      selectedTemplateId === OPTIMIZATION_EXAMPLE_TEMPLATE_ID ||
      selectedTemplateId === OPTIMIZATION_TEMP_TEMPLATE_ID
    ) {
      setSaveDialogDefaultName("我的优化模板");
      setSaveDialogOpen(true);
      return;
    }

    updateTemplates(
      templates.map((item) =>
        item.id === selectedTemplateId
          ? {
              ...item,
              config: { ...config }
            }
          : item
      )
    );
  };

  const handleConfirmSaveTemplate = (name: string) => {
    const normalized = name.trim();
    if (!normalized) {
      return;
    }
    const template: OptimizationTemplate = {
      id: randomId(),
      name: normalized,
      config: { ...config }
    };
    updateTemplates([template, ...templates], template.id);
    setSaveDialogOpen(false);
  };

  const handleApplyTemplate = () => {
    const selected = templates.find((item) => item.id === selectedTemplateId);
    if (!selected) {
      return;
    }
    onChange({ ...selected.config });
  };

  const handleDeleteTemplate = () => {
    if (
      !selectedTemplateId ||
      selectedTemplateId === OPTIMIZATION_EXAMPLE_TEMPLATE_ID ||
      selectedTemplateId === OPTIMIZATION_TEMP_TEMPLATE_ID
    ) {
      return;
    }
    updateTemplates(templates.filter((item) => item.id !== selectedTemplateId));
  };

  const handleExportTemplate = () => {
    const selected = templates.find((item) => item.id === selectedTemplateId);
    const payload = selected ?? templates;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    link.setAttribute("href", url);
    link.setAttribute("download", `optimization-template-${ts}.json`);
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTemplate = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const content = await file.text();
      const parsed = JSON.parse(content) as unknown;
      const normalized: OptimizationTemplate[] = [];
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && typeof item === "object" && "name" in item && "config" in item) {
            normalized.push({
              id: randomId(),
              name: String((item as { name: unknown }).name || "导入模板"),
              config: (item as { config: OptimizationConfig }).config
            });
          }
        });
      } else if (parsed && typeof parsed === "object" && "optimization_mode" in parsed) {
        normalized.push({
          id: randomId(),
          name: "导入模板",
          config: parsed as OptimizationConfig
        });
      }
      if (normalized.length === 0) {
        return;
      }
      updateTemplates([...normalized, ...templates], normalized[0].id);
    } catch {
      // ignore malformed file
    } finally {
      event.target.value = "";
    }
  };

  return (
    <section
      className={`card-sub border border-slate-700/60 bg-slate-900/30 ${compact ? "space-y-1.5 p-2.5" : "space-y-2 p-3"}`}
      data-tour-id="optimization-template-section"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">优化模板</p>
      </div>

      <div className={`mobile-two-col-grid grid grid-cols-1 ${compact ? "gap-1.5" : "gap-2"}`}>
        <select
          className="ui-input"
          value={selectedTemplateId}
          onChange={(e) => updateSelectedTemplateId(e.target.value)}
        >
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className={`grid grid-cols-2 ${compact ? "gap-1.5" : "gap-2"} sm:grid-cols-5`}>
        <button
          type="button"
          className="ui-btn ui-btn-primary ui-btn-xs w-full min-w-0 px-2 disabled:opacity-50"
          onClick={handleApplyTemplate}
          disabled={!selectedTemplateId}
        >
          应用
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary ui-btn-xs w-full min-w-0 px-2"
          onClick={handleSaveTemplate}
        >
          保存
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs w-full min-w-0 px-2 disabled:opacity-50"
          onClick={handleExportTemplate}
          disabled={templates.length === 0}
        >
          导出
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs w-full min-w-0 px-2"
          onClick={() => importRef.current?.click()}
        >
          导入
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs w-full min-w-0 px-2 disabled:opacity-50"
          onClick={handleDeleteTemplate}
          disabled={
            !selectedTemplateId ||
            selectedTemplateId === OPTIMIZATION_EXAMPLE_TEMPLATE_ID ||
            selectedTemplateId === OPTIMIZATION_TEMP_TEMPLATE_ID
          }
        >
          删除
        </button>
        <input
          ref={importRef}
          className="hidden"
          type="file"
          accept=".json,application/json"
          onChange={handleImportTemplate}
        />
      </div>
      <InputDialog
        open={saveDialogOpen}
        title="优化模板名称"
        defaultValue={saveDialogDefaultName}
        placeholder="请输入优化模板名称"
        onCancel={() => setSaveDialogOpen(false)}
        onConfirm={handleConfirmSaveTemplate}
      />
    </section>
  );
}
