import { useCallback, useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type Firestore,
  type Timestamp,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { cleanArea, cleanCoord, cleanFunctions, cleanIds, cleanLink, isRole, type Area, type OrgData, type Person } from "./org";

export interface StoredPerson extends Person {
  updatedBy?: string;
  updatedAt?: Timestamp | null;
}

export const BATCH_LIMIT = 450; // Firestore allows 500 writes per batch

export function toPerson(id: string, d: Record<string, unknown>): StoredPerson {
  return {
    id,
    name: typeof d.name === "string" ? d.name : "",
    title: typeof d.title === "string" ? d.title : "",
    dept: typeof d.dept === "string" ? d.dept : "",
    role: isRole(d.role) ? d.role : "staff",
    managerId: typeof d.managerId === "string" ? d.managerId : null,
    alsoReportsTo: cleanIds(d.alsoReportsTo),
    functions: cleanFunctions(d.functions),
    x: cleanCoord(d.x),
    y: cleanCoord(d.y),
    linkChart: cleanLink(d.linkChart),
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : undefined,
    updatedAt: (d.updatedAt as Timestamp | undefined) ?? null,
  };
}

export const cleanPerson = (p: Person) => ({
  id: p.id,
  name: p.name,
  title: p.title,
  dept: p.dept,
  role: p.role,
  managerId: p.managerId,
  alsoReportsTo: cleanIds(p.alsoReportsTo).filter((m) => m !== p.id && m !== p.managerId),
  functions: cleanFunctions(p.functions),
  x: cleanCoord(p.x),
  y: cleanCoord(p.y),
  linkChart: cleanLink(p.linkChart),
});

export type Op = (b: WriteBatch) => void;

/** Runs any number of writes in batches of at most BATCH_LIMIT. */
export async function runOps(firestore: Firestore, ops: Op[]) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const b = writeBatch(firestore);
    ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(b));
    await b.commit();
  }
}

export interface Move {
  id: string;
  x: number;
  y: number;
}

/**
 * One live, shared org chart stored in Firestore:
 *   charts/{chartId}                — { name, compact, created…, updated… }
 *   charts/{chartId}/people/{id}    — one document per person
 *   charts/{chartId}/areas/{id}     — background areas
 * Every change made by anyone appears for everyone within about a second.
 */
