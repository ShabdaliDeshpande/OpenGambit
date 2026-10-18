import { useState } from 'react';
import { changePassword, deleteAccount } from '../../account/api';

interface Props {
  username: string;
  /** Called after the account was deleted. */
  onDeleted: () => void;
}

/** Change password and delete account, shown on your own profile. */
export function AccountSettings({ username, onDeleted }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [delPassword, setDelPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [delError, setDelError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setPwMessage(null);
    try {
      await changePassword(current, next);
      setPwMessage({ ok: true, text: 'Password changed. Your other devices have been signed out.' });
      setCurrent('');
      setNext('');
    } catch (err) {
      setPwMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setDelError(null);
    try {
      await deleteAccount(delPassword, confirm);
      onDeleted();
    } catch (err) {
      setDelError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="panel account-settings" aria-label="Account settings">
      <h2>Account settings</h2>
      <form onSubmit={submitPassword} className="settings-form">
        <h3>Change password</h3>
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <label className="field">
          <span>Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={next} onChange={e => setNext(e.target.value)} required />
        </label>
        {pwMessage && (
          <p className={pwMessage.ok ? 'success' : 'error'} role="status">
            {pwMessage.text}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          Change password
        </button>
      </form>

      <form onSubmit={submitDelete} className="settings-form danger-zone">
        <h3>Delete account</h3>
        <p className="muted small">
          This removes your account, ratings and puzzle history for good. Games you played stay for your opponents, with your name replaced by
          “[deleted]”. It can’t be undone.
        </p>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={delPassword} onChange={e => setDelPassword(e.target.value)} required />
        </label>
        <label className="field">
          <span>Type your username ({username}) to confirm</span>
          <input value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" required />
        </label>
        {delError && (
          <p className="error" role="alert">
            {delError}
          </p>
        )}
        <button type="submit" className="danger" disabled={busy || confirm !== username}>
          Delete my account
        </button>
      </form>
    </section>
  );
}
