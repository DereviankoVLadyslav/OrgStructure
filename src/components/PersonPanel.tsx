import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FunctionsEditor } from "./FunctionsEditor";
import {
  ROLES,
  ROLE_ORDER,
  ancestors,
  plural,
  reportsOf,
  wouldCycle,
  type OrgIndex,
  type Person,
  type Role,
} from "../lib/org";

export type Draft = { person: Person; isNew: boolean };

interface Props {
  draft: Draft;
  people: Map<string, Person>;
  index: OrgIndex;
  departments: string[];
  onSave: (p: Person, isNew: boolean) => void;
  onDelete: (id: string) => void;
  onAddSub: (managerId: string) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
  canEdit: boolean;
  lastChange?: string;
}

export function PersonPanel({ draft, people, index, departments, onSave, onDelete, onAddSub, onOpen, onClose, canEdit, lastChange }: Props) {
  const [form, setForm] = useState<Person>(draft.person);
  const [confirming, setConfirming] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm(draft.person);
    setConfirming(false);
    nameRef.current?.focus();
  }, [draft]);

  const id = draft.person.id;
  const managerChoices = useMemo(() => {
    // Anyone except the person themselves and people who (directly or not) report to them.
    return [...people.values()]
      .filter((p) => p.id !== id && (draft.isNew || !wouldCycle(p.id, id, people)))
      .sort((a, b) => ROLES[a.role].rank - ROLES[b.role].rank || a.name.localeCompare(b.name, "uk"));
  }, [people, index, id, draft.isNew]);

  const chain = draft.isNew ? [] : ancestors(index, id);
  const reports = draft.isNew ? [] : reportsOf(id, people);
  const boss = index.parentOf.get(id) ?? null;
  const manager = draft.person.managerId ? people.get(draft.person.managerId) : undefined;

  const set = <K extends keyof Person>(k: K, v: Person[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return nameRef.current?.focus();
    onSave({ ...form, name, title: form.title.trim(), dept: form.dept.trim() }, draft.isNew);
  };

  const title = draft.isNew
    ? manager
      ? `Новий підлеглий для ${manager.name}`
      : "Новий співробітник"
    : draft.person.name;

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <button className="x" type="button" aria-label="Закрити" onClick={onClose}>
          ×
        </button>
      </div>

      {!draft.isNew && (
        <div className="chain">
          {chain.length ? (
            <>
              Лінія підпорядкування:{" "}
              {chain.map((a, i) => (
                <span key={a} style={{ display: "contents" }}>
                  {i > 0 && <span>›</span>}
                  <button type="button" onClick={() => onOpen(a)}>
                    {people.get(a)?.name}
                  </button>
                </span>
              ))}
            </>
          ) : (
            <span>Верхній рівень структури</span>
          )}
        </div>
      )}

      <form onSubmit={submit} autoComplete="off">
        <fieldset className="plain" disabled={!canEdit}>
        <label className="field">
          <span>ПІБ</span>
          <input ref={nameRef} required maxLength={80} placeholder="Прізвище Ім'я" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="field">
          <span>Посада</span>
          <input maxLength={120} placeholder="Напр. Менеджер з продажу" value={form.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="field">
          <span>Підрозділ</span>
          <input list="dept-list" maxLength={60} placeholder="Напр. Відділ продажу" value={form.dept} onChange={(e) => set("dept", e.target.value)} />
          <datalist id="dept-list">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
        <fieldset className="field">
          <legend>Роль у структурі</legend>
          <div className="roles">
            {ROLE_ORDER.map((r: Role) => (
              <label key={r}>
                <input type="radio" name="role" value={r} checked={form.role === r} onChange={() => set("role", r)} />
                {ROLES[r].label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <span>Функції</span>
          <FunctionsEditor
            idPrefix="panel-fn"
            functions={form.functions}
            canEdit={canEdit}
            onChange={(next) => set("functions", next)}
          />
        </div>
        <label className="field">
          <span>Основний керівник</span>
          <select
            value={form.managerId ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              setForm((f) => ({ ...f, managerId: v, alsoReportsTo: f.alsoReportsTo.filter((m) => m !== v) }));
            }}
          >
            <option value="">— нікому (верхній рівень) —</option>
            {managerChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.title ? ` — ${p.title}` : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>Також підпорядковується</span>
          {form.alsoReportsTo.filter((m) => people.has(m)).length > 0 ? (
            <ul className="mgr-list">
              {form.alsoReportsTo
                .filter((m) => people.has(m))
                .map((m) => (
                  <li key={m}>
                    <span>{people.get(m)!.name}</span>
                    {canEdit && (
                      <button
                        type="button"
                        className="fn-del"
                        aria-label={`Прибрати підпорядкування ${people.get(m)!.name}`}
                        onClick={() => set("alsoReportsTo", form.alsoReportsTo.filter((x) => x !== m))}
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="fn-empty">
              {canEdit ? "Лише основному керівнику. Додайте ще одного нижче або протягніть лінію від картки керівника." : "Лише основному керівнику."}
            </p>
          )}
          {canEdit && (
            <select
              id="panel-extra-manager"
              value=""
              aria-label="Додати ще одного керівника"
              onChange={(e) => e.target.value && set("alsoReportsTo", [...form.alsoReportsTo, e.target.value])}
            >
              <option value="">+ додати керівника…</option>
              {managerChoices
                .filter((p) => p.id !== form.managerId && !form.alsoReportsTo.includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.title ? ` — ${p.title}` : ""}
                  </option>
                ))}
            </select>
          )}
        </div>
        </fieldset>
        {canEdit && (
        <div className="actions">
          <button className="btn primary" type="submit">
            Зберегти
          </button>
          {!draft.isNew && (
            <>
              <button className="btn" type="button" onClick={() => onAddSub(id)}>
                + Підлеглий
              </button>
              <button className="btn danger" type="button" onClick={() => setConfirming(true)}>
                Видалити
              </button>
            </>
          )}
        </div>
        )}

        {confirming && (
          <div className="confirm">
            <span>
              {reports.length
                ? `Видалити «${draft.person.name}»? ${reports.length} ${plural(
                    reports.length,
                    "прямий підлеглий перейде",
                    "прямі підлеглі перейдуть",
                    "прямих підлеглих перейдуть",
                  )} до ${boss ? people.get(boss)?.name : "верхнього рівня"}.`
                : `Видалити «${draft.person.name}» зі структури?`}
            </span>
            <div>
              <button className="btn danger solid" type="button" onClick={() => onDelete(id)}>
                Так, видалити
              </button>
              <button className="btn" type="button" onClick={() => setConfirming(false)}>
                Скасувати
              </button>
            </div>
          </div>
        )}
      </form>

      {lastChange && <p className="note">{lastChange}</p>}

      {!draft.isNew && (
        <div className="subs">
          <h3>{reports.length ? `Прямі підлеглі · ${reports.length}` : "Прямих підлеглих немає"}</h3>
          {reports.length > 0 && (
            <ul>
              {reports.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpen(c.id)}>
                    <span>{c.name}</span>
                    <small>{ROLES[c.role].label}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
