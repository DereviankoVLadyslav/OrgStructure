import { useState, type FormEvent } from "react";
import { isValidEmail, setChartMember } from "../lib/useAccess";
import type { ChartInfo } from "../lib/useCharts";

interface Props {
  chart: ChartInfo;
  myEmail: string;
  onClose: () => void;
  onMessage: (m: string) => void;
  /** opens the workspace-wide access list */
  onOpenGlobal?: () => void;
}

type ChartLevel = "editor" | "viewer";
const LABEL: Record<ChartLevel, string> = { editor: "Редагування", viewer: "Перегляд" };

/** Who may open one particular chart, on top of people with access to every chart. */
export function ChartAccessPanel({ chart, myEmail, onClose, onMessage, onOpenGlobal }: Props) {
  const [email, setEmail] = useState("");
  const [level, setLevel] = useState<ChartLevel>("viewer");
  const [busy, setBusy] = useState(false);

  const members = [
    ...chart.editors.map((e) => ({ email: e, level: "editor" as const })),
    ...chart.viewers.filter((e) => !chart.editors.includes(e)).map((e) => ({ email: e, level: "viewer" as const })),
  ];

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      onMessage(ok);
    } catch {
      onMessage("Не вдалося змінити доступ. Перевірте з'єднання та правила Firestore.");
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) return onMessage("Введіть коректну адресу пошти.");
    const v = email.trim().toLowerCase();
    run(() => setChartMember(chart.id, v, level, myEmail), `${v} отримав(ла) доступ до «${chart.name}»`).then(() => setEmail(""));
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>Доступ до «{chart.name || "Без назви"}»</h2>
        <button className="x" type="button" aria-label="Закрити" onClick={onClose}>×</button>
      </div>
      <p className="note">
        Ці люди бачать лише цю структуру (та інші, до яких їх додано окремо). Адміністратори й учасники з доступом до
        всіх структур бачать її завжди.
        {onOpenGlobal && (
          <>
            {" "}
            <button type="button" className="link" onClick={onOpenGlobal}>Доступ до всіх структур</button>
          </>
        )}
      </p>

      <form onSubmit={add}>
        <label className="field">
          <span>Робоча пошта</span>
          <input id="chart-access-email" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="field">
          <span>Права на цю структуру</span>
          <div className="seg">
            {(["viewer", "editor"] as const).map((l) => (
              <button key={l} type="button" className={level === l ? "on" : ""} aria-pressed={level === l} onClick={() => setLevel(l)}>
                {LABEL[l]}
              </button>
            ))}
          </div>
        </div>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>Надати доступ</button>
        </div>
      </form>

      <div className="subs">
        <h3>Окремий доступ · {members.length}</h3>
        {members.length === 0 ? (
          <p className="note">Поки що нікому. Структуру бачать лише учасники з доступом до всіх структур.</p>
        ) : (
          <ul className="members">
            {members.map((m) => (
              <li key={m.email}>
                <span className="member-email">{m.email}</span>
                <select
                  aria-label={`Права для ${m.email}`}
                  value={m.level}
                  disabled={busy}
                  onChange={(e) => run(() => setChartMember(chart.id, m.email, e.target.value as ChartLevel, myEmail), "Права змінено")}
                >
                  <option value="viewer">{LABEL.viewer}</option>
                  <option value="editor">{LABEL.editor}</option>
                </select>
                <button
                  type="button"
                  className="link danger"
                  disabled={busy}
                  onClick={() => run(() => setChartMember(chart.id, m.email, null, myEmail), `${m.email} більше не бачить цю структуру`)}
                >
                  Прибрати
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
