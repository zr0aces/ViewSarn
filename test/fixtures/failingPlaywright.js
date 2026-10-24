// Preload (node -r) that replaces playwright with a browser that cannot launch.
const Module = require('node:module');
const original = Module._load;
Module._load = function (request) {
  if (request === 'playwright') {
    return { chromium: { launch: async () => { throw new Error('Executable doesn\'t exist (test stub)'); } } };
  }
  return original.apply(this, arguments);
};
