const DB_NAME = 'shuaci-v5';
const DB_VERSION = 1;

export const wordKey = (value) => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

let connection;
export function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('wordStates')) db.createObjectStore('wordStates', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'scope' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

async function request(storeName, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try { result = operation(store); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getRecord = (store, key) => request(store, 'readonly', (s) => s.get(key));
export const getAllRecords = (store) => request(store, 'readonly', (s) => s.getAll());
export const putRecord = (store, value) => request(store, 'readwrite', (s) => s.put(value));
export const deleteRecord = (store, key) => request(store, 'readwrite', (s) => s.delete(key));

export async function patchWordState(rawWord, patch) {
  const key = wordKey(rawWord);
  const current = (await getRecord('wordStates', key)) || { key, wrong: false, starred: false, reviewStreak: 0, correct: 0, errors: 0 };
  const next = { ...current, ...patch, key, updatedAt: new Date().toISOString() };
  await putRecord('wordStates', next);
  return next;
}

export async function setNote(rawWord, text) {
  const key = wordKey(rawWord);
  if (!text.trim()) return deleteRecord('notes', key);
  return putRecord('notes', { key, text, updatedAt: new Date().toISOString() });
}

async function sha256(text) {
  if (!crypto?.subtle) return '';
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function exportBackup() {
  const data = {
    schemaVersion: 5,
    exportedAt: new Date().toISOString(),
    wordStates: await getAllRecords('wordStates'),
    notes: await getAllRecords('notes'),
    progress: await getAllRecords('progress'),
    settings: await getAllRecords('settings'),
  };
  const canonical = JSON.stringify(data);
  return JSON.stringify({ ...data, checksum: await sha256(canonical) }, null, 2);
}

export async function importBackup(text) {
  const parsed = JSON.parse(text);
  if (![4, 5].includes(Number(parsed.schemaVersion))) throw new Error('不是可识别的刷词神器备份');
  const { checksum, ...withoutChecksum } = parsed;
  if (checksum && checksum !== await sha256(JSON.stringify(withoutChecksum))) throw new Error('备份校验失败，文件可能不完整');
  const db = await openDatabase();
  const stores = ['wordStates', 'notes', 'progress', 'settings'];
  await new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    for (const name of stores) {
      const store = tx.objectStore(name);
      for (const value of Array.isArray(parsed[name]) ? parsed[name] : []) {
        if (name === 'wordStates' || name === 'notes') value.key = wordKey(value.key || value.word);
        store.put(value);
      }
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function migrateSameOriginV4(resolveWordByLegacyId) {
  if (await getRecord('meta', 'v4-migrated')) return 0;
  let migrated = 0;
  try {
    const users = JSON.parse(localStorage.getItem('vocab-tool-users') || '[]');
    const active = localStorage.getItem('vocab-tool-active-user') || users[0]?.id || 'me';
    const raw = localStorage.getItem(`vocab-tool-state:${active}`) || localStorage.getItem('vocab-tool-state');
    if (raw) {
      const old = JSON.parse(raw);
      for (const legacyId of old.wrongBookIds || []) {
        const word = resolveWordByLegacyId(legacyId, old.chapter);
        if (word) { await patchWordState(word.word, { wrong: true }); migrated += 1; }
      }
      for (const legacyId of old.newWordBookIds || []) {
        const word = resolveWordByLegacyId(legacyId, old.chapter);
        if (word) { await patchWordState(word.word, { starred: true }); migrated += 1; }
      }
    }
  } catch (error) { console.warn('Legacy migration skipped', error); }
  await putRecord('meta', { key: 'v4-migrated', migrated, at: new Date().toISOString() });
  return migrated;
}
