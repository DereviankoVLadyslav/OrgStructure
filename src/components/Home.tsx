import { useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { plural } from "../lib/org";
import type { AccessList, UserLevel } from "../lib/useAccess";
import { ChartAccessPanel } from "./ChartAccessPanel";
import type { ChartInfo, useCharts } from "../lib/useCharts";
import { AccessPanel } from "./AccessPanel";

interface Props {
  user: User;
  level: UserLevel;
  list: AccessList;
  bootstrapped: boolean;
  onLogout: () => void;
  charts: ReturnType<typeof useCharts>;
  onOpen: (id: string) => void;
}

const LEVEL_LABEL: Record<UserLevel, string> = { admin: "Адміністратор", editor: "Редактор", viewer: "Перегляд", guest: "Окремі структури" };

const when = (c: ChartInfo) =>
  c.updatedAt?.toDate ? c.updatedAt.toDate().toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" }) : "щойно";

/** Home page: every org chart in the workspace, with create / rename / duplicate / delete. */
export function Home({ user, level, list, bootstrapped, onLogout, charts, onOpen }: Props) {
  const myEmail = (user.email ?? "").toLowerCase();
  const canEdit = level === "admin" || level === "editor"; // create, duplicate, delete
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showAccess, setShowAccess] = useState<"all" | string | null>(null); // "all" or a chart id
  const [toast, setToast] = useState<string | null>(null);

  const say = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 3500);
  };

  useEffect(() => {
    if (bootstrapped) say("Ви увійшли першим, тож стали адміністратором. Додайте колег у розділі «Доступ».");
  }, [bootstrapped]);

  const fail = (e: unknown) => {
    const code = (e as { code?: string }).code;
    say(code === "permission-denied" ? "У вас немає прав на редагування. Перевірте, чи опубліковані нові правила Firestore." : "Не вдалося зберегти. Перевірте з'єднання.");
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy("new");
    try {
      const id = await charts.create(name);
      setNewName("");
      onOpen(id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async (c: ChartInfo) => {
    setBusy(c.id);
    try {
      await charts.duplicate(c, `${c.name} (копія)`);
      say(`Створено копію «${c.name}»`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const saveRename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    const c = charts.charts?.find((x) => x.id === renaming.id);
    setRenaming(null);
    if (!name || name === c?.name) return;
    try {
      await charts.rename(renaming.id, name);
    } catch (err) {
      fail(err);
    }
  };

  const remove = async (c: ChartInfo) => {
    setDeleting(null);
    setBusy(c.id);
    try {
      await charts.remove(c.id);
      say(`Структуру «${c.name}» видалено`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const list_ = charts.charts;

  return (
    <>
      <header className="top">
        <div className="brand">
          <div className="eyebrow">Робочий простір</div>
          <h1 className="home-title">Оргструктури</h1>
        </div>
        <div className="tools">
          <span className="user">
            {user.photoURL && <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
            {myEmail}
            <span className="level">{LEVEL_LABEL[level]}</span>
          </span>
          {level === "admin" && (
            <button className="btn" type="button" onClick={() => setShowAccess((v) => (v === "all" ? null : "all"))}>Доступ до всіх</button>
          )}
          <button className="btn" type="button" onClick={onLogout}>Вийти</button>
        </div>
      </header>

      <div className="main">
        <div className="home">
          <div className="home-inner">
            <p className="home-lead">
              Кожна структура — окрема схема зі своїми людьми, лініями підпорядкування й областями.
              {level === "admin" && " Кнопка «Доступ» на картці відкриває структуру окремим людям; «Доступ до всіх» — для тих, хто бачить усе."}
            </p>

            {charts.error && <p className="err">{charts.error}</p>}

            <div className="chart-grid">
              {canEdit && (
                <form className="chart-card new" onSubmit={create}>
                  <span className="chart-kicker">Нова структура</span>
                  <input
                    id="new-chart-name"
                    className="fn-input"
                    placeholder="Назва, напр. «Sigma Partners — 2027»"
                    maxLength={80}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <button className="btn primary" type="submit" disabled={!newName.trim() || busy === "new"}>
                    {busy === "new" ? "Створюємо…" : "Створити й відкрити"}
                  </button>
                </form>
              )}

              {!list_ && <div className="chart-card ghost">Завантаження…</div>}

              {list_?.map((c) => {
                const count = charts.counts[c.id];
                return (
                  <article key={c.id} className={"chart-card" + (busy === c.id ? " busy" : "")}>
                    {renaming?.id === c.id ? (
                      <input
                        id={`rename-${c.id}`}
                        className="fn-input rename"
                        autoFocus
                        maxLength={80}
                        value={renaming.name}
                        onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                        onBlur={saveRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <button type="button" className="chart-name" onClick={() => onOpen(c.id)}>
                        {c.name || "Без назви"}
                      </button>
                    )}
                    <div className="chart-meta">
                      <span>
                        {count == null ? "…" : count < 0 ? "—" : `${count} ${plural(count, "співробітник", "співробітники", "співробітників")}`}
                      </span>
                      <span>Змінено {when(c)}</span>
                      {level === "admin" && c.editors.length + c.viewers.length > 0 && (
                        <span>Окремий доступ: {new Set([...c.editors, ...c.viewers]).size}</span>
                      )}
                    </div>

                    {deleting === c.id ? (
                      <div className="confirm">
                        <span>
                          Видалити «{c.name}» разом з усіма {count && count > 0 ? `${count} ` : ""}картками? Це не можна скасувати.
                        </span>
                        <div>
                          <button className="btn danger solid" type="button" onClick={() => remove(c)}>Так, видалити</button>
                          <button className="btn" type="button" onClick={() => setDeleting(null)}>Скасувати</button>
                        </div>
                      </div>
                    ) : (
                      <div className="chart-actions">
                        <button className="btn primary" type="button" onClick={() => onOpen(c.id)}>Відкрити</button>
                        {level === "admin" && (
                          <button type="button" className="link" onClick={() => setShowAccess(c.id)}>Доступ</button>
                        )}
                        {!canEdit && c.editors.includes(myEmail) && (
                          <button type="button" className="link" onClick={() => setRenaming({ id: c.id, name: c.name })}>Перейменувати</button>
                        )}
                        {canEdit && (
                          <>
                            <button type="button" className="link" onClick={() => setRenaming({ id: c.id, name: c.name })}>Перейменувати</button>
                            <button type="button" className="link" disabled={busy === c.id} onClick={() => duplicate(c)}>Дублювати</button>
                            <button type="button" className="link danger" onClick={() => setDeleting(c.id)}>Видалити</button>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}

              {list_ && list_.length === 0 && !canEdit && (
                <div className="chart-card ghost">
                  {level === "guest" ? "Вам ще не відкрили жодної структури." : "Структур ще немає. Їх створюють редактори."}
                </div>
              )}
            </div>
          </div>
        </div>

        {showAccess === "all" && level === "admin" && (
          <AccessPanel list={list} myEmail={myEmail} onClose={() => setShowAccess(null)} onMessage={say} />
        )}
        {showAccess && showAccess !== "all" && level === "admin" && list_?.find((c) => c.id === showAccess) && (
          <ChartAccessPanel
            key={showAccess}
            chart={list_.find((c) => c.id === showAccess)!}
            myEmail={myEmail}
            onClose={() => setShowAccess(null)}
            onMessage={say}
            onOpenGlobal={() => setShowAccess("all")}
          />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
