import { adminOnly, definePluginServer, json, readJson } from '@nextpluggable/plugin/server';

interface Config {
  heading: string;
  intro?: string;
  askPhone: boolean;
  requireMessage: boolean;
  webhookUrl?: string;
}

export interface Enquiry {
  id: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  page?: string;
  receivedAt: string;
  handled: boolean;
}

const PREFIX = 'enquiry/';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Best-effort flood protection per server instance: 5 enquiries a minute per visitor address.
const recent = new Map<string, number[]>();
function tooMany(request: Request): boolean {
  const who = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  const times = (recent.get(who) ?? []).filter((t) => now - t < 60_000);
  times.push(now);
  recent.set(who, times);
  if (recent.size > 5000) recent.clear();
  return times.length > 5;
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export default definePluginServer<Config>({
  pages: {
    form: ({ config }) => ({
      metadata: { title: config.heading, description: config.intro?.slice(0, 160) },
    }),
  },

  api: {
    // Public: a visitor submits the form.
    'POST /enquiries': async ({ request, config, storage, log }) => {
      if (tooMany(request)) return json({ error: 'Too many enquiries from this connection. Please try again in a minute.' }, 429);
      const body = await readJson<Record<string, unknown>>(request, 20_000);
      if (!body) return json({ error: 'We could not read your enquiry. Please try again.' }, 400);
      // Honeypot: real visitors never see or fill this field.
      if (text(body.company, 200)) return json({ ok: true });

      const name = text(body.name, 120);
      const email = text(body.email, 200);
      const phone = config.askPhone ? text(body.phone, 40) : '';
      const message = text(body.message, 4000);
      const fields: Record<string, string> = {};
      if (!name) fields.name = 'Please tell us your name.';
      if (!EMAIL.test(email)) fields.email = 'Please enter a valid email address.';
      if (phone && !/^[0-9+()\-\s.]{6,}$/.test(phone)) fields.phone = 'Please enter a valid phone number.';
      if (config.requireMessage && !message) fields.message = 'Please tell us how we can help.';
      if (Object.keys(fields).length) return json({ error: 'Please check the highlighted fields.', fields }, 422);

      const receivedAt = new Date().toISOString();
      const id = `${receivedAt.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
      const enquiry: Enquiry = { id, name, email, phone: phone || undefined, message: message || undefined, page: text(body.page, 300) || undefined, receivedAt, handled: false };
      await storage.set(PREFIX + id, enquiry);

      if (config.webhookUrl) {
        try {
          await fetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: `New enquiry from ${name} <${email}>${phone ? `, ${phone}` : ''}${message ? `\n${message}` : ''}`, enquiry }),
            signal: AbortSignal.timeout(4000),
          });
        } catch (e) {
          log('Could not deliver the notification webhook:', (e as Error).message);
        }
      }
      return json({ ok: true });
    },

    // Dashboard only: the inbox.
    'GET /enquiries': adminOnly(async ({ storage }) => {
      const keys = (await storage.list(PREFIX)).reverse().slice(0, 200);
      const items = (await Promise.all(keys.map((k) => storage.get<Enquiry>(k)))).filter((e): e is Enquiry => e !== null);
      return json({ enquiries: items, total: keys.length });
    }),

    'PATCH /enquiries/:id': adminOnly(async ({ request, params, storage }) => {
      const key = PREFIX + params.id;
      const enquiry = await storage.get<Enquiry>(key);
      if (!enquiry) return json({ error: 'That enquiry no longer exists.' }, 404);
      const body = await readJson<{ handled?: unknown }>(request);
      enquiry.handled = body?.handled === true;
      await storage.set(key, enquiry);
      return json({ enquiry });
    }),

    'DELETE /enquiries/:id': adminOnly(async ({ params, storage }) => {
      await storage.delete(PREFIX + params.id);
      return json({ ok: true });
    }),
  },
});
