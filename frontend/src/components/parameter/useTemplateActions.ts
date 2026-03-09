import { ChangeEvent, RefObject, useEffect, useRef, useState } from "react";
import {
  resolveStrategyTemplates,
  StrategyTemplate,
  STRATEGY_EXAMPLE_TEMPLATE_ID,
  STRATEGY_TEMP_TEMPLATE_ID
} from "../../lib/exampleTemplateResolver";
import { STORAGE_KEYS, writePlain } from "../../lib/storage";
import { BacktestRequest } from "../../types";

function cloneRequest(request: BacktestRequest): BacktestRequest {
  return {
    strategy: { ...request.strategy },
    data: { ...request.data }
  };
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

interface UseTemplateActionsParams {
  request: BacktestRequest;
  requestReady: boolean;
  onChange: (next: BacktestRequest) => void;
}

export type SaveTemplateResult =
  | { status: "saved" }
  | { status: "need-name"; suggestedName: string }
  | { status: "ignored" };

export interface TemplateActionsState {
  importRef: RefObject<HTMLInputElement>;
  templates: StrategyTemplate[];
  selectedTemplateId: string;
  setSelectedTemplateId: (value: string) => void;
  selectedTemplateLocked: boolean;
  saveTemplate: (templateName?: string) => SaveTemplateResult;
  applyTemplate: () => void;
  deleteTemplate: () => void;
  exportTemplate: () => void;
  importTemplate: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function useTemplateActions({
  request,
  requestReady,
  onChange
}: UseTemplateActionsParams): TemplateActionsState {
  const importRef = useRef<HTMLInputElement | null>(null);
  const templatesInitializedRef = useRef(false);
  const [templates, setTemplates] = useState<StrategyTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  useEffect(() => {
    if (!requestReady || templatesInitializedRef.current) {
      return;
    }
    const loaded = resolveStrategyTemplates(request);
    setTemplates(loaded);
    const defaultSelection =
      loaded.find((item) => item.id === STRATEGY_TEMP_TEMPLATE_ID)?.id ??
      loaded[0]?.id ??
      STRATEGY_EXAMPLE_TEMPLATE_ID;
    setSelectedTemplateId(defaultSelection);
    templatesInitializedRef.current = true;
  }, [requestReady, request]);

  const updateTemplates = (next: StrategyTemplate[]) => {
    writePlain(STORAGE_KEYS.strategyTemplates, next);
    const normalized = resolveStrategyTemplates(request);
    setTemplates(normalized);
    if (normalized.length === 0) {
      setSelectedTemplateId("");
      return;
    }
    if (!normalized.some((item) => item.id === selectedTemplateId)) {
      setSelectedTemplateId(normalized[0].id);
    }
  };

  const saveTemplate = (templateName?: string): SaveTemplateResult => {
    if (
      !selectedTemplateId ||
      selectedTemplateId === STRATEGY_EXAMPLE_TEMPLATE_ID ||
      selectedTemplateId === STRATEGY_TEMP_TEMPLATE_ID
    ) {
      const normalizedName = (templateName ?? "").trim();
      if (!normalizedName) {
        return {
          status: "need-name",
          suggestedName: request.data.symbol || "我的模板"
        };
      }
      const template: StrategyTemplate = {
        id: randomId(),
        name: normalizedName,
        request: cloneRequest(request)
      };
      updateTemplates([template, ...templates]);
      setSelectedTemplateId(template.id);
      return { status: "saved" };
    }

    updateTemplates(
      templates.map((item) =>
        item.id === selectedTemplateId
          ? {
              ...item,
              request: cloneRequest(request)
            }
          : item
      )
    );
    return { status: "saved" };
  };

  const applyTemplate = () => {
    const selected = templates.find((item) => item.id === selectedTemplateId);
    if (!selected) {
      return;
    }
    onChange(cloneRequest(selected.request));
  };

  const deleteTemplate = () => {
    if (
      !selectedTemplateId ||
      selectedTemplateId === STRATEGY_EXAMPLE_TEMPLATE_ID ||
      selectedTemplateId === STRATEGY_TEMP_TEMPLATE_ID
    ) {
      return;
    }
    updateTemplates(templates.filter((item) => item.id !== selectedTemplateId));
  };

  const exportTemplate = () => {
    const selected = templates.find((item) => item.id === selectedTemplateId);
    const payload = selected ?? templates;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    link.setAttribute("href", url);
    link.setAttribute("download", `grid-template-${ts}.json`);
    link.click();
    URL.revokeObjectURL(url);
  };

  const importTemplate = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const content = await file.text();
      const parsed = JSON.parse(content) as unknown;
      const normalized: StrategyTemplate[] = [];
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && typeof item === "object" && "name" in item && "request" in item) {
            normalized.push({
              id: randomId(),
              name: String((item as { name: unknown }).name || "导入模板"),
              request: cloneRequest((item as { request: BacktestRequest }).request)
            });
          }
        });
      } else if (parsed && typeof parsed === "object" && "strategy" in parsed && "data" in parsed) {
        normalized.push({
          id: randomId(),
          name: "导入模板",
          request: cloneRequest(parsed as BacktestRequest)
        });
      }
      if (normalized.length === 0) {
        return;
      }
      updateTemplates([...normalized, ...templates]);
      setSelectedTemplateId(normalized[0].id);
    } catch {
      // ignore malformed json
    } finally {
      event.target.value = "";
    }
  };

  return {
    importRef,
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplateLocked:
      selectedTemplateId === STRATEGY_EXAMPLE_TEMPLATE_ID ||
      selectedTemplateId === STRATEGY_TEMP_TEMPLATE_ID,
    saveTemplate,
    applyTemplate,
    deleteTemplate,
    exportTemplate,
    importTemplate
  };
}
