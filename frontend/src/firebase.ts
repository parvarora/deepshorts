// Optional Firebase (Firestore) integration for the "Share Drama" public link.
// Lazy-loaded so the whole app runs fine with Firebase unconfigured.
import type { Script } from "./types";

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

export const firebaseEnabled = Boolean(cfg.apiKey && cfg.projectId);

let _db: any = null;

async function db() {
  if (_db) return _db;
  const { initializeApp } = await import("firebase/app");
  const { getFirestore } = await import("firebase/firestore");
  _db = getFirestore(initializeApp(cfg));
  return _db;
}

/** Save a drama and return its public id. */
export async function shareDrama(script: Script): Promise<string> {
  const { collection, addDoc } = await import("firebase/firestore");
  const ref = await addDoc(collection(await db(), "dramas"), {
    script,
    createdAt: Date.now(),
  });
  return ref.id;
}

/** Load a shared drama by id (null if missing). */
export async function getDrama(id: string): Promise<Script | null> {
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(await db(), "dramas", id));
  return snap.exists() ? ((snap.data() as any).script as Script) : null;
}
