import { useMemo, useState } from "react";

export type WCCategory = { id: number; name: string; parent?: number | null };

export default function CategoryPicker({
  allCategories,
  value,
  onChange,
  searchable = true,
}: {
  allCategories: WCCategory[];
  value: number[];
  onChange: (ids: number[]) => void;
  searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return s
      ? allCategories.filter(c => c.name.toLowerCase().includes(s) || String(c.id).includes(s))
      : allCategories;
  }, [q, allCategories]);

  function toggle(id: number) {
    const set = new Set(value);
    set.has(id) ? set.delete(id) : set.add(id);
    onChange([...set]);
  }

  return (
    <div className="w-96 max-w-full rounded-2xl p-3 shadow border bg-white">
      {searchable && (
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Sök kategori…"
          className="w-full mb-2 rounded border px-2 py-1 text-sm"
        />
      )}
      <div className="max-h-72 overflow-auto space-y-1 pr-1">
        {filtered.map(c => (
          <label key={c.id} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value.includes(c.id)}
              onChange={() => toggle(c.id)}
              className="accent-indigo-600"
            />
            <span className="text-sm">#{c.id} — {c.name}{c.parent ? ` (parent #${c.parent})` : ""}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
