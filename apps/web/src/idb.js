/* PLCdesk — malý pomocník nad IndexedDB (localStorage nemá místo na velké soubory a neumí uložit
   handle složky File System Access). Jeden objektový sklad na databázi; `keyPath` = klíč v záznamu
   (soubory importu), bez něj klíč zvlášť (`put(hodnota, klíč)` — handle kořenového adresáře). */

/**
 * Sklad `store` v databázi `dbName`: { put, get, del, clear, all } — vše vrací Promise.
 * Bez IndexedDB (soukromé okno, zakázané úložiště) Promise skončí chybou; volající ji zahodí.
 */
export function idbStore(dbName, store, keyPath) {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(store, keyPath ? { keyPath } : undefined);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    try {
      return await new Promise((res, rej) => {
        const tx = db.transaction(store, mode);
        const out = fn(tx.objectStore(store));
        tx.oncomplete = () => res(out && "result" in out ? out.result : undefined);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      });
    } finally { db.close(); }
  };
  return {
    put: (value, key) => run("readwrite", s => key === undefined ? s.put(value) : s.put(value, key)),
    get: key => run("readonly", s => s.get(key)),
    del: key => run("readwrite", s => s.delete(key)),
    clear: () => run("readwrite", s => s.clear()),
    all: () => run("readonly", s => s.getAll()),
  };
}
