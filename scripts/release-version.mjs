#!/usr/bin/env node
/**
 * Decides which version the next release from `main` gets and writes it into both
 * packages, which are always released together under one version.
 *
 *   node scripts/release-version.mjs            write the version
 *   node scripts/release-version.mjs --dry-run  only print it
 *
 * The registry is the source of truth for what has been released, not the repository:
 * a release that published but could not push its version commit is picked up from
 * there by the next one.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** In publishing order: `nextpluggable` depends on the plugin SDK. */
export const PACKAGES = ['packages/plugin', 'packages/nextpluggable'];

const PLAIN = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version) {
  const m = PLAIN.exec(version);
  if (!m) throw new Error(`"${version}" is not a plain x.y.z version.`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * `current` is the version in the repository; `published` is every version of either
 * package that has ever been on the registry.
 *
 * A version that was never published and is ahead of everything published goes out as
 * it is: that is the first release, or a minor or major version set by hand in a pull
 * request. In every other case the patch number goes up from the newest version.
 */
export function nextVersion(current, published) {
  parse(current); // pre-release versions are not something this can count up from
  const plain = published.filter((v) => PLAIN.test(v));
  const newest = plain.reduce((max, v) => (compare(v, max) > 0 ? v : max), current);
  if (newest === current && !plain.includes(current)) return current;
  const [major, minor, patch] = parse(newest);
  return `${major}.${minor}.${patch + 1}`;
}

/** Every version a package has had on the registry, including ones later unpublished (their numbers cannot be reused). */
export async function publishedVersions(name, registry = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org') {
  const res = await fetch(`${registry.replace(/\/+$/, '')}/${name.replace('/', '%2F')}`, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The registry answered ${res.status} for ${name}.`);
  const doc = await res.json();
  const versions = new Set([...Object.keys(doc.versions ?? {}), ...Object.keys(doc.time ?? {})]);
  versions.delete('created');
  versions.delete('modified');
  return [...versions];
}

/** Replace the top-level version, leaving the rest of the file exactly as it was written. */
export function setVersion(source, version) {
  const updated = source.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`);
  if (JSON.parse(updated).version !== version) throw new Error('Could not find the "version" field to update.');
  return updated;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = PACKAGES.map((dir) => path.join(root, dir, 'package.json'));
  const manifests = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  const current = manifests[0].version;
  if (manifests.some((m) => m.version !== current))
    throw new Error(`The packages must share one version, found ${manifests.map((m) => `${m.name}@${m.version}`).join(' and ')}.`);

  const onRegistry = await Promise.all(manifests.map((m) => publishedVersions(m.name)));
  const version = nextVersion(current, onRegistry.flatMap((v) => v ?? []));
  const changed = version !== current;
  // A package that is not on the registry yet cannot use trusted publishing: its first release needs a token.
  const firstPublish = onRegistry.some((v) => v === null);

  if (changed && !dryRun) for (const file of files) writeFileSync(file, setVersion(readFileSync(file, 'utf8'), version));

  console.log(`${current} -> ${version}${changed ? '' : ' (released as it is)'}${firstPublish ? ', first release of at least one package' : ''}${dryRun ? ' [dry run]' : ''}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nchanged=${changed}\nfirst_publish=${firstPublish}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
