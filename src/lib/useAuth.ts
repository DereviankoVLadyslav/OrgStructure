import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth } from "./firebase";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return setReady(true);
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  const signIn = async () => {
    if (!auth) return;
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      if (code === "auth/unauthorized-domain")
        setError("Цей домен не дозволено у Firebase. Додайте його в Authentication → Settings → Authorized domains.");
      else if (code === "auth/popup-blocked") setError("Браузер заблокував вікно входу. Дозвольте спливаючі вікна для цього сайту.");
      else setError("Не вдалося увійти. Спробуйте ще раз.");
    }
  };

  const logout = () => (auth ? signOut(auth) : Promise.resolve());

  return { user, ready, error, signIn, logout };
}
