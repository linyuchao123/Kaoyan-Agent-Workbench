import type { ApiDocument, ApiLocalRagBundle, ApiLocalRagChunk } from "./api";

const DATABASE_NAME = "yantu-local-rag";
const STORE_NAME = "document-indexes";
const DATABASE_VERSION = 1;

type StoredLocalRagBundle = ApiLocalRagBundle & {
  key: string;
  account_id: string;
  cached_at: string;
};

export function localRagBundleKey(accountId: string, documentId: string) {
  return `${accountId}:${documentId}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("local RAG database unavailable"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("local RAG request failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("local RAG transaction aborted"));
    });
  } finally {
    database.close();
  }
}

export async function saveLocalRagBundle(accountId: string, bundle: ApiLocalRagBundle) {
  const stored: StoredLocalRagBundle = {
    ...bundle,
    key: localRagBundleKey(accountId, bundle.document_id),
    account_id: accountId,
    cached_at: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(stored));
}

export async function readValidLocalRagBundle(accountId: string, document: ApiDocument) {
  const stored = await withStore<StoredLocalRagBundle | undefined>(
    "readonly",
    (store) => store.get(localRagBundleKey(accountId, document.id)),
  );
  if (!stored) return null;
  const currentChunkingVersion = document.chunking_version ?? 1;
  if (
    stored.account_id !== accountId
    || stored.document_version !== document.version
    || stored.chunking_version !== currentChunkingVersion
  ) return null;
  return stored;
}

export async function removeLocalRagBundle(accountId: string, documentId: string) {
  await withStore("readwrite", (store) => store.delete(localRagBundleKey(accountId, documentId)));
}

export function searchLocalRagChunks(
  chunks: ApiLocalRagChunk[],
  query: string,
  limit = 8,
) {
  const terms = [...new Set(query.toLocaleLowerCase().split(/\s+/).filter(Boolean))];
  if (terms.length === 0) return [];
  return chunks
    .map((chunk) => {
      const haystack = `${chunk.heading ?? ""}\n${chunk.content}`.toLocaleLowerCase();
      const score = terms.reduce((total, term) => total + haystack.split(term).length - 1, 0);
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.chunk_index - right.chunk.chunk_index)
    .slice(0, limit)
    .map((item) => item.chunk);
}
