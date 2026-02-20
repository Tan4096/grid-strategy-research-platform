import { ChangeEvent } from "react";
import { inputClass, labelClass } from "./shared";

interface Props {
  csvFileName: string | null;
  onCsvUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}

export default function DataImportSection({ csvFileName, onCsvUpload }: Props) {
  return (
    <section className="space-y-2 rounded-md border border-slate-700/60 bg-slate-900/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">数据导入</p>
      <div>
        <label className={labelClass()}>CSV 文件（可选）</label>
        <input className={inputClass()} type="file" accept=".csv" onChange={onCsvUpload} />
        <p className="mt-1 text-xs text-slate-400">
          {csvFileName ? `已选择: ${csvFileName}` : "支持列名: timestamp/open/high/low/close/volume"}
        </p>
      </div>
    </section>
  );
}
