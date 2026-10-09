import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { MAX_CARD, MIN_CARD, ROLES, buildIndex, deptColor, inkFor, descendants, managersOf, plural, type Area, type OrgIndex, type Person } from "../lib/org";
import { autoLayout } from "../lib/layout";
import type { LinkedChart } from "../lib/useLinked";
import { COMPACT, NORMAL, PAD, connectorPaths, snap, type Box, type Pt } from "../lib/layout";
import type { Move } from "../lib/useOrg";
import { matches } from "./OrgTree";

interface Props {
  people: Map<string, Person>;
  index: OrgIndex;
  positions: Map<string, Pt>;
  areas: Area[];
  collapsed: Set<string>;
  selectedId: string | null;
  selectedAreaId: string | null;
  query: string;
  canEdit: boolean;
  compact: boolean;
  scale: number;
  onSelect: (id: string, el: HTMLElement) => void;
  onAdd: (managerId: string) => void;
  onToggle: (id: string) => void;
  onMove: (moves: Move[]) => void;
  onDragStart: () => void;
  onAreaSelect: (id: string, el: HTMLElement) => void;
  onAreaChange: (a: Area) => void;
  /** A line was dragged from `managerId`'s card onto `subId`'s card. */
  onLink: (managerId: string, subId: string) => void;
  /** A line was dragged from `managerId`'s card and dropped on empty space at `at` (canvas coordinates). */
  onLinkToEmpty: (managerId: string, at: Pt) => void;
  /** live data of charts that link cards point to */
  linked: Record<string, LinkedChart>;
  /** link cards whose chart is folded away (shown expanded otherwise) */
  foldedLinks: Set<string>;
  onToggleLink: (cardId: string) => void;
  onOpenChart: (chartId: string) => void;
  /** a card inside an embedded (linked) chart was clicked */
  onSelectEmbedded: (chartId: string, personId: string, el: HTMLElement) => void;
  /** a card was resized by dragging its corner */
  onResize: (id: string, w: number, h: number) => void;
}

interface Embedded {
  cardId: string;
  chartId: string;
  name: string;
  frame: Box;
  cards: { key: string; person: Person; x: number; y: number }[];
  boxes: Map<string, Box>;
  people: Map<string, Person>;
}

type Drag =
  | { kind: "card"; id: string; ids: string[]; start: Pt; origin: Map<string, Pt>; moved: boolean; el: HTMLElement }
  | { kind: "area"; id: string; start: Pt; origin: Area; moved: boolean; el: HTMLElement; mode: "move" | "resize" }
  | { kind: "link"; id: string; start: Pt; moved: boolean }
  | { kind: "resize"; id: string; start: Pt; origin: { w: number; h: number }; moved: boolean };

const dcStyle = (p: Person) =>
  ({
    "--dc": deptColor(p.dept),
    ...(p.color ? { "--card-bg": p.color, "--card-ink": inkFor(p.color) } : {}),
  }) as CSSProperties;

/** Text grows and shrinks with a resized card (relative to the default card size). */
function fontSizeFor(w: number | null | undefined, h: number | null | undefined, base: { w: number; h: number }) {
  if (!w && !h) return undefined;
  const kw = w ? w / base.w : Infinity;
  const kh = h ? h / base.h : Infinity;
  const k = Math.min(kw, kh);
  if (!Number.isFinite(k)) return undefined;
  return Math.round(14 * Math.min(4, Math.max(0.6, k)) * 10) / 10;
}

/**
 * Free-form chart: every card sits at its own x/y, lines are drawn between managers and their
 * direct reports. Editors drag cards (Shift = together with the whole branch), drop a card onto
 * another to swap them, and move or resize background areas.
 */
