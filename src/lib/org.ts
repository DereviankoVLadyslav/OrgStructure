export type Role = "director" | "deputy" | "head" | "staff";

export interface Person {
  id: string;
  name: string;
  title: string;
  dept: string;
  role: Role;
  managerId: string | null;
  /** Additional managers the person also reports to (the main one is managerId). */
  alsoReportsTo: string[];
  /** Duties / responsibilities of the person, in display order. */
  functions: string[];
  /** Position on the canvas (top-left corner). null = placed automatically. */
  x: number | null;
  y: number | null;
  /** When set, this card is a live link to another chart (its id) instead of a person. */
  linkChart?: string | null;
}

export type AreaShape = "rect" | "ellipse";
export type AreaTone = "soft" | "strong";

/** A labelled background zone on the canvas (e.g. «Front office») or a title banner. */
export interface Area {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: AreaShape;
  tone: AreaTone;
}

export interface OrgData {
  company: string;
  compact?: boolean;
  people: Person[];
  areas?: Area[];
}

export const ROLES: Record<Role, { label: string; rank: number }> = {
  director: { label: "Керівник компанії", rank: 0 },
  deputy: { label: "Заступник", rank: 1 },
  head: { label: "Начальник підрозділу", rank: 2 },
  staff: { label: "Співробітник", rank: 3 },
};

export const ROLE_ORDER: Role[] = ["director", "head", "deputy", "staff"];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && v in ROLES;
}

export interface OrgIndex {
  byManager: Map<string | null, Person[]>;
  parentOf: Map<string, string | null>;
}

/** Groups people by their manager, turning broken links and cycles into top-level nodes. */
export function buildIndex(people: Map<string, Person>): OrgIndex {
  const byManager = new Map<string | null, Person[]>();
  const parentOf = new Map<string, string | null>();

  for (const p of people.values()) {
    let m: string | null =
      p.managerId && p.managerId !== p.id && people.has(p.managerId) ? p.managerId : null;
    if (m) {
      let cur: string | null = m;
      let steps = 0;
      while (cur && steps <= people.size) {
        if (cur === p.id) {
          m = null;
          break;
        }
        const next: string | null = people.get(cur)?.managerId ?? null;
        cur = next && people.has(next) ? next : null;
        steps++;
      }
    }
    parentOf.set(p.id, m);
    const list = byManager.get(m) ?? [];
    list.push(p);
    byManager.set(m, list);
  }

  for (const list of byManager.values()) {
    list.sort(
      (a, b) =>
        ROLES[a.role].rank - ROLES[b.role].rank ||
        a.dept.localeCompare(b.dept, "uk") ||
        a.name.localeCompare(b.name, "uk"),
    );
  }
  return { byManager, parentOf };
}

export const kids = (idx: OrgIndex, id: string | null) => idx.byManager.get(id) ?? [];

export function descendantCount(idx: OrgIndex, id: string): number {
  let n = 0;
  for (const k of kids(idx, id)) n += 1 + descendantCount(idx, k.id);
  return n;
}

export function descendants(idx: OrgIndex, id: string, out = new Set<string>()): Set<string> {
  for (const k of kids(idx, id)) {
    out.add(k.id);
    descendants(idx, k.id, out);
  }
  return out;
}

export function ancestors(idx: OrgIndex, id: string): string[] {
  const chain: string[] = [];
  let cur = idx.parentOf.get(id) ?? null;
  while (cur) {
    chain.unshift(cur);
    cur = idx.parentOf.get(cur) ?? null;
  }
  return chain;
}

export function deptColor(dept: string): string {
  if (!dept) return "var(--line)";
  let h = 0;
  for (const ch of dept) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--d${h % 8})`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Validates an imported JSON file and returns clean data, or throws with a readable message. */
export function parseOrgData(raw: unknown): OrgData {
  if (!raw || typeof raw !== "object") throw new Error("Файл не містить структури компанії.");
  const obj = raw as { company?: unknown; people?: unknown };
  if (!Array.isArray(obj.people)) throw new Error("У файлі немає списку «people».");
  const people: Person[] = obj.people.map((r, i) => {
    const p = r as Record<string, unknown>;
    if (typeof p.id !== "string" || typeof p.name !== "string")
      throw new Error(`Запис №${i + 1} не має поля id або name.`);
    return {
      id: p.id,
      name: p.name,
      title: typeof p.title === "string" ? p.title : "",
      dept: typeof p.dept === "string" ? p.dept : "",
      role: isRole(p.role) ? p.role : "staff",
      managerId: typeof p.managerId === "string" ? p.managerId : null,
      alsoReportsTo: cleanIds(p.alsoReportsTo),
      functions: cleanFunctions(p.functions),
      x: cleanCoord(p.x),
      y: cleanCoord(p.y),
      linkChart: cleanLink(p.linkChart),
    };
  });
  const areas = Array.isArray((obj as { areas?: unknown }).areas)
    ? ((obj as { areas: unknown[] }).areas.map(cleanArea).filter(Boolean) as Area[])
    : [];
  return {
    company: typeof obj.company === "string" ? obj.company : "Компанія",
    compact: (obj as { compact?: unknown }).compact === true,
    people,
    areas,
  };
}

export const MAX_FUNCTIONS = 50;
export const MAX_FUNCTION_LENGTH = 200;

/** Keeps only non-empty strings, trimmed and within the limits the database accepts. */
export function cleanFunctions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().slice(0, MAX_FUNCTION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_FUNCTIONS);
}

export const MAX_COORD = 100000;

export function cleanCoord(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_COORD, Math.max(0, Math.round(v))) : null;
}

export function cleanArea(v: unknown): Area | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== "string") return null;
  const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : d);
  return {
    id: a.id,
    label: typeof a.label === "string" ? a.label.slice(0, 120) : "",
    x: Math.max(0, n(a.x, 0)),
    y: Math.max(0, n(a.y, 0)),
    w: Math.min(20000, Math.max(40, n(a.w, 400))),
    h: Math.min(20000, Math.max(40, n(a.h, 240))),
    shape: a.shape === "ellipse" ? "ellipse" : "rect",
    tone: a.tone === "strong" ? "strong" : "soft",
  };
}

export const MAX_EXTRA_MANAGERS = 20;

export function cleanIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 100))].slice(0, MAX_EXTRA_MANAGERS);
}

/** Every manager of a person that still exists: the main one first, then the additional ones. */
export function managersOf(p: Person, people: Map<string, Person>): string[] {
  const out: string[] = [];
  if (p.managerId && p.managerId !== p.id && people.has(p.managerId)) out.push(p.managerId);
  for (const m of p.alsoReportsTo) if (m !== p.id && people.has(m) && !out.includes(m)) out.push(m);
  return out;
}

/** Direct reports of a manager, counting both main and additional reporting lines. */
export function reportsOf(id: string, people: Map<string, Person>): Person[] {
  return [...people.values()].filter((p) => managersOf(p, people).includes(id));
}

/**
 * True when making `subId` report to `managerId` would create a loop
 * (the manager already reports, directly or indirectly, to that person).
 */
export function wouldCycle(managerId: string, subId: string, people: Map<string, Person>): boolean {
  if (managerId === subId) return true;
  const seen = new Set<string>();
  const stack = [managerId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === subId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const p = people.get(cur);
    if (p) stack.push(...managersOf(p, people));
  }
  return false;
}

export function cleanLink(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null;
}

export const isLink = (p: Person) => !!p.linkChart;
