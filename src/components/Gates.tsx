import type { ReactNode } from "react";

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

export function SignInGate({ onSignIn, error }: { onSignIn: () => void; error: string | null }) {
  return (
    <Gate title="Оргструктура компанії">
      <p>Увійдіть через Google, щоб переглядати й редагувати структуру. Доступ мають лише люди, яких додав адміністратор.</p>
      <button className="btn primary google" type="button" onClick={onSignIn}>
        Увійти через Google
      </button>
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
