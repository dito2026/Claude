import type { Backend } from './backend';
import { FirestoreBackend } from './firestore';
import { LocalBackend } from './local';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const cloudConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export const backend: Backend = cloudConfigured
  ? new FirestoreBackend(firebaseConfig)
  : new LocalBackend();

export * from './backend';
