import { formatClock } from '../chess/clock';

const LOW_TIME_MS = 10_000;

export function ClockDisplay({ ms, running, label }: { ms: number; running: boolean; label: string }) {
  const classes = ['clock'];
  if (running) classes.push('running');
  if (ms < LOW_TIME_MS) classes.push('low');
  if (ms <= 0) classes.push('flagged');
  return (
    <div className={classes.join(' ')} aria-label={`${label} clock`} role="timer">
      {formatClock(ms)}
    </div>
  );
}
