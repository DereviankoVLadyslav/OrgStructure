import { kids, type OrgIndex, type Person } from "./org";

export interface Pt {
  x: number;
  y: number;
}
export interface Box extends Pt {
  w: number;
  h: number;
}

export interface Metrics {
  /** card width */
  w: number;
  /** height used for placement before the real height is measured */
  h: number;
  /** horizontal gap between neighbouring subtrees */
  gap: number;
  /** vertical distance between rows */
  row: number;
  /** snapping grid */
  grid: number;
}

export const NORMAL: Metrics = { w: 200, h: 112, gap: 24, row: 172, grid: 8 };
export const COMPACT: Metrics = { w: 112, h: 46, gap: 16, row: 96, grid: 8 };

export const PAD = 40;

export const snap = (v: number, grid: number) => Math.max(0, Math.round(v / grid) * grid);

/**
 * Classic top-down tree layout: every parent is centred over its children,
 * subtrees sit side by side. Used for people who have no saved position yet.
 */
export function autoLayout(index: OrgIndex, m: Metrics): Map<string, Pt> {
  const pos = new Map<string, Pt>();

  const place = (p: Person, depth: number, left: number): number => {
    const children = kids(index, p.id);
    const y = PAD + depth * m.row;
    if (!children.length) {
      pos.set(p.id, { x: left, y });
      return m.w;
    }
    let cur = left;
    for (const c of children) cur += place(c, depth + 1, cur) + m.gap;
    const total = cur - m.gap - left;
    const shift = total < m.w ? (m.w - total) / 2 : 0;
    if (shift) for (const id of subtreeIds(index, p.id)) {
      const q = pos.get(id)!;
      pos.set(id, { x: q.x + shift, y: q.y });
    }
    const first = pos.get(children[0].id)!;
    const last = pos.get(children[children.length - 1].id)!;
    pos.set(p.id, { x: (first.x + last.x) / 2, y });
    return Math.max(m.w, total);
  };

  let left = PAD;
  for (const r of kids(index, null)) left += place(r, 0, left) + m.gap * 3;

  for (const [id, p] of pos) pos.set(id, { x: snap(p.x, m.grid), y: snap(p.y, m.grid) });
  return pos;
}

function subtreeIds(index: OrgIndex, id: string): string[] {
  const out: string[] = [];
  for (const k of kids(index, id)) out.push(k.id, ...subtreeIds(index, k.id));
  return out;
}

const overlaps = (a: Box, b: Box, margin = 8) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;

/** First free spot under the manager (or at the top when there is none) for a newly added person. */
export function freeSpot(managerBox: Box | null, taken: Box[], m: Metrics): Pt {
  const y = managerBox ? managerBox.y + m.row : PAD;
  const startX = managerBox ? managerBox.x : PAD;
  for (let i = 0; i < 200; i++) {
    const x = startX + i * (m.w + m.gap);
    const cand = { x, y, w: m.w, h: m.h };
    if (!taken.some((t) => overlaps(cand, t))) return { x: snap(x, m.grid), y: snap(y, m.grid) };
  }
  return { x: snap(startX, m.grid), y: snap(y + m.row, m.grid) };
}

/**
 * Orthogonal connector paths from a manager to their direct reports.
 * Reports below the manager share one horizontal "bus" (like a classic org chart);
 * reports beside or above get their own elbow line.
 */
export function connectorPaths(parent: Box, children: Box[]): string[] {
  const out: string[] = [];
  const px = parent.x + parent.w / 2;
  const pBottom = parent.y + parent.h;
  const below = children.filter((c) => c.y >= pBottom + 12);
  const other = children.filter((c) => c.y < pBottom + 12);

  if (below.length) {
    const minTop = Math.min(...below.map((c) => c.y));
    const busY = Math.round(pBottom + Math.min(22, (minTop - pBottom) / 2));
    const xs = below.map((c) => c.x + c.w / 2);
    const lo = Math.min(px, ...xs);
    const hi = Math.max(px, ...xs);
    let d = `M${px},${pBottom}V${busY}`;
    if (hi - lo > 0.5) d += `M${lo},${busY}H${hi}`;
    for (const c of below) d += `M${c.x + c.w / 2},${busY}V${c.y}`;
    out.push(d);
  }

  for (const c of other) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const py = parent.y + parent.h / 2;
    if (c.x >= parent.x + parent.w) {
      const mid = Math.round((parent.x + parent.w + c.x) / 2);
      out.push(`M${parent.x + parent.w},${py}H${mid}V${cy}H${c.x}`);
    } else if (c.x + c.w <= parent.x) {
      const mid = Math.round((c.x + c.w + parent.x) / 2);
      out.push(`M${parent.x},${py}H${mid}V${cy}H${c.x + c.w}`);
    } else {
      // above and overlapping horizontally
      const mid = Math.round((c.y + c.h + parent.y) / 2);
      out.push(`M${px},${parent.y}V${mid}H${cx}V${c.y + c.h}`);
    }
  }
  return out;
}
