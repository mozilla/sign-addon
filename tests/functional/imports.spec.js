import path from 'path';
import { execSync } from 'child_process';

import shell from 'shelljs';
import tmp from 'tmp';

describe(__filename, () => {
  tmp.setGracefulCleanup();

  const node = shell.which('node');
  const npm = shell.which('npm');
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const fixtureEsmImport = path.join(fixturesDir, 'import-as-esm');
  const fixtureCjsRequire = path.join(fixturesDir, 'require-as-cjs');

  const makeTempDir = () =>
    new Promise((resolve, reject) => {
      tmp.dir(
        {
          prefix: 'tmp-sign-addon-',
          // This allows us to remove a non-empty tmp dir.
          unsafeCleanup: true,
        },
        (err, aPath, aCleanupCallback) => {
          if (err) {
            reject(err);
            return;
          }

          resolve([aPath, aCleanupCallback]);
        },
      );
    });

  describe('imported as a library', () => {
    beforeAll(() => {
      execSync(`${npm} link`, {
        cwd: path.resolve(path.join(__dirname, '..', '..')),
      });
    });

    afterAll(() => {
      execSync(`${npm} unlink`, {
        cwd: path.resolve(path.join(__dirname, '..', '..')),
      });
    });

    // eslint-disable-next-line jest/expect-expect
    it('can be imported as an ESM module', async () => {
      const [cwd, cleanupCallback] = await makeTempDir();

      execSync(`${npm} link sign-addon`, { cwd });
      shell.cp('-rf', `${fixtureEsmImport}/*`, cwd);
      execSync(`${node} --experimental-modules test-import.mjs`, { cwd });

      cleanupCallback();
    });

    // eslint-disable-next-line jest/expect-expect
    it('can be imported as a CommonJS module', async () => {
      const [cwd, cleanupCallback] = await makeTempDir();

      execSync(`${npm} link sign-addon`, { cwd });
      shell.cp('-rf', `${fixtureCjsRequire}/*`, cwd);
      execSync(`${node} test-require.js`, { cwd });

      cleanupCallback();
    });
  });
});
