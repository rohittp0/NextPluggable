/**
 * The plugin manifest (`plugin.json`) — the contract between a plugin and any host.
 * Everything a non-technical site owner sees about a plugin (name, what it adds,
 * its settings form, what it is allowed to do) is derived from this file.
 */

export const MANIFEST_VERSION = 1;

export type SettingType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'toggle'
  | 'select'
  | 'color'
  | 'url'
  | 'email'
  | 'secret';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingField {
  /** Key under which the value is exposed in the plugin's config object. */
  key: string;
  /** Human label shown in the settings form. */
  label: string;
  type: SettingType;
  /** One plain-language sentence shown under the field. */
  help?: string;
  default?: string | number | boolean;
  required?: boolean;
  placeholder?: string;
  /** Section heading the field is grouped under in the form. */
  group?: string;
  /** `select` only. */
  options?: SettingOption[];
  /** `number` only. */
  min?: number;
  max?: number;
  step?: number;
  /**
   * Keep the value on the server (never sent to browsers). `secret` fields are
   * always server-only and are additionally encrypted at rest.
   */
  serverOnly?: boolean;
}

export interface PluginPage {
  /** Stable id; the server entry's `pages[id]` loader is matched by it. */
  id: string;
  /**
   * Default address of the page, e.g. `/emi-calculator` or `/shop/:slug`.
   * `:name` matches one segment, a trailing `*` matches the rest.
   */
  path: string;
  /** Name of the React component exported from the client entry. */
  component: string;
  /** Shown in the dashboard ("Adds a page: EMI Calculator"). Also the default <title>. */
  title: string;
  description?: string;
  /** Let the site owner change the address from the dashboard. Default true for static paths. */
  configurablePath?: boolean;
  /** Set when the page reads the query string on the server (opts the page out of caching). */
  searchParams?: boolean;
}

export interface PluginSlotContribution {
  /** Name of a `<Slot name="…">` the host site renders, e.g. `header.actions`, `body.end`. */
  slot: string;
  component: string;
  order?: number;
}

export interface PluginAdminPage {
  id: string;
  /** Tab title in the dashboard, e.g. "Messages". */
  title: string;
  component: string;
}

/**
 * What the plugin does on the server, in plain language. Shown to the site
 * owner before installing. (v1 hosts display these; sandboxed hosts enforce them.)
 */
export type PluginPermission =
  | 'storage' // keeps its own data on the site
  | 'email' // sends email through the site
  | `fetch:${string}`; // talks to an external service, e.g. fetch:api.stripe.com

export interface PluginManifest {
  manifestVersion: typeof MANIFEST_VERSION;
  /** Globally unique, URL-safe id: lowercase letters, digits, dashes. */
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** An emoji, or a path to a small .svg/.png relative to the plugin directory. */
  icon?: string;
  category?: string;
  /** Source entry points (used by the build only). */
  entry?: { client?: string; server?: string };
  pages?: PluginPage[];
  slots?: PluginSlotContribution[];
  admin?: PluginAdminPage[];
  settings?: SettingField[];
  permissions?: PluginPermission[];
}

/** Written by `nextpluggable-plugin build` to `dist/build.json`; the only file a host must read to list a plugin. */
export interface PluginBuild {
  buildVersion: 1;
  manifest: PluginManifest;
  /** Icon resolved to something directly renderable (emoji or data: URI). */
  icon?: string;
  files: {
    client?: BuiltFile;
    server?: BuiltFile;
    style?: BuiltFile;
  };
}

export interface BuiltFile {
  /** Path relative to the plugin directory. */
  path: string;
  sha256: string;
  bytes: number;
}

/** Optional `nextpluggable.json` at the root of a repository that hosts several plugins. */
export interface RepositoryIndex {
  name?: string;
  description?: string;
  /** Plugin directories relative to the repository root. */
  plugins: string[];
}

