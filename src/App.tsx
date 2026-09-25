import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { User } from "firebase/auth";
import { OrgTree } from "./components/OrgTree";
import { PersonPanel, type Draft } from "./components/PersonPanel";
import { AccessPanel } from "./components/AccessPanel";
import { PersonPopover } from "./components/PersonPopover";
import { DeniedGate, Gate, SetupGate, SignInGate } from "./components/Gates";
import { buildIndex, kids, newId, parseOrgData, plural, type Person, type Role } from "./lib/org";
import { isConfigured } from "./lib/firebase";
import { useAuth } from "./lib/useAuth";
import { useAccess, type AccessLevel, type AccessList } from "./lib/useAccess";
import { useOrg } from "./lib/useOrg";

const COLLAPSED_KEY = "org-chart.collapsed";
const LEVEL_LABEL: Record<AccessLevel, string> = { admin: "Адміністратор", editor: "Редактор", viewer: "Перегляд" };

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export default function App() {
  if (!isConfigured) return <SetupGate />;
  return <Authed />;
}

function Authed() {
  const { user, ready, error, signIn, logout } = useAuth();
  if (!ready) return <Gate title="Завантаження…"><p>Перевіряємо вхід.</p></Gate>;
  if (!user) return <SignInGate onSignIn={signIn} error={error} />;
  return <WithAccess user={user} onLogout={logout} />;
}

function WithAccess({ user, onLogout }: { user: User; onLogout: () => void }) {
  const access = useAccess(user);
  if (access.status === "loading") return <Gate title="Завантаження…"><p>Перевіряємо доступ.</p></Gate>;
  if (access.status === "error") return <Gate title="Немає з'єднання"><p>{access.message}</p></Gate>;
  if (access.status === "denied") return <DeniedGate email={access.email} onLogout={onLogout} />;
  return <Chart user={user} level={access.level} list={access.list} bootstrapped={access.bootstrapped} onLogout={onLogout} />;
}

interface ChartProps {
  user: User;
  level: AccessLevel;
  list: AccessList;
  bootstrapped: boolean;
  onLogout: () => void;
}

