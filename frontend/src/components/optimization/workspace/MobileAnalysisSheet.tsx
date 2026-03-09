import { ReactNode } from "react";
import MobileSheet from "../../ui/MobileSheet";
import { OptimizationResultTab } from "./useResultWorkspaceState";

interface Props {
  open: boolean;
  onClose: () => void;
  activeTab: OptimizationResultTab;
  onTabChange: (tab: OptimizationResultTab) => void;
  children: ReactNode;
}

const ANALYSIS_TABS: Array<{ id: OptimizationResultTab; label: string }> = [
  { id: "heatmap", label: "热力图" },
  { id: "curves", label: "曲线" },
  { id: "robustness", label: "报告" }
];

export default function MobileAnalysisSheet({
  open,
  onClose,
  activeTab,
  onTabChange,
  children
}: Props) {
  return (
    <MobileSheet
      open={open}
      title="更多分析"
      onClose={onClose}
      dataTourId="mobile-analysis-sheet"
    >
      <div className="space-y-3">
        <div className="ui-tab-group">
          {ANALYSIS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`ui-tab ${activeTab === tab.id ? "is-active" : ""}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {children}
      </div>
    </MobileSheet>
  );
}
