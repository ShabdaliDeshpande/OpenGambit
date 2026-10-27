// Flair: one emoji a player may show next to their name. Standard Unicode
// emoji, drawn by the device's own font, so there are no image files. The
// server accepts only these. No imports, so the server can load it.

export const FLAIRS: readonly string[] = [
  '♟️', '♞', '♝', '♜', '♛', '♚', '🏆', '🥇', '🎯', '⚡',
  '🔥', '❄️', '🌟', '✨', '🌙', '☀️', '🌈', '🌊', '🌲', '🌵',
  '🍀', '🌻', '🌸', '🍁', '🍄', '🦉', '🦊', '🐺', '🐻', '🐼',
  '🐯', '🦁', '🐸', '🐢', '🐙', '🦄', '🐉', '🦅', '🐝', '🦋',
  '🐧', '🐬', '🐈', '🐕', '🎲', '🧩', '🎨', '🎵', '🎸', '📚',
  '🧠', '💡', '🔭', '🚀', '⛰️', '🏔️', '☕', '🍵', '🍕', '🍩',
];

/** Whether a flair is one of the allowed emoji. */
export const validFlair = (f: unknown): f is string => typeof f === 'string' && FLAIRS.includes(f);

/** A name with its flair, for plain text. */
export const withFlair = (name: string, flair: string | null | undefined) => (flair ? `${name} ${flair}` : name);
