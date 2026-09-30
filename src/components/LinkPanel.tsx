import { useState, type FormEvent } from "react";
import { ROLES, type Person } from "../lib/org";
import type { ChartInfo } from "../lib/useCharts";

interface Props {
  charts: ChartInfo[];
  people: Person[];
  onCreate: (chartId: string, managerId: string | null) => void;
  onClose: () => void;
}

/** Adds a live link to another chart, optionally under a person of this chart. */
export function LinkPanel({ charts, people, onCreate, onClose }: Props) {
  const [chartId, setChartId] = useState(charts[0]?.id ?? "");
  const [managerId, setManagerId] = useState("");
  const managers = people
    .filter((p) => !p.linkChart)
    .sort((a, b) => ROLES[a.role].rank - ROLES[b.role].rank || a.name.localeCompare(b.name, "uk"));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (chartId) onCreate(chartId, managerId || null);
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>Зв'язати структуру</h2>
        <button className="x" type="button" aria-label="Закрити" onClick={onClose}>×</button>
      </div>
      <p className="note">
        На схемі з'явиться картка іншої структури, а під нею — її живий вміст. Зміни в тій структурі одразу видно тут, а
        сама вона залишається окремою.
      </p>
      {charts.length === 0 ? (
        <p className="note">Немає інших структур, які можна приєднати.</p>
      ) : (
        <form onSubmit={submit}>
          <label className="field">
            <span>Яку структуру приєднати</span>
            <select id="link-chart" value={chartId} onChange={(e) => setChartId(e.target.value)}>
              {charts.map((c) => (
                <option key={c.id} value={c.id}>{c.name || "Без назви"}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Кому вона підпорядковується тут</span>
            <select id="link-manager" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">— нікому (окремо на схемі) —</option>
              {managers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.title ? ` — ${p.title}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <button className="btn primary" type="submit">Приєднати</button>
          </div>
        </form>
      )}
    </aside>
  );
}
