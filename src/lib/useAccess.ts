import { useEffect, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where, arrayRemove, arrayUnion, serverTimestamp, type FieldValue } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./firebase";

export type AccessLevel = "admin" | "editor" | "viewer";
/** A person's workspace-wide role. "guest" = no global role, only access to individual charts. */
export type UserLevel = AccessLevel | "guest";

export interface AccessList {
  admins: string[];
  editors: string[];
  viewers: string[];
}

export type AccessState =
  | { status: "loading" }
  | { status: "denied"; email: string }
  | { status: "error"; message: string }
  | { status: "ok"; level: UserLevel; list: AccessList; bootstrapped: boolean };

const FIELD: Record<AccessLevel, keyof AccessList> = { admin: "admins", editor: "editors", viewer: "viewers" };

const norm = (e: string) => e.trim().toLowerCase();

function levelOf(list: AccessList, email: string): AccessLevel | null {
  if (list.admins.includes(email)) return "admin";
  if (list.editors.includes(email)) return "editor";
  if (list.viewers.includes(email)) return "viewer";
  return null;
}

/**
 * Reads meta/access — who may view, edit and manage the chart.
 * If the document does not exist yet, the first person to sign in creates it and becomes its admin.
 */
export function useAccess(user: User | null) {
  const [state, setState] = useState<AccessState>({ status: "loading" });

  useEffect(() => {
    const firestore = db;
    if (!firestore || !user?.email) return;
    const email = norm(user.email);
    const ref = doc(firestore, "meta", "access");
    let unsub = () => {};
    let cancelled = false;
    let triedBootstrap = false;
    let bootstrapped = false;
    setState({ status: "loading" });

    // Not on the workspace list: maybe they were given access to individual charts.
    const checkGuest = async () => {
      try {
        const charts = collection(firestore, "charts");
        const [v, e] = await Promise.all([
          getDocs(query(charts, where("viewers", "array-contains", email))),
          getDocs(query(charts, where("editors", "array-contains", email))),
        ]);
        if (cancelled) return;
        setState(
          v.empty && e.empty
            ? { status: "denied", email }
            : { status: "ok", level: "guest", list: { admins: [], editors: [], viewers: [] }, bootstrapped: false },
        );
      } catch {
        if (!cancelled) setState({ status: "denied", email });
      }
    };

    const listen = () => {
      unsub = onSnapshot(
        ref,
        (snap) => {
          const d = snap.data() as Partial<AccessList> | undefined;
          const list: AccessList = { admins: d?.admins ?? [], editors: d?.editors ?? [], viewers: d?.viewers ?? [] };
          const level = levelOf(list, email);
          if (level) setState({ status: "ok", level, list, bootstrapped });
          else void checkGuest();
        },
        async (err) => {
          if (cancelled) return;
          if (err.code !== "permission-denied") {
            setState({ status: "error", message: "Не вдалося з'єднатися з базою даних." });
            return;
          }
          // Denied means either "not on the list" or "the list does not exist yet".
          if (triedBootstrap) return checkGuest();
          triedBootstrap = true;
          try {
            await setDoc(ref, { admins: [email], editors: [], viewers: [] });
            bootstrapped = true;
            if (!cancelled) listen(); // the failed listener is closed; open a fresh one
          } catch {
            if (!cancelled) await checkGuest();
          }
        },
      );
    };
    listen();
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user]);

  return state;
}

/** Puts an email on exactly one list (or removes it everywhere when level is null). */
export async function setMemberLevel(email: string, level: AccessLevel | null) {
  if (!db) return;
  const e = norm(email);
  const ref = doc(db, "meta", "access");
  const updates: Record<string, FieldValue> = {
    admins: arrayRemove(e),
    editors: arrayRemove(e),
    viewers: arrayRemove(e),
  };
  if (level) updates[FIELD[level]] = arrayUnion(e);
  await updateDoc(ref, updates);
}

export function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Gives or removes access to one chart: "editor" or "viewer", or null to remove. */
export async function setChartMember(chartId: string, email: string, level: "editor" | "viewer" | null, by: string) {
  if (!db) return;
  const e = norm(email);
  const updates: Record<string, FieldValue | string> = {
    viewers: arrayRemove(e),
    editors: arrayRemove(e),
    updatedBy: by,
    updatedAt: serverTimestamp(),
  };
  if (level) updates[level === "editor" ? "editors" : "viewers"] = arrayUnion(e);
  await updateDoc(doc(db, "charts", chartId), updates);
}
