import type { HandRecord } from '../engine/hand';
import type { PostflopGrade } from '../grading/postflop';
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
  /** Postflop grades; missing while grading has not finished. */
  postflopGrades?: PostflopGrade[];
  /** Seat profiles at the time of the hand (needed to re-grade it). */
  profiles?: string[];
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

/** Save a finished hand and return its id, or null when storage failed. Never throws. */
export async function saveHand(hand: StoredHand): Promise<number | null> {
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const request = tx.objectStore(STORE).add(hand);
      tx.oncomplete = () => resolve(request.result as number);
      tx.onerror = () => reject(tx.error ?? new Error('Write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Write aborted'));
    });
  } catch {
    return null;
  }
}

/** Merge fields into a stored hand. Never throws. */
export async function updateHand(id: number, patch: Partial<StoredHand>): Promise<boolean> {
  try {
    const db = await openDb();
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const get = store.get(id);
      get.onsuccess = () => {
        if (get.result) store.put({ ...(get.result as StoredHand), ...patch, id });
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error ?? new Error('Write failed'));
    });
  } catch {
    return false;
  }
}

/** Stored hands, newest first. Never throws. */
export async function listHands(limit = 500): Promise<StoredHand[]> {
  try {
    const db = await openDb();
    return await new Promise<StoredHand[]>((resolve, reject) => {
      const out: StoredHand[] = [];
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).index('time').openCursor(null, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || out.length >= limit) {
          resolve(out);
          return;
        }
        out.push(cursor.value as StoredHand);
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('Read failed'));
    });
  } catch {
    return [];
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
