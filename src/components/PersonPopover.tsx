import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ROLES, deptColor } from "../lib/org";
import type { StoredPerson } from "../lib/useOrg";
import { FunctionsEditor } from "./FunctionsEditor";

interface Props {
  person: StoredPerson;
  anchor: DOMRect;
  canEdit: boolean;
  managerName?: string;
  reportsCount: number;
  onChangeFunctions: (next: string[]) => Promise<void>;
  onEdit: () => void;
  onAddSub: () => void;
  onClose: () => void;
}

const WIDTH = 320;
const GAP = 10;

/** Small menu that opens next to a card: duties plus quick actions. */
export function PersonPopover({ person, anchor, canEdit, managerName, reportsCount, onChangeFunctions, onEdit, onAddSub, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  const [busy, setBusy] = useState(false);

  // Place below the card, or above it when there is no room; keep inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < 600) {
      setPos({ left: 8, right: 8, bottom: 8, width: "auto" });
      return;
    }
    const h = el.offsetHeight;
    const clampX = (x: number) => Math.min(Math.max(8, x), vw - WIDTH - 8);
    const clampY = (y: number) => Math.min(Math.max(8, y), Math.max(8, vh - h - 8));
    const centered = clampX(anchor.left + anchor.width / 2 - WIDTH / 2);
    if (anchor.bottom + GAP + h <= vh - 8) setPos({ left: centered, top: anchor.bottom + GAP, width: WIDTH });
    else if (anchor.top - GAP - h >= 8) setPos({ left: centered, top: anchor.top - GAP - h, width: WIDTH });
    // not enough room above or below: open beside the card so it stays visible
    else if (anchor.right + GAP + WIDTH <= vw - 8) setPos({ left: anchor.right + GAP, top: clampY(anchor.top), width: WIDTH });
    else if (anchor.left - GAP - WIDTH >= 8) setPos({ left: anchor.left - GAP - WIDTH, top: clampY(anchor.top), width: WIDTH });
    else setPos({ left: centered, top: clampY(anchor.bottom + GAP), width: WIDTH });
  }, [anchor, person.functions.length]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return;
      if (t.closest(`[data-person="${person.id}"]`)) return; // the card itself toggles the menu
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, person.id]);

  const change = async (next: string[]) => {
    setBusy(true);
    try {
      await onChangeFunctions(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={ref}
      className="popover"
      role="dialog"
      aria-label={`${person.name}: функції`}
      style={{ ...pos, "--dc": deptColor(person.dept) } as CSSProperties}
    >
      <div className="pop-head">
        <div>
          <div className="pop-dept"><i />{person.dept || "Без підрозділу"}</div>
          <div className="pop-name">{person.name}</div>
          {person.title && <div className="pop-title">{person.title}</div>}
          <span className={"badge pop-role " + person.role}>{ROLES[person.role].label}</span>
        </div>
        <button className="x sm" type="button" aria-label="Закрити" onClick={onClose}>×</button>
      </div>

      <dl className="pop-facts">
        <div><dt>Керівник</dt><dd>{managerName ?? "—"}</dd></div>
        <div><dt>Підлеглих</dt><dd>{reportsCount}</dd></div>
      </dl>

      <div className="pop-section">
        <h3>Функції{person.functions.length ? ` · ${person.functions.length}` : ""}</h3>
        <FunctionsEditor
          idPrefix={`pop-${person.id}`}
          functions={person.functions}
          canEdit={canEdit}
          busy={busy}
          onChange={change}
        />
      </div>

      <div className="pop-actions">
        <button className="btn" type="button" onClick={onEdit}>
          {canEdit ? "Редагувати картку" : "Детальніше"}
        </button>
        {canEdit && (
          <button className="btn" type="button" onClick={onAddSub}>+ Підлеглий</button>
        )}
      </div>
    </div>
  );
}
