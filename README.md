# Оргструктура компанії

Сайт на React + TypeScript (Vite) + Firebase. Показує структуру компанії у вигляді блок-схеми:
керівник компанії, начальники підрозділів, заступники, співробітники і лінії прямого підпорядкування.

- Кілька людей бачать і редагують **одну спільну схему**. Зміни з'являються в усіх приблизно за секунду.
- Вхід через Google. Адміністратор сам вирішує, хто може лише переглядати, хто редагувати, а хто керувати доступом.
- Головна сторінка зі списком структур: можна створити скільки завгодно схем, перейменувати, дублювати, видалити й перемикатися між ними (також зі списку вгорі на сторінці схеми).
- Картки можна вільно перетягувати: будь-хто може стояти на будь-якому рівні, лінії підпорядкування перемальовуються самі. Shift + перетягування переносить разом з підлеглими, а якщо кинути картку на іншу — вони міняються місцями.
- Працівник може підпорядковуватися кільком керівникам: протягніть лінію від точки справа на картці керівника до картки підлеглого.
- Фонові області (овали й прямокутники на кшталт «Front office») та заголовки; компактний режим карток лише з номером або ім'ям.
- Клік по картці відкриває невелике меню з функціями (обов'язками) працівника — їх можна додавати, змінювати й видаляти.
- На кожній картці видно, хто і коли змінював її останнім.
- Є експорт у JSON (резервна копія) та імпорт.

---

## 1. Створіть проєкт Firebase (≈10 хвилин, безкоштовно)

1. Відкрийте <https://console.firebase.google.com> → **Create a project** (Google Analytics можна вимкнути).
2. **Build → Firestore Database → Create database**. Оберіть регіон `europe-west3 (Frankfurt)` і **production mode**.
3. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save**.
4. **Authentication → Settings → Authorized domains → Add domain** і додайте `<ваш-логін>.github.io`.
5. **Project settings (⚙️) → General → Your apps → значок `</>`** (Web app). Назвіть застосунок, Firebase Hosting
   **не** вмикайте. Скопіюйте значення з `firebaseConfig` — вони знадобляться далі.

### Правила безпеки (обов'язково)

**Firestore Database → Rules** → повністю замініть текст вмістом файлу `firestore.rules` з цього проєкту → **Publish**.

Саме ці правила не дають стороннім людям читати чи змінювати дані. Ключі з `firebaseConfig` не є секретом —
вони все одно потрапляють у код сайту, захист забезпечують правила.

## 2. Опублікуйте сайт на GitHub Pages

1. Створіть репозиторій на GitHub (наприклад, `org-chart`) і завантажте туди цю папку:
   ```bash
   git init
   git add .
   git commit -m "Org chart"
   git branch -M main
   git remote add origin https://github.com/<ваш-логін>/org-chart.git
   git push -u origin main
   ```
2. **Settings → Secrets and variables → Actions → вкладка Variables → New repository variable**.
   Створіть шість змінних зі значеннями з `firebaseConfig`:

   | Змінна | Поле у firebaseConfig |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | `apiKey` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
   | `VITE_FIREBASE_PROJECT_ID` | `projectId` |
   | `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
   | `VITE_FIREBASE_APP_ID` | `appId` |

3. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions → Deploy to GitHub Pages → Run workflow** (або просто зробіть новий push).
   Через 1–2 хвилини сайт відкриється за адресою `https://<ваш-логін>.github.io/org-chart/`.

## 3. Перший вхід

1. **Першим** відкрийте сайт ви і увійдіть через Google — ви автоматично станете адміністратором.
   (Тому не давайте посилання іншим, поки не увійдете самі.)
2. Натисніть «Завантажити приклад» або «Додати керівника».
3. **Доступ** (під шапкою) → введіть Google-пошту колеги й оберіть права:
   - **Адміністратор** — редагує схему і керує доступом;
   - **Редактор** — редагує схему;
   - **Перегляд** — лише бачить схему.
4. Надішліть колегам посилання. Хто ще не в списку, побачить свою адресу і зможе переслати її вам.

---

## Локальний запуск (для розробки)

```bash
cp .env.example .env.local   # і заповніть значеннями з firebaseConfig
npm install
npm run dev
```

Для локальної адреси `localhost` окремо нічого додавати не потрібно — Firebase дозволяє її за замовчуванням.

## Як влаштовані дані

| Шлях у Firestore | Що зберігає |
|---|---|
| `charts/{chartId}` | структура: `name`, `compact`, хто і коли створив і змінив |
| `charts/{chartId}/people/{id}` | одна людина: `name`, `title`, `dept`, `role`, `managerId`, `alsoReportsTo` (додаткові керівники), `functions` (список обов'язків), `x`, `y` (місце на схемі), `updatedBy`, `updatedAt` |
| `charts/{chartId}/areas/{id}` | фонові області: `label`, `x`, `y`, `w`, `h`, `shape`, `tone` |
| `meta/access` | `{ admins: [], editors: [], viewers: [] }` — списки Google-адрес |

`role`: `director` — керівник компанії, `head` — начальник підрозділу, `deputy` — заступник, `staff` — співробітник.
`managerId` — id безпосереднього керівника (`null` — верхній рівень).

Безкоштовного тарифу Firebase (Spark) з запасом вистачає для структури з кількох сотень людей і десятків користувачів.

## Файли проєкту

- `firestore.rules` — правила доступу до бази
- `src/lib/firebase.ts` — підключення до Firebase
- `src/lib/useAuth.ts` — вхід через Google
- `src/lib/useAccess.ts` — перевірка прав і керування списком доступу
- `src/lib/useOrg.ts` — читання та запис структури в реальному часі
- `src/lib/org.ts` — типи, ролі, побудова дерева
- `src/components/OrgTree.tsx` — блок-схема
- `src/components/PersonPanel.tsx` — картка редагування людини
- `src/components/AccessPanel.tsx` — керування доступом
- `src/components/PersonPopover.tsx` — меню, що відкривається по кліку на картку
- `src/components/FunctionsEditor.tsx` — список функцій працівника
- `public/org.json` — приклад структури для кнопки «Завантажити приклад»

Дані з першої версії (одна структура в `people/`, `areas/`, `meta/company`) автоматично копіюються у структуру `charts/main`, коли редактор уперше відкриває головну сторінку. Старі документи лишаються як резервна копія.
