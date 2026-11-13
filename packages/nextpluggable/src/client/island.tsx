'use client';
/**
 * Renders a component from a plugin bundle that was not part of this site's build.
 *
 * Server (SSR pass): the bundle's source was placed in process memory by the
 * server component that rendered us; it is evaluated here with THIS module
 * graph's React, so the plugin renders into the same tree as the rest of the page.
 *
 * Browser: the same bundle arrives as a <script>, registers itself, and is
 * given the browser's React. `use()` suspends until it has, and React keeps the
 * server-rendered HTML in place and hydrates it once the module is ready.
 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as jsxRuntime from 'react/jsx-runtime';
import type { PluginInfo } from '@nextpluggable/plugin';
import { hostRuntime, PluginRuntimeContext } from './host-runtime.js';
import { ClientOnly, createGuardedRuntime, type GuardedRuntime } from './ssr-guard.js';

type PluginModule = Record<string, unknown>;
type Factory = (require: (name: string) => unknown, module: { exports: PluginModule }, exports: PluginModule) => void;
type Tracked<T> = Promise<T> & { status?: 'pending' | 'fulfilled' | 'rejected'; value?: T; reason?: unknown };

const shared: Record<string, unknown> = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'react-dom': ReactDOM,
  '@nextpluggable/plugin': hostRuntime,
};

function hostRequire(name: string): unknown {
  if (name in shared) return shared[name];
  throw new Error(`A plugin tried to load "${name}", which this site does not provide. Bundle it into the plugin instead.`);
}

function instantiate(factory: Factory, require: (name: string) => unknown = hostRequire): PluginModule {
  const module = { exports: {} as PluginModule };
  factory(require, module, module.exports);
  return module.exports;
}

/** Server only: the crash guard each plugin bundle was instantiated with. */
const guards = new Map<string, GuardedRuntime>();

function settled<T>(value: T): Tracked<T> {
  const p = Promise.resolve(value) as Tracked<T>;
  p.status = 'fulfilled';
  p.value = value;
  return p;
}

function failed<T>(reason: unknown): Tracked<T> {
  const p = Promise.reject(reason) as Tracked<T>;
  p.catch(() => {});
  p.status = 'rejected';
  p.reason = reason;
  return p;
}

const modules = new Map<string, Tracked<PluginModule>>();
const pending = new Map<string, { resolve: (m: PluginModule) => void; reject: (e: unknown) => void }>();
const LOAD_TIMEOUT_MS = 20_000;

function register(key: string, factory: Factory): void {
  const waiter = pending.get(key);
  pending.delete(key);
  try {
    const mod = instantiate(factory);
    if (waiter) waiter.resolve(mod);
    else modules.set(key, settled(mod));
  } catch (e) {
    if (waiter) waiter.reject(e);
    else modules.set(key, failed(e));
  }
}

if (typeof window !== 'undefined') {
  // Bundles that arrived before this module ran queued themselves; later ones call straight in.
  const w = window as unknown as { __NP_Q__?: [string, Factory][] | { push(entry: [string, Factory]): void } };
  const queued = Array.isArray(w.__NP_Q__) ? w.__NP_Q__ : [];
  w.__NP_Q__ = { push: (entry: [string, Factory]) => register(entry[0], entry[1]) };
  for (const entry of queued) register(entry[0], entry[1]);
}

