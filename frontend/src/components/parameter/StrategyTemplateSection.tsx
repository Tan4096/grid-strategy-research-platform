import { ChangeEvent, RefObject } from "react";

interface TemplateItem {
  id: string;
  name: string;
}

interface Props {
  templates: TemplateItem[];
  selectedTemplateId: string;
  selectedTemplateLocked: boolean;
  inputClassName: string;
  importRef: RefObject<HTMLInputElement>;
  onSelectedTemplateIdChange: (value: string) => void;
  onSaveTemplate: () => void;
  onApplyTemplate: () => void;
  onExportTemplate: () => void;
  onDeleteTemplate: () => void;
  onImportTemplate: (event: ChangeEvent<HTMLInputElement>) => void;
  compact?: boolean;
}

export default function StrategyTemplateSection({
  templates,
  selectedTemplateId,
  selectedTemplateLocked,
  inputClassName,
  importRef,
  onSelectedTemplateIdChange,
  onSaveTemplate,
  onApplyTemplate,
  onExportTemplate,
  onDeleteTemplate,
  onImportTemplate,
  compact = false
}: Props) {
  return (
    <section
      className={`card-sub border border-slate-700/60 bg-slate-900/30 ${compact ? "space-y-1.5 p-2.5" : "space-y-2 p-3"}`}
      data-tour-id="strategy-template-section"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">回测模版</p>
      </div>
      <div className={`mobile-two-col-grid grid grid-cols-1 ${compact ? "gap-1.5" : "gap-2"}`}>
        <select
          className={inputClassName}
          value={selectedTemplateId}
          onChange={(e) => onSelectedTemplateIdChange(e.target.value)}
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
          onClick={onApplyTemplate}
          disabled={!selectedTemplateId}
        >
          应用
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary ui-btn-xs w-full min-w-0 px-2"
          onClick={onSaveTemplate}
        >
          保存
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs w-full min-w-0 px-2 disabled:opacity-50"
          onClick={onExportTemplate}
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
          onClick={onDeleteTemplate}
          disabled={!selectedTemplateId || selectedTemplateLocked}
        >
          删除
        </button>
        <input ref={importRef} className="hidden" type="file" accept=".json,application/json" onChange={onImportTemplate} />
      </div>
    </section>
  );
}
