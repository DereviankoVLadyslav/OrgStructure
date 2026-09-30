import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { ROLES, deptColor, descendantCount, descendants, kids, plural, type Area, type OrgIndex, type Person } from "../lib/org";
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
}

type Drag =
  | { kind: "card"; id: string; ids: string[]; start: Pt; origin: Map<string, Pt>; moved: boolean; el: HTMLElement }
  | { kind: "area"; id: string; start: Pt; origin: Area; moved: boolean; el: HTMLElement; mode: "move" | "resize" };

const dcStyle = (p: Person) => ({ "--dc": deptColor(p.dept) }) as CSSProperties;

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
  const drag = useRef<Drag | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  // Hidden = inside a collapsed branch (search shows everything).
  const hidden = useMemo(() => {
    const h = new Set<string>();
    if (query) return h;
    for (const id of collapsed) if (people.has(id)) for (const d of descendants(index, id)) h.add(d);
    return h;
  }, [collapsed, index, people, query]);

  const visible = useMemo(() => [...people.values()].filter((p) => !hidden.has(p.id)), [people, hidden]);

  const posOf = (id: string): Pt => override?.get(id) ?? positions.get(id) ?? { x: PAD, y: PAD };
  const boxOf = (id: string): Box => ({ ...posOf(id), w: m.w, h: heights.get(id) ?? m.h });

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

  const paths = useMemo(() => {
    const out: string[] = [];
    for (const p of visible) {
      if (collapsed.has(p.id) && !query) continue;
      const ch = kids(index, p.id).filter((c) => !hidden.has(c.id));
      if (ch.length) out.push(...connectorPaths(boxOf(p.id), ch.map((c) => boxOf(c.id))));
    }
    return out;
  }, [visible, index, hidden, collapsed, query, positions, override, heights, compact]);

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

  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
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

        <svg className="links" width={worldW} height={worldH} aria-hidden="true">
          {paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>

        {visible.map((p) => {
          const pos = posOf(p.id);
          const children = kids(index, p.id);
          const isCollapsed = collapsed.has(p.id) && !query;
          const dragging = override?.has(p.id);
          const cls = [
            "card",
            p.role,
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
              style={{ ...dcStyle(p), left: pos.x, top: pos.y, width: m.w }}
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
              {canEdit && (
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
              {children.length > 0 && (
                <button
                  className="fold"
                  type="button"
                  aria-label={isCollapsed ? "Розгорнути" : "Згорнути"}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onToggle(p.id);
                  }}
                >
                  {isCollapsed ? "+" : "−"} {descendantCount(index, p.id)}
                </button>
              )}
            </div>
          );
        })}

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
