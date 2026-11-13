#!/usr/bin/env node
import('../dist/cli.js')
  .then((cli) => cli.main())
  .then(
    (code) => process.exit(code),
    (err) => {
      console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
