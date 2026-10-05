#!/usr/bin/env node
const path = require('node:path');

async function main(argv) {
  const [{ sync }, { default: config }] = await Promise.all([
    import('./version-control.mjs'), import('./version-targets.mjs'),
  ]);
  return sync(path.resolve(__dirname, '..'), config, argv);
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch(() => {
  console.error('Could not load version tooling; no synchronization performed.');
  process.exitCode = 1;
});
module.exports = { main };
