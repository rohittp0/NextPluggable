import { describe, expect, it } from 'vitest';
import {
  checkPagePath,
  defaultConfig,
  isStaticPath,
  ManifestError,
  validateBuild,
  validateManifest,
  validateRepositoryIndex,
  validateSettings,
  type PluginManifest,
} from './manifest.js';

const base = { manifestVersion: 1, id: 'demo-plugin', name: 'Demo', version: '1.0.0' };

function problems(input: unknown): string[] {
  try {
    validateManifest(input);
  } catch (e) {
    if (e instanceof ManifestError) return e.problems;
    throw e;
  }
  return [];
}

describe('validateManifest', () => {
  it('accepts a minimal manifest and a full one', () => {
    expect(validateManifest(base).id).toBe('demo-plugin');
    const full = {
      ...base,
      description: 'd',
      icon: '🧮',
      pages: [{ id: 'main', path: '/demo', component: 'Main', title: 'Demo' }, { id: 'item', path: '/demo/:slug', component: 'Item', title: 'Item' }],
      slots: [{ slot: 'header.actions', component: 'Button', order: 2 }],
      admin: [{ id: 'inbox', title: 'Inbox', component: 'Inbox' }],
      settings: [
        { key: 'title', label: 'Title', type: 'text', default: 'Hi' },
        { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }] },
        { key: 'apiKey', label: 'Key', type: 'secret' },
      ],
      permissions: ['storage', 'fetch:api.stripe.com', 'fetch:*'],
    };
    expect(problems(full)).toEqual([]);
  });

  it('reports every problem at once, in words', () => {
    const found = problems({ manifestVersion: 2, id: 'Bad Id', name: '', version: 'one' });
    expect(found).toHaveLength(4);
    expect(found.join(' ')).toContain('"version" must look like 1.2.3');
  });

  it.each([
    ['not an object', null],
    ['id shadowing a built-in', { ...base, id: 'constructor' }],
    ['duplicate page ids', { ...base, pages: [{ id: 'a', path: '/a', component: 'A', title: 'A' }, { id: 'a', path: '/b', component: 'B', title: 'B' }] }],
    ['duplicate page paths', { ...base, pages: [{ id: 'a', path: '/a', component: 'A', title: 'A' }, { id: 'b', path: '/a', component: 'B', title: 'B' }] }],
    ['a page on the home address', { ...base, pages: [{ id: 'a', path: '/', component: 'A', title: 'A' }] }],
    ['a page key shadowing a built-in', { ...base, pages: [{ id: 'toString', path: '/a', component: 'A', title: 'A' }] }],
    ['a component that is not an identifier', { ...base, pages: [{ id: 'a', path: '/a', component: 'A-B', title: 'A' }] }],
    ['a select without options', { ...base, settings: [{ key: 'm', label: 'M', type: 'select' }] }],
    ['a secret with a default', { ...base, settings: [{ key: 's', label: 'S', type: 'secret', default: 'x' }] }],
    ['a default of the wrong type', { ...base, settings: [{ key: 'n', label: 'N', type: 'number', default: '5' }] }],
    ['a setting key shadowing a built-in', { ...base, settings: [{ key: 'valueOf', label: 'V', type: 'text' }] }],
    ['an unknown setting type', { ...base, settings: [{ key: 'n', label: 'N', type: 'date' }] }],
    ['an unknown permission', { ...base, permissions: ['filesystem'] }],
    ['a malformed fetch permission', { ...base, permissions: ['fetch:https://x.com/path'] }],
  ])('rejects %s', (_name, input) => {
    expect(problems(input).length).toBeGreaterThan(0);
  });
});

describe('page paths', () => {
  it.each(['/tools/emi', '/shop/:slug', '/docs/*', '/a.b~c-d_e'])('accepts %s', (p) => expect(checkPagePath(p)).toBeNull());
  it.each(['tools', '/', '/a/', '/a//b', '/a/*/b', '/a/:1x', '/a b', '/a?x=1', '/../etc'])('rejects %s', (p) => expect(checkPagePath(p)).not.toBeNull());
  it('tells static paths from patterns', () => {
    expect(isStaticPath('/a/b')).toBe(true);
    expect(isStaticPath('/a/:b')).toBe(false);
    expect(isStaticPath('/a/*')).toBe(false);
  });
});

