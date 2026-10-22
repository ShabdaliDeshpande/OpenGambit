import { useCallback, useEffect, useState } from 'react';
import { fetchRuns, submitRun, type Me, type RunBests, type RunMode } from '../account/api';

const KEY = 'chess-app:puzzle-runs';
const EMPTY: RunBests = { streak: { best: 0, today: 0 }, storm: { best: 0, today: 0 } };
const today = () => new Date().toISOString().slice(0, 10);

interface Local {
  date: string;
  bests: RunBests;
}

function loadLocal(): RunBests {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const saved = JSON.parse(raw) as Local;
    // "today" resets at midnight UTC, like the server's
    if (saved.date !== today()) return { streak: { best: saved.bests.streak.best, today: 0 }, storm: { best: saved.bests.storm.best, today: 0 } };
    return saved.bests;
  } catch {
    return EMPTY;
  }
}

function saveLocal(bests: RunBests) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ date: today(), bests } satisfies Local));
  } catch {
    // not saved: bests last for this visit
  }
}

/** Best Streak and Storm scores: on the server when signed in, in this browser for guests. */
export function useRunBests(me: Me | null) {
  const [bests, setBests] = useState<RunBests>(loadLocal);

  useEffect(() => {
    if (!me) {
      setBests(loadLocal());
      return;
    }
    let cancelled = false;
    fetchRuns()
      .then(b => !cancelled && setBests(b))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [me?.id]);

  /** Records a finished run; resolves to whether it's a new personal best. */
  const record = useCallback(
    async (mode: RunMode, score: number): Promise<boolean> => {
      if (me) {
        const res = await submitRun(mode, score);
        setBests({ streak: res.streak, storm: res.storm });
        return res.newBest;
      }
      const current = loadLocal();
      const newBest = score > current[mode].best;
      const next = { ...current, [mode]: { best: Math.max(current[mode].best, score), today: Math.max(current[mode].today, score) } };
      saveLocal(next);
      setBests(next);
      return newBest;
    },
    [me],
  );

  return { bests, record };
}
