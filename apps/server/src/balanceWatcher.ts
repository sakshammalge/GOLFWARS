import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetBalance, setBalanceOverride } from '@golfwars/shared';

/** Where the dev override lives: `apps/server/balance.dev.json` (next to `src/` and `dist/`). */
export const DEFAULT_BALANCE_FILE =
  process.env.GOLFWARS_BALANCE_FILE ??
  fileURLToPath(new URL('../balance.dev.json', import.meta.url));

export interface BalanceWatcher {
  /** The override currently applied (null = none, built-in defaults). */
  current(): Record<string, unknown> | null;
  /** Called after every (re)load with the override that is now in force. */
  onChange(cb: (override: Record<string, unknown> | null) => void): () => void;
  stop(): void;
}

export interface BalanceWatcherOptions {
  file?: string;
  /** Defaults to "not production". When false nothing is read and nothing is watched. */
  enabled?: boolean;
  log?: (msg: string) => void;
  debounceMs?: number;
}

/**
 * Dev-only hot reload of balance numbers. Watches the override file (JSON, same shape as
 * `BALANCE`), applies it to the shared `BALANCE` object, which every running room reads live, and
 * tells the listeners (rooms broadcast it to their clients). A broken file keeps the last good
 * override; deleting the file restores the defaults. In production the file is ignored entirely.
 */
export function startBalanceWatcher(opts: BalanceWatcherOptions = {}): BalanceWatcher {
  const file = opts.file ?? DEFAULT_BALANCE_FILE;
  const enabled = opts.enabled ?? process.env.NODE_ENV !== 'production';
  const log = opts.log ?? ((m: string) => console.log(`[balance] ${m}`));
  const listeners = new Set<(o: Record<string, unknown> | null) => void>();
  let current: Record<string, unknown> | null = null;
  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const load = (): void => {
    let next: Record<string, unknown> | null = null;
    if (existsSync(file)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('top level must be an object');
        }
        next = parsed as Record<string, unknown>;
      } catch (e) {
        log(`ignoring ${basename(file)}: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    if (next) {
      const r = setBalanceOverride(next);
      log(`loaded ${basename(file)}: ${r.applied.length} values set`);
      for (const p of r.ignored) if (!p.startsWith('_')) log(`  ignored unknown/invalid key ${p}`);
    } else {
      resetBalance();
      log('override removed: defaults restored');
    }
    for (const cb of listeners) cb(current);
  };

  if (enabled) {
    load();
    try {
      // Watch the directory so creating or deleting the file is noticed too.
      watcher = watch(dirname(file), (_event, name) => {
        if (name && name !== basename(file)) return;
        clearTimeout(timer);
        timer = setTimeout(load, opts.debounceMs ?? 80);
      });
      watcher.on('error', () => {});
    } catch {
      log('cannot watch the override file; edit + restart instead');
    }
  }

  return {
    current: () => current,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    stop() {
      clearTimeout(timer);
      watcher?.close();
      listeners.clear();
    },
  };
}
