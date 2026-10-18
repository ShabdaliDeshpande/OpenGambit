import { useEffect, useRef, useSyncExternalStore } from 'react';
import { onSoundSetting, playSound, setSoundOn, soundOn } from '../sound/sounds';

/** A closing sound when the game ends (move sounds come from the board). */
export function useGameEndSound(ended: boolean): void {
  const wasEnded = useRef(ended);
  useEffect(() => {
    if (ended && !wasEnded.current) playSound('end');
    wasEnded.current = ended;
  }, [ended]);
}

/** A short beep the moment your clock drops under ten seconds. */
export function useLowTimeWarning(ms: number | null, ticking: boolean): void {
  const low = ms !== null && ms > 0 && ms < 10_000;
  const warned = useRef(false);
  useEffect(() => {
    if (!ticking || ms === null || ms >= 10_000) {
      warned.current = false;
      return;
    }
    if (low && !warned.current) {
      warned.current = true;
      playSound('lowtime');
    }
  }, [low, ticking, ms]);
}

/** The sound on/off setting, shared by the whole app. */
export function useSoundSetting(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(onSoundSetting, soundOn, () => true);
  return [on, setSoundOn];
}
