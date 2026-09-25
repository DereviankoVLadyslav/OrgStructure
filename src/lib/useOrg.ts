import { useCallback, useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { cleanFunctions, isRole, type OrgData, type Person } from "./org";

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
    functions: cleanFunctions(d.functions),
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
  functions: cleanFunctions(p.functions),
});

/**
 * Live, shared org chart stored in Firestore:
 *   people/{id}   — one document per person
 *   meta/company  — { name }
 * Every change made by anyone appears for everyone within about a second.
 */
export function useOrg(enabled: boolean, editorEmail: string) {
  const [people, setPeople] = useState<StoredPerson[] | null>(null);
  const [company, setCompanyName] = useState("Компанія");
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
      (snap) => setCompanyName((snap.data()?.name as string) || "Компанія"),
      () => {},
    );
    return () => {
      unsubPeople();
      unsubCompany();
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
    async (id: string, newManager: string | null, directReports: Person[]) => {
      if (!db) return;
      const batch = writeBatch(db);
      for (const c of directReports) batch.set(doc(db, "people", c.id), { ...clean({ ...c, managerId: newManager }), ...stamp() });
      batch.delete(doc(db, "people", id));
      await batch.commit();
    },
    [stamp],
  );

  const setCompany = useCallback(async (name: string) => {
    if (!db) return;
    await setDoc(doc(db, "meta", "company"), { name });
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
      ops.push((b) => b.set(doc(firestore, "meta", "company"), { name: next.company }));
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const b = writeBatch(firestore);
        ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(b));
        await b.commit();
      }
    },
    [stamp],
  );

  return { people, company, error, upsert, remove, setCompany, replaceAll };
}
