import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { User } from "firebase/auth";
import { OrgCanvas } from "./components/OrgCanvas";
import { AreaPopover } from "./components/AreaPopover";
import { PersonPanel, type Draft } from "./components/PersonPanel";
import { AccessPanel } from "./components/AccessPanel";
import { PersonPopover } from "./components/PersonPopover";
import { DeniedGate, Gate, SetupGate, SignInGate } from "./components/Gates";
import { buildIndex, kids, managersOf, newId, parseOrgData, plural, reportsOf, wouldCycle, type Area, type Person, type Role } from "./lib/org";
import { COMPACT, NORMAL, PAD, autoLayout, freeSpot, type Pt } from "./lib/layout";
import type { Move } from "./lib/useOrg";
import { isConfigured } from "./lib/firebase";
import { useAuth } from "./lib/useAuth";
import { useAccess, type AccessList, type UserLevel } from "./lib/useAccess";
import { ChartAccessPanel } from "./components/ChartAccessPanel";
import { LinkPopover } from "./components/LinkPopover";
import { LinkPanel } from "./components/LinkPanel";
import { useLinkedCharts } from "./lib/useLinked";
import { useOrg } from "./lib/useOrg";
import { useCharts, type ChartInfo } from "./lib/useCharts";
import { Home } from "./components/Home";

const COLLAPSED_KEY = "org-chart.collapsed";
/** Branches are no longer folded on the canvas (the fold badges were removed). */
const NO_COLLAPSE = new Set<string>();
const LEVEL_LABEL: Record<UserLevel, string> = { admin: "Адміністратор", editor: "Редактор", viewer: "Перегляд", guest: "Окремі структури" };

function loadCollapsed(chartId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`${COLLAPSED_KEY}.${chartId}`) ?? "[]"));
  } catch {
    return new Set();
  }
}

export default function App() {
  if (!isConfigured) return <SetupGate />;
  return <Authed />;
}

function Authed() {
  const auth = useAuth();
  const { user, ready, logout } = auth;
  if (!ready) return <Gate title="Завантаження…"><p>Перевіряємо вхід.</p></Gate>;
  if (!user) return <SignInGate auth={auth} />;
  return <WithAccess user={user} onLogout={logout} />;
}

function WithAccess({ user, onLogout }: { user: User; onLogout: () => void }) {
  const access = useAccess(user);
  if (access.status === "loading") return <Gate title="Завантаження…"><p>Перевіряємо доступ.</p></Gate>;
  if (access.status === "error") return <Gate title="Немає з'єднання"><p>{access.message}</p></Gate>;
  if (access.status === "denied") return <DeniedGate email={access.email} onLogout={onLogout} />;
  return <Workspace user={user} level={access.level} list={access.list} bootstrapped={access.bootstrapped} onLogout={onLogout} />;
}

