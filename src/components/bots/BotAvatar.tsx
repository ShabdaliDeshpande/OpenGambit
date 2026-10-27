import type { AvatarSpec, Bot } from '../../bots/bots';

/** Relative luminance of a #rrggbb colour, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

function Eyes({ kind, ink }: { kind: AvatarSpec['eyes']; ink: string }) {
  switch (kind) {
    case 'round':
      return (
        <g fill={ink}>
          <circle cx="25" cy="35" r="3" />
          <circle cx="39" cy="35" r="3" />
        </g>
      );
    case 'sleepy':
      return (
        <g fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round">
          <path d="M21 35 q4 3 8 0" />
          <path d="M35 35 q4 3 8 0" />
        </g>
      );
    case 'wide':
      return (
        <g>
          <circle cx="25" cy="34" r="5.5" fill="#fff" />
          <circle cx="39" cy="34" r="5.5" fill="#fff" />
          <circle cx="26" cy="35" r="2.6" fill="#1d232b" />
          <circle cx="40" cy="35" r="2.6" fill="#1d232b" />
        </g>
      );
    case 'glasses':
      return (
        <g>
          <g fill="none" stroke={ink} strokeWidth="2">
            <circle cx="25" cy="35" r="5.5" />
            <circle cx="39" cy="35" r="5.5" />
            <path d="M30.5 35 h3" />
          </g>
          <circle cx="25" cy="35" r="2" fill={ink} />
          <circle cx="39" cy="35" r="2" fill={ink} />
        </g>
      );
    case 'visor':
      return (
        <g>
          <rect x="17" y="30" width="30" height="9" rx="4.5" fill="#1d232b" />
          <rect x="21" y="32.5" width="9" height="2.5" rx="1.25" fill="#7fd1f0" />
        </g>
      );
  }
}

function Mouth({ kind, ink }: { kind: AvatarSpec['mouth']; ink: string }) {
  const line = { fill: 'none', stroke: ink, strokeWidth: 2.4, strokeLinecap: 'round' as const };
  switch (kind) {
    case 'smile':
      return <path d="M26 44 q6 5 12 0" {...line} />;
    case 'grin':
      return <path d="M24 42 q8 10 16 0 z" fill={ink} />;
    case 'flat':
      return <path d="M27 45 h10" {...line} />;
    case 'o':
      return <circle cx="32" cy="45" r="2.6" fill={ink} />;
    case 'smirk':
      return <path d="M26 45 q7 3 12 -3" {...line} />;
  }
}

function Top({ kind }: { kind: AvatarSpec['top'] }) {
  switch (kind) {
    case 'none':
      return null;
    case 'sprout':
      return (
        <g>
          <path d="M32 17 V8" stroke="#3f8f4e" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="27" cy="9" rx="5" ry="2.6" transform="rotate(-25 27 9)" fill="#5cb85c" />
          <ellipse cx="37" cy="7" rx="5" ry="2.6" transform="rotate(25 37 7)" fill="#5cb85c" />
        </g>
      );
    case 'crumbs':
      return (
        <g fill="#8a5a2b">
          <circle cx="24" cy="16" r="1.8" />
          <circle cx="31" cy="13" r="1.6" />
          <circle cx="38" cy="15" r="2" />
          <circle cx="43" cy="19" r="1.4" />
        </g>
      );
    case 'moss':
      return <path d="M13 26 q3 -12 19 -12 q16 0 19 12 q-4 -3 -7 0 q-3 -4 -6 -1 q-3 -4 -6 0 q-3 -4 -6 0 q-3 -3 -6 1 q-4 -3 -7 0 z" fill="#4e7d3a" />;
    case 'bolt':
      return <path d="M34 4 L25 18 h6 l-3 10 l10 -15 h-6 l3 -9 z" fill="#f2994a" stroke="#7a4a12" strokeWidth="1" strokeLinejoin="round" />;
    case 'quill':
      return (
        <g>
          <path d="M40 22 C44 12 50 6 56 4 C54 11 48 17 41 23 z" fill="#f4f5f7" stroke="#5b6fa8" strokeWidth="1.2" />
          <path d="M41 23 L38 27" stroke="#1d232b" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case 'feather':
      return (
        <g>
          <path d="M30 17 C26 9 28 3 34 1 C35 7 34 12 31 17 z" fill="#3d7ea6" />
          <path d="M31 17 C33 10 38 6 43 6 C41 11 37 15 32 18 z" fill="#f4f5f7" stroke="#2f3542" strokeWidth="1" />
        </g>
      );
    case 'flame':
      return <path d="M32 2 C36 8 42 10 40 18 C39 22 35 23 32 23 C28 23 24 21 24 17 C24 12 29 11 28 6 C31 8 31 11 32 13 C34 10 33 6 32 2 z" fill="#f2c94c" stroke="#d9534f" strokeWidth="1.4" />;
    case 'turret':
      return <path d="M18 20 v-8 h5 v4 h4 v-4 h10 v4 h4 v-4 h5 v8 z" fill="#5d6875" />;
    case 'question':
      return (
        <text x="32" y="17" textAnchor="middle" fontSize="16" fontWeight="700" fill="#5c3a8a" fontFamily="system-ui, sans-serif">
          ?
        </text>
      );
    case 'peak':
      return (
        <g>
          <path d="M18 20 L30 4 L36 12 L40 8 L48 20 z" fill="#2a5d7d" />
          <path d="M26 9.3 L30 4 L33.6 8.8 L31 8 L29 10 z" fill="#fff" />
        </g>
      );
  }
}

/** A bot's face, drawn by this app. Decorative: the bot's name is always shown next to it. */
export function BotAvatar({ bot, size = 56 }: { bot: Bot; size?: number }) {
  const a = bot.avatar;
  const ink = luminance(a.face) < 0.18 ? '#f4f5f7' : '#1d232b';
  return (
    <svg className="bot-avatar" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="31" fill={a.back} />
      <circle cx="32" cy="38" r="21" fill={a.face} />
      <Top kind={a.top} />
      <Eyes kind={a.eyes} ink={ink} />
      <Mouth kind={a.mouth} ink={ink} />
    </svg>
  );
}