const ID_RE = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const COMPONENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SLOT_RE = /^[a-z][a-z0-9.-]{0,63}$/;
/** Names that collide with built-in object properties; refusing them keeps every lookup by id/key safe. */
const RESERVED = new Set(['constructor', 'prototype', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf']);
const isKey = (v: unknown): v is string => typeof v === 'string' && KEY_RE.test(v) && !RESERVED.has(v);
const SETTING_TYPES: readonly SettingType[] = [
  'text',
  'textarea',
  'number',
  'toggle',
  'select',
  'color',
  'url',
  'email',
  'secret',
];

export class ManifestError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid plugin manifest:\n- ${problems.join('\n- ')}`);
    this.name = 'ManifestError';
  }
}

/** Validate a page path pattern. Returns a problem description, or null when fine. */
export function checkPagePath(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/')) return 'must start with "/"';
  if (path.length > 200) return 'is too long';
  if (path !== '/' && path.endsWith('/')) return 'must not end with "/"';
  if (path === '/') return 'cannot be the home page';
  const segments = path.slice(1).split('/');
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg === '*') {
      if (i !== segments.length - 1) return '"*" is only allowed as the last segment';
      continue;
    }
    if (seg.startsWith(':')) {
      if (!KEY_RE.test(seg.slice(1))) return `has an invalid parameter name "${seg}"`;
      continue;
    }
    if (!/^[A-Za-z0-9._~-]+$/.test(seg)) return `has an invalid segment "${seg}" (use letters, digits, dashes)`;
  }
  return null;
}

export function isStaticPath(path: string): boolean {
  return !path.split('/').some((s) => s === '*' || s.startsWith(':'));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate an untrusted value as a manifest. Throws ManifestError listing every
 * problem in words a plugin author can act on.
 */
export function validateManifest(input: unknown): PluginManifest {
  const p: string[] = [];
  if (!isRecord(input)) throw new ManifestError(['manifest must be a JSON object']);
  const m = input;

  if (m.manifestVersion !== MANIFEST_VERSION) p.push(`"manifestVersion" must be ${MANIFEST_VERSION}`);
  if (typeof m.id !== 'string' || !ID_RE.test(m.id) || RESERVED.has(m.id))
    p.push('"id" must be 3-50 characters: lowercase letters, digits and dashes, starting with a letter');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80) p.push('"name" is required (max 80 characters)');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) p.push('"version" must look like 1.2.3');
  for (const k of ['description', 'author', 'homepage', 'icon', 'category'] as const) {
    if (m[k] !== undefined && typeof m[k] !== 'string') p.push(`"${k}" must be text`);
  }
  if (typeof m.description === 'string' && m.description.length > 500) p.push('"description" is too long (max 500 characters)');

  if (m.entry !== undefined) {
    if (!isRecord(m.entry)) p.push('"entry" must be an object');
    else
      for (const k of ['client', 'server'] as const)
        if (m.entry[k] !== undefined && typeof m.entry[k] !== 'string') p.push(`"entry.${k}" must be a file path`);
  }

  const pageIds = new Set<string>();
  const pagePaths = new Set<string>();
  if (m.pages !== undefined) {
    if (!Array.isArray(m.pages)) p.push('"pages" must be a list');
    else
      m.pages.forEach((page, i) => {
        const at = `pages[${i}]`;
        if (!isRecord(page)) return void p.push(`${at} must be an object`);
        if (!isKey(page.id)) p.push(`${at}.id must be a short identifier`);
        else if (pageIds.has(page.id)) p.push(`${at}.id "${page.id}" is used twice`);
        else pageIds.add(page.id);
        const pathProblem = checkPagePath(page.path);
        if (pathProblem) p.push(`${at}.path ${pathProblem}`);
        else if (pagePaths.has(page.path as string)) p.push(`${at}.path "${String(page.path)}" is used twice`);
        else pagePaths.add(page.path as string);
        if (typeof page.component !== 'string' || !COMPONENT_RE.test(page.component))
          p.push(`${at}.component must be the name of an exported component`);
        if (typeof page.title !== 'string' || !page.title.trim()) p.push(`${at}.title is required`);
        if (page.description !== undefined && typeof page.description !== 'string') p.push(`${at}.description must be text`);
        for (const k of ['configurablePath', 'searchParams'] as const)
          if (page[k] !== undefined && typeof page[k] !== 'boolean') p.push(`${at}.${k} must be true or false`);
      });
  }

  if (m.slots !== undefined) {
    if (!Array.isArray(m.slots)) p.push('"slots" must be a list');
    else
      m.slots.forEach((slot, i) => {
        const at = `slots[${i}]`;
        if (!isRecord(slot)) return void p.push(`${at} must be an object`);
        if (typeof slot.slot !== 'string' || !SLOT_RE.test(slot.slot)) p.push(`${at}.slot must be a slot name like "header.actions"`);
        if (typeof slot.component !== 'string' || !COMPONENT_RE.test(slot.component))
          p.push(`${at}.component must be the name of an exported component`);
        if (slot.order !== undefined && typeof slot.order !== 'number') p.push(`${at}.order must be a number`);
      });
  }

  if (m.admin !== undefined) {
    const ids = new Set<string>();
    if (!Array.isArray(m.admin)) p.push('"admin" must be a list');
    else
      m.admin.forEach((a, i) => {
        const at = `admin[${i}]`;
        if (!isRecord(a)) return void p.push(`${at} must be an object`);
        if (!isKey(a.id)) p.push(`${at}.id must be a short identifier`);
        else if (ids.has(a.id)) p.push(`${at}.id "${a.id}" is used twice`);
        else ids.add(a.id);
        if (typeof a.title !== 'string' || !a.title.trim()) p.push(`${at}.title is required`);
        if (typeof a.component !== 'string' || !COMPONENT_RE.test(a.component))
          p.push(`${at}.component must be the name of an exported component`);
      });
  }

  if (m.settings !== undefined) {
    const keys = new Set<string>();
    if (!Array.isArray(m.settings)) p.push('"settings" must be a list');
    else
      m.settings.forEach((f, i) => {
        const at = `settings[${i}]`;
        if (!isRecord(f)) return void p.push(`${at} must be an object`);
        if (!isKey(f.key)) p.push(`${at}.key must be a short identifier`);
        else if (keys.has(f.key)) p.push(`${at}.key "${f.key}" is used twice`);
        else keys.add(f.key);
        if (typeof f.label !== 'string' || !f.label.trim()) p.push(`${at}.label is required`);
        if (!SETTING_TYPES.includes(f.type as SettingType)) p.push(`${at}.type must be one of: ${SETTING_TYPES.join(', ')}`);
        if (f.type === 'select') {
          if (!Array.isArray(f.options) || f.options.length === 0) p.push(`${at}.options is required for a select`);
          else if (!f.options.every((o) => isRecord(o) && typeof o.value === 'string' && typeof o.label === 'string'))
            p.push(`${at}.options must be a list of { value, label }`);
        }
        if (f.type === 'secret' && f.default !== undefined) p.push(`${at} is a secret and cannot have a default`);
        if (f.default !== undefined) {
          const want = f.type === 'number' ? 'number' : f.type === 'toggle' ? 'boolean' : 'string';
          if (typeof f.default !== want) p.push(`${at}.default must be a ${want}`);
        }
        for (const k of ['min', 'max', 'step'] as const)
          if (f[k] !== undefined && typeof f[k] !== 'number') p.push(`${at}.${k} must be a number`);
        for (const k of ['help', 'placeholder', 'group'] as const)
          if (f[k] !== undefined && typeof f[k] !== 'string') p.push(`${at}.${k} must be text`);
        for (const k of ['required', 'serverOnly'] as const)
          if (f[k] !== undefined && typeof f[k] !== 'boolean') p.push(`${at}.${k} must be true or false`);
      });
  }

  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) p.push('"permissions" must be a list');
    else
      m.permissions.forEach((perm, i) => {
        const ok =
          perm === 'storage' ||
          perm === 'email' ||
          (typeof perm === 'string' && /^fetch:(\*|[a-z0-9.-]+(?::\d+)?)$/i.test(perm));
        if (!ok) p.push(`permissions[${i}] must be "storage", "email" or "fetch:<host>"`);
      });
  }

  if (p.length) throw new ManifestError(p);
  return m as unknown as PluginManifest;
}

/** Default values declared by the manifest's settings. */
export function defaultConfig(manifest: PluginManifest): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const f of manifest.settings ?? []) if (f.default !== undefined) out[f.key] = f.default;
  return out;
}

/** Whether a setting's value may be sent to browsers. */
export function isPublicSetting(field: SettingField): boolean {
  return field.type !== 'secret' && !field.serverOnly;
}

/**
 * Check and normalise values submitted for a plugin's settings.
 * Returns cleaned values plus per-field messages written for a non-technical reader.
 */
export function validateSettings(
  manifest: PluginManifest,
  input: Record<string, unknown>,
): { values: Record<string, string | number | boolean>; errors: Record<string, string> } {
  const values: Record<string, string | number | boolean> = {};
  const errors: Record<string, string> = {};
  for (const f of manifest.settings ?? []) {
    let v = input[f.key];
    if (typeof v === 'string') v = f.type === 'textarea' || f.type === 'secret' ? v : v.trim();
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (f.required) errors[f.key] = `${f.label} is required.`;
      continue;
    }
    switch (f.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) errors[f.key] = `${f.label} must be a number.`;
        else if (f.min !== undefined && n < f.min) errors[f.key] = `${f.label} must be at least ${f.min}.`;
        else if (f.max !== undefined && n > f.max) errors[f.key] = `${f.label} must be at most ${f.max}.`;
        else values[f.key] = n;
        break;
      }
      case 'toggle':
        if (typeof v !== 'boolean') errors[f.key] = `${f.label} must be on or off.`;
        else values[f.key] = v;
        break;
      case 'select':
        if (typeof v !== 'string' || !f.options?.some((o) => o.value === v)) errors[f.key] = `Choose one of the options for ${f.label}.`;
        else values[f.key] = v;
        break;
      case 'color':
        if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) errors[f.key] = `${f.label} must be a colour like #1d4ed8.`;
        else values[f.key] = v.toLowerCase();
        break;
      case 'url':
        if (typeof v !== 'string' || !/^https?:\/\/\S+$/i.test(v)) errors[f.key] = `${f.label} must be a web address starting with http:// or https://.`;
        else values[f.key] = v;
        break;
      case 'email':
        if (typeof v !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.key] = `${f.label} must be an email address.`;
        else values[f.key] = v;
        break;
      default:
        if (typeof v !== 'string') errors[f.key] = `${f.label} must be text.`;
        else if (v.length > 10_000) errors[f.key] = `${f.label} is too long.`;
        else values[f.key] = v;
    }
  }
  return { values, errors };
}