/** Tiny hash router: «#/» is the list of charts, «#/c/<id>» opens one chart (works on GitHub Pages). */
function useHashRoute() {
  const read = () => {
    const m = window.location.hash.match(/^#\/c\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  };
  const [chartId, setChartId] = useState<string | null>(read);
  useEffect(() => {
    const on = () => setChartId(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((id: string | null) => {
    window.location.hash = id ? `#/c/${id}` : "#/";
  }, []);
  return [chartId, go] as const;
}

function Workspace({ user, level, list, bootstrapped, onLogout }: Omit<ChartProps, "chartId" | "charts" | "onOpenChart">) {
  const myEmail = (user.email ?? "").toLowerCase();
  const canEdit = level === "admin" || level === "editor";
  const charts = useCharts(myEmail, canEdit, level === "admin", level === "guest");
  const [chartId, go] = useHashRoute();
  if (chartId)
    return (
      <Chart
        key={chartId}
        chartId={chartId}
        charts={charts.charts ?? []}
        onOpenChart={go}
        user={user}
        level={level}
        list={list}
        bootstrapped={false}
        onLogout={onLogout}
      />
    );
  return <Home user={user} level={level} list={list} bootstrapped={bootstrapped} onLogout={onLogout} charts={charts} onOpen={go} />;
}

interface ChartProps {
  chartId: string;
  charts: ChartInfo[];
  onOpenChart: (id: string | null) => void;
  user: User;
  level: UserLevel;
  list: AccessList;
  bootstrapped: boolean;
  onLogout: () => void;
}

function Chart({ chartId, charts, onOpenChart, user, level, list, bootstrapped, onLogout }: ChartProps) {
  const myEmail = (user.email ?? "").toLowerCase();
  const chartInfo = charts.find((c) => c.id === chartId);
  // workspace editors edit every chart; others only the charts they were given edit access to
  const canEdit = level === "admin" || level === "editor" || (chartInfo?.editors.includes(myEmail) ?? false);
  const { people: rows, company, compact, areas, missing, error, upsert, remove, setCompany, setCompact, move, upsertArea, removeArea, replaceAll } =
    useOrg(chartId, myEmail);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(chartId));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [side, setSide] = useState<"person" | "access" | "global-access" | "link" | null>(null);
  const [popover, setPopover] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [embPop, setEmbPop] = useState<{ chartId: string; id: string; anchor: DOMRect } | null>(null);
  const [foldedLinks, setFoldedLinks] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(`org-chart.folded-links.${chartId}`) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [areaPop, setAreaPop] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [confirmArrange, setConfirmArrange] = useState(false);
  const [query, setQuery] = useState("");
  const [zoom, setZoomState] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [companyInput, setCompanyInput] = useState(company);

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fitted = useRef(false);

  const people = useMemo(() => new Map((rows ?? []).map((p) => [p.id, p])), [rows]);
  const index = useMemo(() => buildIndex(people), [people]);
  const metrics = compact ? COMPACT : NORMAL;
  const auto = useMemo(() => autoLayout(index, metrics), [index, metrics]);
  /** Saved position when there is one, otherwise the automatic tree position. */
  const positions = useMemo(() => {
    const out = new Map<string, Pt>();
    for (const p of people.values()) out.set(p.id, p.x != null && p.y != null ? { x: p.x, y: p.y } : auto.get(p.id) ?? { x: PAD, y: PAD });
    return out;
  }, [people, auto]);
  const manualLayout = useMemo(() => [...people.values()].some((p) => p.x != null && p.y != null), [people]);

  const linked = useLinkedCharts((rows ?? []).map((p) => p.linkChart).filter((x): x is string => !!x));
  const departments = useMemo(
    () => [...new Set((rows ?? []).filter((p) => !p.linkChart).map((p) => p.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, "uk")),
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
      localStorage.setItem(`${COLLAPSED_KEY}.${chartId}`, JSON.stringify([...collapsed]));
    } catch {
      /* per-browser convenience only */
    }
  }, [collapsed, chartId]);

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

  const bounds = useMemo(() => {
    let w = 0;
    let h = 0;
    for (const p of positions.values()) {
      w = Math.max(w, p.x + metrics.w);
      h = Math.max(h, p.y + metrics.h);
    }
    for (const a of areas) {
      w = Math.max(w, a.x + a.w);
      h = Math.max(h, a.y + a.h);
    }
    return { w: w + PAD, h: h + PAD };
  }, [positions, areas, metrics]);

  const fit = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !bounds.w) return;
    // include linked charts shown on the canvas (their cards are laid out by the canvas itself)
    let w = bounds.w;
    let h = bounds.h;
    const frames = c.querySelectorAll<HTMLElement>(".embed-frame");
    frames.forEach((f) => {
      w = Math.max(w, f.offsetLeft + f.offsetWidth + PAD);
      h = Math.max(h, f.offsetTop + f.offsetHeight + PAD);
    });
    const z = Math.min(1, Math.max(0.3, Math.min((c.clientWidth - 16) / w, (c.clientHeight - 16) / h)));
    setZoomState(Math.round(z * 100) / 100);
    requestAnimationFrame(() => {
      c.scrollLeft = 0;
      c.scrollTop = 0;
    });
  }, [bounds]);

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
      if (e.button !== 0 || (e.target as HTMLElement).closest(".card,button,input,.area-grip,.area-resize,.popover")) return;
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
    if (!c || (!popover && !areaPop && !embPop)) return;
    const close = () => {
      setPopover(null);
      setAreaPop(null);
      setEmbPop(null);
    };
    c.addEventListener("scroll", close, { passive: true });
    return () => c.removeEventListener("scroll", close);
  }, [popover, areaPop, embPop]);
  useEffect(() => {
    setPopover(null);
    setAreaPop(null);
    setEmbPop(null);
  }, [zoom, collapsed, query, compact]);

  useEffect(() => {
    if (!query) return;
    canvasRef.current?.querySelector(".hit")?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [query]);

  /* ---------- editing ---------- */
  const openEdit = (id: string) => {
    const p = people.get(id);
    if (!p) return;
    setDraft({
      person: { id: p.id, name: p.name, title: p.title, dept: p.dept, role: p.role, managerId: index.parentOf.get(id) ?? null, alsoReportsTo: [...p.alsoReportsTo], functions: [...p.functions], x: p.x, y: p.y },
      isNew: false,
    });
    setSide("person");
    setPopover(null);
  };

  const openNew = (managerId: string | null, role: Role = "staff", at?: Pt) => {
    if (!canEdit) return;
    const m = managerId ? people.get(managerId) : undefined;
    if (managerId && collapsed.has(managerId)) {
      setCollapsed((s) => {
        const n = new Set(s);
        n.delete(managerId);
        return n;
      });
    }
    // In a hand-arranged chart a new card gets the first free spot under its manager.
    let spot: Pt | null = at ?? null;
    if (!spot && manualLayout) {
      const taken = [...positions.values()].map((p) => ({ ...p, w: metrics.w, h: metrics.h }));
      const mp = managerId ? positions.get(managerId) : undefined;
      spot = freeSpot(mp ? { ...mp, w: metrics.w, h: metrics.h } : null, taken, metrics);
    }
    setDraft({
      person: { id: newId(), name: "", title: "", dept: m?.dept ?? "", role, managerId, alsoReportsTo: [], functions: [], x: spot?.x ?? null, y: spot?.y ?? null },
      isNew: true,
    });
    setSide("person");
    setPopover(null);
  };

  const writeFailed = (e: unknown) => {
    const code = (e as { code?: string }).code;
    say(code === "permission-denied" ? "У вас немає прав на редагування." : "Не вдалося зберегти. Перевірте з'єднання.");
  };

  /** Clicking a card opens (or closes) its small menu. */
  const toggleLink = (cardId: string) =>
    setFoldedLinks((s) => {
      const next = new Set(s);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      try {
        localStorage.setItem(`org-chart.folded-links.${chartId}`, JSON.stringify([...next]));
      } catch {
        /* per-browser convenience only */
      }
      return next;
    });

  /** Puts a live link to another chart on this one. */
  const addLink = async (targetId: string, managerId: string | null) => {
    const target = charts.find((c) => c.id === targetId);
    let spot: Pt | null = null;
    if (manualLayout) {
      const taken = [...positions.values()].map((p) => ({ ...p, w: metrics.w, h: metrics.h }));
      const mp = managerId ? positions.get(managerId) : undefined;
      spot = freeSpot(mp ? { ...mp, w: metrics.w, h: metrics.h } : null, taken, metrics);
    }
    const card: Person = {
      id: newId(),
      name: (target?.name || "Структура").slice(0, 80),
      title: "",
      dept: "",
      role: "staff",
      managerId,
      alsoReportsTo: [],
      functions: [],
      x: spot?.x ?? null,
      y: spot?.y ?? null,
      linkChart: targetId,
    };
    setSide(null);
    try {
      await upsert(card);
      say(`Структуру «${card.name}» приєднано`);
    } catch (e) {
      writeFailed(e);
    }
  };

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
      await upsert({ ...p, functions: next });
    } catch (e) {
      writeFailed(e);
    }
  };

  /** Saves dragged positions. The first drag also pins everybody else where they are now. */
  const onMove = async (moves: Move[]) => {
    const moved = new Set(moves.map((m) => m.id));
    const pin = [...people.values()]
      .filter((p) => !moved.has(p.id) && (p.x == null || p.y == null))
      .map((p) => ({ id: p.id, ...positions.get(p.id)! }));
    try {
      await move([...moves, ...pin]);
    } catch (e) {
      writeFailed(e);
    }
  };

  const autoArrange = async () => {
    setConfirmArrange(false);
    try {
      await move([...auto].map(([id, p]) => ({ id, ...p })));
      say("Картки розставлено автоматично");
      requestAnimationFrame(fit);
    } catch (e) {
      writeFailed(e);
    }
  };

  const toggleCompact = async () => {
    try {
      await setCompact(!compact);
    } catch (e) {
      writeFailed(e);
    }
  };

  /* ---------- areas ---------- */
  const addArea = async () => {
    const c = canvasRef.current;
    const cx = c ? (c.scrollLeft + c.clientWidth / 2) / zoom : 400;
    const cy = c ? (c.scrollTop + c.clientHeight / 2) / zoom : 300;
    const a: Area = { id: "a" + newId().slice(1), label: "Нова область", x: Math.max(0, Math.round(cx - 240)), y: Math.max(0, Math.round(cy - 140)), w: 480, h: 280, shape: "rect", tone: "soft" };
    try {
      await upsertArea(a);
      say("Область додано. Клікніть на її назву, щоб змінити, або тягніть за назву, щоб перемістити.");
    } catch (e) {
      writeFailed(e);
    }
  };
  const saveArea = async (a: Area) => {
    try {
      await upsertArea(a);
    } catch (e) {
      writeFailed(e);
    }
  };
  const deleteArea = async (id: string) => {
    setAreaPop(null);
    try {
      await removeArea(id);
      say("Область видалено");
    } catch (e) {
      writeFailed(e);
    }
  };
  const openAreaPop = (id: string, el: HTMLElement) => {
    setPopover(null);
    setAreaPop((cur) => (cur?.id === id ? null : { id, anchor: el.getBoundingClientRect() }));
  };

  /** A line dragged from one card to another: `subId` starts reporting to `managerId`. */
  const onLink = async (managerId: string, subId: string) => {
    const sub = people.get(subId);
    const boss = people.get(managerId);
    if (!sub || !boss) return;
    if (managersOf(sub, people).includes(managerId)) return say(`${sub.name} вже підпорядковується ${boss.name}.`);
    if (wouldCycle(managerId, subId, people))
      return say(`Не можна: ${boss.name} сам(а) підпорядковується ${sub.name}, вийде замкнене коло.`);
    const next: Person = sub.managerId && people.has(sub.managerId)
      ? { ...sub, alsoReportsTo: [...sub.alsoReportsTo.filter((m) => m !== managerId), managerId] }
      : { ...sub, managerId, alsoReportsTo: sub.alsoReportsTo.filter((m) => m !== managerId) };
    try {
      const pending = upsert(next);
      say(next.managerId === managerId ? `${sub.name} тепер підпорядковується ${boss.name}` : `${sub.name} тепер також підпорядковується ${boss.name}`);
      await pending;
    } catch (e) {
      writeFailed(e);
    }
  };

  const onSave = async (p: Person, isNew: boolean) => {
    try {
      // A card placed by hand switches the chart to manual layout: pin everyone else where they are
      // so the automatic arrangement does not shift them around the new card.
      const pins =
        isNew && p.x != null
          ? [...people.values()].filter((q) => q.x == null || q.y == null).map((q) => ({ id: q.id, ...positions.get(q.id)! }))
          : [];
      const pending = upsert(p);
      setDraft({ person: p, isNew: false }); // Firestore shows the change right away; the server confirms in the background
      say(isNew ? "Співробітника додано" : "Зміни збережено");
      await pending;
      if (pins.length) await move(pins);
    } catch (e) {
      writeFailed(e);
    }
  };

  const onDelete = async (id: string) => {
    try {
      // Direct reports move up to the removed person's main manager; extra links to them disappear.
      const up = index.parentOf.get(id) ?? null;
      const updated: Person[] = [];
      for (const q of people.values()) {
        if (q.id === id) continue;
        const main = q.managerId === id ? up : q.managerId;
        const extra = q.alsoReportsTo.filter((m) => m !== id && m !== main);
        if (main !== q.managerId || extra.length !== q.alsoReportsTo.length) updated.push({ ...q, managerId: main, alsoReportsTo: extra });
      }
      const pending = remove(id, updated);
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


  /* ---------- import / export ---------- */
  const exportJson = () => {
    const data = {
      company,
      compact,
      people: (rows ?? []).map(({ id, name, title, dept, role, managerId, alsoReportsTo, functions, x, y, linkChart }) => ({ id, name, title, dept, role, managerId, alsoReportsTo, functions, x, y, linkChart })),
      areas,
    };
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

  const n = rows?.filter((p) => !p.linkChart).length ?? 0;
  const roots = kids(index, null);
  const current = draft && !draft.isNew ? people.get(draft.person.id) : undefined;
  const lastChange =
    current?.updatedBy
      ? `Востаннє змінено: ${current.updatedBy}${current.updatedAt ? " · " + current.updatedAt.toDate().toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : ""}`
      : undefined;

  if (missing)
    return (
      <Gate title="Структуру не знайдено">
        <p>Можливо, її видалили або посилання неповне.</p>
        <button className="btn primary" type="button" onClick={() => onOpenChart(null)}>До всіх структур</button>
      </Gate>
    );

  return (
    <>
      <header className="top">
        <div className="brand">
          <div className="eyebrow">
            <button type="button" className="back" onClick={() => onOpenChart(null)}>← Усі структури</button>
            {charts.length > 1 && (
              <select
                id="chart-switch"
                className="switch"
                aria-label="Перейти до іншої структури"
                value={chartId}
                onChange={(e) => onOpenChart(e.target.value)}
              >
                {charts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name || "Без назви"}</option>
                ))}
              </select>
            )}
            <span className="stats">
              {n} {plural(n, "співробітник", "співробітники", "співробітників")} · {departments.length}{" "}
              {plural(departments.length, "підрозділ", "підрозділи", "підрозділів")}
            </span>
          </div>
          <input
            id="company-name"
            aria-label="Назва структури"
            maxLength={80}
            readOnly={!canEdit}
            value={companyInput}
            onChange={(e) => setCompanyInput(e.target.value)}
            onBlur={() => {
              const v = companyInput.trim() || company || "Структура";
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
        <span className="canvas-tools">
          <button
            type="button"
            className={"chip" + (compact ? " on" : "")}
            aria-pressed={compact}
            disabled={!canEdit}
            title={canEdit ? "Маленькі картки лише з ім'ям або номером" : "Вигляд змінюють редактори"}
            onClick={toggleCompact}
          >
            Компактні картки
          </button>
          {canEdit && (
            <>
              <button type="button" className="chip" onClick={addArea}>+ Область</button>
              <button type="button" className="chip" onClick={() => setSide(side === "link" ? null : "link")}>+ Структура</button>
              {confirmArrange ? (
                <span className="confirm-inline">
                  Розставити всі картки автоматично? Ручне розміщення буде втрачено.
                  <button type="button" className="link danger" onClick={autoArrange}>Так</button>
                  <button type="button" className="link" onClick={() => setConfirmArrange(false)}>Ні</button>
                </span>
              ) : (
                manualLayout && (
                  <button type="button" className="chip" onClick={() => setConfirmArrange(true)}>Авторозміщення</button>
                )
              )}
              <span className="hint">Тягніть картку мишею · з Shift — разом з підлеглими · киньте на іншу картку, щоб поміняти місцями · точку справа на картці протягніть до підлеглого (або в порожнє місце, щоб створити нового)</span>
            </>
          )}
        </span>
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
            <OrgCanvas
              people={people}
              index={index}
              positions={positions}
              areas={areas}
              collapsed={NO_COLLAPSE}
              selectedId={popover?.id ?? (side === "person" ? (draft?.isNew ? draft.person.managerId : draft?.person.id ?? null) : null)}
              selectedAreaId={areaPop?.id ?? null}
              query={query}
              canEdit={canEdit}
              compact={compact}
              scale={zoom}
              onSelect={openPopover}
              onAdd={(id) => openNew(id)}
              onToggle={toggle}
              onMove={onMove}
              onDragStart={() => {
                setPopover(null);
                setAreaPop(null);
              }}
              onAreaSelect={openAreaPop}
              onAreaChange={saveArea}
              onLink={onLink}
              onLinkToEmpty={(managerId, at) => openNew(managerId, "staff", at)}
              linked={linked}
              foldedLinks={foldedLinks}
              onToggleLink={toggleLink}
              onOpenChart={(id) => onOpenChart(id)}
              onResize={async (id, w, h) => {
                const p = people.get(id);
                if (!p) return;
                try {
                  await upsert({ ...p, w, h });
                } catch (e) {
                  writeFailed(e);
                }
              }}
              onSelectEmbedded={(cid, id, el) => {
                setPopover(null);
                setEmbPop({ chartId: cid, id, anchor: el.getBoundingClientRect() });
              }}
            />
          )}
        </div>

        {side === "link" && canEdit && (
          <LinkPanel
            charts={charts.filter((c) => c.id !== chartId && !(rows ?? []).some((p) => p.linkChart === c.id))}
            people={rows ?? []}
            onCreate={addLink}
            onClose={() => setSide(null)}
          />
        )}
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
        {side === "access" && level === "admin" && chartInfo && (
          <ChartAccessPanel
            chart={chartInfo}
            myEmail={myEmail}
            onClose={() => setSide(null)}
            onMessage={say}
            onOpenGlobal={() => setSide("global-access")}
          />
        )}
        {side === "global-access" && level === "admin" && (
          <AccessPanel list={list} myEmail={myEmail} onClose={() => setSide(null)} onMessage={say} />
        )}
      </div>

      {popover && people.get(popover.id)?.linkChart && (() => {
        const card = people.get(popover.id)!;
        const bosses = managersOf(card, people);
        return (
          <LinkPopover
            key={card.id}
            card={card}
            data={linked[card.linkChart!]}
            anchor={popover.anchor}
            canEdit={canEdit}
            folded={foldedLinks.has(card.id)}
            managerName={bosses.length ? bosses.map((b) => people.get(b)?.name).join(", ") : undefined}
            onOpen={() => onOpenChart(card.linkChart!)}
            onToggle={() => toggleLink(card.id)}
            onRemove={() => {
              setPopover(null);
              onDelete(card.id);
            }}
            onClose={closePopover}
          />
        );
      })()}

      {embPop && (() => {
        const data = linked[embPop.chartId];
        const q = data?.people?.find((x) => x.id === embPop.id);
        if (!q || !data?.people) return null;
        const map = new Map(data.people.map((x) => [x.id, x]));
        const bosses = managersOf(q, map);
        return (
          <PersonPopover
            key={`${embPop.chartId}:${q.id}`}
            person={q}
            anchor={embPop.anchor}
            canEdit={false}
            managerName={bosses.length ? bosses.map((b) => map.get(b)?.name).join(", ") : undefined}
            reportsCount={reportsOf(q.id, map).length}
            onChangeFunctions={async () => {}}
            onEdit={() => onOpenChart(embPop.chartId)}
            onAddSub={() => {}}
            onClose={() => setEmbPop(null)}
          />
        );
      })()}

      {popover && people.get(popover.id) && !people.get(popover.id)!.linkChart && (() => {
        const p = people.get(popover.id)!;
        const bosses = managersOf(p, people);
        return (
          <PersonPopover
            key={p.id}
            person={p}
            anchor={popover.anchor}
            canEdit={canEdit}
            managerName={bosses.length ? bosses.map((b) => people.get(b)?.name).join(", ") : undefined}
            reportsCount={reportsOf(p.id, people).length}
            onChangeFunctions={(next) => changeFunctions(p.id, next)}
            onStyle={async (patch) => {
              try {
                await upsert({ ...p, ...patch });
              } catch (e) {
                writeFailed(e);
              }
            }}
            onEdit={() => openEdit(p.id)}
            onAddSub={() => openNew(p.id)}
            onClose={closePopover}
          />
        );
      })()}

      {areaPop && areas.find((a) => a.id === areaPop.id) && (
        <AreaPopover
          key={areaPop.id}
          area={areas.find((a) => a.id === areaPop.id)!}
          anchor={areaPop.anchor}
          canEdit={canEdit}
          onChange={saveArea}
          onDelete={() => deleteArea(areaPop.id)}
          onClose={() => setAreaPop(null)}
        />
      )}

      {(toast || error) && <div className="toast">{toast ?? error}</div>}
    </>
  );
}
