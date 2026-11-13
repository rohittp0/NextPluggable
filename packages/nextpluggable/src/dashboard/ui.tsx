'use client';
import * as React from 'react';
import type { SettingField } from '@nextpluggable/plugin/manifest';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export type ApiCall = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

export function createApi(apiPath: string, onUnauthorized: () => void): ApiCall {
  return async (method, path, body) => {
    let res: Response;
    try {
      res = await fetch(`${apiPath}${path}`, {
        method,
        credentials: 'same-origin',
        headers: { 'x-nextpluggable': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new ApiError('Could not reach the site. Check your connection and try again.', 0);
    }
    const data = (await res.json().catch(() => null)) as { error?: string; fields?: Record<string, string> } | null;
    if (!res.ok) {
      if (res.status === 401 && path.startsWith('/admin')) onUnauthorized();
      throw new ApiError(data?.error ?? 'Something went wrong. Please try again.', res.status, data?.fields);
    }
    return data as never;
  };
}

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'danger-solid' | 'link'; small?: boolean; busy?: boolean },
) {
  const { variant, small, busy, className, children, disabled, ...rest } = props;
  const cls = ['np-btn', variant ? `np-btn-${variant}` : '', small ? 'np-btn-sm' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type="button" {...rest} className={cls} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="np-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; showLabel?: boolean }) {
  return (
    <label className="np-switch">
      <input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} aria-label={props.label} onChange={(e) => props.onChange(e.target.checked)} />
      <i aria-hidden="true" />
      {props.showLabel ? <span>{props.label}</span> : null}
    </label>
  );
}

export function PluginIcon({ icon, name }: { icon?: string; name: string }) {
  return (
    <span className="np-icon" aria-hidden="true">
      {icon?.startsWith('data:') ? <img src={icon} alt="" /> : (icon ?? name.slice(0, 1).toUpperCase())}
    </span>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const { onClose } = props;
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="np-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="np-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <header>
          <h2 id={titleId}>{props.title}</h2>
        </header>
        <div className="np-modal-body">{props.children}</div>
        <footer>{props.footer}</footer>
      </div>
    </div>
  );
}

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="np-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`np-toast${t.kind === 'error' ? ' np-toast-error' : ''}`}>
          <span>{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export type FieldValue = string | number | boolean | undefined;

/** One auto-generated form control for a plugin setting. */
export function SettingInput(props: {
  field: SettingField;
  value: FieldValue;
  secretSet?: boolean;
  error?: string;
  onChange: (value: FieldValue) => void;
}) {
  const { field, value, error, onChange } = props;
  const id = React.useId();
  const describedBy = [field.help ? `${id}-help` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  const common = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, className: 'np-input' } as const;
  let control: React.ReactNode;

  switch (field.type) {
    case 'toggle':
      return (
        <div className="np-field">
          <Switch checked={Boolean(value)} onChange={onChange} label={field.label} showLabel />
          {field.help ? <span className="np-help">{field.help}</span> : null}
          {error ? <span className="np-error">{error}</span> : null}
        </div>
      );
    case 'textarea':
      control = <textarea {...common} value={(value as string) ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'number':
      control = (
        <input
          {...common}
          type="number"
          inputMode="decimal"
          value={value === undefined ? '' : String(value)}
          min={field.min}
          max={field.max}
          step={field.step ?? 'any'}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
      break;
    case 'select':
      control = (
        <select {...common} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          {!field.required || value === undefined ? <option value="">Choose…</option> : null}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'color':
      control = (
        <span className="np-color">
          <input type="color" aria-label={`${field.label} picker`} value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#000000'} onChange={(e) => onChange(e.target.value)} />
          <input {...common} style={{ maxWidth: 140 }} value={(value as string) ?? ''} placeholder="#2563eb" onChange={(e) => onChange(e.target.value)} />
        </span>
      );
      break;
    case 'secret':
      control = (
        <input
          {...common}
          type="password"
          autoComplete="new-password"
          value={(value as string) ?? ''}
          placeholder={props.secretSet ? 'Saved. Type to replace it' : field.placeholder}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      );
      break;
    default:
      control = (
        <input
          {...common}
          type={field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : 'text'}
          value={(value as string) ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }

  return (
    <div className="np-field">
      <label htmlFor={id}>
        {field.label}
        {field.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {control}
      {field.help ? (
        <span className="np-help" id={`${id}-help`}>
          {field.help}
        </span>
      ) : null}
      {field.type === 'secret' ? <span className="np-help">Kept private on the server. It is never shown again after saving.</span> : null}
      {error ? (
        <span className="np-error" id={`${id}-err`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

const SLOT_NAMES: Record<string, string> = {
  'header.actions': 'your site header',
  header: 'your site header',
  footer: 'your site footer',
  'body.end': 'every page',
  sidebar: 'your sidebar',
};

/** What a plugin adds and is allowed to do, in plain language. */
export function describePlugin(p: {
  pages: { title: string; path: string }[];
  slots: string[];
  adminPages: string[];
  permissions: string[];
  hasServer: boolean;
}): string[] {
  const out: string[] = [];
  for (const page of p.pages) out.push(`Adds the page “${page.title}” at ${page.path}`);
  for (const slot of p.slots) out.push(`Shows something in ${SLOT_NAMES[slot] ?? `the “${slot}” area of your site`}`);
  for (const title of p.adminPages) out.push(`Adds a “${title}” screen to this dashboard`);
  if (p.permissions.includes('storage')) out.push('Saves its own data on your site');
  if (p.permissions.includes('email')) out.push('Sends email from your site');
  for (const perm of p.permissions)
    if (perm.startsWith('fetch:')) out.push(perm === 'fetch:*' ? 'Connects to other services on the internet' : `Connects to ${perm.slice(6)}`);
  if (p.hasServer) out.push('Runs its own code on your site’s server');
  return out;
}

export function timeAgo(iso: string | undefined): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? '' : 's'} ago`;
  return `${Math.round(s / 86_400)} day${Math.round(s / 86_400) === 1 ? '' : 's'} ago`;
}