function Chart({ user, level, list, bootstrapped, onLogout }: ChartProps) {
  const myEmail = (user.email ?? "").toLowerCase();
  const canEdit = level !== "viewer";
  const { people: rows, company, error, upsert, remove, setCompany, replaceAll } = useOrg(true, myEmail);

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [side, setSide] = useState<"person" | "access" | null>(null);
  const [popover, setPopover] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [query, setQuery] = useState("");
  const [zoom, setZoomState] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [companyInput, setCompanyInput] = useState(company);

  const canvasRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fitted = useRef(false);

  const people = useMemo(() => new Map((rows ?? []).map((p) => [p.id, p])), [rows]);
  const index = useMemo(() => buildIndex(people), [people]);
  const departments = useMemo(
    () => [...new Set((rows ?? []).map((p) => p.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, "uk")),
    [rows],
  );

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  useEffect(() => {
    if (bootstrapped) say("Ви увійшли першим, тож стали адміністратором. Додайте колег у розділі «Доступ».");
  }, [bootstrapped, say]);

  useEffect(() => {
    if (document.activeElement?.id !== "company-name") setCompanyInput(company);
  }, [company]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      /* per-browser convenience only */
    }
  }, [collapsed]);

  // Someone else deleted the person being edited
  useEffect(() => {
    if (draft && !draft.isNew && rows && !people.has(draft.person.id)) {
      setDraft(null);
      setSide(null);
      say("Цю картку видалив інший користувач.");
    }
  }, [rows, people, draft, say]);

  /* ---------- zoom & pan ---------- */
  const setZoom = (z: number) => setZoomState(Math.min(1.6, Math.max(0.35, Math.round(z * 100) / 100)));

  const fit = useCallback(() => {
    const c = canvasRef.current;
    const t = treeRef.current;
    if (!c || !t) return;
    t.style.zoom = "1";
    const z = Math.min(1, Math.max(0.45, (c.clientWidth - 8) / t.scrollWidth));
    t.style.zoom = String(z);
    setZoomState(z);
    requestAnimationFrame(() => {
      c.scrollLeft = (c.scrollWidth - c.clientWidth) / 2;
      c.scrollTop = 0;
    });
  }, []);

  useLayoutEffect(() => {
    if (!fitted.current && rows && rows.length) {
      fitted.current = true;
      fit();
    }
  }, [rows, fit]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let start: { x: number; y: number; l: number; t: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest(".card,.mini,button,.stack,input")) return;
      start = { x: e.clientX, y: e.clientY, l: c.scrollLeft, t: c.scrollTop };
      c.setPointerCapture(e.pointerId);
      c.classList.add("panning");
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      c.scrollLeft = start.l - (e.clientX - start.x);
      c.scrollTop = start.t - (e.clientY - start.y);
    };
    const up = () => {
      start = null;
      c.classList.remove("panning");
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoomState((z) => Math.min(1.6, Math.max(0.35, z * (e.deltaY < 0 ? 1.08 : 0.93))));
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false });
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("wheel", wheel);
    };
  }, []);

  // The menu is anchored to a card; moving the chart would leave it floating in the wrong place.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !popover) return;
    const close = () => setPopover(null);
    c.addEventListener("scroll", close, { passive: true });
    return () => c.removeEventListener("scroll", close);
  }, [popover]);
  useEffect(() => setPopover(null), [zoom, collapsed, query]);

  useEffect(() => {
    if (!query) return;
    treeRef.current?.querySelector(".hit")?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [query]);

  /* ---------- editing ---------- */
  const openEdit = (id: string) => {
    const p = people.get(id);
    if (!p) return;
    setDraft({
      person: { id: p.id, name: p.name, title: p.title, dept: p.dept, role: p.role, managerId: index.parentOf.get(id) ?? null, functions: [...p.functions] },
      isNew: false,
    });
    setSide("person");
    setPopover(null);
  };

  const openNew = (managerId: string | null, role: Role = "staff") => {
    if (!canEdit) return;
    const m = managerId ? people.get(managerId) : undefined;
    if (managerId && collapsed.has(managerId)) {
      setCollapsed((s) => {
        const n = new Set(s);
        n.delete(managerId);
        return n;
      });
    }
    setDraft({ person: { id: newId(), name: "", title: "", dept: m?.dept ?? "", role, managerId, functions: [] }, isNew: true });
    setSide("person");
    setPopover(null);
  };

  const writeFailed = (e: unknown) => {
    const code = (e as { code?: string }).code;
    say(code === "permission-denied" ? "У вас немає прав на редагування." : "Не вдалося зберегти. Перевірте з'єднання.");
  };

  /** Clicking a card opens (or closes) its small menu. */
  const openPopover = (id: string, el: HTMLElement) => {
    if (popover?.id === id) return setPopover(null);
    if (side === "person") {
      setSide(null);
      setDraft(null);
    }
    setPopover({ id, anchor: el.getBoundingClientRect() });
  };
  const closePopover = useCallback(() => setPopover(null), []);

  const changeFunctions = async (id: string, next: string[]) => {
    const p = people.get(id);
    if (!p) return;
    try {
      await upsert({ id: p.id, name: p.name, title: p.title, dept: p.dept, role: p.role, managerId: p.managerId, functions: next });
    } catch (e) {
      writeFailed(e);
    }
  };

  const onSave = async (p: Person, isNew: boolean) => {
    try {
      const pending = upsert(p);
      setDraft({ person: p, isNew: false }); // Firestore shows the change right away; the server confirms in the background
      say(isNew ? "Співробітника додано" : "Зміни збережено");
      await pending;
    } catch (e) {
      writeFailed(e);
    }
  };

  const onDelete = async (id: string) => {
    try {
      const pending = remove(id, index.parentOf.get(id) ?? null, kids(index, id));
      setDraft(null);
      setSide(null);
      say("Видалено");
      await pending;
    } catch (e) {
      writeFailed(e);
    }
  };

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleAll = () => {
    if (collapsed.size) setCollapsed(new Set());
    else setCollapsed(new Set((rows ?? []).filter((p) => p.role === "head" && kids(index, p.id).length).map((p) => p.id)));
  };

  /* ---------- import / export ---------- */
  const exportJson = () => {
    const data = { company, people: (rows ?? []).map(({ id, name, title, dept, role, managerId, functions }) => ({ id, name, title, dept, role, managerId, functions })) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "org.json";
    a.click();
    URL.revokeObjectURL(a.href);
    say("Файл org.json завантажено");
  };

  const importData = async (load: () => Promise<unknown>, done: string) => {
    try {
      const parsed = parseOrgData(await load());
      await replaceAll(parsed);
      setDraft(null);
      setSide(null);
      fitted.current = false;
      say(done);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "permission-denied") say("У вас немає прав на редагування.");
      else say(err instanceof Error && err.message.length < 120 && !code ? err.message : "Не вдалося завантажити структуру.");
    }
  };

  const importFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) importData(async () => JSON.parse(await file.text()), "Структуру імпортовано");
  };

  const loadDemo = () =>
    importData(async () => (await fetch(`${import.meta.env.BASE_URL}org.json`)).json(), "Демо-структуру завантажено");

  const n = rows?.length ?? 0;
  const roots = kids(index, null);
  const current = draft && !draft.isNew ? people.get(draft.person.id) : undefined;
  const lastChange =
    current?.updatedBy
      ? `Востаннє змінено: ${current.updatedBy}${current.updatedAt ? " · " + current.updatedAt.toDate().toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : ""}`
      : undefined;

  return (
    <>
      <header className="top">
        <div className="brand">
          <div className="eyebrow">
            Організаційна структура
            <span className="stats">
              {n} {plural(n, "співробітник", "співробітники", "співробітників")} · {departments.length}{" "}
              {plural(departments.length, "підрозділ", "підрозділи", "підрозділів")}
            </span>
          </div>
          <input
            id="company-name"
            aria-label="Назва компанії"
            maxLength={80}
            readOnly={!canEdit}
            value={companyInput}
            onChange={(e) => setCompanyInput(e.target.value)}
            onBlur={() => {
              const v = companyInput.trim() || "Компанія";
              setCompanyInput(v);
              if (v !== company) setCompany(v).catch(writeFailed);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
        <div className="tools">
          <label className="search">
            <svg viewBox="0 0 16 16">
              <circle cx="7" cy="7" r="5" strokeWidth="1.6" />
              <path d="M11 11l3.5 3.5" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input type="search" placeholder="Пошук людини чи посади" aria-label="Пошук" value={query} onChange={(e) => setQuery(e.target.value.trim())} />
          </label>
          <button className="btn" type="button" onClick={toggleAll}>
            {collapsed.size ? "Розгорнути все" : "Згорнути все"}
          </button>
          <div className="zoom" role="group" aria-label="Масштаб">
            <button type="button" aria-label="Зменшити" onClick={() => setZoom(zoom - 0.1)}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Збільшити" onClick={() => setZoom(zoom + 0.1)}>+</button>
          </div>
          <button className="btn" type="button" onClick={fit}>Вмістити</button>
          {canEdit && (
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                const top = roots.find((p) => p.role === "director") ?? roots[0];
                openNew(top ? top.id : null, top ? "staff" : "director");
              }}
            >
              + Співробітник
            </button>
          )}
        </div>
      </header>

      <div className="legend">
        <span><i className="sw director" />Керівник компанії</span>
        <span><i className="sw head" />Начальник підрозділу</span>
        <span><i className="sw deputy" />Заступник</span>
        <span><i className="sw" />Співробітник</span>
        <span className="filebar">
          <span className="user">
            {user.photoURL && <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
            {myEmail}
            <span className="level">{LEVEL_LABEL[level]}</span>
          </span>
          {level === "admin" && (
            <button type="button" className="link" onClick={() => setSide(side === "access" ? null : "access")}>Доступ</button>
          )}
          <button type="button" className="link" onClick={exportJson}>Експорт JSON</button>
          {canEdit && <button type="button" className="link" onClick={() => fileRef.current?.click()}>Імпорт</button>}
          <button type="button" className="link" onClick={onLogout}>Вийти</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importFile} />
        </span>
      </div>

      <div className="main">
        <div className="canvas" ref={canvasRef}>
          <div className={"tree" + (query ? " searching" : "")} ref={treeRef} style={{ zoom }}>
            {!rows ? (
              <div className="empty"><p>Завантаження структури…</p></div>
            ) : n === 0 ? (
              <div className="empty">
                <h2>Структура порожня</h2>
                {canEdit ? (
                  <>
                    <p>Почніть з керівника компанії, а потім додавайте підлеглих кнопкою «+» на картці. Або завантажте приклад і змініть його під себе.</p>
                    <div className="copy">
                      <button className="btn primary" type="button" onClick={() => openNew(null, "director")}>+ Додати керівника</button>
                      <button className="btn" type="button" onClick={loadDemo}>Завантажити приклад</button>
                    </div>
                  </>
                ) : (
                  <p>Редактори ще не додали жодної людини.</p>
                )}
              </div>
            ) : (
              <OrgTree
                index={index}
                collapsed={collapsed}
                selectedId={popover?.id ?? (side === "person" ? (draft?.isNew ? draft.person.managerId : draft?.person.id ?? null) : null)}
                query={query}
                canEdit={canEdit}
                onSelect={openPopover}
                onAdd={(id) => openNew(id)}
                onToggle={toggle}
              />
            )}
          </div>
        </div>

        {side === "person" && draft && (
          <PersonPanel
            draft={draft}
            people={people}
            index={index}
            departments={departments}
            canEdit={canEdit}
            lastChange={lastChange}
            onSave={onSave}
            onDelete={onDelete}
            onAddSub={(id) => openNew(id)}
            onOpen={openEdit}
            onClose={() => {
              setDraft(null);
              setSide(null);
            }}
          />
        )}
        {side === "access" && level === "admin" && (
          <AccessPanel list={list} myEmail={myEmail} onClose={() => setSide(null)} onMessage={say} />
        )}
      </div>

      {popover && people.get(popover.id) && (() => {
        const p = people.get(popover.id)!;
        const boss = index.parentOf.get(p.id);
        return (
          <PersonPopover
            key={p.id}
            person={p}
            anchor={popover.anchor}
            canEdit={canEdit}
            managerName={boss ? people.get(boss)?.name : undefined}
            reportsCount={kids(index, p.id).length}
            onChangeFunctions={(next) => changeFunctions(p.id, next)}
            onEdit={() => openEdit(p.id)}
            onAddSub={() => openNew(p.id)}
            onClose={closePopover}
          />
        );
      })()}

      {(toast || error) && <div className="toast">{toast ?? error}</div>}
    </>
  );
}
