import { AnalysisRiskLevel } from "../types";

interface Props {
  level: AnalysisRiskLevel;
}

const LEVEL_LABEL: Record<AnalysisRiskLevel, string> = {
  low: "低",
  medium: "中",
  high: "高"
};

const LEVEL_CLASS: Record<AnalysisRiskLevel, string> = {
  low: "border-emerald-400/50 bg-emerald-500/15 text-emerald-200",
  medium: "border-amber-400/50 bg-amber-500/15 text-amber-200",
  high: "border-rose-400/50 bg-rose-500/15 text-rose-200"
};

export default function RiskLevelBadge({ level }: Props) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${LEVEL_CLASS[level]}`}>
      {LEVEL_LABEL[level]}
    </span>
  );
}

