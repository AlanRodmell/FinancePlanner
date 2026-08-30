// db.js — IndexedDB wrapper for the ledger app
// Stores: transactions, categories, rules, settings (incl. Google API key)

const DB_NAME = 'ledger-db';
const DB_VERSION = 2;
const STORES = ['transactions', 'categories', 'rules', 'settings', 'budgets'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('transactions')) {
        const store = db.createObjectStore('transactions', { keyPath: 'id' });
        store.createIndex('date', 'date');
        store.createIndex('category', 'category');
        store.createIndex('hash', 'hash', { unique: false });
      }
      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('rules')) {
        db.createObjectStore('rules', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('budgets')) {
        db.createObjectStore('budgets', { keyPath: 'categoryId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = fn(store);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
  }));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const DB = {
  async getAll(storeName) {
    const db = await openDB();
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    return requestToPromise(store.getAll());
  },

  async get(storeName, key) {
    const db = await openDB();
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    return requestToPromise(store.get(key));
  },

  async put(storeName, value) {
    return tx(storeName, 'readwrite', store => store.put(value));
  },

  async putMany(storeName, values) {
    return tx(storeName, 'readwrite', store => {
      values.forEach(v => store.put(v));
    });
  },

  async delete(storeName, key) {
    return tx(storeName, 'readwrite', store => store.delete(key));
  },

  async clear(storeName) {
    return tx(storeName, 'readwrite', store => store.clear());
  },

  async clearAll() {
    for (const s of STORES) await this.clear(s);
  },

  STORES,
};

export async function getSetting(key, fallback = null) {
  const row = await DB.get('settings', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  return DB.put('settings', { key, value });
}
