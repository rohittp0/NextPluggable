import { describe, expect, it } from 'vitest';
import { HttpError } from '../errors.js';
import { githubReader, parseGitHubUrl } from './github.js';

describe('parseGitHubUrl', () => {
  it.each([
    ['acme/plugins', { owner: 'acme', repo: 'plugins' }],
    ['https://github.com/acme/plugins', { owner: 'acme', repo: 'plugins' }],
    ['  https://github.com/acme/plugins/  ', { owner: 'acme', repo: 'plugins' }],
    ['http://www.github.com/acme/plugins.git', { owner: 'acme', repo: 'plugins' }],
    ['github.com/acme/plugins', { owner: 'acme', repo: 'plugins' }],
    ['git@github.com:acme/plugins.git', { owner: 'acme', repo: 'plugins' }],
    ['https://github.com/acme/plugins/tree/main', { owner: 'acme', repo: 'plugins', ref: 'main' }],
    ['https://github.com/acme/plugins/tree/v2/packages/site%20plugins', { owner: 'acme', repo: 'plugins', ref: 'v2', dir: 'packages/site plugins' }],
    ['https://github.com/acme/plugins?tab=readme#top', { owner: 'acme', repo: 'plugins' }],
    ['https://github.com/acme/plugins/issues/3', { owner: 'acme', repo: 'plugins' }],
  ])('understands %s', (input, expected) => expect(parseGitHubUrl(input)).toEqual(expected));

  it.each(['', 'plugins', 'a/b/c', 'https://gitlab.com/acme/plugins', 'https://github.com/acme', 'https://github.com.evil.example/acme/plugins', '/etc/passwd', '/home/plugins', './plugins', '../a/b', 'acme/plug ins', 'javascript:alert(1)'])(
    'refuses %s',
    (input) => expect(parseGitHubUrl(input)).toBeNull(),
  );
});

it('cannot be steered outside the repository by dot segments', () => {
  expect(parseGitHubUrl('https://github.com/acme/plugins/tree/main/../../etc')).toEqual({ owner: 'acme', repo: 'plugins' });
  expect(parseGitHubUrl('https://github.com/acme/plugins/tree/main/a/%2e%2e/%2e%2e/%2e%2e/etc')?.dir ?? '').not.toContain('..');
});

function fakeFetch(respond: (url: URL, headers: Headers) => Response) {
  const calls: { url: URL; headers: Headers }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });
    return respond(url, headers);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const SHA = 'c'.repeat(40);
const message = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(HttpError);
  return (e as HttpError).message;
};

describe('githubReader', () => {
  it('resolves the commit, then reads files pinned to it', async () => {
    const { fetchImpl, calls } = fakeFetch((url) => (url.pathname.endsWith('/commits/HEAD') ? new Response(`${SHA}\n`) : new Response('{"ok":true}')));
    const reader = githubReader({ owner: 'acme', repo: 'plugins' }, { apiUrl: 'https://api.github.com', fetch: fetchImpl });
    const revision = await reader.resolveRevision();
    expect(revision).toBe(SHA);
    const bytes = await reader.read('plugins/my plugin/dist/build.json', revision);
    expect(new TextDecoder().decode(bytes!)).toBe('{"ok":true}');
    expect(calls[0]!.headers.get('accept')).toBe('application/vnd.github.sha');
    expect(calls[1]!.url.pathname).toBe('/repos/acme/plugins/contents/plugins/my%20plugin/dist/build.json');
    expect(calls[1]!.url.searchParams.get('ref')).toBe(SHA);
    expect(calls[1]!.headers.get('accept')).toBe('application/vnd.github.raw+json');
    expect(calls.every((c) => !c.headers.has('authorization'))).toBe(true);
  });

  it('sends the token only as a bearer header and follows a chosen branch', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(SHA));
    await githubReader({ owner: 'acme', repo: 'plugins', ref: 'release/v2' }, { apiUrl: 'https://ghe.example/api/v3', token: 'tok', fetch: fetchImpl }).resolveRevision();
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer tok');
    expect(calls[0]!.url.href).toBe('https://ghe.example/api/v3/repos/acme/plugins/commits/release/v2');
    expect(calls[0]!.url.href).not.toContain('tok');
  });

  it('treats a missing file as absent, not as an error', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('{}', { status: 404 }));
    expect(await githubReader({ owner: 'a', repo: 'b' }, { apiUrl: 'https://x', fetch: fetchImpl }).read('nope', SHA)).toBeNull();
  });

  it('explains every way GitHub can say no', async () => {
    const reader = (status: number, headers: Record<string, string> = {}, token?: string, ref?: string) =>
      githubReader({ owner: 'acme', repo: 'plugins', ref }, { apiUrl: 'https://x', token, fetch: fakeFetch(() => new Response('{}', { status, headers })).fetchImpl });

    expect(await message(reader(404).resolveRevision())).toContain('if the repository is private, add an access token');
    expect(await message(reader(404, {}, 'tok').resolveRevision())).toContain('that the access token can read it');
    expect(await message(reader(422, {}, undefined, 'nope').resolveRevision())).toContain('We could not find "nope"');
    expect(await message(reader(401, {}, 'tok').resolveRevision())).toContain('did not accept the access token');
    expect(await message(reader(403, {}, 'tok').resolveRevision())).toContain('does not have permission');
    expect(await message(reader(403).resolveRevision())).toContain('GitHub refused access');
    const reset = String(Math.floor(Date.now() / 1000) + 20 * 60);
    const limited = await message(reader(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }).resolveRevision());
    expect(limited).toMatch(/try again in about (19|20) minutes/);
    expect(limited).toContain('Adding an access token raises the limit');
    expect(await message(reader(429, {}, 'tok').read('x', SHA))).not.toContain('Adding an access token');
    expect(await message(reader(500).resolveRevision())).toContain('unexpected response (500)');
    expect(await message(reader(200).resolveRevision())).toContain('unexpected response'); // body is not a commit id
  });

  it('reports an unreachable GitHub plainly', async () => {
    const reader = githubReader({ owner: 'a', repo: 'b' }, { apiUrl: 'https://x', fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    expect(await message(reader.resolveRevision())).toContain('Could not reach GitHub');
  });
});
