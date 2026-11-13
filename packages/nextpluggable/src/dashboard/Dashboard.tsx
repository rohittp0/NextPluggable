'use client';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { PluginIsland } from '../client/island.js';
import type { CatalogPluginView, DashboardState, PluginView, SessionView } from '../views.js';
import { dashboardCss } from './styles.js';
import {
  ApiError,
  Button,
  createApi,
  describePlugin,
  Modal,
  PluginIcon,
  SettingInput,
  Switch,
  timeAgo,
  Toasts,
  type ApiCall,
  type FieldValue,
  type Toast,
} from './ui.js';

interface Ctx {
  api: ApiCall;
  base: string;
  state: DashboardState;
  setState: (s: DashboardState) => void;
  notify: (text: string, kind?: Toast['kind']) => void;
  /** Run a dashboard action: applies the returned state and reports failure as a toast. Never throws; resolves to the response, or null on failure. */
  act: <T extends DashboardState>(work: () => Promise<T>, done?: string) => Promise<T | null>;
}

/**
 * Move between dashboard screens without a server round trip. Next.js keeps
 * `usePathname()` in sync with `history.pushState`, and, unlike a full
 * navigation (which remounts a catch-all page whenever its segments change),
 * this keeps the dashboard mounted, so loaded data and notices survive.
 */
function go(href: string): void {
  window.history.pushState(null, '', href);
  document.querySelector('.np-root')?.scrollTo(0, 0);
}

function Link({ href, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(href);
      }}
    />
  );
}

const DashboardContext = React.createContext<Ctx | null>(null);
const useDash = () => React.useContext(DashboardContext)!;

export interface DashboardProps {
  apiPath: string;
  dashboardPath: string;
  siteName: string;
  session: SessionView;
  /** Set when the site's configuration is incomplete (shown instead of the dashboard). */
  setupError?: string;
}

