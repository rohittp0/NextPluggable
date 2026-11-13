import { HttpError } from '../errors.js';
import type { SourceReader } from './reader.js';

export interface GitHubLocation {
  owner: string;
  repo: string;
  ref?: string;
  dir?: string;
}

const NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Understand whatever a person pastes for a repository: `owner/repo`, a
 * browser URL (optionally `/tree/<branch>/<folder>`), or a git clone address.
 */
export function parseGitHubUrl(input: string): GitHubLocation | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^git@github\.com:/i, 'https://github.com/').replace(/^(?:www\.)?github\.com\//i, 'https://github.com/');
  let parts: string[];
  if (/^https?:\/\//i.test(s)) {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return null;
    }
    if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
    parts = url.pathname.split('/').filter(Boolean);
  } else {
    parts = s.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
  }
  const [owner, repoRaw, kind, ref, ...rest] = parts;
  if (!owner || !repoRaw) return null;
  const repo = repoRaw.replace(/\.git$/i, '');
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  const location: GitHubLocation = { owner, repo };
  if (kind === 'tree' && ref) {
    location.ref = decodeURIComponent(ref);
    const dir = rest.map(decodeURIComponent).join('/');
    if (dir) {
      if (dir.split('/').some((p) => p === '..' || p === '.')) return null;
      location.dir = dir;
    }
  }
  return location;
}

export interface GitHubReaderOptions {
  apiUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** Reads files from a GitHub repository at an exact commit, via the REST API. */
export function githubReader(location: GitHubLocation, options: GitHubReaderOptions): SourceReader {
  const doFetch = options.fetch ?? fetch;
  const repoUrl = `${options.apiUrl}/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}`;
  const name = `${location.owner}/${location.repo}`;

  async function call(url: string, accept: string): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: {
          accept,
          'user-agent': 'nextpluggable',
          'x-github-api-version': '2022-11-28',
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        cache: 'no-store',
        redirect: 'follow',
      });
    } catch {
      throw new HttpError(502, 'Could not reach GitHub. Check the internet connection of the server and try again.');
    }
    if (res.status === 401)
      throw new HttpError(400, `GitHub did not accept the access token for ${name}. It may have expired — create a new one and reconnect the source.`);
    if (res.status === 403 || res.status === 429) {
      if (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
        const mins = Number.isFinite(reset) && reset > Date.now() ? Math.max(1, Math.ceil((reset - Date.now()) / 60_000)) : null;
        throw new HttpError(
          429,
          `GitHub is limiting requests right now${mins ? ` — try again in about ${mins} minute${mins === 1 ? '' : 's'}` : ''}.${options.token ? '' : ' Adding an access token raises the limit.'}`,
        );
      }
      throw new HttpError(400, `The access token does not have permission to read ${name}. It needs read access to the repository's contents.`);
    }
    return res;
  }

  return {
    async resolveRevision() {
      const res = await call(`${repoUrl}/commits/${encodePath(location.ref ?? 'HEAD')}`, 'application/vnd.github.sha');
      if (res.status === 404 || res.status === 422 || res.status === 409)
        throw new HttpError(
          404,
          location.ref
            ? `We could not find "${location.ref}" in ${name}. Check the address${options.token ? '' : ' — if the repository is private, add an access token'}.`
            : `We could not find the repository ${name}, or it is empty. Check the address${options.token ? ' and that the access token can read it' : ' — if the repository is private, add an access token'}.`,
        );
      if (!res.ok) throw new HttpError(502, `GitHub returned an unexpected response (${res.status}).`);
      const sha = (await res.text()).trim();
      if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new HttpError(502, 'GitHub returned an unexpected response.');
      return sha;
    },
    async read(path, revision) {
      const res = await call(`${repoUrl}/contents/${encodePath(path)}?ref=${encodeURIComponent(revision)}`, 'application/vnd.github.raw+json');
      if (res.status === 404) return null;
      if (!res.ok) throw new HttpError(502, `GitHub returned an unexpected response (${res.status}) for ${path}.`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
