import { useState, type KeyboardEvent } from "react";
import { MAX_FUNCTIONS, MAX_FUNCTION_LENGTH } from "../lib/org";

interface Props {
  functions: string[];
  canEdit: boolean;
  onChange: (next: string[]) => void;
  /** id prefix so two editors on screen keep distinct input ids */
  idPrefix: string;
  busy?: boolean;
}

/** List of a person's duties with inline add, edit and remove. */
export function FunctionsEditor({ functions, canEdit, onChange, idPrefix, busy }: Props) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);

  const add = () => {
    const v = draft.trim();
    if (!v || functions.length >= MAX_FUNCTIONS) return;
    onChange([...functions, v]);
    setDraft("");
  };

  const commitEdit = () => {
    if (!editing) return;
    const v = editing.text.trim();
    const next = [...functions];
    if (v) next[editing.index] = v;
    else next.splice(editing.index, 1);
    setEditing(null);
    if (JSON.stringify(next) !== JSON.stringify(functions)) onChange(next);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="fn">
      {functions.length === 0 ? (
        <p className="fn-empty">{canEdit ? "Функцій ще немає. Додайте першу нижче." : "Функції не вказані."}</p>
      ) : (
        <ol className="fn-list">
          {functions.map((f, i) => (
            <li key={i}>
              {editing?.index === i ? (
                <input
                  id={`${idPrefix}-edit-${i}`}
                  className="fn-input"
                  autoFocus
                  maxLength={MAX_FUNCTION_LENGTH}
                  value={editing.text}
                  onChange={(e) => setEditing({ index: i, text: e.target.value })}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitEdit();
                    }
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <>
                  <span
                    className={"fn-text" + (canEdit ? " editable" : "")}
                    title={canEdit ? "Натисніть, щоб змінити" : undefined}
                    onClick={() => canEdit && !busy && setEditing({ index: i, text: f })}
                  >
                    {f}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="fn-del"
                      aria-label={`Видалити функцію «${f}»`}
                      disabled={busy}
                      onClick={() => onChange(functions.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {canEdit && functions.length < MAX_FUNCTIONS && (
        <div className="fn-add">
          <input
            id={`${idPrefix}-new`}
            className="fn-input"
            placeholder="Нова функція, напр. «Погодження договорів»"
            maxLength={MAX_FUNCTION_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />
          <button type="button" className="btn" onClick={add} disabled={!draft.trim() || busy}>
            Додати
          </button>
        </div>
      )}
    </div>
  );
}