describe('settings', () => {
  const manifest = validateManifest({
    ...base,
    settings: [
      { key: 'title', label: 'Title', type: 'text', required: true, default: 'Hello' },
      { key: 'rate', label: 'Rate', type: 'number', min: 0, max: 40 },
      { key: 'show', label: 'Show', type: 'toggle', default: true },
      { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      { key: 'colour', label: 'Colour', type: 'color' },
      { key: 'link', label: 'Link', type: 'url' },
      { key: 'mail', label: 'Mail', type: 'email' },
      { key: 'apiKey', label: 'API key', type: 'secret' },
    ],
  }) as PluginManifest;

  it('collects defaults', () => {
    expect(defaultConfig(manifest)).toEqual({ title: 'Hello', show: true });
  });

  it('normalises good values', () => {
    const { values, errors } = validateSettings(manifest, { title: '  Hi  ', rate: '8.5', show: false, mode: 'b', colour: '#AABBCC', link: 'https://x.com', mail: 'a@b.co', apiKey: ' keep spaces ' });
    expect(errors).toEqual({});
    expect(values).toEqual({ title: 'Hi', rate: 8.5, show: false, mode: 'b', colour: '#aabbcc', link: 'https://x.com', mail: 'a@b.co', apiKey: ' keep spaces ' });
  });

  it('explains each bad value in a sentence and drops it', () => {
    const { values, errors } = validateSettings(manifest, { title: '', rate: 99, show: 'yes', mode: 'z', colour: 'red', link: 'x.com', mail: 'nope' });
    expect(values).toEqual({});
    expect(errors).toMatchObject({
      title: 'Title is required.',
      rate: 'Rate must be at most 40.',
      show: 'Show must be on or off.',
      mode: 'Choose one of the options for Mode.',
      link: 'Link must be a web address starting with http:// or https://.',
      mail: 'Mail must be an email address.',
    });
    expect(errors.colour).toContain('#1d4ed8');
  });

  it('ignores values for settings the plugin does not declare', () => {
    expect(validateSettings(manifest, { title: 'x', injected: 'y' }).values).toEqual({ title: 'x' });
  });
});

describe('repository index and build files', () => {
  it('normalises plugin directories and refuses to leave the repository', () => {
    expect(validateRepositoryIndex({ plugins: ['./plugins/a/', 'b'] }).plugins).toEqual(['plugins/a', 'b']);
    expect(() => validateRepositoryIndex({ plugins: ['../outside'] })).toThrow(ManifestError);
    expect(() => validateRepositoryIndex({ plugins: 'a' })).toThrow(ManifestError);
  });

  const file = { path: 'dist/client.js', sha256: 'a'.repeat(64), bytes: 10 };
  const withPage = { ...base, pages: [{ id: 'a', path: '/a', component: 'A', title: 'A' }] };

  it('accepts a well-formed build', () => {
    expect(validateBuild({ buildVersion: 1, manifest: withPage, files: { client: file } }).files.client?.sha256).toBe(file.sha256);
  });
  it.each([
    ['an unknown build version', { buildVersion: 2, manifest: base, files: {} }],
    ['a file path that escapes the plugin', { buildVersion: 1, manifest: base, files: { client: { ...file, path: '../../x.js' } } }],
    ['an absolute file path', { buildVersion: 1, manifest: base, files: { client: { ...file, path: '/etc/passwd' } } }],
    ['a malformed fingerprint', { buildVersion: 1, manifest: base, files: { client: { ...file, sha256: 'xyz' } } }],
    ['pages without a client bundle', { buildVersion: 1, manifest: withPage, files: {} }],
    ['an invalid manifest inside', { buildVersion: 1, manifest: { ...base, id: 'X' }, files: {} }],
  ])('rejects %s', (_n, input) => expect(() => validateBuild(input)).toThrow(ManifestError));
});
