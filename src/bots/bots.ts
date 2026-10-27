// The bot gallery (Phase 16). Every bot, name, line of chat and avatar here
// was written for OpenGambit. Ratings are approximate: scripts/bot-ratings.ts
// plays the bots against each other and the engine levels to set them.

import type { Level } from '../engine/search';

export type BotStyleName = 'balanced' | 'attacker' | 'defender' | 'tricky' | 'materialist';

export const STYLE_LABEL: Record<BotStyleName, string> = {
  balanced: 'Balanced',
  attacker: 'Attacker',
  defender: 'Defender',
  tricky: 'Tricky',
  materialist: 'Pawn grabber',
};

export type ChatEvent = 'start' | 'capture' | 'check' | 'blunder' | 'win' | 'loss' | 'draw';

/** How the avatar is drawn (see BotAvatar). */
export interface AvatarSpec {
  face: string;
  back: string;
  eyes: 'round' | 'sleepy' | 'wide' | 'glasses' | 'visor';
  mouth: 'smile' | 'grin' | 'flat' | 'o' | 'smirk';
  top: 'none' | 'sprout' | 'crumbs' | 'moss' | 'bolt' | 'quill' | 'feather' | 'flame' | 'turret' | 'question' | 'peak';
}

export interface Bot {
  id: string;
  name: string;
  /** Approximate rating, from scripts/bot-ratings.ts. */
  rating: number;
  style: BotStyleName;
  tagline: string;
  description: string;
  /** What it likes to play, in words, for its card. */
  openings: string;
  engine: Level;
  /** Lines in SAN from the start position; the bot follows one while the game matches it. */
  repertoire: { white: string[]; black: string[] };
  /** Whether it also plays imported master moves (Phase 13) early on, after its own lines. */
  book: boolean;
  /** Scales how often it talks (1 = the usual chance per event). */
  chatty: number;
  chat: Record<ChatEvent, string[]>;
  avatar: AvatarSpec;
}

