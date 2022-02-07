import assert from 'assert';

// @ts-ignore
// eslint-disable-next-line import/no-unresolved
import signAddon from 'sign-addon';

assert.deepEqual(
  Object.keys(signAddon).sort(),
  ['signAddon', 'signAddonAndExit'].sort(),
);
assert.equal(typeof signAddon.signAddon, 'function');
assert.equal(typeof signAddon.signAddonAndExit, 'function');
