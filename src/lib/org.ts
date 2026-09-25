export type Role = "director" | "deputy" | "head" | "staff";

export interface Person {
  id: string;
  name: string;
  title: string;
  dept: string;
  role: Role;
  managerId: string | null;
}

export interface OrgData {
  company: string;
  people: Person[];
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
    };
  });
  return { company: typeof obj.company === "string" ? obj.company : "Компанія", people };
}
