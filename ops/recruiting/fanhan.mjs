#!/usr/bin/env node
/** Public CLI entrypoint; business operations remain in the shared authenticated client. */
import { main } from './cli.mjs';
main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, status: error.status }));
  process.exitCode = 1;
});