export function Dashboard(props: DashboardProps) {
  const [session, setSession] = React.useState(props.session);
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(1);

  const dismiss = React.useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = React.useCallback(
    (text: string, kind: Toast['kind'] = 'ok') => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 4500);
    },
    [dismiss],
  );
  const api = React.useMemo(() => createApi(props.apiPath, () => setSession((s) => ({ ...s, user: null }))), [props.apiPath]);

  // The dashboard covers the site it is embedded in; keep the page behind it from scrolling.
  React.useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  let content: React.ReactNode;
  if (props.setupError || !session.configured) content = <Setup message={props.setupError} />;
  else if (!session.user)
    content = session.mode === 'password' ? <SignIn api={api} siteName={props.siteName} onDone={(user) => setSession((s) => ({ ...s, user }))} /> : <NotAllowed loginUrl={session.loginUrl} />;
  else
    content = (
      <App
        api={api}
        base={props.dashboardPath}
        siteName={props.siteName}
        notify={notify}
        onSignOut={
          session.mode === 'password'
            ? async () => {
                await api('POST', '/logout').catch(() => {});
                setSession((s) => ({ ...s, user: null }));
              }
            : undefined
        }
      />
    );

  return (
    <div className="np-root">
      <style href="nextpluggable-dashboard" precedence="nextpluggable">
        {dashboardCss}
      </style>
      {content}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

// ------------------------------------------------------------------ gates

function Setup({ message }: { message?: string }) {
  return (
    <div className="np-center">
      <div className="np-card np-auth" style={{ maxWidth: 520 }}>
        <span className="np-brand-mark" aria-hidden="true">
          ◆
        </span>
        <h1>One more step to finish setup</h1>
        <p>The plugin dashboard is installed but not switched on yet. Whoever looks after this website’s hosting needs to do this once:</p>
        {message ? <div className="np-note np-note-warn">{message}</div> : null}
        <ol className="np-steps">
          <li>
            <span>
              Add <code className="np-code">NEXTPLUGGABLE_PASSWORD</code> to the site’s environment variables: the password you will use to sign in here.
            </span>
          </li>
          <li>
            <span>
              Add <code className="np-code">NEXTPLUGGABLE_SECRET</code>: a long random value used to keep sign-ins and saved keys safe.
            </span>
          </li>
          <li>
            <span>Restart or redeploy the site, then reload this page.</span>
          </li>
        </ol>
      </div>
    </div>
  );
}

function NotAllowed({ loginUrl }: { loginUrl?: string }) {
  return (
    <div className="np-center">
      <div className="np-card np-auth">
        <span className="np-brand-mark" aria-hidden="true">
          ◆
        </span>
        <h1>Sign in to manage plugins</h1>
        <p>You need to be signed in to this website with an account that is allowed to manage plugins.</p>
        {loginUrl ? (
          <a className="np-btn np-btn-primary" href={loginUrl}>
            Go to sign in
          </a>
        ) : null}
      </div>
    </div>
  );
}

function SignIn(props: { api: ApiCall; siteName: string; onDone: (user: NonNullable<SessionView['user']>) => void }) {
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="np-center">
      <form
        className="np-card np-auth"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await props.api<{ user: NonNullable<SessionView['user']> }>('POST', '/login', { password });
            props.onDone(res.user);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <span className="np-brand-mark" aria-hidden="true">
          ◆
        </span>
        <h1>Plugins for {props.siteName}</h1>
        <p>Enter the dashboard password to continue.</p>
        <div className="np-field">
          <label htmlFor="np-password">Password</label>
          <input
            id="np-password"
            className="np-input"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'np-password-error' : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? (
            <span className="np-error" id="np-password-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
        <Button type="submit" variant="primary" busy={busy} style={{ width: '100%' }}>
          Sign in
        </Button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ shell

function App(props: { api: ApiCall; base: string; siteName: string; notify: Ctx['notify']; onSignOut?: () => void }) {
  const { api, base, notify } = props;
  const [state, setState] = React.useState<DashboardState | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const pathname = usePathname() ?? base;

  const load = React.useCallback(() => {
    setLoadError(null);
    api<DashboardState>('GET', '/admin/state').then(setState, (e: Error) => setLoadError(e.message));
  }, [api]);
  React.useEffect(load, [load]);

  const act = React.useCallback<Ctx['act']>(
    async (work, done) => {
      try {
        const next = await work();
        setState(next);
        if (done) notify(done);
        return next;
      } catch (e) {
        notify((e as Error).message, 'error');
        return null;
      }
    },
    [notify],
  );

  const at = pathname.indexOf(base);
  const [section, id] = (at === -1 ? '' : pathname.slice(at + base.length)).split('/').filter(Boolean);
  const current = section === 'add' ? 'add' : section === 'sources' ? 'sources' : 'installed';
  const tab = (href: string, key: string, label: string) => (
    <Link href={href} aria-current={current === key ? 'page' : undefined}>
      {label}
    </Link>
  );

  let view: React.ReactNode;
  if (loadError)
    view = (
      <div className="np-card np-empty">
        <h2>The dashboard could not load</h2>
        <p>{loadError}</p>
        <Button variant="primary" onClick={load}>
          Try again
        </Button>
      </div>
    );
  else if (!state)
    view = (
      <div className="np-list" aria-busy="true" aria-label="Loading">
        <div className="np-skel" />
        <div className="np-skel" />
      </div>
    );
  else if (section === 'plugin' && id) view = <PluginDetail key={id} id={decodeURIComponent(id)} />;
  else if (section === 'add') view = <AddPlugins />;
  else if (section === 'sources') view = <Sources />;
  else view = <Installed />;

  return (
    <>
      <header className="np-top">
        <div className="np-top-in">
          <Link href={base} className="np-brand">
            <span className="np-brand-mark" aria-hidden="true">
              ◆
            </span>
            Plugins <small>{props.siteName}</small>
          </Link>
          <nav className="np-nav" aria-label="Dashboard">
            {tab(base, 'installed', 'Installed')}
            {tab(`${base}/add`, 'add', 'Add plugins')}
            {tab(`${base}/sources`, 'sources', 'Sources')}
          </nav>
          <a className="np-btn np-btn-sm" href="/" target="_blank" rel="noreferrer">
            View site ↗
          </a>
          {props.onSignOut ? (
            <Button small onClick={props.onSignOut}>
              Sign out
            </Button>
          ) : null}
        </div>
      </header>
      <main className="np-main">
        {state ? <DashboardContext.Provider value={{ api, base, state, setState, notify, act }}>{view}</DashboardContext.Provider> : view}
      </main>
    </>
  );
}

function StatusChip({ plugin }: { plugin: PluginView }) {
  if (plugin.needsSetup) return <span className="np-chip np-chip-warn">Needs setup</span>;
  return plugin.enabled ? <span className="np-chip np-chip-on">Active</span> : <span className="np-chip">Paused</span>;
}

function useRefresh() {
  const { api, act, notify } = useDash();
  const [busy, setBusy] = React.useState(false);
  const refresh = React.useCallback(
    async (announce: boolean) => {
      setBusy(true);
      const res = await act(() => api<DashboardState & { failures: { label: string; message: string }[] }>('POST', '/admin/refresh'));
      setBusy(false);
      if (!res) return;
      for (const f of res.failures) notify(`${f.label}: ${f.message}`, 'error');
      if (announce && !res.failures.length) notify('Everything is up to date with your sources.');
    },
    [api, act, notify],
  );
  return { busy, refresh };
}

// ------------------------------------------------------------------ installed

function Installed() {
  const { state, base } = useDash();
  const { busy, refresh } = useRefresh();
  const updates = state.plugins.filter((p) => p.update).length;

  if (!state.plugins.length)
    return (
      <div className="np-card np-empty">
        <div className="np-empty-art" aria-hidden="true">
          🧩
        </div>
        <h2>No plugins installed yet</h2>
        {state.sources.length ? (
          <>
            <p>Plugins add new pages and features to your site. Pick one to get started.</p>
            <Link className="np-btn np-btn-primary" href={`${base}/add`}>
              Browse plugins
            </Link>
          </>
        ) : (
          <>
            <p>Plugins add new pages and features to your site. First, connect a place to get plugins from.</p>
            <Link className="np-btn np-btn-primary" href={`${base}/sources`}>
              Connect a plugin source
            </Link>
          </>
        )}
      </div>
    );

  return (
    <>
      <div className="np-head">
        <div>
          <h1>Installed plugins</h1>
          <p>
            {state.plugins.length} installed
            {updates ? ` · ${updates} update${updates === 1 ? '' : 's'} available` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button busy={busy} onClick={() => refresh(true)}>
            Check for updates
          </Button>
          <Link className="np-btn np-btn-primary" href={`${base}/add`}>
            Add plugins
          </Link>
        </div>
      </div>
      <ul className="np-list">
        {state.plugins.map((p) => (
          <InstalledRow key={p.id} plugin={p} />
        ))}
      </ul>
    </>
  );
}

function InstalledRow({ plugin }: { plugin: PluginView }) {
  const { api, act, base } = useDash();
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async (name: string, work: () => Promise<DashboardState>, done: string) => {
    setBusy(name);
    await act(work, done);
    setBusy(null);
  };
  const settingsHref = `${base}/plugin/${encodeURIComponent(plugin.id)}`;
  return (
    <li className="np-card np-row">
      <PluginIcon icon={plugin.icon} name={plugin.name} />
      <div>
        <div className="np-title">
          <Link href={settingsHref}>{plugin.name}</Link>
          <StatusChip plugin={plugin} />
          <span className="np-meta">v{plugin.version}</span>
        </div>
        {plugin.description ? <p className="np-desc">{plugin.description}</p> : null}
        {plugin.enabled && plugin.pages.some((pg) => pg.linkable) ? (
          <div className="np-links">
            {plugin.pages
              .filter((pg) => pg.linkable)
              .map((pg) => (
                <a key={pg.id} href={pg.path} target="_blank" rel="noreferrer">
                  {pg.path} ↗
                </a>
              ))}
          </div>
        ) : null}
      </div>
      <div className="np-row-actions">
        {plugin.update ? (
          <Button
            small
            variant="primary"
            busy={busy === 'update'}
            onClick={() => run('update', () => api('POST', `/admin/plugins/${plugin.id}/update`), `${plugin.name} was updated to version ${plugin.update!.version}.`)}
          >
            Update to {plugin.update.version}
          </Button>
        ) : null}
        <Link className="np-btn np-btn-sm" href={settingsHref}>
          {plugin.needsSetup ? 'Finish setup' : 'Settings'}
        </Link>
        <Switch
          checked={plugin.enabled}
          disabled={busy !== null || plugin.needsSetup}
          label={`${plugin.name} is ${plugin.enabled ? 'on' : 'off'}`}
          onChange={(enabled) =>
            run('toggle', () => api('PATCH', `/admin/plugins/${plugin.id}`, { enabled }), enabled ? `${plugin.name} is now live on your site.` : `${plugin.name} is paused. Its pages are hidden.`)
          }
        />
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ add plugins

function AddPlugins() {
  const { state, base, api, act, notify } = useDash();
  const { busy, refresh } = useRefresh();
  const [query, setQuery] = React.useState('');
  const [confirm, setConfirm] = React.useState<CatalogPluginView | null>(null);
  const [installing, setInstalling] = React.useState(false);

  // Pick up newly published plugins without asking the owner to think about it.
  const stale = state.sources.some((s) => !s.checkedAt || Date.now() - new Date(s.checkedAt).getTime() > 5 * 60_000);
  const refreshed = React.useRef(false);
  React.useEffect(() => {
    if (stale && !refreshed.current) {
      refreshed.current = true;
      void refresh(false);
    }
  }, [stale, refresh]);

  if (!state.sources.length)
    return (
      <div className="np-card np-empty">
        <div className="np-empty-art" aria-hidden="true">
          🔌
        </div>
        <h2>Connect a plugin source first</h2>
        <p>Plugins come from GitHub repositories. Connect one and everything it offers will show up here, ready to install.</p>
        <Link className="np-btn np-btn-primary" href={`${base}/sources`}>
          Connect a plugin source
        </Link>
      </div>
    );

  const q = query.trim().toLowerCase();
  const items = state.catalog.filter((p) => !q || `${p.name} ${p.description ?? ''} ${p.category ?? ''}`.toLowerCase().includes(q));

  const install = async (p: CatalogPluginView) => {
    setInstalling(true);
    const res = await act(() => api<DashboardState>('POST', '/admin/install', { sourceId: p.sourceId, path: p.path }));
    setInstalling(false);
    if (!res) return;
    setConfirm(null);
    const installed = res.plugins.find((x) => x.id === p.id);
    notify(installed?.needsSetup ? `${p.name} is installed. Fill in its settings to switch it on.` : `${p.name} is installed and live.`);
    go(`${base}/plugin/${encodeURIComponent(p.id)}`);
  };

  return (
    <>
      <div className="np-head">
        <div>
          <h1>Add plugins</h1>
          <p>Everything offered by your connected sources. Installing takes a few seconds and needs no rebuild.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input className="np-input np-search" type="search" placeholder="Search plugins" aria-label="Search plugins" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button busy={busy} onClick={() => refresh(true)}>
            Refresh
          </Button>
        </div>
      </div>
      {items.length ? (
        <ul className="np-grid">
          {items.map((p) => (
            <li key={`${p.sourceId}:${p.path}`} className="np-card np-tile">
              <div className="np-tile-head">
                <PluginIcon icon={p.icon} name={p.name} />
                <div>
                  <div className="np-title">{p.name}</div>
                  <div className="np-meta">
                    v{p.version}
                    {p.category ? ` · ${p.category}` : ''}
                  </div>
                </div>
              </div>
              {p.description ? <p className="np-desc">{p.description}</p> : null}
              <div className="np-tile-foot">
                <span className="np-meta">from {p.sourceLabel}</span>
                {p.installed ? (
                  <Link className="np-btn np-btn-sm" href={`${base}/plugin/${encodeURIComponent(p.id)}`}>
                    Installed ✓
                  </Link>
                ) : (
                  <Button small variant="primary" onClick={() => setConfirm(p)}>
                    Install
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="np-card np-empty">
          <h2>{q ? 'No plugins match your search' : 'Your sources have no plugins yet'}</h2>
          <p>{q ? 'Try a different word.' : 'When plugins are published to a connected source they will appear here.'}</p>
        </div>
      )}
      {confirm ? (
        <Modal
          title={`Install ${confirm.name}?`}
          onClose={() => !installing && setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)} disabled={installing}>
                Cancel
              </Button>
              <Button variant="primary" busy={installing} onClick={() => install(confirm)}>
                Install
              </Button>
            </>
          }
        >
          <p>
            From <strong>{confirm.sourceLabel}</strong>. This plugin:
          </p>
          <ul className="np-adds" style={{ marginTop: 10 }}>
            {describePlugin(confirm).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p style={{ marginTop: 12, fontSize: 13 }}>Only install plugins from sources you trust: a plugin can do anything your website can.</p>
        </Modal>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ sources

function Sources() {
  const { state, api, setState, notify } = useDash();
  const [url, setUrl] = React.useState('');
  const [isPrivate, setIsPrivate] = React.useState(false);
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<DashboardState>('POST', '/admin/sources', { url, token: isPrivate ? token : undefined });
      const added = res.sources[res.sources.length - 1];
      setState(res);
      notify(added ? `Connected ${added.label}: ${added.pluginCount} plugin${added.pluginCount === 1 ? '' : 's'} found.` : 'Connected.');
      setUrl('');
      setToken('');
      setIsPrivate(false);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <>
      <div className="np-head">
        <div>
          <h1>Plugin sources</h1>
          <p>A source is a GitHub repository that holds plugins. Connect one and its plugins appear under “Add plugins”.</p>
        </div>
      </div>

      <form className="np-card np-pad np-section" onSubmit={connect}>
        <div className="np-field">
          <label htmlFor="np-source-url">Repository address</label>
          <input
            id="np-source-url"
            className="np-input"
            required
            placeholder="https://github.com/your-company/plugins"
            value={url}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'np-source-error' : 'np-source-help'}
            onChange={(e) => setUrl(e.target.value)}
          />
          <span className="np-help" id="np-source-help">
            Copy it from your browser’s address bar while looking at the repository on GitHub.
            {state.site.allowLocalSources ? ' While developing you can also enter a folder path on this computer.' : ''}
          </span>
          {error ? (
            <span className="np-error" id="np-source-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
        <label className="np-check" style={{ marginTop: 0, marginBottom: 14 }}>
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          <span>This repository is private</span>
        </label>
        {isPrivate ? (
          <div className="np-field">
            <label htmlFor="np-source-token">Access token</label>
            <input id="np-source-token" className="np-input" type="password" autoComplete="off" required value={token} placeholder="github_pat_…" onChange={(e) => setToken(e.target.value)} />
            <span className="np-help">A private repository needs a key that lets this site read it. To create one:</span>
            <ol className="np-steps">
              <li>
                <span>
                  Open{' '}
                  <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                    GitHub → New fine-grained token ↗
                  </a>
                  .
                </span>
              </li>
              <li>
                <span>Under “Repository access” choose “Only select repositories” and pick this repository.</span>
              </li>
              <li>
                <span>Under “Permissions → Repository permissions” set “Contents” to “Read-only”.</span>
              </li>
              <li>
                <span>Create the token, copy it, and paste it above. It is stored encrypted and never shown again.</span>
              </li>
            </ol>
          </div>
        ) : null}
        <Button type="submit" variant="primary" busy={busy}>
          Connect source
        </Button>
      </form>

      {state.sources.length ? (
        <ul className="np-list">
          {state.sources.map((s) => (
            <li key={s.id} className="np-card np-row">
              <span className="np-icon" aria-hidden="true">
                {s.type === 'github' ? '🐙' : '📁'}
              </span>
              <div>
                <div className="np-title">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.label}
                    </a>
                  ) : (
                    s.label
                  )}
                  {s.hasToken ? <span className="np-chip">Private</span> : null}
                </div>
                <p className="np-desc">
                  {s.pluginCount} plugin{s.pluginCount === 1 ? '' : 's'} · checked {timeAgo(s.checkedAt)}
                </p>
                {s.problems.map((p) => (
                  <p key={p.path} className="np-error" style={{ marginTop: 6 }}>
                    {p.path || 'This source'}: {p.message}
                  </p>
                ))}
              </div>
              <div className="np-row-actions">
                <Button
                  small
                  variant="danger"
                  busy={removing === s.id}
                  onClick={async () => {
                    setRemoving(s.id);
                    try {
                      setState(await api<DashboardState>('DELETE', `/admin/sources/${s.id}`));
                      notify(`${s.label} was disconnected. Plugins already installed from it keep working.`);
                    } catch (err) {
                      notify((err as Error).message, 'error');
                    }
                    setRemoving(null);
                  }}
                >
                  Disconnect
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ plugin detail

function PluginDetail({ id }: { id: string }) {
  const { state, base, api, act } = useDash();
  const plugin = state.plugins.find((p) => p.id === id);
  const [tab, setTab] = React.useState('settings');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [deleteData, setDeleteData] = React.useState(false);

  if (!plugin)
    return (
      <div className="np-card np-empty">
        <h2>That plugin is not installed</h2>
        <p>It may have been removed.</p>
        <Link className="np-btn np-btn-primary" href={base}>
          Back to installed plugins
        </Link>
      </div>
    );

  const run = async (name: string, work: () => Promise<DashboardState>, done: string) => {
    setBusy(name);
    const res = await act(work, done);
    setBusy(null);
    return res;
  };
  const adminTab = plugin.adminPages.find((a) => `admin:${a.id}` === tab);

  return (
    <>
      <p style={{ marginBottom: 14 }}>
        <Link href={base}>← Installed plugins</Link>
      </p>
      <div className="np-head">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <PluginIcon icon={plugin.icon} name={plugin.name} />
          <div>
            <h1 className="np-title" style={{ fontSize: 24 }}>
              {plugin.name} <StatusChip plugin={plugin} />
            </h1>
            <p>
              Version {plugin.version}
              {plugin.author ? ` · by ${plugin.author}` : ''}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {plugin.update ? (
            <Button
              variant="primary"
              busy={busy === 'update'}
              onClick={() => run('update', () => api('POST', `/admin/plugins/${plugin.id}/update`), `${plugin.name} was updated to version ${plugin.update!.version}.`)}
            >
              Update to {plugin.update.version}
            </Button>
          ) : null}
          <Switch
            checked={plugin.enabled}
            disabled={busy !== null || plugin.needsSetup}
            showLabel
            label={plugin.enabled ? 'On' : 'Off'}
            onChange={(enabled) =>
              run('toggle', () => api('PATCH', `/admin/plugins/${plugin.id}`, { enabled }), enabled ? `${plugin.name} is now live on your site.` : `${plugin.name} is paused. Its pages are hidden.`)
            }
          />
        </div>
      </div>

      {plugin.needsSetup ? <div className="np-note np-note-warn">Fill in the required settings (marked *) and save. The plugin switches on once they are complete.</div> : null}

      <div className="np-tabs" role="tablist">
        {[{ key: 'settings', title: 'Settings' }, ...plugin.adminPages.map((a) => ({ key: `admin:${a.id}`, title: a.title })), { key: 'about', title: 'About' }].map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.title}
          </button>
        ))}
      </div>

      {tab === 'settings' ? <SettingsForm key={plugin.updatedAt} plugin={plugin} /> : null}

      {adminTab ? (
        plugin.enabled && plugin.runtime ? (
          <div className="np-card np-pad">
            {plugin.runtime.styleHref ? <link rel="stylesheet" href={plugin.runtime.styleHref} precedence="nextpluggable" /> : null}
            <PluginIsland
              key={`${plugin.runtime.moduleKey}:${adminTab.id}`}
              moduleKey={plugin.runtime.moduleKey}
              src={plugin.runtime.scriptSrc}
              component={adminTab.component}
              info={{ id: plugin.id, version: plugin.version, apiBase: plugin.runtime.apiBase, paths: plugin.runtime.paths }}
              config={plugin.runtime.publicConfig}
              loadingFallback={<div className="np-skel" />}
              errorFallback={<div className="np-note np-note-danger">This screen could not be loaded. Try reloading the page.</div>}
            />
          </div>
        ) : (
          <div className="np-note">Switch the plugin on to use this screen.</div>
        )
      ) : null}

      {tab === 'about' ? (
        <>
          <div className="np-card np-pad np-section">
            {plugin.description ? <p style={{ marginBottom: 16 }}>{plugin.description}</p> : null}
            <dl className="np-dl">
              <dt>What it does</dt>
              <dd>
                <ul className="np-adds">
                  {describePlugin({ ...plugin, adminPages: plugin.adminPages.map((a) => a.title) }).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </dd>
              <dt>Comes from</dt>
              <dd>
                {plugin.source.label}
                {plugin.source.connected ? '' : ' (no longer connected, so updates are unavailable)'}
              </dd>
              <dt>Installed</dt>
              <dd>{new Date(plugin.installedAt).toLocaleDateString(undefined, { dateStyle: 'long' })}</dd>
            </dl>
          </div>
          <div className="np-card np-pad" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div className="np-label">Remove this plugin</div>
              <p className="np-help">Its pages and features disappear from your site straight away.</p>
            </div>
            <Button variant="danger" onClick={() => setRemoveOpen(true)}>
              Remove plugin
            </Button>
          </div>
        </>
      ) : null}

      {removeOpen ? (
        <Modal
          title={`Remove ${plugin.name}?`}
          onClose={() => busy === null && setRemoveOpen(false)}
          footer={
            <>
              <Button onClick={() => setRemoveOpen(false)} disabled={busy !== null}>
                Keep plugin
              </Button>
              <Button
                variant="danger-solid"
                busy={busy === 'remove'}
                onClick={async () => {
                  const res = await run('remove', () => api('DELETE', `/admin/plugins/${plugin.id}`, { deleteData }), `${plugin.name} was removed.`);
                  if (res) go(base);
                }}
              >
                Remove
              </Button>
            </>
          }
        >
          <p>
            {plugin.pages.length ? `Its page${plugin.pages.length === 1 ? '' : 's'} (${plugin.pages.map((p) => p.path).join(', ')}) will stop working immediately. ` : ''}
            You can install it again later.
          </p>
          <label className="np-check">
            <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
            <span>
              Also delete everything this plugin has saved. <strong>This cannot be undone.</strong>
            </span>
          </label>
        </Modal>
      ) : null}
    </>
  );
}

function SettingsForm({ plugin }: { plugin: PluginView }) {
  const { api, state, setState, notify } = useDash();
  const initial = React.useMemo(() => {
    const values: Record<string, FieldValue> = {};
    for (const f of plugin.settings) if (f.type !== 'secret') values[f.key] = plugin.values[f.key] ?? (f.type === 'toggle' ? false : undefined);
    const paths: Record<string, string> = {};
    for (const p of plugin.pages) paths[p.id] = p.path;
    return { values, paths };
  }, [plugin]);
  const [values, setValues] = React.useState(initial.values);
  const [secrets, setSecrets] = React.useState<Record<string, FieldValue>>({});
  const [paths, setPaths] = React.useState(initial.paths);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  const dirty = JSON.stringify([values, paths]) !== JSON.stringify([initial.values, initial.paths]) || Object.values(secrets).some((v) => v !== undefined);
  const groups = React.useMemo(() => {
    const map = new Map<string, typeof plugin.settings>();
    for (const f of plugin.settings) map.set(f.group ?? 'Settings', [...(map.get(f.group ?? 'Settings') ?? []), f]);
    return [...map.entries()];
  }, [plugin]);
  const editablePages = plugin.pages.filter((p) => p.configurable);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const config: Record<string, unknown> = {};
    for (const f of plugin.settings) {
      if (f.type === 'secret') {
        if (secrets[f.key] !== undefined) config[f.key] = secrets[f.key];
      } else config[f.key] = values[f.key] ?? null;
    }
    try {
      setState(await api<DashboardState>('PATCH', `/admin/plugins/${plugin.id}`, { config, paths, ...(plugin.needsSetup ? { enabled: true } : {}) }));
      notify('Saved. Your site is already using the new settings.');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else notify((err as Error).message, 'error');
    }
    setSaving(false);
  };

  if (!plugin.settings.length && !editablePages.length)
    return (
      <div className="np-card np-empty">
        <h2>Nothing to set up</h2>
        <p>This plugin works out of the box and has no settings.</p>
      </div>
    );

  return (
    <form onSubmit={save} noValidate>
      {plugin.pages.length ? (
        <section className="np-card np-section">
          <h2>Pages</h2>
          <div className="np-pad">
            {plugin.pages.map((p) => {
              const err = errors[`path:${p.id}`];
              return (
                <div className="np-field" key={p.id}>
                  <label htmlFor={`np-path-${p.id}`}>Address of “{p.title}”</label>
                  {p.configurable ? (
                    <span className="np-affix">
                      <span>{state.site.url.replace(/^https?:\/\//, '')}</span>
                      <input id={`np-path-${p.id}`} value={paths[p.id] ?? ''} aria-invalid={err ? true : undefined} onChange={(e) => setPaths({ ...paths, [p.id]: e.target.value })} />
                    </span>
                  ) : (
                    <span id={`np-path-${p.id}`} className="np-code">
                      {p.path}
                    </span>
                  )}
                  <span className="np-help">
                    {p.description ? `${p.description} ` : ''}
                    {plugin.enabled && p.linkable ? (
                      <a href={p.path} target="_blank" rel="noreferrer">
                        Open page ↗
                      </a>
                    ) : null}
                  </span>
                  {err ? <span className="np-error">{err}</span> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {groups.map(([group, fields]) => (
        <section className="np-card np-section" key={group}>
          <h2>{group}</h2>
          <div className="np-pad">
            {fields.map((f) => (
              <SettingInput
                key={f.key}
                field={f}
                value={f.type === 'secret' ? secrets[f.key] : values[f.key]}
                secretSet={plugin.secretsSet[f.key]}
                error={errors[f.key]}
                onChange={(v) => (f.type === 'secret' ? setSecrets({ ...secrets, [f.key]: v }) : setValues({ ...values, [f.key]: v }))}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="np-card np-savebar">
        <span className="np-meta">{Object.keys(errors).length ? 'Some fields need your attention.' : dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
        <Button type="submit" variant="primary" busy={saving} disabled={!dirty && !plugin.needsSetup}>
          {plugin.needsSetup ? 'Save and switch on' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
