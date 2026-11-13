// A tiny stand-in for the GitHub REST API, serving this repository's own files.
// It lets the end-to-end test exercise the real GitHub code path (URL parsing,
// auth headers, commit pinning, integrity checks) without touching the network.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SHA = { 1: 'a'.repeat(40), 2: 'b'.repeat(40) };
export const PRIVATE_TOKEN = 'github_pat_good_token';

export async function startMockGitHub(repoRoot) {
  let revision = 1;
  const requests = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    if (req.method === 'POST' && url.pathname === '/__advance') {
      revision = 2;
      return send(200, '{}');
    }
    const m = /^\/repos\/([^/]+)\/([^/]+)\/(commits|contents)\/(.+)$/.exec(url.pathname);
    if (!m) return send(404, '{"message":"Not Found"}');
    const [, owner, repo, kind, rest] = m;
    const auth = req.headers.authorization;
    requests.push({ repo: `${owner}/${repo}`, kind, rest: decodeURIComponent(rest), ref: url.searchParams.get('ref'), auth });

    if (owner !== 'acme' || !['plugins', 'private-plugins', 'tampered', 'empty'].includes(repo)) return send(404, '{"message":"Not Found"}');
    if (repo === 'private-plugins') {
      // Like GitHub: a private repository does not exist for anonymous callers.
      if (!auth) return send(404, '{"message":"Not Found"}');
      if (auth !== `Bearer ${PRIVATE_TOKEN}`) return send(401, '{"message":"Bad credentials"}');
    }
    const sha = repo === 'plugins' ? SHA[revision] : SHA[1];
    if (kind === 'commits') return send(200, sha, 'text/plain');

    // Contents are only served for the exact commit that was resolved (pinning).
    if (url.searchParams.get('ref') !== sha) return send(404, '{"message":"No commit found for the ref"}');
    if (repo === 'empty') return send(404, '{"message":"Not Found"}');
    const file = decodeURIComponent(rest);
    if (file.split('/').includes('..')) return send(404, '{"message":"Not Found"}');
    let data;
    try {
      data = await readFile(path.join(repoRoot, file));
    } catch {
      return send(404, '{"message":"Not Found"}');
    }
    if (repo === 'tampered' && file.endsWith('dist/client.js')) data = Buffer.concat([data, Buffer.from('\n;globalThis.__tampered=1;')]);
    if (repo === 'plugins' && revision === 2 && file === 'plugins/emi-calculator/dist/build.json') {
      const build = JSON.parse(data.toString('utf8'));
      build.manifest.version = '1.0.1';
      data = Buffer.from(JSON.stringify(build));
    }
    send(200, data, 'application/octet-stream');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    advance: () => {
      revision = 2;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
