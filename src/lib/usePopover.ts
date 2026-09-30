import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

const GAP = 10;

/** Places a floating panel next to an anchor rectangle and keeps it inside the window. */
export function useAnchoredPosition(ref: RefObject<HTMLElement | null>, anchor: DOMRect, width: number, deps: unknown[] = []) {
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
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
    const clampX = (x: number) => Math.min(Math.max(8, x), vw - width - 8);
    const clampY = (y: number) => Math.min(Math.max(8, y), Math.max(8, vh - h - 8));
    const centered = clampX(anchor.left + anchor.width / 2 - width / 2);
    if (anchor.bottom + GAP + h <= vh - 8) setPos({ left: centered, top: anchor.bottom + GAP, width });
    else if (anchor.top - GAP - h >= 8) setPos({ left: centered, top: anchor.top - GAP - h, width });
    // not enough room above or below: open beside the anchor so it stays visible
    else if (anchor.right + GAP + width <= vw - 8) setPos({ left: anchor.right + GAP, top: clampY(anchor.top), width });
    else if (anchor.left - GAP - width >= 8) setPos({ left: anchor.left - GAP - width, top: clampY(anchor.top), width });
    else setPos({ left: centered, top: clampY(anchor.bottom + GAP), width });
  }, [anchor, width, ...deps]);
  return pos;
}

/** Closes on Escape, window resize, or a press outside the panel (except on `keepSelector`). */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void, keepSelector?: string) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return;
      if (keepSelector && t.closest(keepSelector)) return;
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
  }, [ref, onClose, keepSelector]);
}
