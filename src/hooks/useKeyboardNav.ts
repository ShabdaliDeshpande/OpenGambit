import { useEffect, useRef } from 'react';

export interface NavHandlers {
  prev: () => void;
  next: () => void;
  first: () => void;
  last: () => void;
  flip: () => void;
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** ←/→ step through moves, Home/End jump, f flips the board. Inactive when `enabled` is false. */
export function useKeyboardNav(handlers: NavHandlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const h = ref.current;
      const action = (
        { ArrowLeft: h.prev, ArrowRight: h.next, Home: h.first, End: h.last, ArrowUp: h.first, ArrowDown: h.last, f: h.flip } as Record<
          string,
          (() => void) | undefined
        >
      )[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
