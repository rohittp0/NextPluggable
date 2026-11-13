import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigation, usePlugin, usePluginApi, usePluginConfig, type PageProps } from '@nextpluggable/plugin';
import type { Enquiry } from './server';
import './style.css';

interface Config {
  heading: string;
  intro?: string;
  submitLabel: string;
  successMessage: string;
  askPhone: boolean;
  requireMessage: boolean;
  floatingButton: boolean;
  floatingLabel?: string;
  accent: string;
}

const accentStyle = (accent: string) => ({ ['--npenq-accent' as string]: accent });

function Input(props: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  multiline?: boolean;
  autoComplete?: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const shared = {
    id,
    name: props.name,
    value: props.value,
    required: props.required,
    autoComplete: props.autoComplete,
    'aria-invalid': props.error ? true : undefined,
    'aria-describedby': props.error ? `${id}-error` : undefined,
  } as const;
  return (
    <div className="npenq-field">
      <label htmlFor={id}>
        {props.label}
        {props.required ? null : <span className="npenq-optional"> (optional)</span>}
      </label>
      {props.multiline ? (
        <textarea {...shared} rows={5} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input {...shared} type={props.type ?? 'text'} onChange={(e) => props.onChange(e.target.value)} />
      )}
      {props.error ? (
        <p className="npenq-error" id={`${id}-error`}>
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

/** The public contact page. */
export function EnquiryPage(_props: PageProps) {
  const cfg = usePluginConfig<Config>();
  const api = usePluginApi();
  const [values, setValues] = useState({ name: '', email: '', phone: '', message: '', company: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (v: string) => setValues((s) => ({ ...s, [key]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setProblem(null);
    setErrors({});
    try {
      const res = await api('/enquiries', { method: 'POST', json: { ...values, page: document.referrer || undefined } });
      const body = (await res.json().catch(() => null)) as { error?: string; fields?: Record<string, string> } | null;
      if (res.ok) return setStatus('sent');
      setErrors(body?.fields ?? {});
      setProblem(body?.error ?? 'Something went wrong. Please try again.');
    } catch {
      setProblem('We could not send your enquiry. Check your connection and try again.');
    }
    setStatus('idle');
  };

  return (
    <section className="npenq" style={accentStyle(cfg.accent)}>
      <h1>{cfg.heading}</h1>
      {cfg.intro ? <p className="npenq-intro">{cfg.intro}</p> : null}
      {status === 'sent' ? (
        <div className="npenq-card npenq-success" role="status">
          <span aria-hidden="true">✓</span>
          <p>{cfg.successMessage}</p>
        </div>
      ) : (
        <form className="npenq-card" onSubmit={submit} noValidate>
          <Input name="name" label="Your name" required autoComplete="name" value={values.name} error={errors.name} onChange={set('name')} />
          <Input name="email" label="Email" type="email" required autoComplete="email" value={values.email} error={errors.email} onChange={set('email')} />
          {cfg.askPhone ? <Input name="phone" label="Phone" type="tel" autoComplete="tel" value={values.phone} error={errors.phone} onChange={set('phone')} /> : null}
          <Input name="message" label="How can we help?" multiline required={cfg.requireMessage} value={values.message} error={errors.message} onChange={set('message')} />
          {/* Honeypot for bots: hidden from people and assistive technology. */}
          <div className="npenq-hp" aria-hidden="true">
            <label>
              Company
              <input tabIndex={-1} autoComplete="off" name="company" value={values.company} onChange={(e) => set('company')(e.target.value)} />
            </label>
          </div>
          {problem ? (
            <p className="npenq-error" role="alert">
              {problem}
            </p>
          ) : null}
          <button type="submit" className="npenq-submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : cfg.submitLabel}
          </button>
        </form>
      )}
    </section>
  );
}

/** Floating button shown on every page of the site (slot: body.end). */
export function EnquiryButton() {
  const cfg = usePluginConfig<Config>();
  const { paths } = usePlugin();
  const { pathname } = useNavigation();
  const target = paths.form;
  if (!cfg.floatingButton || !target || pathname === target) return null;
  return (
    <Link href={target} className="npenq-fab" style={accentStyle(cfg.accent)}>
      <span aria-hidden="true">✉</span> {cfg.floatingLabel || 'Get in touch'}
    </Link>
  );
}

/** The inbox shown as a tab in the plugin dashboard. */
export function EnquiryInbox() {
  const api = usePluginApi();
  const [items, setItems] = useState<Enquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api('/enquiries');
      if (!res.ok) throw new Error();
      setItems(((await res.json()) as { enquiries: Enquiry[] }).enquiries);
    } catch {
      setError('The enquiries could not be loaded.');
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const setHandled = async (enquiry: Enquiry, handled: boolean) => {
    setItems((list) => list?.map((e) => (e.id === enquiry.id ? { ...e, handled } : e)) ?? null);
    const res = await api(`/enquiries/${enquiry.id}`, { method: 'PATCH', json: { handled } });
    if (!res.ok) void load();
  };
  const remove = async (enquiry: Enquiry) => {
    if (!window.confirm(`Delete the enquiry from ${enquiry.name}? This cannot be undone.`)) return;
    setItems((list) => list?.filter((e) => e.id !== enquiry.id) ?? null);
    const res = await api(`/enquiries/${enquiry.id}`, { method: 'DELETE' });
    if (!res.ok) void load();
  };

  if (error)
    return (
      <div className="npenq-admin">
        <p className="npenq-error">{error}</p>
        <button type="button" className="npenq-btn" onClick={load}>
          Try again
        </button>
      </div>
    );
  if (!items) return <p className="npenq-admin npenq-muted">Loading enquiries…</p>;
  if (!items.length)
    return (
      <div className="npenq-admin npenq-empty">
        <p className="npenq-empty-title">No enquiries yet</p>
        <p className="npenq-muted">When a visitor sends the form, their message appears here.</p>
      </div>
    );

  const open = items.filter((e) => !e.handled).length;
  return (
    <div className="npenq-admin">
      <p className="npenq-muted" data-testid="enquiry-count">
        {items.length} enquir{items.length === 1 ? 'y' : 'ies'} · {open} to follow up
      </p>
      <ul className="npenq-list">
        {items.map((e) => (
          <li key={e.id} className={e.handled ? 'npenq-handled' : undefined}>
            <div className="npenq-item-head">
              <strong>{e.name}</strong>
              <time dateTime={e.receivedAt}>{new Date(e.receivedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
            </div>
            <p className="npenq-contact">
              <a href={`mailto:${e.email}`}>{e.email}</a>
              {e.phone ? (
                <>
                  {' · '}
                  <a href={`tel:${e.phone}`}>{e.phone}</a>
                </>
              ) : null}
            </p>
            {e.message ? <p className="npenq-message">{e.message}</p> : null}
            <div className="npenq-actions">
              <label>
                <input type="checkbox" checked={e.handled} onChange={(ev) => setHandled(e, ev.target.checked)} /> Followed up
              </label>
              <button type="button" className="npenq-btn npenq-btn-danger" onClick={() => remove(e)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
