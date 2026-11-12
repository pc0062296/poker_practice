import type { HandRecord } from '../engine/hand';
import type { PreflopGrade } from '../grading/preflop';

/** A finished hand as stored on the device. */
export interface StoredHand {
  id?: number;
  time: number;
  heroIndex: number;
  /** Hero's result for the hand in chips. */
  heroNet: number;
  record: HandRecord;
  preflopGrades: PreflopGrade[];
}

const DB_NAME = 'poker-practice';
const DB_VERSION = 1;
const STORE = 'hands';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('time', 'time');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open the database'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** Save a finished hand. Failures are reported to the caller, never thrown into the game loop. */
export async function saveHand(hand: StoredHand): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(hand);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Write aborted'));
    });
    return true;
  } catch {
    return false;
  }
}

/** Number of hands stored on this device. */
export async function countHands(): Promise<number> {
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Count failed'));
    });
  } catch {
    return 0;
  }
}
