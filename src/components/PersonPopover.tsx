import { useRef, useState, type CSSProperties } from "react";
import { useAnchoredPosition, useDismiss } from "../lib/usePopover";
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

/** Small menu that opens next to a card: duties plus quick actions. */
export function PersonPopover({ person, anchor, canEdit, managerName, reportsCount, onChangeFunctions, onEdit, onAddSub, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const pos = useAnchoredPosition(ref, anchor, WIDTH, [person.functions.length]);
  // the card itself toggles the menu, so a press on it must not count as "outside"
  useDismiss(ref, onClose, `[data-person="${person.id}"]`);

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
        <div><dt>Керівник{managerName?.includes(",") ? "и" : ""}</dt><dd>{managerName ?? "—"}</dd></div>
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
