import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import { beforeAll, describe, it } from '@jest/globals';
import shell from 'shelljs';
import tmp from 'tmp';

describe(fileURLToPath(import.meta.url), () => {
  tmp.setGracefulCleanup();

  const node = shell.which('node');
  const npm = shell.which('npm');
  const currentDirname = path.dirname(fileURLToPath(import.meta.url));
  const fixturesDir = path.join(currentDirname, '..', 'fixtures');
  const fixtureEsmImport = path.join(fixturesDir, 'import-as-esm');
  const fixtureCjsRequire = path.join(fixturesDir, 'require-as-cjs');
  const packageDir = path.resolve(path.join(currentDirname, '..', '..'));

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

  beforeAll(async () => {
    execSync(`${npm} run build`, { cwd: packageDir, stdio: 'inherit' });
  });

  describe('imported as a library', () => {
    // eslint-disable-next-line jest/expect-expect
    it('can be imported as an ESM module', async () => {
      const [cwd, cleanupCallback] = await makeTempDir();

      execSync(`${npm} install ${packageDir}`, { cwd, stdio: 'inherit' });
      shell.cp('-rf', `${fixtureEsmImport}/*`, cwd);
      execSync(`${node} test-import.mjs`, { cwd });

      cleanupCallback();
    });

    // eslint-disable-next-line jest/expect-expect
    it('can be imported as a CommonJS module dynamically', async () => {
      const [cwd, cleanupCallback] = await makeTempDir();

      execSync(`${npm} install ${packageDir}`, { cwd, stdio: 'inherit' });
      shell.cp('-rf', `${fixtureCjsRequire}/*`, cwd);
      execSync(`${node} test-require.js`, { cwd });

      cleanupCallback();
    });
  });
});