function loadModule(key: string, src: string): Tracked<PluginModule> {
  const existing = modules.get(key);
  if (existing) return existing;
  let tracked: Tracked<PluginModule>;

  if (typeof window === 'undefined') {
    const state = (globalThis as Record<symbol, { ssrCode?: Map<string, string> } | undefined>)[Symbol.for('nextpluggable.state')];
    const code = state?.ssrCode?.get(key);
    // Keep only the newest build of each plugin in memory.
    const prefix = `${key.split('@')[0]}@`;
    for (const k of modules.keys()) if (k.startsWith(prefix)) (modules.delete(k), guards.delete(k));
    try {
      if (code === undefined) throw new Error(`Plugin bundle ${key} was not prepared for server rendering.`);
      // On the server the plugin is given a React that contains its crashes (see ssr-guard).
      const guarded = createGuardedRuntime(`Plugin "${key.split('@')[0]}"`);
      guards.set(key, guarded);
      const guardedRequire = (name: string) => (name === 'react' ? guarded.react : name === 'react/jsx-runtime' ? guarded.jsxRuntime : hostRequire(name));
      tracked = settled(instantiate(new Function('require', 'module', 'exports', `${code}\n//# sourceURL=nextpluggable-plugin:///${key}/client.js`) as Factory, guardedRequire));
    } catch (e) {
      console.error(`[nextpluggable] Plugin bundle ${key} could not be loaded on the server and was left out of the page:`, e);
      tracked = failed(e);
    }
  } else {
    tracked = new Promise<PluginModule>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(key);
        reject(new Error(`Timed out loading plugin bundle ${key}.`));
      }, LOAD_TIMEOUT_MS);
      pending.set(key, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      if (!document.querySelector(`script[src="${CSS.escape(src)}"]`)) {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onerror = () => {
          clearTimeout(timer);
          pending.delete(key);
          reject(new Error(`Could not load plugin bundle ${key}.`));
        };
        document.head.appendChild(script);
      }
    }) as Tracked<PluginModule>;
    tracked.then(
      (value) => {
        tracked.status = 'fulfilled';
        tracked.value = value;
      },
      (reason) => {
        tracked.status = 'rejected';
        tracked.reason = reason;
      },
    );
  }
  modules.set(key, tracked);
  return tracked;
}

function Loaded(props: { moduleKey: string; src: string; component: string; componentProps: Record<string, unknown> }) {
  const tracked = loadModule(props.moduleKey, props.src);
  if (typeof window === 'undefined') {
    // A bundle that failed to load must not fail the page: leave it to the browser, where the error boundary handles it.
    const Component = tracked.status === 'fulfilled' ? tracked.value?.[props.component] : undefined;
    if (typeof Component !== 'function') return <ClientOnly />;
    const Guarded = (guards.get(props.moduleKey)?.guard(Component) ?? Component) as React.ComponentType<Record<string, unknown>>;
    return <Guarded {...props.componentProps} />;
  }
  const mod = React.use(tracked as Promise<PluginModule>);
  const Component = mod[props.component] as React.ComponentType<Record<string, unknown>> | undefined;
  if (typeof Component !== 'function') throw new Error(`Plugin bundle ${props.moduleKey} does not export "${props.component}".`);
  return <Component {...props.componentProps} />;
}

class Boundary extends React.Component<{ fallback: React.ReactNode; label: string; children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error(`[nextpluggable] ${this.props.label} failed to render:`, error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface PluginIslandProps {
  moduleKey: string;
  src: string;
  /** Name of the export to render. */
  component: string;
  info: PluginInfo;
  config: Record<string, unknown>;
  props?: Record<string, unknown>;
  /** Shown if the plugin crashes. Slots default to nothing so a broken widget never breaks the page around it. */
  errorFallback?: React.ReactNode;
  /** Shown while the bundle loads on client-side navigation. */
  loadingFallback?: React.ReactNode;
}

export function PluginIsland(p: PluginIslandProps) {
  // Start fetching the bundle as early as possible; during SSR this emits an async <script> in the document head.
  ReactDOM.preinit(p.src, { as: 'script' });
  const value = React.useMemo(() => ({ info: p.info, config: p.config }), [p.info, p.config]);
  return (
    <PluginRuntimeContext.Provider value={value}>
      <Boundary fallback={p.errorFallback ?? null} label={`Plugin "${p.info.id}"`}>
        <React.Suspense fallback={p.loadingFallback ?? null}>
          <Loaded moduleKey={p.moduleKey} src={p.src} component={p.component} componentProps={p.props ?? {}} />
        </React.Suspense>
      </Boundary>
    </PluginRuntimeContext.Provider>
  );
}
