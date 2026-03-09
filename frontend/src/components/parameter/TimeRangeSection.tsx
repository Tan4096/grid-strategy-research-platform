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
    <section className="card-sub space-y-3 border border-slate-700/60 bg-slate-900/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">时间范围（UTC+8）</p>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="min-w-0">
          <label className={labelClass()}>开始时间</label>
          <input
            className={`${inputClass()} ui-datetime-input`}
            type="datetime-local"
            step={60}
            value={startTimeInputValue}
            onChange={(e) => updateData("start_time", beijingMinuteInputToIso(e.target.value))}
          />
        </div>
        <div className="min-w-0">
          <label className={labelClass()}>结束时间</label>
          <div className="space-y-2">
            <input
              className={`${inputClass()} ui-datetime-input`}
              type="datetime-local"
              step={60}
              value={endTimeInputValue}
              onChange={(e) => updateData("end_time", beijingMinuteInputToIso(e.target.value))}
            />
            <label className="flex items-center gap-2 text-[11px] leading-tight text-slate-300">
              <input
                type="checkbox"
                checked={useNowEndTime}
                data-tour-id="time-now-checkbox"
                onChange={(e) => {
                  if (e.target.checked) {
                    updateData("end_time", null);
                    return;
                  }
                  updateData("end_time", nowBeijingIsoMinute());
                }}
              />
              到最新时间
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