export function OrgCanvas(props: Props) {
  const { people, index, positions, areas, collapsed, selectedId, selectedAreaId, query, canEdit, compact, scale } = props;
  const m = compact ? COMPACT : NORMAL;

  const [heights, setHeights] = useState<Map<string, number>>(new Map());
  const [override, setOverride] = useState<Map<string, Pt> | null>(null);
  const [areaOverride, setAreaOverride] = useState<Area | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [linkLine, setLinkLine] = useState<{ from: Pt; to: Pt } | null>(null);
  const [sizeOverride, setSizeOverride] = useState<{ id: string; w: number; h: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const worldRef = useRef<HTMLDivElement>(null);

  // Hidden = inside a collapsed branch (search shows everything).
  const hidden = useMemo(() => {
    const h = new Set<string>();
    if (query) return h;
    for (const id of collapsed) if (people.has(id)) for (const d of descendants(index, id)) h.add(d);
    return h;
  }, [collapsed, index, people, query]);

  const visible = useMemo(() => [...people.values()].filter((p) => !hidden.has(p.id)), [people, hidden]);

  const posOf = (id: string): Pt => override?.get(id) ?? positions.get(id) ?? { x: PAD, y: PAD };
  /** Card width: being resized → saved custom width → default for the current view. */
  const widthOf = (id: string) => (sizeOverride?.id === id ? sizeOverride.w : people.get(id)?.w ?? m.w);
  const boxOf = (id: string): Box => ({
    ...posOf(id),
    w: widthOf(id),
    h: sizeOverride?.id === id ? sizeOverride.h : heights.get(id) ?? people.get(id)?.h ?? m.h,
  });

  // Measure real card heights so lines start and end exactly at the card edges.
  useLayoutEffect(() => {
    let changed = false;
    const next = new Map(heights);
    for (const [id, el] of cardRefs.current) {
      const h = el.offsetHeight;
      if (h && next.get(id) !== h) {
        next.set(id, h);
        changed = true;
      }
    }
    if (changed) setHeights(next);
  });

  // Linked charts shown inside this one: their own layout, placed under the link card and framed.
  const embedded = useMemo(() => {
    const out: Embedded[] = [];
    for (const card of visible) {
      const chartId = card.linkChart;
      if (!chartId || props.foldedLinks.has(card.id)) continue;
      const data = props.linked[chartId];
      if (!data?.people?.length) continue;
      const map = new Map(data.people.map((q) => [q.id, q as Person]));
      const auto = autoLayout(buildIndex(map), m);
      const raw = data.people.map((q) => ({ q, p: q.x != null && q.y != null ? { x: q.x, y: q.y } : auto.get(q.id) ?? { x: 0, y: 0 } }));
      const minX = Math.min(...raw.map((r) => r.p.x));
      const minY = Math.min(...raw.map((r) => r.p.y));
      const maxX = Math.max(...raw.map((r) => r.p.x + m.w));
      const lb = boxOf(card.id);
      const dx = Math.round(lb.x + lb.w / 2 - (maxX - minX) / 2 - minX);
      const dy = Math.round(lb.y + lb.h + 72 - minY);
      const cards = raw.map(({ q, p }) => ({ key: `${card.id}:${q.id}`, person: q as Person, x: p.x + dx, y: p.y + dy }));
      const boxes = new Map(cards.map((c) => [c.person.id, { x: c.x, y: c.y, w: c.person.w ?? m.w, h: heights.get(c.key) ?? c.person.h ?? m.h }]));
      const all = [...boxes.values()];
      const fx = Math.min(...all.map((b) => b.x)) - 20;
      const fy = Math.min(...all.map((b) => b.y)) - 34;
      const frame = {
        x: fx,
        y: fy,
        w: Math.max(...all.map((b) => b.x + b.w)) + 20 - fx,
        h: Math.max(...all.map((b) => b.y + b.h)) + 24 - fy,
      };
      out.push({ cardId: card.id, chartId, name: data.name, frame, cards, boxes, people: map });
    }
    return out;
  }, [visible, props.linked, props.foldedLinks, positions, override, heights, compact, sizeOverride, people]);

  const embeddedPaths = useMemo(() => {
    const out: string[] = [];
    for (const g of embedded) {
      const bosses = new Map<string, string[]>();
      const roots: Box[] = [];
      for (const q of g.people.values()) {
        const ms = managersOf(q, g.people);
        if (!ms.length) roots.push(g.boxes.get(q.id)!);
        ms.forEach((b) => bosses.set(b, [...(bosses.get(b) ?? []), q.id]));
      }
      for (const [b, ch] of bosses) out.push(...connectorPaths(g.boxes.get(b)!, ch.map((c) => g.boxes.get(c)!)));
      if (roots.length) out.push(...connectorPaths(boxOf(g.cardId), roots, 36));
    }
    return out;
  }, [embedded]);

  const paths = useMemo(() => {
    const out: { d: string; extra: boolean }[] = [];
    // Group visible reporting lines by manager. Main lines share a bus; additional ones are drawn
    // separately (dashed) so they never read as part of another team's bus.
    const main = new Map<string, string[]>();
    const extra = new Map<string, string[]>();
    for (const p of visible) {
      managersOf(p, people).forEach((b, i) => {
        if (hidden.has(b) || (collapsed.has(b) && !query)) return;
        const m = i === 0 ? main : extra;
        m.set(b, [...(m.get(b) ?? []), p.id]);
      });
    }
    for (const [b, ch] of main) for (const d of connectorPaths(boxOf(b), ch.map(boxOf))) out.push({ d, extra: false });
    for (const [b, ch] of extra) for (const c of ch) for (const d of connectorPaths(boxOf(b), [boxOf(c)], 34)) out.push({ d, extra: true });
    return out;
  }, [visible, people, hidden, collapsed, query, positions, override, heights, compact, sizeOverride]);

  // World size: everything plus room to drag further right/down.
  const allAreas = areas.map((a) => (areaOverride && a.id === areaOverride.id ? areaOverride : a));
  let worldW = 800;
  let worldH = 600;
  for (const p of visible) {
    const b = boxOf(p.id);
    worldW = Math.max(worldW, b.x + b.w + 320);
    worldH = Math.max(worldH, b.y + b.h + 240);
  }
  for (const a of allAreas) {
    worldW = Math.max(worldW, a.x + a.w + 320);
    worldH = Math.max(worldH, a.y + a.h + 240);
  }
  for (const g of embedded) {
    worldW = Math.max(worldW, g.frame.x + g.frame.w + 320);
    worldH = Math.max(worldH, g.frame.y + g.frame.h + 240);
  }

  /* ---------- dragging ---------- */
  const toWorld = (e: { clientX: number; clientY: number }): Pt => ({ x: e.clientX / scale, y: e.clientY / scale });

  const onCardDown = (e: RPointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const ids = e.shiftKey && canEdit ? [id, ...descendants(index, id)] : [id];
    const origin = new Map(ids.map((i) => [i, posOf(i)]));
    drag.current = { kind: "card", id, ids, start: toWorld(e), origin, moved: false, el: e.currentTarget };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onAreaDown = (e: RPointerEvent<HTMLElement>, a: Area, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { kind: "area", id: a.id, start: toWorld(e), origin: a, moved: false, el: e.currentTarget, mode };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeDown = (e: RPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || !canEdit) return;
    e.stopPropagation();
    const b = boxOf(id);
    drag.current = { kind: "resize", id, start: toWorld(e), origin: { w: b.w, h: b.h }, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onLinkDown = (e: RPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || !canEdit) return;
    e.stopPropagation();
    const b = boxOf(id);
    drag.current = { kind: "link", id, start: { x: b.x + b.w / 2, y: b.y + b.h }, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const cardUnder = (e: { clientX: number; clientY: number }, except: string) =>
    document
      .elementsFromPoint(e.clientX, e.clientY)
      .map((el) => (el as HTMLElement).closest?.("[data-person]") as HTMLElement | null)
      .find((el) => el && el.dataset.person !== except)?.dataset.person ?? null;

  const worldPoint = (e: { clientX: number; clientY: number }): Pt => {
    const r = worldRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "resize") {
      const w = toWorld(e);
      d.moved = true;
      const clamp = (v: number, min: number) => Math.min(MAX_CARD, Math.max(min, snap(v, m.grid)));
      setSizeOverride({ id: d.id, w: clamp(d.origin.w + w.x - d.start.x, MIN_CARD.w), h: clamp(d.origin.h + w.y - d.start.y, MIN_CARD.h) });
      return;
    }
    if (d.kind === "link") {
      d.moved = true;
      setLinkLine({ from: d.start, to: worldPoint(e) });
      setDropTarget(cardUnder(e, d.id));
      return;
    }
    const w = toWorld(e);
    const dx = w.x - d.start.x;
    const dy = w.y - d.start.y;
    if (!d.moved) {
      if (Math.hypot(dx * scale, dy * scale) < 5 || !canEdit) return;
      d.moved = true;
      props.onDragStart();
    }
    if (d.kind === "card") {
      const next = new Map<string, Pt>();
      for (const [id, o] of d.origin) next.set(id, { x: snap(o.x + dx, m.grid), y: snap(o.y + dy, m.grid) });
      setOverride(next);
      if (d.ids.length === 1) {
        const under = document
          .elementsFromPoint(e.clientX, e.clientY)
          .map((el) => (el as HTMLElement).closest?.("[data-person]") as HTMLElement | null)
          .find((el) => el && el.dataset.person !== d.id);
        setDropTarget(under?.dataset.person ?? null);
      }
    } else {
      const o = d.origin;
      setAreaOverride(
        d.mode === "move"
          ? { ...o, x: snap(o.x + dx, m.grid), y: snap(o.y + dy, m.grid) }
          : { ...o, w: Math.max(80, snap(o.w + dx, m.grid)), h: Math.max(60, snap(o.h + dy, m.grid)) },
      );
    }
  };

  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "resize") {
      if (d.moved && sizeOverride) props.onResize(d.id, sizeOverride.w, sizeOverride.h);
      window.setTimeout(() => setSizeOverride(null), 400);
      return;
    }
    if (d.kind === "link") {
      const target = cardUnder(e, d.id);
      setLinkLine(null);
      setDropTarget(null);
      if (target) props.onLink(d.id, target);
      else if (d.moved) {
        // dropped on empty space: start creating a new subordinate right there
        const p = worldPoint(e);
        props.onLinkToEmpty(d.id, { x: snap(p.x - m.w / 2, m.grid), y: snap(p.y - 16, m.grid) });
      }
      return;
    }
    if (!d.moved) {
      if (d.kind === "card") props.onSelect(d.id, d.el);
      else if (d.mode === "move") props.onAreaSelect(d.id, d.el);
      return;
    }
    if (d.kind === "card") {
      const target = dropTarget;
      setDropTarget(null);
      if (target && d.ids.length === 1) {
        // Swap places with the card it was dropped on. Unrelated cards take their branches along,
        // so each manager keeps their team underneath them.
        const a = d.origin.get(d.id)!;
        const b = positions.get(target) ?? posOf(target);
        const related = descendants(index, d.id).has(target) || descendants(index, target).has(d.id);
        const moves: Move[] = [
          { id: d.id, ...b },
          { id: target, ...a },
        ];
        if (!related) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const shift = (id: string, sx: number, sy: number) => {
            const p = positions.get(id);
            if (p) moves.push({ id, x: Math.max(0, p.x + sx), y: Math.max(0, p.y + sy) });
          };
          for (const id of descendants(index, d.id)) shift(id, dx, dy);
          for (const id of descendants(index, target)) shift(id, -dx, -dy);
        }
        props.onMove(moves);
      } else if (override) {
        props.onMove([...override].map(([id, p]) => ({ id, ...p })));
      }
      // keep the dragged position on screen until the saved one arrives
      window.setTimeout(() => setOverride(null), 400);
    } else if (areaOverride) {
      props.onAreaChange(areaOverride);
      window.setTimeout(() => setAreaOverride(null), 400);
    }
    void e;
  };

  // A new snapshot with the saved positions makes the temporary ones unnecessary.
  useEffect(() => {
    if (!drag.current) setOverride(null);
  }, [positions]);

  return (
    <div className="world-size" style={{ width: worldW * scale, height: worldH * scale }}>
      <div
        ref={worldRef}
        className={"world" + (compact ? " compact" : "") + (canEdit ? " editable" : "") + (query ? " searching" : "")}
        style={{ width: worldW, height: worldH, transform: `scale(${scale})` }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {allAreas.map((a) => (
          <div
            key={a.id}
            className={`area ${a.shape} ${a.tone}` + (a.id === selectedAreaId ? " selected" : "")}
            style={{ left: a.x, top: a.y, width: a.w, height: a.h }}
          >
            <span
              className="area-label area-grip"
              data-area={a.id}
              role="button"
              tabIndex={0}
              title={canEdit ? "Перетягніть, щоб перемістити; клікніть, щоб змінити" : undefined}
              onPointerDown={(e) => onAreaDown(e, a, "move")}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && props.onAreaSelect(a.id, e.currentTarget)}
            >
              {a.label || (canEdit ? "Без назви" : "")}
            </span>
          </div>
        ))}

        {embedded.map((g) => (
          <div key={g.cardId} className="embed-frame" style={{ left: g.frame.x, top: g.frame.y, width: g.frame.w, height: g.frame.h }}>
            <button type="button" className="embed-label" onClick={() => props.onOpenChart(g.chartId)} title="Відкрити цю структуру">
              ↗ {g.name || "Пов'язана структура"}
            </button>
          </div>
        ))}

        <svg className="links" width={worldW} height={worldH} aria-hidden="true">
          {paths.map((p, i) => (
            <path key={i} d={p.d} />
          ))}
          {embeddedPaths.map((d, i) => (
            <path key={"e" + i} d={d} className="embedded" />
          ))}
          {linkLine && (
            <path className="link-preview" d={`M${linkLine.from.x},${linkLine.from.y}L${linkLine.to.x},${linkLine.to.y}`} />
          )}
        </svg>

        {visible.map((p) => {
          const pos = posOf(p.id);
          const dragging = override?.has(p.id);
          const cls = [
            "card",
            p.linkChart ? "link-card" : p.role,
            p.color && !p.linkChart && "custom",
            (p.h || sizeOverride?.id === p.id) && "sized",
            compact && "compact",
            p.id === selectedId && "selected",
            matches(p, query) && "hit",
            dragging && "dragging",
            p.id === dropTarget && "drop-target",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={p.id}
              ref={(el) => {
                if (el) cardRefs.current.set(p.id, el);
                else cardRefs.current.delete(p.id);
              }}
              className={cls}
              style={{
                ...dcStyle(p),
                left: pos.x,
                top: pos.y,
                width: widthOf(p.id),
                ...(sizeOverride?.id === p.id ? { height: sizeOverride.h } : p.h ? { height: p.h } : {}),
                fontSize:
                  sizeOverride?.id === p.id
                    ? fontSizeFor(sizeOverride.w, sizeOverride.h, m)
                    : fontSizeFor(p.w, p.h, m),
              }}
              role="button"
              tabIndex={0}
              data-person={p.id}
              aria-haspopup="dialog"
              aria-label={`${p.name}, ${p.title}`}
              title={compact ? [p.name, p.title, ROLES[p.role].label].filter(Boolean).join("\n") : undefined}
              onPointerDown={(e) => onCardDown(e, p.id)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  props.onSelect(p.id, e.currentTarget);
                }
              }}
            >
              {p.linkChart ? (
                <LinkCardBody
                  card={p}
                  data={props.linked[p.linkChart]}
                  folded={props.foldedLinks.has(p.id)}
                  compact={compact}
                  onOpen={() => props.onOpenChart(p.linkChart!)}
                  onToggle={() => props.onToggleLink(p.id)}
                />
              ) : (
              <>
              {!compact && (
                <div className="dept">
                  <i />
                  {p.dept || "Без підрозділу"}
                </div>
              )}
              <div className="name">
                {compact && <i className="dot" />}
                {p.name}
              </div>
              {!compact && p.title && <div className="title">{p.title}</div>}
              {!compact && (
                <div className="card-foot">
                  <span className="badge">{ROLES[p.role].label}</span>
                  {p.functions.length > 0 && (
                    <span className="fn-count" title={p.functions.join("\n")}>
                      {p.functions.length} {plural(p.functions.length, "функція", "функції", "функцій")}
                    </span>
                  )}
                </div>
              )}
              </>
              )}
              {canEdit && !p.linkChart && (
                <button
                  className="add"
                  type="button"
                  title="Додати підлеглого"
                  aria-label={`Додати підлеглого для ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onAdd(p.id);
                  }}
                >
                  +
                </button>
              )}
              {canEdit && !p.linkChart && (
                <span
                  className="link-handle"
                  title="Протягніть до картки підлеглого, щоб додати підпорядкування"
                  aria-hidden="true"
                  onPointerDown={(e) => onLinkDown(e, p.id)}
                />
              )}
              {canEdit && (
                <span
                  className="card-resize"
                  title="Потягніть, щоб змінити розмір картки"
                  aria-hidden="true"
                  onPointerDown={(e) => onResizeDown(e, p.id)}
                />
              )}
            </div>
          );
        })}

        {/* cards of linked charts: live, read-only here */}
        {embedded.flatMap((g) =>
          g.cards.map(({ key, person: q, x, y }) => (
            <div
              key={key}
              ref={(el) => {
                if (el) cardRefs.current.set(key, el);
                else cardRefs.current.delete(key);
              }}
              className={["card", "embedded", q.linkChart ? "link-card" : q.role, q.color && !q.linkChart && "custom", q.h && "sized", compact && "compact", matches(q, query) && "hit"].filter(Boolean).join(" ")}
              style={{ ...dcStyle(q), left: x, top: y, width: q.w ?? m.w, ...(q.h ? { height: q.h } : {}), fontSize: fontSizeFor(q.w, q.h, m) }}
              role="button"
              tabIndex={0}
              data-embedded={key}
              aria-label={`${q.name}, ${q.title} (структура «${g.name}»)`}
              title={compact ? [q.name, q.title].filter(Boolean).join("\n") : undefined}
              onClick={(e) => (q.linkChart ? props.onOpenChart(q.linkChart) : props.onSelectEmbedded(g.chartId, q.id, e.currentTarget))}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && props.onSelectEmbedded(g.chartId, q.id, e.currentTarget)}
            >
              {q.linkChart ? (
                <div className="name">↗ {q.name}</div>
              ) : (
                <>
                  {!compact && (
                    <div className="dept">
                      <i />
                      {q.dept || "Без підрозділу"}
                    </div>
                  )}
                  <div className="name">
                    {compact && <i className="dot" />}
                    {q.name}
                  </div>
                  {!compact && q.title && <div className="title">{q.title}</div>}
                  {!compact && (
                    <div className="card-foot">
                      <span className="badge">{ROLES[q.role].label}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )),
        )}

        {/* resize handles sit above the cards so they can always be grabbed */}
        {canEdit &&
          allAreas.map((a) => {
            const k = a.shape === "ellipse" ? 0.8536 : 1; // point on the ellipse at 45°
            return (
              <span
                key={a.id}
                className="area-resize"
                title="Змінити розмір"
                style={{ left: a.x + a.w * k - 18, top: a.y + a.h * k - 18 }}
                onPointerDown={(e) => onAreaDown(e, a, "resize")}
              />
            );
          })}
      </div>
    </div>
  );
}

/** Content of a card that stands for another chart. */
function LinkCardBody({
  card,
  data,
  folded,
  compact,
  onOpen,
  onToggle,
}: {
  card: Person;
  data: LinkedChart | undefined;
  folded: boolean;
  compact: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const n = data?.people?.length ?? 0;
  const status = !data
    ? "Завантаження…"
    : data.denied
      ? "Немає доступу"
      : data.missing
        ? "Структуру видалено"
        : data.people
          ? `${n} ${plural(n, "картка", "картки", "карток")}`
          : "Завантаження…";
  const usable = data && !data.denied && !data.missing;
  return (
    <>
      {!compact && <div className="dept">Пов'язана структура</div>}
      <div className="name">↗ {data?.name || card.name}</div>
      {!compact && <div className="title">{status}</div>}
      {usable && (
        <div className="link-actions">
          <button type="button" className="chip" onClick={(e) => (e.stopPropagation(), onOpen())}>Відкрити</button>
          {n > 0 && (
            <button type="button" className="chip" onClick={(e) => (e.stopPropagation(), onToggle())}>
              {folded ? "Показати" : "Сховати"}
            </button>
          )}
        </div>
      )}
    </>
  );
}
