const assert = require('assert');

// @ts-ignore
const signAddon = require('sign-addon'); // eslint-disable-line import/no-unresolved

assert.deepEqual(
  Object.keys(signAddon).sort(),
  ['signAddon', 'signAddonAndExit'].sort(),
);
assert.equal(typeof signAddon.signAddon, 'function');
assert.equal(typeof signAddon.signAddonAndExit, 'function');
