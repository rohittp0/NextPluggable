import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPlugin, describeBuildError } from './build.js';
import { validateManifest } from './manifest.js';

const HELP = `nextpluggable-plugin — build tool for NextPluggable plugins

Usage:
  nextpluggable-plugin build [dir]      Build dist/ (client.js, server.js, style.css, build.json)
  nextpluggable-plugin validate [dir]   Check plugin.json without building

Options:
  --no-minify    Keep the client bundle readable
`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const [command, dirArg] = args.filter((a) => !a.startsWith('--'));
  const dir = path.resolve(dirArg ?? '.');

  if (!command || flags.has('--help') || command === 'help') {
    console.log(HELP);
    return command ? 0 : 1;
  }

  if (command === 'validate') {
    const manifest = validateManifest(JSON.parse(await readFile(path.join(dir, 'plugin.json'), 'utf8')));
    console.log(`✓ ${manifest.name} ${manifest.version} — plugin.json is valid`);
    return 0;
  }

  if (command === 'build') {
    const started = Date.now();
    const result = await buildPlugin(dir, { minify: !flags.has('--no-minify'), log: (l) => console.log(l) });
    console.log(`✓ Built ${result.manifest.name} ${result.manifest.version} in ${Date.now() - started} ms`);
    return 0;
  }

  console.error(`Unknown command "${command}".\n\n${HELP}`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`✗ ${describeBuildError(err)}`);
    process.exit(1);
  },
);