export function useOrg(chartId: string, editorEmail: string) {
  const [people, setPeople] = useState<StoredPerson[] | null>(null);
  const [company, setCompanyName] = useState("");
  const [compact, setCompactState] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    setPeople(null);
    setAreas([]);
    setMissing(false);
    const unsubPeople = onSnapshot(
      collection(db, "charts", chartId, "people"),
      (snap) => {
        setPeople(snap.docs.map((d) => toPerson(d.id, d.data())));
        setError(null);
      },
      () => setError("Втрачено доступ до структури. Оновіть сторінку."),
    );
    const unsubChart = onSnapshot(
      doc(db, "charts", chartId),
      (snap) => {
        if (!snap.exists() && !snap.metadata.fromCache) setMissing(true);
        setCompanyName((snap.data()?.name as string) || "");
        setCompactState(snap.data()?.compact === true);
      },
      () => {},
    );
    const unsubAreas = onSnapshot(
      collection(db, "charts", chartId, "areas"),
      (snap) => setAreas(snap.docs.map((d) => cleanArea({ ...d.data(), id: d.id })).filter(Boolean) as Area[]),
      () => {},
    );
    return () => {
      unsubPeople();
      unsubChart();
      unsubAreas();
    };
  }, [chartId]);

  const stamp = useCallback(() => ({ updatedBy: editorEmail, updatedAt: serverTimestamp() }), [editorEmail]);

  const personRef = useCallback((firestore: Firestore, id: string) => doc(firestore, "charts", chartId, "people", id), [chartId]);
  const areaRef = useCallback((firestore: Firestore, id: string) => doc(firestore, "charts", chartId, "areas", id), [chartId]);
  /** Marks the chart as changed, so the home page shows who edited it last and when. */
  const touch = useCallback(
    (firestore: Firestore): Op => (b) => b.set(doc(firestore, "charts", chartId), stamp(), { merge: true }),
    [chartId, stamp],
  );

  const upsert = useCallback(
    async (p: Person) => {
      const f = db;
      if (!f) return;
      await runOps(f, [(b) => b.set(personRef(f, p.id), { ...cleanPerson(p), ...stamp() }), touch(f)]);
    },
    [personRef, stamp, touch],
  );

  /** Removes a person and saves the people whose reporting lines changed because of it. One batch. */
  const remove = useCallback(
    async (id: string, updated: Person[]) => {
      const f = db;
      if (!f) return;
      await runOps(f, [
        ...updated.map((c): Op => (b) => b.set(personRef(f, c.id), { ...cleanPerson(c), ...stamp() })),
        (b) => b.delete(personRef(f, id)),
        touch(f),
      ]);
    },
    [personRef, stamp, touch],
  );

  const setCompany = useCallback(
    async (name: string) => {
      const f = db;
      if (!f) return;
      await runOps(f, [(b) => b.set(doc(f, "charts", chartId), { name, ...stamp() }, { merge: true })]);
    },
    [chartId, stamp],
  );

  const setCompact = useCallback(
    async (value: boolean) => {
      const f = db;
      if (!f) return;
      await runOps(f, [(b) => b.set(doc(f, "charts", chartId), { compact: value, ...stamp() }, { merge: true })]);
    },
    [chartId, stamp],
  );

  /** Saves new canvas positions for several people at once (drag, swap, auto-arrange). */
  const move = useCallback(
    async (moves: Move[]) => {
      const f = db;
      if (!f || !people || !moves.length) return;
      const byId = new Map(people.map((p) => [p.id, p]));
      const ops: Op[] = moves
        .filter((m) => byId.has(m.id))
        .map((m) => (b) => b.set(personRef(f, m.id), { ...cleanPerson({ ...byId.get(m.id)!, x: m.x, y: m.y }), ...stamp() }));
      await runOps(f, [...ops, touch(f)]);
    },
    [people, personRef, stamp, touch],
  );

  const upsertArea = useCallback(
    async (a: Area) => {
      const f = db;
      if (!f) return;
      await runOps(f, [(b) => b.set(areaRef(f, a.id), cleanArea(a)!), touch(f)]);
    },
    [areaRef, touch],
  );

  const removeArea = useCallback(
    async (id: string) => {
      const f = db;
      if (!f) return;
      await runOps(f, [(b) => b.delete(areaRef(f, id)), touch(f)]);
    },
    [areaRef, touch],
  );

  /** Replaces the whole structure (used by «Імпорт»). */
  const replaceAll = useCallback(
    async (next: OrgData) => {
      const f = db;
      if (!f) return;
      const existing = await getDocs(collection(f, "charts", chartId, "people"));
      const keep = new Set(next.people.map((p) => p.id));
      const ops: Op[] = [];
      existing.docs.forEach((d) => {
        if (!keep.has(d.id)) ops.push((b) => b.delete(d.ref));
      });
      next.people.forEach((p) => ops.push((b) => b.set(personRef(f, p.id), { ...cleanPerson(p), ...stamp() })));
      const existingAreas = await getDocs(collection(f, "charts", chartId, "areas"));
      existingAreas.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
      (next.areas ?? []).forEach((a) => ops.push((b) => b.set(areaRef(f, a.id), cleanArea(a)!)));
      ops.push((b) =>
        b.set(doc(f, "charts", chartId), { name: next.company.slice(0, 80) || "Структура", compact: next.compact === true, ...stamp() }, { merge: true }),
      );
      await runOps(f, ops);
    },
    [chartId, personRef, areaRef, stamp],
  );

  return { people, company, compact, areas, missing, error, upsert, remove, setCompany, setCompact, move, upsertArea, removeArea, replaceAll };
}
