import { useCallback, useEffect, useState } from "react";
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

const EMAIL_KEY = "org-chart.emailForSignIn";

/** Where the person is in the sign-in flow. */
export type LinkState =
  | { step: "enter" } // type your work email
  | { step: "sent"; email: string } // link sent, check the mailbox
  | { step: "confirm" }; // opened the link in another browser: type the email again

const remember = (email: string) => {
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    /* private window: the person will be asked to type it again */
  }
};
const recall = () => {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
};
const forget = () => {
  try {
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* ignore */
  }
};

/** Removes Firebase's one-time code from the address bar, keeping the chart route (#/c/…). */
const cleanUrl = () => window.history.replaceState(null, "", window.location.pathname + window.location.hash);

function message(code: string): string {
  switch (code) {
    case "auth/invalid-email":
      return "Перевірте адресу пошти — схоже, в ній помилка.";
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return "Посилання вже використане або застаріло. Надішліть нове.";
    case "auth/quota-exceeded":
      return "На сьогодні вичерпано ліміт листів. Спробуйте завтра або зверніться до адміністратора.";
    case "auth/unauthorized-continue-uri":
    case "auth/unauthorized-domain":
      return "Цей сайт не додано до дозволених доменів у Firebase (Authentication → Settings → Authorized domains).";
    case "auth/operation-not-allowed":
      return "Вхід за посиланням не ввімкнено у Firebase (Authentication → Sign-in method → Email/Password → Email link).";
    default:
      return "Не вдалося увійти. Спробуйте ще раз.";
  }
}

/**
 * Passwordless sign-in: a one-time link is sent to the person's work email (works with any mail
 * server, including Kerio Connect). Opening the link signs them in.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [completing, setCompleting] = useState(() => !!auth && isSignInWithEmailLink(auth, window.location.href));
  const [link, setLink] = useState<LinkState>({ step: "enter" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!auth) return setReady(true);
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  const finish = useCallback(async (email: string) => {
    if (!auth) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailLink(auth, email.trim().toLowerCase(), window.location.href);
      forget();
      cleanUrl();
      setCompleting(false);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      setError(message(code));
      if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") {
        cleanUrl();
        setCompleting(false);
        setLink({ step: "enter" });
      } else {
        setLink({ step: "confirm" });
      }
    } finally {
      setBusy(false);
    }
  }, []);

  // Opened the link from the email: finish signing in.
  useEffect(() => {
    if (!completing) return;
    const saved = recall();
    if (saved) finish(saved);
    else setLink({ step: "confirm" }); // different browser or device: ask for the address again
  }, [completing, finish]);

  const sendLink = async (email: string) => {
    if (!auth) return;
    const e = email.trim().toLowerCase();
    setBusy(true);
    setError(null);
    try {
      await sendSignInLinkToEmail(auth, e, {
        url: window.location.origin + window.location.pathname,
        handleCodeInApp: true,
      });
      remember(e);
      setLink({ step: "sent", email: e });
    } catch (err) {
      setError(message((err as { code?: string }).code ?? ""));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setError(null);
    setLink({ step: "enter" });
  };

  const logout = () => (auth ? signOut(auth) : Promise.resolve());

  return { user, ready: ready && !(completing && link.step !== "confirm"), link, busy, error, sendLink, finish, restart, logout };
}
