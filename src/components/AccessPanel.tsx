import { useState, type FormEvent } from "react";
import { isValidEmail, setMemberLevel, type AccessLevel, type AccessList } from "../lib/useAccess";

const LEVELS: { level: AccessLevel; label: string; hint: string }[] = [
  { level: "admin", label: "Адміністратор", hint: "усі структури й керування доступом" },
  { level: "editor", label: "Редактор", hint: "редагує всі структури" },
  { level: "viewer", label: "Перегляд", hint: "бачить усі структури" },
];

interface Props {
  list: AccessList;
  myEmail: string;
  onClose: () => void;
  onMessage: (m: string) => void;
}

export function AccessPanel({ list, myEmail, onClose, onMessage }: Props) {
  const [email, setEmail] = useState("");
  const [level, setLevel] = useState<AccessLevel>("editor");
  const [busy, setBusy] = useState(false);

  const members = [
    ...list.admins.map((e) => ({ email: e, level: "admin" as const })),
    ...list.editors.map((e) => ({ email: e, level: "editor" as const })),
    ...list.viewers.map((e) => ({ email: e, level: "viewer" as const })),
  ];

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      onMessage(ok);
    } catch {
      onMessage("Не вдалося змінити доступ. Перевірте з'єднання.");
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) return onMessage("Введіть коректну адресу пошти.");
    const v = email.trim().toLowerCase();
    run(() => setMemberLevel(v, level), `Доступ для ${v} збережено`).then(() => setEmail(""));
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>Доступ до всіх структур</h2>
        <button className="x" type="button" aria-label="Закрити" onClick={onClose}>×</button>
      </div>
      <p className="note">
        Люди входять за посиланням, яке приходить на їхню робочу пошту. Бачити й редагувати схеми можуть лише адреси з цього списку.
      </p>

      <form onSubmit={add}>
        <label className="field">
          <span>Робоча пошта</span>
          <input id="access-email" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Права</span>
          <select id="access-level" value={level} onChange={(e) => setLevel(e.target.value as AccessLevel)}>
            {LEVELS.map((l) => (
              <option key={l.level} value={l.level}>
                {l.label} — {l.hint}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>Надати доступ</button>
        </div>
      </form>

      <div className="subs">
        <h3>Учасники · {members.length}</h3>
        <ul className="members">
          {members.map((m) => (
            <li key={m.email}>
              <span className="member-email">
                {m.email}
                {m.email === myEmail && <small> (ви)</small>}
              </span>
              <select
                aria-label={`Права для ${m.email}`}
                value={m.level}
                disabled={busy || m.email === myEmail}
                onChange={(e) => run(() => setMemberLevel(m.email, e.target.value as AccessLevel), "Права змінено")}
              >
                {LEVELS.map((l) => (
                  <option key={l.level} value={l.level}>{l.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="link danger"
                disabled={busy || m.email === myEmail}
                onClick={() => run(() => setMemberLevel(m.email, null), `${m.email} більше не має доступу`)}
              >
                Прибрати
              </button>
            </li>
          ))}
        </ul>
        <p className="note">Власні права змінити не можна — попросіть іншого адміністратора.</p>
      </div>
    </aside>
  );
}
