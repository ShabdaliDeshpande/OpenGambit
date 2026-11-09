import { useSyncExternalStore } from 'react';
import { onServerChange, serverBase } from '../net/server';

/** The server address (see serverBase), re-rendering when the app's server changes. */
export function useServer(): string | null {
  return useSyncExternalStore(onServerChange, serverBase, serverBase);
}
