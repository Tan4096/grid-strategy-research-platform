import { ChangeEvent, useEffect, useRef, useState } from "react";
import { STORAGE_KEYS, readPlain, writePlain } from "../../lib/storage";
import { OptimizationConfig } from "../../types";

interface Props {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
}

interface OptimizationTemplate {
  id: string;
  name: string;
  config: OptimizationConfig;
}

const LEGACY_OPTIMIZATION_TEMPLATES_KEY = "btc-grid-backtest:optimization-templates:v1";

function loadTemplates(): OptimizationTemplate[] {
  return (
    readPlain<OptimizationTemplate[]>(
      STORAGE_KEYS.optimizationTemplates,
      (raw) => {
        if (!Array.isArray(raw)) {
          return [];
        }
        return raw.filter(
          (item) => item && typeof item === "object" && "id" in item && "name" in item && "config" in item
        ) as OptimizationTemplate[];
      },
      [LEGACY_OPTIMIZATION_TEMPLATES_KEY]
    ) ?? []
  );
}

function saveTemplates(templates: OptimizationTemplate[]) {
  writePlain(STORAGE_KEYS.optimizationTemplates, templates);
}

export default function OptimizationTemplateSection({ config, onChange }: Props) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const [templates, setTemplates] = useState<OptimizationTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  useEffect(() => {
    const loaded = loadTemplates();
    setTemplates(loaded);
    if (loaded.length > 0) {
      setSelectedTemplateId(loaded[0].id);
    }
  }, []);

  const updateTemplates = (next: OptimizationTemplate[]) => {
    setTemplates(next);
    saveTemplates(next);
    if (next.length === 0) {
      setSelectedTemplateId("");
      return;
    }
    if (!next.some((item) => item.id === selectedTemplateId)) {
      setSelectedTemplateId(next[0].id);
    }
  };

  const handleSaveTemplate = () => {
    if (!selectedTemplateId) {
      const name = window.prompt("优化模板名称", "我的优化模板");
      if (!name || !name.trim()) {
        return;
      }
      const template: OptimizationTemplate = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: name.trim(),
        config: { ...config }
      };
      updateTemplates([template, ...templates]);
      setSelectedTemplateId(template.id);
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

  const handleCreateTemplate = () => {
    const name = window.prompt("新模板名称", "我的优化模板");
    if (!name || !name.trim()) {
      return;
    }
    const template: OptimizationTemplate = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: name.trim(),
      config: { ...config }
    };
    updateTemplates([template, ...templates]);
    setSelectedTemplateId(template.id);
  };

  const handleApplyTemplate = () => {
    const selected = templates.find((item) => item.id === selectedTemplateId);
    if (!selected) {
      return;
    }
    onChange({ ...selected.config });
  };

  const handleDeleteTemplate = () => {
    if (!selectedTemplateId) {
      return;
    }
    updateTemplates(templates.filter((item) => item.id !== selectedTemplateId));
  };

  const handleRenameTemplate = () => {
    if (!selectedTemplateId) {
      return;
    }
    const selected = templates.find((item) => item.id === selectedTemplateId);
    if (!selected) {
      return;
    }
    const name = window.prompt("重命名模板", selected.name);
    if (!name || !name.trim()) {
      return;
    }
    const trimmed = name.trim();
    updateTemplates(
      templates.map((item) =>
        item.id === selectedTemplateId
          ? {
              ...item,
              name: trimmed
            }
          : item
      )
    );
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
              id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              name: String((item as { name: unknown }).name || "导入模板"),
              config: (item as { config: OptimizationConfig }).config
            });
          }
        });
      } else if (parsed && typeof parsed === "object" && "optimization_mode" in parsed) {
        normalized.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          name: "导入模板",
          config: parsed as OptimizationConfig
        });
      }
      if (normalized.length === 0) {
        return;
      }
      updateTemplates([...normalized, ...templates]);
      setSelectedTemplateId(normalized[0].id);
    } catch {
      // ignore malformed file
    } finally {
      event.target.value = "";
    }
  };

  return (
    <section className="space-y-2 rounded-md border border-slate-700/60 bg-slate-900/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">优化模板</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="rounded border border-slate-600 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-100"
            onClick={handleSaveTemplate}
          >
            {selectedTemplateId ? "保存到当前模板" : "保存当前参数"}
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 bg-slate-800/70 px-2 py-1 text-[11px] text-slate-200"
            onClick={handleCreateTemplate}
          >
            新建模板
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <select
          className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
        >
          <option value="">选择模板</option>
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 disabled:opacity-50"
          onClick={handleApplyTemplate}
          disabled={!selectedTemplateId}
        >
          应用模板
        </button>
      </div>

      <details className="rounded-md border border-slate-700/60 bg-slate-950/40 px-2 py-2">
        <summary className="cursor-pointer text-xs text-slate-300">模板管理（导入 / 导出 / 删除）</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
            onClick={handleRenameTemplate}
            disabled={!selectedTemplateId}
          >
            重命名
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
            onClick={handleExportTemplate}
            disabled={templates.length === 0}
          >
            导出 JSON
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-xs text-slate-200"
            onClick={() => importRef.current?.click()}
          >
            导入 JSON
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-xs font-semibold text-slate-100 disabled:opacity-50"
            onClick={handleDeleteTemplate}
            disabled={!selectedTemplateId}
          >
            删除模板
          </button>
          <input
            ref={importRef}
            className="hidden"
            type="file"
            accept=".json,application/json"
            onChange={handleImportTemplate}
          />
        </div>
      </details>
    </section>
  );
}
