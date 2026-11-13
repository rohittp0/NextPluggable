/**
 * Process-wide state. Next.js compiles server components, route handlers and
 * the SSR pass of client components as separate module graphs, so module-level
 * variables are not shared between them — `globalThis` is.
 */
export const GLOBAL_KEY = Symbol.for('nextpluggable.state');

export interface Globals {
  /** Client bundle source keyed by module key, handed from the server layer to the SSR layer. */
  ssrCode: Map<string, string>;
  /** Evaluated plugin server modules keyed by content hash. */
  serverModules: Map<string, unknown>;
  /** Immutable stored files keyed by storage key. */
  files: Map<string, string>;
  /** Cached list of installed plugins, keyed by the instance's API path. */
  state: Map<string, { at: number; value: unknown }>;
  /** Failed sign-in timestamps keyed by client address. */
  loginAttempts: Map<string, number[]>;
  warned: Set<string>;
}

export function globals(): Globals {
  const g = globalThis as { [GLOBAL_KEY]?: Globals };
  return (g[GLOBAL_KEY] ??= {
    ssrCode: new Map(),
    serverModules: new Map(),
    files: new Map(),
    state: new Map(),
    loginAttempts: new Map(),
    warned: new Set(),
  });
}

export function warnOnce(key: string, message: string): void {
  const g = globals();
  if (g.warned.has(key)) return;
  g.warned.add(key);
  console.warn(`[nextpluggable] ${message}`);
}