export function validateRepositoryIndex(input: unknown): RepositoryIndex {
  if (!isRecord(input) || !Array.isArray(input.plugins) || !input.plugins.every((x) => typeof x === 'string'))
    throw new ManifestError(['nextpluggable.json must contain a "plugins" list of directories']);
  const plugins = input.plugins.map((d: string) => d.replace(/^\.?\/+/, '').replace(/\/+$/, ''));
  if (plugins.some((d) => d.split('/').includes('..'))) throw new ManifestError(['plugin directories must stay inside the repository']);
  return {
    name: typeof input.name === 'string' ? input.name : undefined,
    description: typeof input.description === 'string' ? input.description : undefined,
    plugins,
  };
}

export function validateBuild(input: unknown): PluginBuild {
  if (!isRecord(input) || input.buildVersion !== 1) throw new ManifestError(['dist/build.json is missing or was made by an incompatible build tool']);
  const manifest = validateManifest(input.manifest);
  const files: PluginBuild['files'] = {};
  const rawFiles = isRecord(input.files) ? input.files : {};
  for (const k of ['client', 'server', 'style'] as const) {
    const f = rawFiles[k];
    if (f === undefined) continue;
    if (
      !isRecord(f) ||
      typeof f.path !== 'string' ||
      f.path.split('/').includes('..') ||
      f.path.startsWith('/') ||
      typeof f.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(f.sha256) ||
      typeof f.bytes !== 'number'
    )
      throw new ManifestError([`dist/build.json has a malformed "${k}" file entry`]);
    files[k] = { path: f.path, sha256: f.sha256, bytes: f.bytes };
  }
  const needsClient = (manifest.pages?.length ?? 0) + (manifest.slots?.length ?? 0) + (manifest.admin?.length ?? 0) > 0;
  if (needsClient && !files.client) throw new ManifestError(['the plugin declares pages or components but has no built client bundle']);
  const icon = typeof input.icon === 'string' && input.icon.length <= 64_000 ? input.icon : undefined;
  return { buildVersion: 1, manifest, icon, files };
}
