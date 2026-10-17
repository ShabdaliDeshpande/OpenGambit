import { useCallback, useEffect, useState } from 'react';
import { fetchMe, logIn, logOut, signUp, type Me } from '../account/api';
import { reconnectOnline } from '../online/client';

export interface AccountState {
  /** undefined while loading, null when signed out. */
  me: Me | null | undefined;
  signIn: (username: string, password: string, create: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => void;
}

/** The signed-in user. Signing in or out reconnects online play under the new identity. */
export function useAccount(): AccountState {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = useCallback(() => {
    fetchMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(refresh, [refresh]);

  const signIn = useCallback(async (username: string, password: string, create: boolean) => {
    const user = await (create ? signUp : logIn)(username, password);
    setMe(user);
    reconnectOnline();
  }, []);

  const signOut = useCallback(async () => {
    await logOut();
    setMe(null);
    reconnectOnline();
  }, []);

  return { me, signIn, signOut, refresh };
}
