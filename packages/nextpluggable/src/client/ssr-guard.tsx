'use client';
/**
 * Keeps a crashing plugin from failing the server render of the page around it.
 *
 * React has no error boundaries on the server: a component that throws there
 * fails the nearest Suspense boundary, and for statically cached pages Next.js
 * then (rightly) refuses to produce the page at all. A widget in the site's
 * layout would take every page down with it.
 *
 * Plugins get React from the host, so on the server the host hands them a
 * React whose element factories wrap every plugin function component in a
 * try/catch. When one throws, it is replaced by a client-only placeholder:
 * the page is produced without that plugin's HTML and the browser renders the
 * plugin itself. If it throws there too, the island's error boundary shows the
 * fallback; if it only failed on the server (say, it read `window` while
 * rendering), it simply works.
 */
import dynamic from 'next/dynamic';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';

/** Renders nothing in the browser; on the server it hands the enclosing Suspense boundary over to client rendering. */
export const ClientOnly = dynamic(() => Promise.resolve({ default: () => null }), { ssr: false });

const MEMO = Symbol.for('react.memo');
const FORWARD_REF = Symbol.for('react.forward_ref');

type AnyRecord = Record<string | symbol, unknown>;

/** Things components throw on purpose: suspending (a promise, or React's own marker) and framework control flow. */
function isControlFlow(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false;
  const x = e as { then?: unknown; digest?: unknown; message?: unknown };
  return typeof x.then === 'function' || typeof x.digest === 'string' || (typeof x.message === 'string' && x.message.startsWith('Suspense Exception'));
}

export interface GuardedRuntime {
  /** Wrap one component type. */
  guard<T>(type: T): T;
  react: typeof React;
  jsxRuntime: typeof jsxRuntime;
}

export function createGuardedRuntime(label: string): GuardedRuntime {
  const wrapped = new WeakMap<object, unknown>();
  let reported = false;

  const crashed = (error: unknown): React.ReactNode => {
    if (!reported) {
      reported = true;
      console.error(`[nextpluggable] ${label} crashed while rendering on the server and was left out of the page:`, error);
    }
    return <ClientOnly />;
  };

  function guard<T>(type: T): T {
    if (type === null || (typeof type !== 'function' && typeof type !== 'object')) return type;
    const hit = wrapped.get(type as object);
    if (hit) return hit as T;
    let result: unknown = type;
    const t = type as unknown as AnyRecord & { prototype?: { isReactComponent?: unknown }; displayName?: string; name?: string };

    if (typeof type === 'function') {
      // Class components cannot be called directly; they stay as they are.
      if (!t.prototype?.isReactComponent) {
        const component = type as unknown as (props: unknown) => React.ReactNode;
        const Guarded = (props: unknown) => {
          try {
            return component(props);
          } catch (e) {
            if (isControlFlow(e)) throw e;
            return crashed(e);
          }
        };
        Guarded.displayName = t.displayName ?? t.name;
        result = Guarded;
      }
    } else if (t.$$typeof === MEMO) {
      const inner = guard(t.type);
      if (inner !== t.type) result = React.memo(inner as React.FunctionComponent, t.compare as undefined);
    } else if (t.$$typeof === FORWARD_REF) {
      const render = t.render as (props: unknown, ref: unknown) => React.ReactNode;
      result = React.forwardRef((props, ref) => {
        try {
          return render(props, ref);
        } catch (e) {
          if (isControlFlow(e)) throw e;
          return crashed(e);
        }
      });
    }
    wrapped.set(type as object, result);
    return result as T;
  }

  const jsx = jsxRuntime as unknown as { jsx: (...a: unknown[]) => unknown; jsxs: (...a: unknown[]) => unknown };
  return {
    guard,
    react: { ...React, createElement: (type: unknown, ...rest: unknown[]) => (React.createElement as (...a: unknown[]) => unknown)(guard(type), ...rest) } as typeof React,
    jsxRuntime: {
      ...jsxRuntime,
      jsx: (type: unknown, ...rest: unknown[]) => jsx.jsx(guard(type), ...rest),
      jsxs: (type: unknown, ...rest: unknown[]) => jsx.jsxs(guard(type), ...rest),
    } as typeof jsxRuntime,
  };
}
