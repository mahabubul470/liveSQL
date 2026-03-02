import { STATUSES } from "../types.js";

interface Props {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}

export function FilterBar({ value, onChange }: Props) {
  return (
    <div className="filter-bar">
      <label className="filter-label">Filter by status</label>
      <div className="filter-pills">
        <button className={`pill ${!value ? "active" : ""}`} onClick={() => onChange(undefined)}>
          All
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`pill pill-${s} ${value === s ? "active" : ""}`}
            onClick={() => onChange(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
