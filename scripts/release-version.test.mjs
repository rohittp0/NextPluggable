import { describe, expect, it } from 'vitest';
import { compare, nextVersion, setVersion } from './release-version.mjs';

describe('nextVersion', () => {
  it('releases the first version as it is', () => {
    expect(nextVersion('0.1.0', [])).toBe('0.1.0');
  });

  it('raises the patch number once the current version is out', () => {
    expect(nextVersion('0.1.0', ['0.1.0'])).toBe('0.1.1');
    expect(nextVersion('0.1.9', ['0.1.8', '0.1.9'])).toBe('0.1.10');
  });

  it('releases a minor or major version set by hand as it is, then patches on from it', () => {
    expect(nextVersion('0.2.0', ['0.1.0', '0.1.7'])).toBe('0.2.0');
    expect(nextVersion('1.0.0', ['0.9.3'])).toBe('1.0.0');
    expect(nextVersion('0.2.0', ['0.1.7', '0.2.0'])).toBe('0.2.1');
  });

  it('continues from the registry when the repository fell behind', () => {
    // A release published 0.1.3 but its version commit never reached main.
    expect(nextVersion('0.1.0', ['0.1.0', '0.1.1', '0.1.2', '0.1.3'])).toBe('0.1.4');
    // Only one of the two packages got out at 0.1.4: both move on to 0.1.5.
    expect(nextVersion('0.1.3', ['0.1.3', '0.1.4'])).toBe('0.1.5');
  });

  it('compares numbers, not text, and ignores pre-releases on the registry', () => {
    expect(nextVersion('0.1.2', ['0.1.2', '0.1.10'])).toBe('0.1.11');
    expect(nextVersion('0.1.0', ['0.1.0', '0.2.0-beta.1'])).toBe('0.1.1');
    expect(compare('0.10.0', '0.9.9')).toBeGreaterThan(0);
  });

  it('refuses a repository version it cannot count up from', () => {
    expect(() => nextVersion('0.2.0-beta.1', [])).toThrow('not a plain x.y.z version');
  });
});

describe('setVersion', () => {
  it('changes only the version and keeps the file as written', () => {
    const source = '{\n  "name": "x",\n  "version": "0.1.0",\n  "engines": { "node": ">=20.16" },\n  "dependencies": { "y": "0.1.0" }\n}\n';
    expect(setVersion(source, '0.1.1')).toBe(source.replace('"version": "0.1.0"', '"version": "0.1.1"'));
  });

  it('fails loudly when there is no version to change', () => {
    expect(() => setVersion('{ "name": "x" }', '0.1.1')).toThrow('Could not find');
  });
});
