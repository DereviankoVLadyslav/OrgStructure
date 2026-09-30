import { useCallback, useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { cleanArea, cleanCoord, cleanFunctions, cleanIds, isRole, type Area, type OrgData, type Person } from "./org";

export interface StoredPerson extends Person {
  updatedBy?: string;
  updatedAt?: Timestamp | null;
}

const BATCH_LIMIT = 450; // Firestore allows 500 writes per batch

function toPerson(id: string, d: Record<string, unknown>): StoredPerson {
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
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : undefined,
    updatedAt: (d.updatedAt as Timestamp | undefined) ?? null,
  };
}

const clean = (p: Person) => ({
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
});

export interface Move {
  id: string;
  x: number;
  y: number;
}

/**
 * Live, shared org chart stored in Firestore:
 *   people/{id}   — one document per person
 *   meta/company  — { name }
 * Every change made by anyone appears for everyone within about a second.
 */
export function useOrg(enabled: boolean, editorEmail: string) {
  const [people, setPeople] = useState<StoredPerson[] | null>(null);
  const [company, setCompanyName] = useState("Компанія");
  const [compact, setCompactState] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !db) return;
    const unsubPeople = onSnapshot(
      collection(db, "people"),
      (snap) => {
        setPeople(snap.docs.map((d) => toPerson(d.id, d.data())));
        setError(null);
      },
      () => setError("Втрачено доступ до структури. Оновіть сторінку."),
    );
    const unsubCompany = onSnapshot(
      doc(db, "meta", "company"),
      (snap) => {
        setCompanyName((snap.data()?.name as string) || "Компанія");
        setCompactState(snap.data()?.compact === true);
      },
      () => {},
    );
    const unsubAreas = onSnapshot(
      collection(db, "areas"),
      (snap) => setAreas(snap.docs.map((d) => cleanArea({ ...d.data(), id: d.id })).filter(Boolean) as Area[]),
      () => {},
    );
    return () => {
      unsubPeople();
      unsubCompany();
      unsubAreas();
    };
  }, [enabled]);

  const stamp = useCallback(() => ({ updatedBy: editorEmail, updatedAt: serverTimestamp() }), [editorEmail]);

  const upsert = useCallback(
    async (p: Person) => {
      if (!db) return;
      await setDoc(doc(db, "people", p.id), { ...clean(p), ...stamp() });
    },
    [stamp],
  );

  /** Removes a person; their direct reports move up to the removed person's manager. One atomic batch. */
  const remove = useCallback(
    async (id: string, updated: Person[]) => {
      if (!db) return;
      const batch = writeBatch(db);
      for (const c of updated) batch.set(doc(db, "people", c.id), { ...clean(c), ...stamp() });
      batch.delete(doc(db, "people", id));
      await batch.commit();
    },
    [stamp],
  );

  const setCompany = useCallback(async (name: string) => {
    if (!db) return;
    await setDoc(doc(db, "meta", "company"), { name }, { merge: true });
  }, []);

  const setCompact = useCallback(
    async (value: boolean) => {
      if (!db) return;
      await setDoc(doc(db, "meta", "company"), { name: company, compact: value }, { merge: true });
    },
    [company],
  );

  /** Saves new canvas positions for several people at once (drag, swap, auto-arrange). */
  const move = useCallback(
    async (moves: Move[]) => {
      const firestore = db;
      if (!firestore || !people || !moves.length) return;
      const byId = new Map(people.map((p) => [p.id, p]));
      const ops = moves
        .filter((m) => byId.has(m.id))
        .map((m) => (b: ReturnType<typeof writeBatch>) =>
          b.set(doc(firestore, "people", m.id), { ...clean({ ...byId.get(m.id)!, x: m.x, y: m.y }), ...stamp() }),
        );
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const b = writeBatch(firestore);
        ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(b));
        await b.commit();
      }
    },
    [people, stamp],
  );

  const upsertArea = useCallback(async (a: Area) => {
    if (!db) return;
    const c = cleanArea(a)!;
    await setDoc(doc(db, "areas", c.id), c);
  }, []);

  const removeArea = useCallback(async (id: string) => {
    if (!db) return;
    await deleteDoc(doc(db, "areas", id));
  }, []);

  /** Replaces the whole structure (used by «Імпорт»). */
  const replaceAll = useCallback(
    async (next: OrgData) => {
      const firestore = db;
      if (!firestore) return;
      const existing = await getDocs(collection(firestore, "people"));
      const keep = new Set(next.people.map((p) => p.id));
      const ops: ((b: ReturnType<typeof writeBatch>) => void)[] = [];
      existing.docs.forEach((d) => {
        if (!keep.has(d.id)) ops.push((b) => b.delete(d.ref));
      });
      next.people.forEach((p) => ops.push((b) => b.set(doc(firestore, "people", p.id), { ...clean(p), ...stamp() })));
      const existingAreas = await getDocs(collection(firestore, "areas"));
      existingAreas.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
      (next.areas ?? []).forEach((a) => ops.push((b) => b.set(doc(firestore, "areas", a.id), cleanArea(a)!)));
      ops.push((b) => b.set(doc(firestore, "meta", "company"), { name: next.company, compact: next.compact === true }));
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const b = writeBatch(firestore);
        ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(b));
        await b.commit();
      }
    },
    [stamp],
  );

  return { people, company, compact, areas, error, upsert, remove, setCompany, setCompact, move, upsertArea, removeArea, replaceAll };
}
