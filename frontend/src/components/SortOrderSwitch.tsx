import { SortOrder } from "../types";

interface Props {
  value: SortOrder;
  onChange: (next: SortOrder) => void;
}

export default function SortOrderSwitch({ value, onChange }: Props) {
  return (
    <div className="ui-tab-group" style={{ width: "auto" }} aria-label="排序切换">
      <button
        type="button"
        className={`ui-tab ${value === "desc" ? "is-active" : ""}`}
        onClick={() => onChange("desc")}
      >
        最新
      </button>
      <button
        type="button"
        className={`ui-tab ${value === "asc" ? "is-active" : ""}`}
        onClick={() => onChange("asc")}
      >
        最早
      </button>
    </div>
  );
}
