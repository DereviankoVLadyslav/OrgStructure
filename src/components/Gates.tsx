import { useState, type ReactNode } from "react";
import type { useAuth } from "../lib/useAuth";

export function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function SetupGate() {
  return (
    <Gate title="Потрібно підключити Firebase">
      <p>
        Сайт зібрано без налаштувань Firebase. Додайте змінні <code>VITE_FIREBASE_*</code> у файл{" "}
        <code>.env.local</code> (для локального запуску) або у Settings → Secrets and variables → Actions → Variables
        репозиторію GitHub, і зберіть сайт ще раз.
      </p>
      <p>Покрокова інструкція — у файлі README.md.</p>
    </Gate>
  );
}

export function SignInGate({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const { link, busy, error, sendLink, finish, restart } = auth;
  const [email, setEmail] = useState("");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  if (link.step === "sent")
    return (
      <Gate title="Перевірте пошту">
        <p>
          Ми надіслали посилання для входу на <code>{link.email}</code>. Відкрийте лист у цьому ж браузері й натисніть
          «Увійти». Посилання одноразове.
        </p>
        <p>Лист не прийшов за кілька хвилин? Перевірте папку «Спам» або попросіть IT додати відправника до дозволених.</p>
        <div className="copy">
          <button className="btn" type="button" disabled={busy} onClick={() => sendLink(link.email)}>Надіслати ще раз</button>
          <button className="btn" type="button" onClick={restart}>Інша адреса</button>
        </div>
        {error && <p className="err">{error}</p>}
      </Gate>
    );

  const confirm = link.step === "confirm";
  return (
    <Gate title={confirm ? "Підтвердіть пошту" : "Оргструктура компанії"}>
      <p>
        {confirm
          ? "Посилання відкрито в іншому браузері чи пристрої. Введіть ту саму адресу, на яку надсилали лист."
          : "Увійдіть через корпоративну пошту: ми надішлемо на неї посилання для входу, пароль не потрібен. Доступ мають лише люди, яких додав адміністратор."}
      </p>
      <form
        className="signin"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy) return;
          if (confirm) finish(email);
          else sendLink(email);
        }}
      >
        <label className="field">
          <span>Робоча пошта</span>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="btn primary google" type="submit" disabled={!valid || busy}>
          {busy ? "Зачекайте…" : confirm ? "Увійти" : "Надіслати посилання"}
        </button>
      </form>
      {error && <p className="err">{error}</p>}
    </Gate>
  );
}

export function DeniedGate({ email, onLogout }: { email: string; onLogout: () => void }) {
  const copy = () => navigator.clipboard?.writeText(email).catch(() => {});
  return (
    <Gate title="Немає доступу">
      <p>
        Адреса <code>{email}</code> ще не додана до списку. Надішліть її адміністратору структури, а коли він
        додасть вас — натисніть «Перевірити ще раз».
      </p>
      <div className="copy">
        <button className="btn primary" type="button" onClick={() => window.location.reload()}>Перевірити ще раз</button>
        <button className="btn" type="button" onClick={copy}>Скопіювати адресу</button>
        <button className="btn" type="button" onClick={onLogout}>Увійти іншим акаунтом</button>
      </div>
    </Gate>
  );
}
