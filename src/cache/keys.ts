import { ALIASES_STORE_NAME, openDB } from "@/cache/idb";

// -- Content hashing -----------------------------------------------------------------

const SEPARATION_VERSION = "htdemucs-fp32:v2";

async function computeContentKey(bytes: BufferSource): Promise<string> {
  const audioDigest = await crypto.subtle.digest("SHA-256", bytes);
  const versioned = new TextEncoder().encode(SEPARATION_VERSION);
  const combined = new Uint8Array(audioDigest.byteLength + versioned.byteLength);
  combined.set(new Uint8Array(audioDigest), 0);
  combined.set(versioned, audioDigest.byteLength);

  const digest = await crypto.subtle.digest("SHA-256", combined);
  const digestBytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of digestBytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// -- videoId alias -----------------------------------------------------------------

async function getContentKeyForVideoId(videoId: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ALIASES_STORE_NAME, "readonly");
    const store = tx.objectStore(ALIASES_STORE_NAME);
    const request = store.get(videoId);
    request.onerror = () => reject(request.error ?? new Error(`keys: get failed for ${videoId}`));
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
    tx.oncomplete = () => db.close();
  });
}

async function setVideoIdAlias(videoId: string, contentKey: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ALIASES_STORE_NAME, "readwrite");
    tx.objectStore(ALIASES_STORE_NAME).put(contentKey, videoId);
    tx.onerror = () => reject(tx.error ?? new Error(`keys: set failed for ${videoId}`));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

async function deleteVideoIdAlias(videoId: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ALIASES_STORE_NAME, "readwrite");
    tx.objectStore(ALIASES_STORE_NAME).delete(videoId);
    tx.onerror = () => reject(tx.error ?? new Error(`keys: delete failed for ${videoId}`));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

// -- Clearing (settings UI) -----------------------------------------------------

async function clearAllAliases(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ALIASES_STORE_NAME, "readwrite");
    tx.objectStore(ALIASES_STORE_NAME).clear();
    tx.onerror = () => reject(tx.error ?? new Error("keys: clear failed"));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

export {
  SEPARATION_VERSION,
  computeContentKey,
  getContentKeyForVideoId,
  setVideoIdAlias,
  deleteVideoIdAlias,
  clearAllAliases,
};
