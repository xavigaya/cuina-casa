"use client";

import { SECTIONS } from "@/lib/sections";
import { UNIT_OPTIONS } from "@/lib/units";

export function QuantityUnitFields({
  quantity,
  unit,
  onQuantity,
  onUnit,
}: {
  quantity: string;
  unit: string;
  onQuantity: (v: string) => void;
  onUnit: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label" htmlFor="qty">
          Quantitat
        </label>
        <input
          id="qty"
          className="input"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => onQuantity(e.target.value.replace(/[^\d.,]/g, ""))}
          placeholder="—"
        />
      </div>
      <div>
        <label className="label" htmlFor="unit">
          Unitat
        </label>
        <select id="unit" className="input" value={unit} onChange={(e) => onUnit(e.target.value)}>
          <option value="">—</option>
          {UNIT_OPTIONS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function SectionSelect({ value, onChange, id = "section" }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        Secció del súper
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {SECTIONS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.emoji} {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function parseQty(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function qtyToString(n: number | null | undefined): string {
  return n == null ? "" : String(n).replace(".", ",");
}
