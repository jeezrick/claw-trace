#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const entry = path.resolve(__dirname, 'apps/server/dist/index.js');

if (!fs.existsSync(entry)) {
  console.error('[claw-trace] v2 runtime is missing. Build first with `npm run v2:build` or run `claw-trace update`.');
  process.exit(1);
}

require(entry);
