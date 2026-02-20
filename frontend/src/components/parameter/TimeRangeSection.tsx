import { BacktestRequest } from "../../types";
import { inputClass, labelClass } from "./shared";

interface Props {
  startTimeInputValue: string;
  endTimeInputValue: string;
  useNowEndTime: boolean;
  updateData: <K extends keyof BacktestRequest["data"]>(key: K, value: BacktestRequest["data"][K]) => void;
  beijingMinuteInputToIso: (value: string) => string | null;
  nowBeijingIsoMinute: () => string;
}

export default function TimeRangeSection({
  startTimeInputValue,
  endTimeInputValue,
  useNowEndTime,
  updateData,
  beijingMinuteInputToIso,
  nowBeijingIsoMinute
}: Props) {
  return (
    <section className="space-y-3 rounded-md border border-slate-700/60 bg-slate-900/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">时间范围</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass()}>开始时间 (UTC+8)</label>
          <input
            className={inputClass()}
            type="datetime-local"
            step={60}
            value={startTimeInputValue}
            onChange={(e) => updateData("start_time", beijingMinuteInputToIso(e.target.value))}
          />
        </div>
        <div>
          <label className={labelClass()}>结束时间 (UTC+8)</label>
          <div className="space-y-2">
            <input
              className={inputClass()}
              type="datetime-local"
              step={60}
              value={endTimeInputValue}
              disabled={useNowEndTime}
              onChange={(e) => updateData("end_time", beijingMinuteInputToIso(e.target.value))}
            />
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={useNowEndTime}
                onChange={(e) => {
                  if (e.target.checked) {
                    updateData("end_time", null);
                    return;
                  }
                  updateData("end_time", nowBeijingIsoMinute());
                }}
              />
              到 Now（当前北京时间，精确到分钟）
            </label>
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-400">默认时间基准为北京时间 (UTC+8)，可勾选“到 Now”自动使用当前分钟。</p>
    </section>
  );
}
