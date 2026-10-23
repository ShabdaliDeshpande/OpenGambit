import { DEFAULT_POSITION, validateFen } from 'chess.js';
import { createRoot, isWhiteMove, makeChild, moveNumber, type GameTree, type TreeNode } from './tree';
import { joinComment, splitComment } from './shapes';

/**
 * PGN reader and writer for game trees, including variations, comments and
 * NAGs (chess.js keeps only the main line, so the tree needs its own).
 */

// ------------------------------------------------------------------ writing

const SEVEN_TAGS = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
const escapeTag = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const cleanComment = (c: string) => c.replace(/[{}]/g, '').trim();
/** The comment written after a node: its drawn shapes as [%cal]/[%csl] commands, then its text. */
const commentOf = (node: TreeNode) => joinComment(cleanComment(node.comment), node.shapes);
const hasComment = (node: TreeNode) => commentOf(node) !== '';

function moveTokens(node: TreeNode, forceNumber: boolean): string[] {
  const n = moveNumber(node);
  const tokens = [isWhiteMove(node) ? `${n}. ${node.san}` : forceNumber ? `${n}... ${node.san}` : node.san];
  for (const nag of node.nags) tokens.push(`$${nag}`);
  if (hasComment(node)) tokens.push(`{ ${commentOf(node)} }`);
  return tokens;
}

/** Tokens for everything after `parent`, main line first with variations in parentheses. */
function lineTokens(parent: TreeNode, forceNumber: boolean): string[] {
  const out: string[] = [];
  let node = parent;
  let force = forceNumber;
  while (node.children.length > 0) {
    const [main, ...alternatives] = node.children as [TreeNode, ...TreeNode[]];
    out.push(...moveTokens(main, force));
    force = hasComment(main);
    for (const alt of alternatives) {
      out.push(`(${[...moveTokens(alt, true), ...lineTokens(alt, hasComment(alt))].join(' ')})`);
      force = true;
    }
    node = main;
  }
  return out;
}

export function writePgn(tree: GameTree): string {
  const { root } = tree;
  const result = tree.headers.Result ?? '*';
  const headers: Record<string, string> = {
    Event: '?',
    Site: '?',
    Date: '????.??.??',
    Round: '?',
    White: '?',
    Black: '?',
    ...tree.headers,
    Result: result,
  };
  if (root.fen !== DEFAULT_POSITION) {
    headers.SetUp = '1';
    headers.FEN = root.fen;
  } else {
    delete headers.SetUp;
    delete headers.FEN;
  }
  const ordered = [...SEVEN_TAGS, ...Object.keys(headers).filter(k => !SEVEN_TAGS.includes(k))];
  const tagLines = ordered.map(k => `[${k} "${escapeTag(headers[k]!)}"]`);

  const tokens: string[] = [];
  if (hasComment(root)) tokens.push(`{ ${commentOf(root)} }`);
  tokens.push(...lineTokens(root, true), result);
  return `${tagLines.join('\n')}\n\n${wrap(tokens.join(' '), 80)}\n`;
}

function wrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

// ------------------------------------------------------------------ reading

type Token =
  | { t: 'tag'; key: string; value: string }
  | { t: 'comment'; text: string }
  | { t: 'open' }
  | { t: 'close' }
  | { t: 'nag'; n: number }
  | { t: 'result'; value: string }
  | { t: 'san'; text: string };

const SUFFIX_NAGS: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const s = text.replace(/\r\n?/g, '\n');
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '%' && (i === 0 || s[i - 1] === '\n')) {
      i = s.indexOf('\n', i) < 0 ? s.length : s.indexOf('\n', i); // escape line
    } else if (ch === '[') {
      const m = /^\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]/.exec(s.slice(i));
      if (!m) throw new Error(`Malformed header near "${s.slice(i, i + 30)}"`);
      tokens.push({ t: 'tag', key: m[1]!, value: m[2]!.replace(/\\(.)/g, '$1') });
      i += m[0].length;
    } else if (ch === '{') {
      const end = s.indexOf('}', i);
      if (end < 0) throw new Error('Unclosed comment');
      tokens.push({ t: 'comment', text: s.slice(i + 1, end).trim().replace(/\s+/g, ' ') });
      i = end + 1;
    } else if (ch === ';') {
      const end = s.indexOf('\n', i);
      tokens.push({ t: 'comment', text: s.slice(i + 1, end < 0 ? s.length : end).trim() });
      i = end < 0 ? s.length : end;
    } else if (ch === '(') {
      tokens.push({ t: 'open' });
      i++;
    } else if (ch === ')') {
      tokens.push({ t: 'close' });
      i++;
    } else if (ch === '$') {
      const m = /^\$(\d+)/.exec(s.slice(i));
      if (!m) throw new Error('Malformed NAG');
      tokens.push({ t: 'nag', n: Number(m[1]) });
      i += m[0].length;
    } else {
      const m = /^[^\s(){};$[]+/.exec(s.slice(i))!;
      const word = m[0];
      i += word.length;
      if (RESULTS.has(word)) tokens.push({ t: 'result', value: word });
      else {
        // strip a leading move number ("12." / "12..." / "12...e5")
        const stripped = word.replace(/^\d+\.+/, '');
        if (!stripped) continue;
        const glyph = /[!?]+$/.exec(stripped)?.[0];
        const san = glyph ? stripped.slice(0, -glyph.length) : stripped;
        if (san) tokens.push({ t: 'san', text: san });
        if (glyph && SUFFIX_NAGS[glyph]) tokens.push({ t: 'nag', n: SUFFIX_NAGS[glyph] });
      }
    }
  }
  return tokens;
}

