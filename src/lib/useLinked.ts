import { useEffect, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { toPerson, type StoredPerson } from "./useOrg";

export interface LinkedChart {
  name: string;
  people: StoredPerson[] | null;
  /** chart was deleted */
  missing: boolean;
  /** the viewer has no access to it */
  denied: boolean;
}

/**
 * Live data of the charts that cards in the current chart link to.
 * Every change in a linked chart shows up here right away.
 */
export function useLinkedCharts(ids: string[]) {
  const [data, setData] = useState<Record<string, LinkedChart>>({});
  const key = [...new Set(ids)].sort().join(",");

  useEffect(() => {
    const f = db;
    if (!f || !key) {
      setData({});
      return;
    }
    const list = key.split(",");
    const patch = (id: string, p: Partial<LinkedChart>) =>
      setData((d) => {
        const base: LinkedChart = d[id] ?? { name: "", people: null, missing: false, denied: false };
        return { ...d, [id]: { ...base, ...p } };
      });
    const unsubs = list.flatMap((id) => [
      onSnapshot(
        doc(f, "charts", id),
        (s) => patch(id, s.exists() ? { name: (s.data()?.name as string) || "", missing: false } : s.metadata.fromCache ? {} : { missing: true }),
        () => patch(id, { denied: true }),
      ),
      onSnapshot(
        collection(f, "charts", id, "people"),
        (s) => patch(id, { people: s.docs.map((d) => toPerson(d.id, d.data())) }),
        () => patch(id, { denied: true }),
      ),
    ]);
    return () => unsubs.forEach((u) => u());
  }, [key]);

  return data;
}
