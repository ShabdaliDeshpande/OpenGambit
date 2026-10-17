import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  signIn: (username: string, password: string, create: boolean) => Promise<void>;
}

/** Sign in, or create an account. */
export function AccountDialog({ open, onClose, signIn }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [create, setCreate] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(null);
      setPassword('');
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password, create);
      setPassword('');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="account-dialog" onClose={onClose} aria-labelledby="account-title">
      <form onSubmit={submit}>
        <h2 id="account-title">{create ? 'Create an account' : 'Sign in'}</h2>
        <p className="muted">
          {create
            ? 'An account lets you play rated games, keeps your ratings and saves your game history.'
            : 'Sign in to play rated games and keep your history.'}
        </p>
        <label className="field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,19}"
            title="3–20 characters: letters, digits, _ or -"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete={create ? 'new-password' : 'current-password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={create ? 8 : 1}
            maxLength={128}
          />
        </label>
        {create && <p className="muted small">At least 8 characters. There is no password reset yet, so keep it somewhere safe.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row dialog-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Please wait…' : create ? 'Create account' : 'Sign in'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className="muted small">
          {create ? 'Already have an account? ' : 'New here? '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setCreate(c => !c);
              setError(null);
            }}
          >
            {create ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </dialog>
  );
}
