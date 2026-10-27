import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNotifications, markNotificationsSeen, type Notification } from '../daily/api';

const POLL_MS = 60_000;
export const BROWSER_NOTIFY_KEY = 'chess-app:browser-notify';

/** Whether this browser should show system notifications (you said yes, and so did the browser). */
export function browserNotifyOn(): boolean {
  try {
    return localStorage.getItem(BROWSER_NOTIFY_KEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/** The address a notification opens. */
export const notificationUrl = (n: Pick<Notification, 'kind' | 'link'>) => (n.link ? (n.kind === 'tour' ? `?dailytour=${n.link}` : `?daily=${n.link}`) : '?daily');

function showSystem(n: Notification) {
  const url = notificationUrl(n);
  const options = { body: n.text, tag: n.id, data: { url }, icon: '/icons/icon-192.png' };
  navigator.serviceWorker?.ready
    .then(reg => reg.showNotification('OpenGambit', options))
    .catch(() => new Notification('OpenGambit', options));
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Your notifications (daily games, challenges, tournaments), polled while the app is open. */
export function NotificationBell({ onOpen }: { onOpen: (url: string) => void }) {
  const [list, setList] = useState<Notification[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [open, setOpen] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const poll = useCallback(() => {
    fetchNotifications()
      .then(r => {
        // new ones pop up as system notifications while the tab is in the background
        if (known.current && document.hidden && browserNotifyOn()) for (const n of r.list) if (!n.seen && !known.current.has(n.id)) showSystem(n);
        known.current = new Set(r.list.map(n => n.id));
        setList(r.list);
        setUnseen(r.unseen);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    window.addEventListener('focus', poll);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', poll);
    };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const seen = (ids: string[] | null) =>
    void markNotificationsSeen(ids)
      .then(r => {
        setList(r.list);
        setUnseen(r.unseen);
      })
      .catch(() => undefined);

  return (
    <div className="bell" ref={wrap}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={unseen ? `Notifications, ${unseen} new` : 'Notifications'} title="Notifications">
        🔔{unseen > 0 && <span className="bell-count">{unseen > 99 ? '99+' : unseen}</span>}
      </button>
      {open && (
        <div className="bell-panel panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unseen > 0 && (
              <button type="button" className="link-button" onClick={() => seen(null)}>
                Mark all read
              </button>
            )}
          </div>
          {list.length === 0 ? (
            <p className="muted small">Nothing yet. Daily games, challenges and tournaments will show up here.</p>
          ) : (
            <ul>
              {list.map(n => (
                <li key={n.id} className={n.seen ? '' : 'new'}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.seen) seen([n.id]);
                      setOpen(false);
                      onOpen(notificationUrl(n));
                    }}
                  >
                    <span>{n.text}</span>
                    <span className="muted small">{ago(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
