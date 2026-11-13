import { describe, expect, it } from 'vitest';
import { effectivePaths, findPage, matchPattern, normalizePathname, pathProblem } from './routes.js';
import type { InstallRecord, Installs } from './types.js';

function install(id: string, pages: { id: string; path: string }[], extra: Partial<InstallRecord> = {}): InstallRecord {
  return {
    id,
    manifest: { manifestVersion: 1, id, name: id.toUpperCase(), version: '1.0.0', pages: pages.map((p) => ({ ...p, component: 'C', title: p.id })) },
    buildHash: 'h',
    source: { id: 's', label: 'src', path: id, revision: 'r' },
    files: {},
    enabled: true,
    config: {},
    paths: {},
    installedAt: '',
    updatedAt: '',
    ...extra,
  };
}

describe('matchPattern', () => {
  it.each([
    ['/tools/emi', '/tools/emi', {}],
    ['/shop/:slug', '/shop/red-shoes', { slug: 'red-shoes' }],
    ['/shop/:slug', '/shop/caf%C3%A9', { slug: 'café' }],
    ['/docs/*', '/docs/a/b/c', { '*': 'a/b/c' }],
    ['/docs/*', '/docs', { '*': '' }],
    ['/:a/:b', '/x/y', { a: 'x', b: 'y' }],
  ])('%s matches %s', (pattern, path, params) => expect(matchPattern(pattern, path)).toEqual(params));

  it.each([
    ['/tools/emi', '/tools'],
    ['/tools/emi', '/tools/emi/extra'],
    ['/shop/:slug', '/shop'],
    ['/shop/:slug', '/shop/a/b'],
    ['/tools/emi', '/tools/EMI'],
  ])('%s does not match %s', (pattern, path) => expect(matchPattern(pattern, path)).toBeNull());

  it('survives malformed percent-encoding', () => {
    expect(matchPattern('/shop/:slug', '/shop/%E0%A4%A')).toEqual({ slug: '%E0%A4%A' });
  });
});

describe('findPage', () => {
  const installs: Installs = {
    shop: install('shop', [{ id: 'cart', path: '/shop/cart' }, { id: 'product', path: '/shop/:slug' }, { id: 'rest', path: '/shop/*' }]),
    emi: install('emi', [{ id: 'calc', path: '/emi' }], { paths: { calc: '/loan-calculator' } }),
    off: install('off', [{ id: 'page', path: '/hidden' }], { enabled: false }),
  };

  it('prefers exact addresses over parameters over wildcards', () => {
    expect(findPage(installs, '/shop/cart')?.page.id).toBe('cart');
    expect(findPage(installs, '/shop/red-shoes')).toMatchObject({ page: { id: 'product' }, params: { slug: 'red-shoes' } });
    expect(findPage(installs, '/shop/a/b')?.page.id).toBe('rest');
  });

  it('uses the address chosen by the owner, not the plugin default', () => {
    expect(effectivePaths(installs.emi!)).toEqual({ calc: '/loan-calculator' });
    expect(findPage(installs, '/loan-calculator')?.install.id).toBe('emi');
    expect(findPage(installs, '/emi')).toBeNull();
  });

  it('ignores paused plugins, tolerates a trailing slash, and finds nothing for unknown addresses', () => {
    expect(findPage(installs, '/hidden')).toBeNull();
    expect(findPage(installs, '/loan-calculator/')?.install.id).toBe('emi');
    expect(findPage(installs, '/nope')).toBeNull();
    expect(findPage({}, '/')).toBeNull();
    expect(normalizePathname('//a//b/')).toBe('/a/b');
  });
});

describe('pathProblem', () => {
  const installs: Installs = { a: install('a', [{ id: 'one', path: '/one' }, { id: 'two', path: '/two' }]), b: install('b', [{ id: 'item', path: '/b/:id' }]) };
  const reserved = ['/admin/plugins', '/api/nextpluggable', '/_next', '/api'];

  it('allows a free address and a page keeping its own', () => {
    expect(pathProblem(installs, 'a', 'one', '/fresh', reserved)).toBeNull();
    expect(pathProblem(installs, 'a', 'one', '/one', reserved)).toBeNull();
  });
  it('names the plugin that already owns an address', () => {
    expect(pathProblem(installs, 'b', 'item', '/one', reserved)).toContain('already used by the plugin "A"');
    expect(pathProblem(installs, 'a', 'one', '/two', reserved)).toContain('another page of this plugin');
    expect(pathProblem(installs, 'a', 'one', '/b/:slug', reserved)).toContain('"B"'); // same shape, different parameter name
  });
  it('protects the dashboard, API and framework addresses', () => {
    for (const p of ['/admin/plugins', '/admin/plugins/x', '/api/anything', '/_next/static']) expect(pathProblem(installs, 'a', 'one', p, reserved)).toContain('reserved');
    expect(pathProblem(installs, 'a', 'one', '/administrator', reserved)).toBeNull();
  });
});
