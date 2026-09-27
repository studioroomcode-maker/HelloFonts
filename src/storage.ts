import type { Project } from './core/types';
import { mergeProject } from './core/project';

/** 브라우저 안(IndexedDB)에 여러 글꼴 프로젝트를 저장한다. 서버는 쓰지 않는다 */

export interface FontRecord {
  id: string;
  updatedAt: number;
  createdAt: number;
  project: Project;
}

const DB_NAME = 'hellofonts';
const STORE = 'fonts';
const LEGACY_KEY = 'hellofonts.project.v1';
const CURRENT_KEY = 'hellofonts.current';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const newId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function listFonts(): Promise<FontRecord[]> {
  const all = await tx<FontRecord[]>('readonly', (s) => s.getAll() as IDBRequest<FontRecord[]>);
  return all
    .map((r) => ({ ...r, project: mergeProject(r.project) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getFont(id: string): Promise<FontRecord | null> {
  const r = await tx<FontRecord | undefined>('readonly', (s) => s.get(id) as IDBRequest<FontRecord | undefined>);
  return r ? { ...r, project: mergeProject(r.project) } : null;
}

export function putFont(rec: FontRecord): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.put(rec));
}

export function deleteFont(id: string): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
}

export function rememberCurrent(id: string) {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // 저장소를 쓸 수 없으면 다음 실행 때 최근 글꼴을 연다
  }
}

export function lastCurrent(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

/** 예전 버전이 localStorage에 남긴 프로젝트를 첫 글꼴로 옮긴다 */
export async function migrateLegacy(): Promise<FontRecord | null> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const now = Date.now();
    const rec: FontRecord = { id: newId(), createdAt: now, updatedAt: now, project: mergeProject(JSON.parse(raw)) };
    await putFont(rec);
    localStorage.removeItem(LEGACY_KEY);
    return rec;
  } catch {
    return null;
  }
}
