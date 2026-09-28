import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "fs";
import path from "path";
import { isDemoMode } from "@/lib/config";
import { createSeedDatabase, emptyDatabase } from "@/lib/demo/seed";
import type { Database } from "@/lib/domain/types";
import { openBytes, sealBytes } from "@/lib/security/crypto";
import { migrateDatabase } from "@/lib/store/migrate";

export interface DataStore {
  read(): Database;
  replace(next: Database): void;
  /** Runs `fn` with exclusive write access. */
  withLock<T>(fn: () => T): T;
}

class MemoryStore implements DataStore {
  constructor(private db: Database) {}

  read(): Database {
    return this.db;
  }

  replace(next: Database): void {
    this.db = next;
  }

  withLock<T>(fn: () => T): T {
    return fn();
  }
}

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Single-node durable store.
 * - Encrypted at rest with AES-256-GCM when HF_DATA_KEY is set (required in production).
 * - Atomic: writes a temp file, fsyncs, then renames over the old file, so a crash never leaves
 *   a half-written store. The previous version is kept as store.json.bak.
 * - Safe across processes on one host: mutations take an exclusive lock file, and reads reload
 *   when another process has changed the file.
 * It is not a multi-host database. See docs/PRODUCTION_READINESS.md for the Postgres path.
 */
class FileStore implements DataStore {
  private db: Database | null = null;
  private mtimeMs = 0;
  private readonly file: string;
  private readonly lockFile: string;

  constructor() {
    const dir = process.env.HF_DATA_DIR || path.join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, "store.json");
    this.lockFile = path.join(dir, "store.lock");
  }

  read(): Database {
    if (existsSync(this.file)) {
      const mtime = statSync(this.file).mtimeMs;
      if (this.db && mtime === this.mtimeMs) return this.db;
      const plain = openBytes(readFileSync(this.file), "store").toString("utf8");
      const { db, migrated } = migrateDatabase(JSON.parse(plain));
      this.db = db;
      this.mtimeMs = mtime;
      if (migrated) this.withLock(() => this.persist());
      return this.db;
    }
    if (this.db) return this.db;
    this.db = isDemoMode() ? createSeedDatabase() : emptyDatabase();
    this.withLock(() => this.persist());
    return this.db;
  }

  replace(next: Database): void {
    this.db = next;
    this.persist();
  }

  withLock<T>(fn: () => T): T {
    const started = Date.now();
    let fd: number | null = null;
    while (fd === null) {
      try {
        fd = openSync(this.lockFile, "wx", 0o600);
        writeSync(fd, String(process.pid));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          if (Date.now() - statSync(this.lockFile).mtimeMs > LOCK_STALE_MS) unlinkSync(this.lockFile);
        } catch {
          // Another process removed it first.
        }
        if (Date.now() - started > LOCK_WAIT_MS) throw new Error("Timed out waiting for the data store lock.");
        sleepSync(10);
      }
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      try {
        unlinkSync(this.lockFile);
      } catch {
        // Already gone.
      }
    }
  }

  private persist(): void {
    if (!this.db) return;
    const payload = sealBytes(Buffer.from(JSON.stringify(this.db)), "store");
    const temp = `${this.file}.${process.pid}.tmp`;
    const fd = openSync(temp, "w", 0o600);
    try {
      writeSync(fd, payload);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(this.file)) {
      try {
        writeFileSync(`${this.file}.bak`, readFileSync(this.file), { mode: 0o600 });
      } catch {
        // Backup copy is best effort; the atomic rename below is what protects the data.
      }
    }
    renameSync(temp, this.file);
    this.mtimeMs = statSync(this.file).mtimeMs;
  }
}

let memoryStore: MemoryStore | null = null;
let fileStore: FileStore | null = null;

export function usingMemoryStore(): boolean {
  return process.env.HF_STORE === "memory";
}

export function getStore(): DataStore {
  if (usingMemoryStore()) {
    if (!memoryStore) memoryStore = new MemoryStore(createSeedDatabase());
    return memoryStore;
  }
  if (!fileStore) fileStore = new FileStore();
  return fileStore;
}

export function resetMemoryStore(now = new Date()): void {
  memoryStore = new MemoryStore(createSeedDatabase(now));
}

export function readDb(): Database {
  return structuredClone(getStore().read());
}

/**
 * Applies `fn` to a private copy and commits it only if `fn` returns without throwing,
 * so a failed validation never leaves a half-applied change.
 */
export function mutate<T>(fn: (db: Database) => T): T {
  const store = getStore();
  return store.withLock(() => {
    const draft = structuredClone(store.read());
    const result = fn(draft);
    store.replace(draft);
    return result;
  });
}

/**
 * The running data path. `DATA_PROVIDER=supabase` is reserved for the Postgres adapter.
 * Until that adapter ships, every request uses this store.
 */
export function dataMode(): "demo" | "file" | "memory" {
  if (usingMemoryStore()) return "memory";
  return isDemoMode() ? "demo" : "file";
}
