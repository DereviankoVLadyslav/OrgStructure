import { useRef, useState } from "react";
import type { Person } from "../lib/org";
import type { LinkedChart } from "../lib/useLinked";
import { useAnchoredPosition, useDismiss } from "../lib/usePopover";

interface Props {
  card: Person;
  data: LinkedChart | undefined;
  anchor: DOMRect;
  canEdit: boolean;
  folded: boolean;
  managerName?: string;
  onOpen: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Menu of a card that links to another chart. */
export function LinkPopover({ card, data, anchor, canEdit, folded, managerName, onOpen, onToggle, onRemove, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(ref, anchor, 300);
  useDismiss(ref, onClose, `[data-person="${card.id}"]`);
  const [confirm, setConfirm] = useState(false);
  const usable = data && !data.denied && !data.missing;

  return (
    <div ref={ref} className="popover" role="dialog" aria-label="Пов'язана структура" style={pos}>
      <div className="pop-head">
        <div>
          <div className="pop-dept">Пов'язана структура</div>
          <div className="pop-name">↗ {data?.name || card.name}</div>
        </div>
        <button className="x sm" type="button" aria-label="Закрити" onClick={onClose}>×</button>
      </div>
      <p className="note">
        Це жива копія іншої структури: зміни в ній одразу видно тут. Редагувати її картки можна лише в самій структурі.
        {data?.denied && " У вас немає доступу до неї — попросіть адміністратора."}
        {data?.missing && " Цю структуру видалили."}
      </p>
      <dl className="pop-facts">
        <div><dt>Підпорядковується</dt><dd>{managerName ?? "—"}</dd></div>
        <div><dt>Карток</dt><dd>{data?.people?.length ?? "—"}</dd></div>
      </dl>
      <div className="pop-actions">
        {usable && <button className="btn primary" type="button" onClick={onOpen}>Відкрити структуру</button>}
        {usable && <button className="btn" type="button" onClick={onToggle}>{folded ? "Показати тут" : "Сховати"}</button>}
      </div>
      {canEdit && (
        <div className="pop-actions">
          {confirm ? (
            <>
              <button className="btn danger solid" type="button" onClick={onRemove}>Так, прибрати</button>
              <button className="btn" type="button" onClick={() => setConfirm(false)}>Скасувати</button>
            </>
          ) : (
            <button className="btn danger" type="button" onClick={() => setConfirm(true)}>Прибрати зв'язок</button>
          )}
        </div>
      )}
      {canEdit && confirm && <p className="note">Сама структура залишиться — зникне лише картка-посилання тут.</p>}
    </div>
  );
}
