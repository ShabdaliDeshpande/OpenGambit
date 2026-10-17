import { useState } from 'react';

interface Props {
  pgn: string;
  fen: string;
  onLoadPgn: (text: string) => void;
  onLoadFen: (text: string) => void;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function PgnFenPanel({ pgn, fen, onLoadPgn, onLoadFen }: Props) {
  const [input, setInput] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      setMessage({ kind: 'ok', text: ok });
      setInput('');
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const copyWithMessage = async (text: string, what: string) =>
    setMessage((await copy(text)) ? { kind: 'ok', text: `${what} copied.` } : { kind: 'error', text: 'Clipboard not available.' });

  return (
    <section className="panel pgn" aria-label="PGN and FEN">
      <h2>Import / export</h2>
      <label className="field">
        <span>FEN (shown position)</span>
        <input readOnly value={fen} onFocus={e => e.currentTarget.select()} />
      </label>
      <label className="field">
        <span>PGN</span>
        <textarea readOnly rows={5} value={pgn} onFocus={e => e.currentTarget.select()} />
      </label>
      <div className="row">
        <button type="button" onClick={() => copyWithMessage(fen, 'FEN')}>
          Copy FEN
        </button>
        <button type="button" onClick={() => copyWithMessage(pgn, 'PGN')}>
          Copy PGN
        </button>
      </div>
      <label className="field">
        <span>Paste PGN or FEN to load</span>
        <textarea rows={4} value={input} onChange={e => setInput(e.target.value)} placeholder="1. e4 e5 2. Nf3 …  or  a FEN string" />
      </label>
      <div className="row">
        <button type="button" disabled={!input.trim()} onClick={() => run(() => onLoadPgn(input), 'PGN loaded.')}>
          Load PGN
        </button>
        <button type="button" disabled={!input.trim()} onClick={() => run(() => onLoadFen(input), 'Position loaded.')}>
          Load FEN
        </button>
      </div>
      {message && (
        <p className={message.kind === 'error' ? 'error' : 'muted'} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