export const BOTS: readonly Bot[] = [
  {
    id: 'pebble',
    name: 'Pebble',
    rating: 370,
    style: 'balanced',
    tagline: 'Just learned how the pieces move.',
    description: 'Pebble moves almost at random and often leaves pieces where they can be taken. A friendly first opponent.',
    openings: 'Pushes a centre pawn and hopes for the best.',
    engine: { depth: 1, maxMs: 300, noise: 400, quiescence: false },
    repertoire: { white: ['e4 e5 Nf3', 'd4 d5 Nc3'], black: ['e4 e5', 'd4 d5', 'c4 e5', 'Nf3 Nf6'] },
    book: false,
    chatty: 1.2,
    chat: {
      start: ['Hi! I know how all the pieces move now. Mostly.', 'Let’s play! Which one is the knight again?'],
      capture: ['Ooh, I got one!', 'Is that allowed? It is? Great!'],
      check: ['Check! I think. Yes, check!', 'Your king looks worried.'],
      blunder: ['Wait, can I take that?', 'Was that a present for me?'],
      win: ['I won? I won! I’m telling everyone.', 'Wow. I didn’t expect that either.'],
      loss: ['Good game! I learned a lot. I think.', 'That was fun. Can we play again?'],
      draw: ['A draw! Nobody loses. I like that.'],
    },
    avatar: { face: '#b8bcc2', back: '#e6ebe7', eyes: 'round', mouth: 'smile', top: 'sprout' },
  },
  {
    id: 'biscuit',
    name: 'Biscuit',
    rating: 800,
    style: 'materialist',
    tagline: 'Can’t resist a free pawn.',
    description: 'Biscuit takes anything that’s offered and counts every pawn twice. Leave something hanging and it will snap it up, even when it shouldn’t.',
    openings: 'Accepts every gambit going: the Danish, the Queen’s Gambit, the King’s Gambit.',
    engine: { depth: 1, maxMs: 400, noise: 220, quiescence: true, style: { greed: 25 } },
    repertoire: {
      white: ['e4 e5 Nf3 Nc6 Bc4', 'e4 c5 Nf3'],
      black: ['e4 e5 d4 exd4 c3 dxc3', 'd4 d5 c4 dxc4', 'e4 e5 f4 exf4', 'e4 d5 exd5 Qxd5'],
    },
    book: false,
    chatty: 1,
    chat: {
      start: ['Snacks first, then chess. Actually, pawns are snacks.', 'I hope you brought spare pawns.'],
      capture: ['Mmm, crunchy.', 'Into the tin it goes.', 'Thank you very much!'],
      check: ['Check! Now, where were we? Oh yes, your pawns.'],
      blunder: ['Is that one for me? Don’t mind if I do.', 'Free food!'],
      win: ['Delicious game. Every last crumb.', 'I win, and I kept all the pieces. Well, most.'],
      loss: ['I ate too much and forgot about my king.', 'You were the tougher biscuit today.'],
      draw: ['A draw. We’ll split the last pawn.'],
    },
    avatar: { face: '#d9a35b', back: '#f6e7cf', eyes: 'wide', mouth: 'grin', top: 'crumbs' },
  },
  {
    id: 'moss',
    name: 'Moss',
    rating: 960,
    style: 'defender',
    tagline: 'Slow, steady and hard to knock over.',
    description: 'Moss keeps its king wrapped up tight and swaps pieces whenever it can. It won’t attack you much, but it won’t fall for much either.',
    openings: 'The London System as White, the Caro-Kann and the Slav as Black.',
    engine: { depth: 1, maxMs: 500, noise: 120, quiescence: true, style: { kingGuard: 8, trades: 3 } },
    repertoire: {
      white: ['d4 d5 Bf4 Nf6 e3', 'd4 Nf6 Bf4 g6 e3', 'd4 e6 Bf4'],
      black: ['e4 c6 d4 d5', 'd4 d5 c4 c6', 'Nf3 d5 g3 c6', 'c4 c6'],
    },
    book: false,
    chatty: 0.7,
    chat: {
      start: ['Hello. Let’s take our time.', 'No hurry. The board isn’t going anywhere.'],
      capture: ['A fair trade.', 'Fewer pieces, fewer worries.'],
      check: ['Check. Gently, now.'],
      blunder: ['Hm. Are you sure about that one?', 'I’ll just tidy that up.'],
      win: ['Slow and steady. Good game.', 'Sometimes the quiet way works.'],
      loss: ['You found a way through. Well played.', 'My walls had a gap after all.'],
      draw: ['A peaceful result. I don’t mind at all.'],
    },
    avatar: { face: '#7fa36b', back: '#e2eddb', eyes: 'sleepy', mouth: 'flat', top: 'moss' },
  },
  {
    id: 'sparkplug',
    name: 'Sparkplug',
    rating: 1390,
    style: 'attacker',
    tagline: 'Goes straight for your king.',
    description: 'Sparkplug points every piece at your king and loves a check, sound or not. Keep your defences together and it often overreaches.',
    openings: 'The King’s Gambit and the Italian as White; the Dutch and the Two Knights as Black.',
    engine: { depth: 2, maxMs: 600, noise: 110, quiescence: true, style: { kingAttack: 6, checks: 25 } },
    repertoire: {
      white: ['e4 e5 f4', 'e4 e5 Nf3 Nc6 Bc4', 'e4 c5 Nc3 Nc6 f4'],
      black: ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'd4 f5', 'c4 f5', 'e4 e5 Nf3 Nc6 Bb5 f5'],
    },
    book: false,
    chatty: 1.3,
    chat: {
      start: ['Ready? I’m coming for your king!', 'Buckle up. This won’t be a quiet one.'],
      capture: ['Zap!', 'Out of my way!'],
      check: ['Check! Feel the spark?', 'Check, check, check!', 'Your king is getting warm.'],
      blunder: ['Ooh, that opens things up nicely.', 'You just let me in!'],
      win: ['Boom! That’s how you finish an attack.', 'Full charge, every time.'],
      loss: ['I ran out of spark. Nicely defended.', 'Too much attack, not enough pieces.'],
      draw: ['A draw? My battery needs a rest anyway.'],
    },
    avatar: { face: '#f2c94c', back: '#fdf3cf', eyes: 'wide', mouth: 'grin', top: 'bolt' },
  },
  {
    id: 'inkwell',
    name: 'Inkwell',
    rating: 1650,
    style: 'balanced',
    tagline: 'Thinks before writing a move down.',
    description: 'Inkwell plays neat, sensible chess: it develops, takes the centre and rarely gives anything away for free.',
    openings: 'The English as White; the French and the Queen’s Indian set-up as Black.',
    engine: { depth: 3, maxMs: 800, noise: 70, quiescence: true },
    repertoire: {
      white: ['c4 e5 Nc3 Nf6 g3', 'c4 Nf6 Nc3 e6 Nf3', 'c4 c5 Nc3 Nc6 g3'],
      black: ['e4 e6 d4 d5', 'd4 Nf6 c4 e6', 'Nf3 Nf6 c4 e6', 'c4 Nf6'],
    },
    book: false,
    chatty: 0.8,
    chat: {
      start: ['Good day. Shall we begin?', 'A fresh page. Let’s write something good.'],
      capture: ['Noted.', 'That goes in the margin.'],
      check: ['Check, if you please.'],
      blunder: ['Ah, a smudge. I’ll take advantage of that.', 'I believe that was a slip of the pen.'],
      win: ['A tidy game, I think. Thank you.', 'Signed, sealed and finished.'],
      loss: ['Well written. You earned that.', 'I’ll be rereading this one.'],
      draw: ['A draw. A fair summary of the game.'],
    },
    avatar: { face: '#5b6fa8', back: '#e1e6f4', eyes: 'glasses', mouth: 'smile', top: 'quill' },
  },
  {
    id: 'magpie',
    name: 'Magpie',
    rating: 1680,
    style: 'tricky',
    tagline: 'Leaves shiny things lying around.',
    description: 'Magpie picks moves that set traps: a piece that looks free, a check that leads nowhere. Ask yourself why it left that there.',
    openings: 'Trappy lines like the Blackburne Shilling and the Albin Countergambit.',
    engine: { depth: 3, maxMs: 900, noise: 50, quiescence: true, style: { traps: 60 } },
    repertoire: {
      white: ['e4 e5 Nf3 d6 Bc4 Bg4 Nc3', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5'],
      black: ['e4 e5 Nf3 Nc6 Bc4 Nd4', 'd4 d5 c4 e5', 'Nf3 d5 c4 d4', 'c4 e5'],
    },
    book: false,
    chatty: 1,
    chat: {
      start: ['Hello, hello. See anything you like?', 'Let’s see what you pick up today.'],
      capture: ['Mine now.', 'Shiny!'],
      check: ['Check! Didn’t see that coming, did you?'],
      blunder: ['Oh, you took the bait!', 'Heh. I was hoping you’d do that.'],
      win: ['Never trust a free piece.', 'All my little tricks worked out.'],
      loss: ['You saw through every trick. Impressive.', 'Not one bite. Well played.'],
      draw: ['A draw. I’ll hide better traps next time.'],
    },
    avatar: { face: '#2f3542', back: '#dfe3ea', eyes: 'round', mouth: 'smirk', top: 'feather' },
  },
  {
    id: 'bonfire',
    name: 'Bonfire',
    rating: 1920,
    style: 'attacker',
    tagline: 'Gambits first, questions later.',
    description: 'Bonfire throws pawns into the fire to open lines against your king. Its attacks are faster and better aimed than Sparkplug’s.',
    openings: 'The Smith-Morra and Evans gambits as White; the Dragon and the King’s Indian as Black.',
    engine: { depth: 4, maxMs: 1200, noise: 30, quiescence: true, style: { kingAttack: 5, checks: 20 } },
    repertoire: {
      white: ['e4 c5 d4 cxd4 c3', 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4', 'e4 e6 d4 d5 Nc3 Nf6 Bg5'],
      black: ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'd4 Nf6 c4 g6 Nc3 Bg7', 'c4 g6', 'Nf3 Nf6 c4 g6'],
    },
    book: true,
    chatty: 1.1,
    chat: {
      start: ['Let’s light this up.', 'Hope you like it hot.'],
      capture: ['More fuel!', 'Into the flames.'],
      check: ['Check! Feel the heat?', 'The fire’s at your door.'],
      blunder: ['That’s the spark I needed.', 'Now it really catches.'],
      win: ['Burned right through. Good game!', 'Nothing left but embers.'],
      loss: ['You put the fire out. Respect.', 'Too much smoke, not enough fire.'],
      draw: ['A draw. The fire burned itself out.'],
    },
    avatar: { face: '#e0663a', back: '#fbe1d5', eyes: 'wide', mouth: 'grin', top: 'flame' },
  },
  {
    id: 'bastion',
    name: 'Bastion',
    rating: 2090,
    style: 'defender',
    tagline: 'A fortress with a plan.',
    description: 'Bastion defends patiently, trades your attackers away and waits for you to overstretch. Beating it takes real pressure.',
    openings: 'The Queen’s Gambit Declined on both sides, and the Caro-Kann.',
    engine: { depth: 5, maxMs: 1500, noise: 15, quiescence: true, style: { kingGuard: 6, trades: 2 } },
    repertoire: {
      white: ['d4 d5 c4 e6 Nc3 Nf6 Bg5', 'd4 Nf6 c4 e6 Nf3 b6 g3', 'Nf3 d5 g3'],
      black: ['e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5', 'd4 d5 c4 e6', 'c4 e6', 'Nf3 d5'],
    },
    book: true,
    chatty: 0.6,
    chat: {
      start: ['The gates are closed. Try to open them.', 'Let’s see how patient you are.'],
      capture: ['One less attacker.', 'Repelled.'],
      check: ['Check. A counterattack.'],
      blunder: ['A crack in your position. I’ll widen it.', 'That weakens you more than you think.'],
      win: ['The walls held, and then I came out.', 'Patience wins again.'],
      loss: ['You broke through. Not many do.', 'The fortress fell. Well played.'],
      draw: ['A draw. Neither wall gave way.'],
    },
    avatar: { face: '#8a8f98', back: '#e6e8eb', eyes: 'visor', mouth: 'flat', top: 'turret' },
  },
  {
    id: 'riddle',
    name: 'Riddle',
    rating: 2120,
    style: 'tricky',
    tagline: 'Every move is a question.',
    description: 'Riddle plays strong, sound moves that still ask you a question each turn. The obvious reply is often the wrong one.',
    openings: 'The Ruy Lopez and the Open Sicilian as White; sharp Sicilians and the Albin as Black.',
    engine: { depth: 5, maxMs: 1500, noise: 12, quiescence: true, style: { traps: 50 } },
    repertoire: {
      white: ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3'],
      black: ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 e5', 'd4 d5 c4 e5', 'c4 e5', 'Nf3 d5'],
    },
    book: true,
    chatty: 0.9,
    chat: {
      start: ['Here’s a riddle: who wins this one?', 'Think twice. Then think again.'],
      capture: ['One question answered.', 'That was the easy part.'],
      check: ['Check. What now?'],
      blunder: ['Wrong answer, I’m afraid.', 'That’s what I hoped you’d say.'],
      win: ['Solved. Better luck next time.', 'The answer was in the position all along.'],
      loss: ['You solved me. Well done.', 'A clever answer to a hard question.'],
      draw: ['A draw. Some riddles have no answer.'],
    },
    avatar: { face: '#8e5bc2', back: '#ece2f6', eyes: 'round', mouth: 'smirk', top: 'question' },
  },
  {
    id: 'summit',
    name: 'Summit',
    rating: 2500,
    style: 'balanced',
    tagline: 'The top of the mountain.',
    description: 'Summit is OpenGambit’s strongest bot: deep, accurate and patient, with master openings when the server has them.',
    openings: 'Main lines: the Ruy Lopez and the Nimzo-Indian; the Sicilian and the Nimzo as Black.',
    engine: { depth: 7, maxMs: 2500, noise: 0, quiescence: true },
    repertoire: {
      white: ['e4 e5 Nf3 Nc6 Bb5', 'd4 Nf6 c4 e6 Nc3 Bb4 Qc2'],
      black: ['e4 c5', 'd4 Nf6 c4 e6', 'c4 Nf6', 'Nf3 Nf6'],
    },
    book: true,
    chatty: 0.5,
    chat: {
      start: ['Welcome to the summit. It’s a long climb.', 'Good luck. You’ll need a plan.'],
      capture: ['Expected.', 'As calculated.'],
      check: ['Check.'],
      blunder: ['That changes the evaluation a lot.', 'A costly step on a steep slope.'],
      win: ['A good climb. Try again from base camp.', 'Thank you for the game.'],
      loss: ['You reached the summit. Remarkable.', 'Very well played. I have nothing to add.'],
      draw: ['A draw at altitude. A fine result.'],
    },
    avatar: { face: '#3d7ea6', back: '#dcebf4', eyes: 'sleepy', mouth: 'smile', top: 'peak' },
  },
];

export const botById = (id: string) => BOTS.find(b => b.id === id);
