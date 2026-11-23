/**
 * IndexedDB の最小の読み書き（依存なし）。CryptoKey は structured clone できるので、そのまま保存する
 * （MDN Structured clone algorithm: CryptoKey は対象。取り出せない鍵は取り出せないまま保存される → 確認 1 で再読込後も確かめる）
 */
const DB = "todoke-11d";
const STORES = ["kv", "claims"] as const;
type Store = (typeof STORES)[number];

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("kv");
      r.result.createObjectStore("claims", { autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const r = fn(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export const kvGet = <T>(key: string) => tx<T | undefined>("kv", "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const kvSet = (key: string, value: unknown) => tx("kv", "readwrite", (s) => s.put(value, key));
export const kvDelete = (key: string) => tx("kv", "readwrite", (s) => s.delete(key));
export const claimAdd = (value: unknown) => tx("claims", "readwrite", (s) => s.add(value));
export const claimAll = <T>() => tx<T[]>("claims", "readonly", (s) => s.getAll() as IDBRequest<T[]>);
