import { useEffect, useState } from 'react';
import { ApiError, fetchMe } from '../../account/api';
import { FLAIRS } from '../../account/flair';
import { fetchVacation, setFlair, setVacation, type VacationInfo } from '../../daily/api';
import { BROWSER_NOTIFY_KEY, browserNotifyOn } from '../NotificationBell';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

/** Flair, vacation and browser notifications, in your account settings. */
export function DailySettings({ onChanged }: { onChanged: () => void }) {
  const [flair, setChosen] = useState<string | null | undefined>(undefined);
  const [vacation, setVac] = useState<VacationInfo | null>(null);
  const [days, setDays] = useState(7);
  const [notify, setNotify] = useState(browserNotifyOn);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe()
      .then(me => setChosen(me?.flair ?? null))
      .catch(() => setChosen(null));
    fetchVacation()
      .then(setVac)
      .catch(() => undefined);
  }, []);

  const pick = (f: string | null) => {
    setChosen(f);
    setFlair(f)
      .then(() => {
        setError(null);
        onChanged();
      })
      .catch(e => setError(errorText(e)));
  };

  const vacationChange = (d: number | null) =>
    void setVacation(d)
      .then(v => {
        setVac(v);
        setError(null);
      })
      .catch(e => setError(errorText(e)));

  const toggleNotify = async (on: boolean) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const answer = await Notification.requestPermission();
      if (answer !== 'granted') return setError('Your browser didn’t allow notifications. You can change that in its site settings.');
    }
    try {
      localStorage.setItem(BROWSER_NOTIFY_KEY, on ? '1' : '0');
    } catch {
      // not remembered in this browser
    }
    setNotify(on);
    setError(null);
  };

  return (
    <>
      <div className="settings-form">
        <h3>Flair</h3>
        <p className="muted small">An emoji shown next to your name in the lobby, in games, on leaderboards and on your profile.</p>
        <div className="flair-grid" role="radiogroup" aria-label="Flair">
          <button type="button" role="radio" aria-checked={flair === null} className={flair === null ? 'on' : ''} onClick={() => pick(null)} disabled={flair === undefined}>
            None
          </button>
          {FLAIRS.map(f => (
            <button key={f} type="button" role="radio" aria-checked={flair === f} className={flair === f ? 'on' : ''} onClick={() => pick(f)} disabled={flair === undefined}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-form">
        <h3>Vacation</h3>
        {!vacation ? (
          <p className="muted small">Loading…</p>
        ) : vacation.on ? (
          <>
            <p className="small">
              You’re on vacation until {new Date(vacation.until!).toLocaleString()}. Your daily clocks are paused and you can’t start new daily games.
            </p>
            <button type="button" onClick={() => vacationChange(null)}>
              End vacation now
            </button>
            <p className="muted small">Whole days you haven’t started are given back.</p>
          </>
        ) : (
          <>
            <p className="small">
              Pause your clocks in every daily game. You have {vacation.left} of {vacation.perYear} days left this year; days are used whole.
            </p>
            <div className="row">
              <label>
                Days{' '}
                <select value={Math.min(days, Math.max(1, vacation.left))} onChange={e => setDays(Number(e.target.value))} disabled={vacation.left === 0}>
                  {Array.from({ length: Math.max(1, vacation.left) }, (_v, i) => i + 1).map(d => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={vacation.left === 0} onClick={() => vacationChange(Math.min(days, vacation.left))}>
                Start vacation
              </button>
            </div>
          </>
        )}
      </div>

      <div className="settings-form">
        <h3>Notifications</h3>
        <label className="check">
          <input type="checkbox" checked={notify} onChange={e => void toggleNotify(e.target.checked)} disabled={typeof Notification === 'undefined'} /> Show system notifications in this browser
        </label>
        <p className="muted small">While OpenGambit is open in a tab, new notifications (your move, a challenge, time running out) also pop up when the tab is in the background. The bell 🔔 always lists them.</p>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}
