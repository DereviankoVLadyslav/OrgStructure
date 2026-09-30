import { useRef, useState } from "react";
import type { Area, AreaShape, AreaTone } from "../lib/org";
import { useAnchoredPosition, useDismiss } from "../lib/usePopover";

interface Props {
  area: Area;
  anchor: DOMRect;
  canEdit: boolean;
  onChange: (a: Area) => void;
  onDelete: () => void;
  onClose: () => void;
}

const SHAPES: { v: AreaShape; label: string }[] = [
  { v: "rect", label: "Прямокутник" },
  { v: "ellipse", label: "Овал" },
];
const TONES: { v: AreaTone; label: string }[] = [
  { v: "soft", label: "Світла зона" },
  { v: "strong", label: "Заголовок" },
];

/** Small settings menu for a background area: name, shape, style, delete. */
export function AreaPopover({ area, anchor, canEdit, onChange, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(ref, anchor, 300);
  useDismiss(ref, onClose, `[data-area="${area.id}"]`);
  const [label, setLabel] = useState(area.label);
  const [confirm, setConfirm] = useState(false);
  // Latest edited version, so a label saved on blur and a style clicked right after both survive.
  const unsaved = useRef<Partial<Area>>({});
  for (const k of Object.keys(unsaved.current) as (keyof Area)[]) {
    if (unsaved.current[k] === area[k]) delete unsaved.current[k]; // the database has it now
  }
  const current = (): Area => ({ ...area, ...unsaved.current });

  const apply = (patch: Partial<Area>) => {
    unsaved.current = { ...unsaved.current, ...patch };
    onChange(current());
  };

  const saveLabel = () => {
    const v = label.trim();
    if (v !== current().label) apply({ label: v });
  };

  return (
    <div ref={ref} className="popover" role="dialog" aria-label="Налаштування області" style={pos}>
      <div className="pop-head">
        <div>
          <div className="pop-dept">Область</div>
          <div className="pop-name">{area.label || "Без назви"}</div>
        </div>
        <button className="x sm" type="button" aria-label="Закрити" onClick={onClose}>×</button>
      </div>

      {canEdit ? (
        <>
          <label className="field">
            <span>Назва</span>
            <input
              id={`area-label-${area.id}`}
              className="fn-input"
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), undefined)}
            />
          </label>
          <div className="field">
            <span>Форма</span>
            <div className="seg">
              {SHAPES.map((s) => (
                <button key={s.v} type="button" className={current().shape === s.v ? "on" : ""} aria-pressed={current().shape === s.v} onClick={() => apply({ shape: s.v })}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Стиль</span>
            <div className="seg">
              {TONES.map((t) => (
                <button key={t.v} type="button" className={current().tone === t.v ? "on" : ""} aria-pressed={current().tone === t.v} onClick={() => apply({ tone: t.v })}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <p className="note">Тягніть за назву, щоб перемістити. Розмір змінюється за правий нижній кут.</p>
          <div className="pop-actions">
            {confirm ? (
              <>
                <button className="btn danger solid" type="button" onClick={onDelete}>Так, видалити</button>
                <button className="btn" type="button" onClick={() => setConfirm(false)}>Скасувати</button>
              </>
            ) : (
              <button className="btn danger" type="button" onClick={() => setConfirm(true)}>Видалити область</button>
            )}
          </div>
        </>
      ) : (
        <p className="note">Області змінюють редактори.</p>
      )}
    </div>
  );
}
