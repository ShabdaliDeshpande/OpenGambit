import { useCallback, useEffect, useState } from 'react';
import { fetchLearnProgress, saveLearnProgress } from '../account/api';
import { mergeProgress, type Progress } from '../learn/progress';

const KEY = 'chess-app:learn';

function load(): Progress {
  try {
    return mergeProgress({}, JSON.parse(localStorage.getItem(KEY) ?? '{}') as Progress);
  } catch {
    return {};
  }
}

function store(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // not remembered in this browser
  }
}

/**
 * Learning progress, kept in the browser and, when signed in, on the account.
 * Signing in merges the two (the better result of each wins).
 */
export function useLearnProgress(signedIn: boolean) {
  const [progress, setProgress] = useState<Progress>(load);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetchLearnProgress()
      .then(saved => {
        if (cancelled) return;
        const local = load();
        const merged = mergeProgress(saved, local);
        setProgress(merged);
        store(merged);
        // anything better here than on the account goes up
        if (Object.keys(merged).some(k => merged[k] !== saved[k])) void saveLearnProgress(local).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  /** Records one result; only an improvement changes anything. */
  const record = useCallback(
    (key: string, value: number) => {
      setProgress(p => {
        const next = mergeProgress(p, { [key]: value });
        if (next[key] === p[key]) return p;
        store(next);
        if (signedIn) void saveLearnProgress({ [key]: value }).catch(() => undefined);
        return next;
      });
    },
    [signedIn],
  );

  return { progress, record };
}
