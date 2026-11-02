import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { backend, type AuthUser } from '../data';
import type { UserProfile } from '../lib/types';
import { can, type Permission } from './permissions';
import type { Actor } from '../services/common';

interface AuthState {
  user: AuthUser | null;
  profile: UserProfile | null;
  loading: boolean;
  actor: Actor;
  can: (p: Permission) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);

  useEffect(
    () =>
      backend.auth.onChange((u) => {
        setUser(u);
        setAuthReady(true);
      }),
    [],
  );

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setProfileReady(true);
      return;
    }
    setProfileReady(false);
    return backend.subscribeDoc<UserProfile>('users', user.uid, (p) => {
      setProfile(p);
      setProfileReady(true);
    });
  }, [user]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      profile,
      loading: !authReady || !profileReady,
      actor: { uid: user?.uid ?? 'anon', name: profile?.name ?? user?.email ?? 'Usuario' },
      can: (p) => !!profile?.active && can(profile.role, p),
      signIn: (e, pw) => backend.auth.signIn(e, pw),
      signOut: () => backend.auth.signOut(),
    }),
    [user, profile, authReady, profileReady],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
