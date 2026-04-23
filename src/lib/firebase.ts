import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// Helper to check if config is valid
export const isFirebaseConfigValid = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey.length > 0);

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

if (isFirebaseConfigValid) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    storage = getStorage(app);
  } catch (error) {
    console.error("Failed to initialize Firebase:", error);
  }
}

export { auth, db, storage };

// Standard Error Handler
export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
  }
}

export function handleFirestoreError(error: any, operationType: FirestoreErrorInfo['operationType'], path: string | null): never {
  const info: FirestoreErrorInfo = {
    error: error.message || 'Unknown Firestore error',
    operationType,
    path,
    authInfo: {
      userId: auth?.currentUser?.uid || 'anonymous',
      email: auth?.currentUser?.email || '',
      emailVerified: auth?.currentUser?.emailVerified || false,
      isAnonymous: !auth?.currentUser,
    }
  };
  throw new Error(JSON.stringify(info));
}

// Connectivity check as per integration guidelines
async function testConnection() {
  if (!isFirebaseConfigValid || !db) return;
  try {
    // Only run if db is defined
    await getDocFromServer(doc(db!, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration and network status.");
    }
  }
}

testConnection();