/** Mutable node used while parsing; converted to the immutable shape at the end. */
interface Builder {
  node: TreeNode;
  children: Builder[];
}

const freeze = (b: Builder): TreeNode => ({ ...b.node, children: b.children.map(freeze) });

/** Reads the first game in `text`. Throws a readable error on invalid input. */
export function readPgn(text: string): GameTree {
  const tokens = tokenize(text);
  const headers: Record<string, string> = {};
  let i = 0;
  for (; i < tokens.length && tokens[i]!.t === 'tag'; i++) {
    const tok = tokens[i] as Extract<Token, { t: 'tag' }>;
    headers[tok.key] = tok.value;
  }

  let fen = DEFAULT_POSITION;
  if (headers.FEN) {
    const v = validateFen(headers.FEN);
    if (!v.ok) throw new Error(`Invalid FEN header: ${v.error}`);
    fen = headers.FEN;
  }
  const root: Builder = { node: createRoot(fen), children: [] };

  // `line` is the chain of builders from the root to the current move
  let line: Builder[] = [root];
  const stack: Builder[][] = [];
  let pendingComment = '';
  let sawMove = false;

  const current = () => line[line.length - 1]!;
  const addComment = (b: Builder, raw: string) => {
    // drawn arrows and circles come out of the comment into the node's shapes
    const { text, shapes } = splitComment(raw);
    const comment = text ? (b.node.comment ? `${b.node.comment} ${text}` : text) : b.node.comment;
    b.node = { ...b.node, comment, ...(shapes.length ? { shapes: [...(b.node.shapes ?? []), ...shapes] } : {}) };
  };

  for (; i < tokens.length; i++) {
    const tok = tokens[i]!;
    switch (tok.t) {
      case 'tag':
        if (sawMove) i = tokens.length; // the next game begins: stop
        break;
      case 'comment':
        if (tokens[i - 1]?.t === 'open') pendingComment = tok.text; // opens a variation: belongs to its first move
        else if (!sawMove) addComment(root, tok.text);
        else addComment(current(), tok.text);
        break;
      case 'open': {
        if (line.length < 2) throw new Error('Variation without a preceding move');
        stack.push(line);
        line = line.slice(0, -1); // the variation is an alternative to the last move
        break;
      }
      case 'close':
        if (!stack.length) throw new Error('Unbalanced ")"');
        line = stack.pop()!;
        break;
      case 'nag': {
        const b = current();
        if (b !== root) b.node = { ...b.node, nags: [...new Set([...b.node.nags, tok.n])].sort((x, y) => x - y) };
        break;
      }
      case 'result':
        if (stack.length === 0) {
          if (!headers.Result || headers.Result === '*') headers.Result = tok.value;
          i = tokens.length;
        }
        break;
      case 'san': {
        const parent = current();
        let child: TreeNode;
        try {
          child = makeChild(parent.node, tok.text);
        } catch {
          throw new Error(`Illegal move "${tok.text}" after ${parent.node.san ? `${moveNumber(parent.node)}${isWhiteMove(parent.node) ? '.' : '...'} ${parent.node.san}` : 'the start'}`);
        }
        let b = parent.children.find(c => c.node.id === child.id);
        if (!b) {
          b = { node: child, children: [] };
          parent.children.push(b);
        }
        if (pendingComment) {
          addComment(b, pendingComment);
          pendingComment = '';
        }
        line = [...line, b];
        sawMove = true;
        break;
      }
    }
  }
  if (stack.length) throw new Error('Unclosed variation "("');
  return { root: freeze(root), headers };
}
