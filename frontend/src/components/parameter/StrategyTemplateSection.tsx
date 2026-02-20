import { ChangeEvent, RefObject } from "react";

interface TemplateItem {
  id: string;
  name: string;
}

interface Props {
  templates: TemplateItem[];
  selectedTemplateId: string;
  inputClassName: string;
  importRef: RefObject<HTMLInputElement>;
  onSelectedTemplateIdChange: (value: string) => void;
  onSaveTemplate: () => void;
  onApplyTemplate: () => void;
  onExportTemplate: () => void;
  onDeleteTemplate: () => void;
  onImportTemplate: (event: ChangeEvent<HTMLInputElement>) => void;
}

export default function StrategyTemplateSection({
  templates,
  selectedTemplateId,
  inputClassName,
  importRef,
  onSelectedTemplateIdChange,
  onSaveTemplate,
  onApplyTemplate,
  onExportTemplate,
  onDeleteTemplate,
  onImportTemplate
}: Props) {
  return (
    <section className="space-y-2 rounded-md border border-slate-700/60 bg-slate-900/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">策略模板</p>
        <button
          type="button"
          className="rounded border border-slate-600 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-100"
          onClick={onSaveTemplate}
        >
          保存当前参数
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <select
          className={inputClassName}
          value={selectedTemplateId}
          onChange={(e) => onSelectedTemplateIdChange(e.target.value)}
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
          onClick={onApplyTemplate}
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
            onClick={onExportTemplate}
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
            onClick={onDeleteTemplate}
            disabled={!selectedTemplateId}
          >
            删除模板
          </button>
          <input ref={importRef} className="hidden" type="file" accept=".json,application/json" onChange={onImportTemplate} />
        </div>
        <p className="mt-2 text-xs text-slate-400">支持导入单个请求或模板列表，CSV 内容不会被持久化。</p>
      </details>
    </section>
  );
}
