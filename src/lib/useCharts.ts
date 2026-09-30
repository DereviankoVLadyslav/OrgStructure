import { useCallback, useEffect, useState } from "react";
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  serverTimestamp,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { cleanArea } from "./org";
import { cleanPerson, runOps, toPerson, type Op } from "./useOrg";

export interface ChartInfo {
  id: string;
  name: string;
  createdBy?: string;
  createdAt?: Timestamp | null;
  updatedBy?: string;
  updatedAt?: Timestamp | null;
}

const newChartId = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Copies people and areas from one place in the database to a chart. */
async function copyInto(f: Firestore, fromPeople: string[], fromAreas: string[], toChart: string, email: string): Promise<Op[]> {
  const [people, areas] = await Promise.all([
    getDocs(collection(f, fromPeople[0], ...fromPeople.slice(1))),
    getDocs(collection(f, fromAreas[0], ...fromAreas.slice(1))),
  ]);
  const ops: Op[] = [];
  people.docs.forEach((d) =>
    ops.push((b) =>
      b.set(doc(f, "charts", toChart, "people", d.id), {
        ...cleanPerson(toPerson(d.id, d.data())),
        updatedBy: email,
        updatedAt: serverTimestamp(),
      }),
    ),
  );
  areas.docs.forEach((d) => {
    const a = cleanArea({ ...d.data(), id: d.id });
    if (a) ops.push((b) => b.set(doc(f, "charts", toChart, "areas", a.id), a));
  });
  return ops;
}

/** List of all org charts, plus create / rename / duplicate / delete. */
export function useCharts(email: string, canEdit: boolean) {
  const [charts, setCharts] = useState<ChartInfo[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false); // list came from the server, not the local cache

  useEffect(() => {
    if (!db) return;
    return onSnapshot(
      collection(db, "charts"),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChartInfo, "id">) }));
        list.sort((a, b) => (b.updatedAt?.toMillis?.() ?? Date.now()) - (a.updatedAt?.toMillis?.() ?? Date.now()));
        setCharts(list);
        if (!snap.metadata.fromCache) setConfirmed(true);
        setError(null);
      },
      () => setError("Не вдалося завантажити список структур."),
    );
  }, []);

  // Number of people in each chart (a cheap count query, refreshed when the list changes).
  const idsKey = charts?.map((c) => `${c.id}:${c.updatedAt?.toMillis?.() ?? ""}`).join(",") ?? "";
  useEffect(() => {
    const f = db;
    if (!f || !charts) return;
    let alive = true;
    Promise.all(
      charts.map(async (c) => {
        try {
          const r = await getCountFromServer(collection(f, "charts", c.id, "people"));
          return [c.id, r.data().count] as const;
        } catch {
          return [c.id, -1] as const;
        }
      }),
    ).then((pairs) => alive && setCounts(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
  }, [idsKey]);

  // One-time move of the chart from the earlier single-chart version into the list.
  useEffect(() => {
    const f = db;
    if (!f || !canEdit || !confirmed || !charts || charts.length) return;
    (async () => {
      try {
        if ((await getDocFromServer(doc(f, "charts", "main"))).exists()) return;
        const legacy = await getDocs(collection(f, "people"));
        if (legacy.empty) return;
        const company = await getDoc(doc(f, "meta", "company"));
        const ops = await copyInto(f, ["people"], ["areas"], "main", email);
        ops.push((b) =>
          b.set(doc(f, "charts", "main"), {
            name: ((company.data()?.name as string) || "Основна структура").slice(0, 80),
            compact: company.data()?.compact === true,
            createdBy: email,
            createdAt: serverTimestamp(),
            updatedBy: email,
            updatedAt: serverTimestamp(),
          }),
        );
        await runOps(f, ops);
      } catch {
        /* no legacy data or no permission: nothing to move */
      }
    })();
  }, [charts, confirmed, canEdit, email]);

  const create = useCallback(
    async (name: string) => {
      const f = db;
      if (!f) throw new Error("no db");
      const id = newChartId();
      await runOps(f, [
        (b) =>
          b.set(doc(f, "charts", id), {
            name: name.trim().slice(0, 80),
            compact: false,
            createdBy: email,
            createdAt: serverTimestamp(),
            updatedBy: email,
            updatedAt: serverTimestamp(),
          }),
      ]);
      return id;
    },
    [email],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const f = db;
      if (!f) return;
      await runOps(f, [(b) => b.set(doc(f, "charts", id), { name: name.trim().slice(0, 80), updatedBy: email, updatedAt: serverTimestamp() }, { merge: true })]);
    },
    [email],
  );

  const duplicate = useCallback(
    async (source: ChartInfo, name: string) => {
      const f = db;
      if (!f) throw new Error("no db");
      const id = newChartId();
      const src = await getDoc(doc(f, "charts", source.id));
      const ops = await copyInto(f, ["charts", source.id, "people"], ["charts", source.id, "areas"], id, email);
      ops.unshift((b) =>
        b.set(doc(f, "charts", id), {
          name: name.trim().slice(0, 80),
          compact: src.data()?.compact === true,
          createdBy: email,
          createdAt: serverTimestamp(),
          updatedBy: email,
          updatedAt: serverTimestamp(),
        }),
      );
      await runOps(f, ops);
      return id;
    },
    [email],
  );

  /** Deletes a chart with everything in it. */
  const remove = useCallback(async (id: string) => {
    const f = db;
    if (!f) return;
    const [people, areas] = await Promise.all([
      getDocs(collection(f, "charts", id, "people")),
      getDocs(collection(f, "charts", id, "areas")),
    ]);
    const ops: Op[] = [...people.docs, ...areas.docs].map((d) => (b) => b.delete(d.ref));
    ops.push((b) => b.delete(doc(f, "charts", id)));
    await runOps(f, ops);
  }, []);

  return { charts, counts, error, create, rename, duplicate, remove };
}
