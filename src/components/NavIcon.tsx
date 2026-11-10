// Arrows for stepping through moves, drawn as shapes. The characters ⏮ ◀ ▶ ⏭
// can't be used: phones turn some of them into colour emoji (iOS draws ⏮ and
// ⏭ as blue buttons next to plain ◀ and ▶).

const PATHS = {
  first: 'M4 4h2.6v16H4zM20 4v16L8.2 12z',
  prev: 'M17.5 4v16L5.5 12z',
  next: 'M6.5 4l12 8-12 8z',
  last: 'M17.4 4H20v16h-2.6zM4 4l11.8 8L4 20z',
} as const;

export function NavIcon({ kind }: { kind: keyof typeof PATHS }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[kind]} />
    </svg>
  );
}
