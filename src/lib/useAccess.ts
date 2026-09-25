import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, updateDoc, arrayRemove, arrayUnion, type FieldValue } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./firebase";

export type AccessLevel = "admin" | "editor" | "viewer";

export interface AccessList {
  admins: string[];
  editors: string[];
  viewers: string[];
}

export type AccessState =
  | { status: "loading" }
  | { status: "denied"; email: string }
  | { status: "error"; message: string }
  | { status: "ok"; level: AccessLevel; list: AccessList; bootstrapped: boolean };

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

    const listen = () => {
      unsub = onSnapshot(
        ref,
        (snap) => {
          const d = snap.data() as Partial<AccessList> | undefined;
          const list: AccessList = { admins: d?.admins ?? [], editors: d?.editors ?? [], viewers: d?.viewers ?? [] };
          const level = levelOf(list, email);
          setState(level ? { status: "ok", level, list, bootstrapped } : { status: "denied", email });
        },
        async (err) => {
          if (cancelled) return;
          if (err.code !== "permission-denied") {
            setState({ status: "error", message: "Не вдалося з'єднатися з базою даних." });
            return;
          }
          // Denied means either "not on the list" or "the list does not exist yet".
          if (triedBootstrap) return setState({ status: "denied", email });
          triedBootstrap = true;
          try {
            await setDoc(ref, { admins: [email], editors: [], viewers: [] });
            bootstrapped = true;
            if (!cancelled) listen(); // the failed listener is closed; open a fresh one
          } catch {
            if (!cancelled) setState({ status: "denied", email });
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
