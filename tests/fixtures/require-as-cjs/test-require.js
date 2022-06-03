const assert = require('assert');

(async () => {
  // Trying to require sign-addon as a CommonJS module is not supported anymore
  // and it should be throwing the expected ERR_REQUIRE_ESM error.
  assert.throws(
    () => {
      // @ts-ignore - silent error "cannot find module 'sign-addon'"
      require('sign-addon'); // eslint-disable-line import/no-unresolved, global-require
    },
    {
      name: 'Error',
      code: 'ERR_REQUIRE_ESM',
    },
  );

  // But it should still be possible to import it in a CommonJS module using a
  // dynamic import.
  // @ts-ignore - silent error "cannot find module 'sign-addon'"
  const signAddon = await import('sign-addon'); // eslint-disable-line import/no-unresolved
  assert.deepEqual(
    Object.keys(signAddon).sort(),
    ['default', 'signAddon', 'signAddonAndExit'].sort(),
  );
  assert.equal(typeof signAddon.signAddon, 'function');
  assert.equal(typeof signAddon.signAddonAndExit, 'function');
})();
