import { useState } from 'react';
import { builtInServer, normaliseServer, serverBase, setServer } from '../../net/server';

/** Asks a server whether it's an OpenGambit server, allowing for one that's waking up from sleep. */
async function probe(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/me`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return false;
    const data = (await res.json()) as unknown;
    return !!data && typeof data === 'object' && 'user' in data;
  } catch {
    return false;
  }
}

interface Props {
  /** Called once the server is set. */
  onDone?: () => void;
  onCancel?: () => void;
}

/**
 * The Android app's server address. Online play, accounts, tournaments and
 * daily chess all live on an OpenGambit server (`npm start`, or the Docker
 * image); everything else in the app works without one.
 */
export function ServerSetup({ onDone, onCancel }: Props) {
  const current = serverBase();
  const [text, setText] = useState(current || builtInServer() || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const origin = normaliseServer(text);
    if (!origin) {
      setError('Enter the server’s https:// address, for example https://chess.example.com');
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await probe(origin);
    setBusy(false);
    if (!ok) {
      setError(`Couldn’t reach an OpenGambit server at ${origin}. Check the address and your connection.`);
      return;
    }
    setServer(origin);
    onDone?.();
  };

  return (
    <form className="panel server-setup" onSubmit={submit}>
      <h2>Game server</h2>
      <p className="muted">
        Online games, accounts, tournaments and daily chess run on an OpenGambit server. Enter its address to use them. Playing the computer, bots,
        puzzles, lessons and the analysis board work without one.
      </p>
      <label className="field">
        <span>Server address</span>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://chess.example.com"
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={busy}
          required
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="muted" role="status">
          Connecting… a server that was asleep can take up to a minute to wake up.
        </p>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** "Server: host · Change" in the app, so the address can be changed later. */
export function ServerLine({ onChange }: { onChange: () => void }) {
  const base = serverBase();
  if (!base) return null;
  return (
    <p className="muted small server-line">
      Server: {new URL(base).host}{' '}
      <button type="button" className="link-button" onClick={onChange}>
        Change
      </button>
    </p>
  );
}
