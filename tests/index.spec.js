import path from 'path';

import { signAddonAndExit } from '../src';

const testDir = path.resolve(__dirname);
const fixturePath = path.join(testDir, 'fixtures');

/**
 * @typedef {import('../src/amo-client').ClientParams} ClientParams
 * @typedef {import('../src/amo-client').SignParams} SignParams
 * @typedef {import('../src/amo-client').SignResult} SignResult
 */

describe(__filename, () => {
  describe('signAddonAndExit', function () {
    /**
     * We use `any` instead of `never` because we cannot mock `never`.
     * @type {(statusCode: number) => any}
     */
    let mockProcessExit;
    /** @type {typeof process} */
    let mockProcess;
    /** @type {(params: SignParams) => SignResult} */
    let signingCall;
    /** @type {(params: ClientParams) => void} */
    let fakeClientContructor;

    beforeEach(function () {
      mockProcessExit = jest.fn();
      mockProcess = {
        ...process,
        // `mockProcessExit` is not compatible with the type of `process.exit()`
        // because we are using a mock.
        // @ts-ignore
        exit: mockProcessExit,
      };
      fakeClientContructor = jest.fn();
    });

    /**
     * @returns {typeof import('../src/amo-client').Client}
     */
    function makeAMOClientStub(overrides = {}) {
      const options = {
        errorToThrow: null,
        result: { success: true },
        ...overrides,
      };

      function AMOClientStub() {
        const constructor = fakeClientContructor;
        // TODO: do not use `arguments`
        // @ts-ignore
        // eslint-disable-next-line prefer-rest-params
        constructor.apply(constructor, arguments);

        // `this` is not typed.
        // @ts-ignore
        this.debug = jest.fn();

        signingCall = jest.fn().mockImplementation(
          /**
           * @param {SignParams} params
           */
          // eslint-disable-next-line no-unused-vars
          (params) =>
            new Promise((resolve) => {
              if (options.errorToThrow) {
                throw options.errorToThrow;
              }
              resolve(options.result);
            }),
        );

        // `this` is not typed.
        // @ts-ignore
        this.sign = signingCall;
      }

      // TODO: make AMOClientStub fully compatible with the Client type.
      // @ts-ignore
      return AMOClientStub;
    }

    /**
     * @returns {Promise<void>}
     */
    function runSignCmd(overrides = {}) {
      const options = {
        throwError: true,
        AMOClientStub: makeAMOClientStub(),
        cmdOptions: {},
        ...overrides,
      };

      const cmdOptions = {
        apiKey: 'some-key',
        apiSecret: 'some-secret',
        id: 'some-addon@somewhere',
        xpiPath: path.join(fixturePath, 'simple-addon.xpi'),
        version: '0.0.1',
        verbose: false,
        AMOClient: options.AMOClientStub,
        ...options.cmdOptions,
      };

      const cmdConfig = {
        systemProcess: mockProcess,
        throwError: options.throwError,
      };

      return signAddonAndExit(cmdOptions, cmdConfig);
    }

    it('should exit 0 on signing success', () => {
      return runSignCmd({ throwError: false }).then(function () {
        expect(signingCall).toHaveBeenCalled();
        expect(mockProcessExit).toHaveBeenCalledWith(0);
      });
    });

    it('passes id/version to the signer', async () => {
      const version = '1.0.0';
      const guid = '@simple-addon';

      await runSignCmd({ cmdOptions: { id: guid, version } });

      expect(signingCall).toHaveBeenCalledWith(
        expect.objectContaining({
          version,
          guid,
        }),
      );
    });

    it('passes release channel to the signer', async () => {
      const channel = 'listed';

      await runSignCmd({ cmdOptions: { channel } });

      expect(signingCall).toHaveBeenCalledWith(
        expect.objectContaining({ channel }),
      );
    });

    it('passes JWT expiration to the signing client', async () => {
      const apiJwtExpiresIn = 60 * 15; // 15 minutes

      await runSignCmd({ cmdOptions: { apiJwtExpiresIn } });

      expect(fakeClientContructor).toHaveBeenCalledWith(
        expect.objectContaining({ apiJwtExpiresIn }),
      );
    });

    it('throws an error for XPI file errors', async () => {
      await runSignCmd({
        throwError: false,
        cmdOptions: {
          xpiPath: '/not/a/real/path.xpi',
        },
      });

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('can turn on debug logging', async () => {
      await runSignCmd({ cmdOptions: { verbose: true } });

      expect(fakeClientContructor).toHaveBeenCalledWith(
        expect.objectContaining({ debugLogging: true }),
      );
    });

    it('can configure an API proxy', async () => {
      const apiProxy = 'http://yourproxy:6000';

      await runSignCmd({ cmdOptions: { apiProxy } });

      expect(fakeClientContructor).toHaveBeenCalledWith(
        expect.objectContaining({ proxyServer: apiProxy }),
      );
    });

    it('can configure an API request', async () => {
      const apiRequestConfig = { tunnel: true };

      await runSignCmd({ cmdOptions: { apiRequestConfig } });

      expect(fakeClientContructor).toHaveBeenCalledWith(
        expect.objectContaining({ requestConfig: apiRequestConfig }),
      );
    });

    it('can configure polling timeouts', async () => {
      const timeout = 5000;

      await runSignCmd({ cmdOptions: { timeout } });

      expect(fakeClientContructor).toHaveBeenCalledWith(
        expect.objectContaining({ statusCheckTimeout: timeout }),
      );
    });

    it('can configure a download destination', async () => {
      const downloadDir = '/some/fake/download-destination';

      await runSignCmd({ cmdOptions: { downloadDir } });

      expect(fakeClientContructor).toHaveBeenCalledWith(
        expect.objectContaining({
          downloadDir,
        }),
      );
    });

    it('passes custom XPI to the signer', async () => {
      const xpiPath = path.join(fixturePath, 'simple-addon.xpi');

      await runSignCmd({
        cmdOptions: {
          id: 'some-id',
          version: '0.0.1',
          xpiPath,
        },
      });

      expect(signingCall).toHaveBeenCalledWith(
        expect.objectContaining({ xpiPath }),
      );
    });

    it('should exit 1 on signing failure', async () => {
      await runSignCmd({
        throwError: false,
        AMOClientStub: makeAMOClientStub({
          result: { success: false },
        }),
      });

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should exit 1 on exception', async () => {
      await runSignCmd({
        AMOClientStub: makeAMOClientStub({
          errorToThrow: new Error('some signing error'),
        }),
        throwError: false,
      });

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should allow an empty id', async () => {
      /** @type {null | string} */
      const guid = null;

      await runSignCmd({ cmdOptions: { id: guid, version: '0.0.1' } });

      expect(signingCall).toHaveBeenCalledWith(
        expect.objectContaining({ guid }),
      );
    });

    it('should throw error when version is empty', () => {
      return runSignCmd({
        cmdOptions: {
          id: 'some-addon@somewhere',
          version: null,
        },
      })
        .then(() => {
          throw new Error('unexpected success');
        })
        .catch((error) => {
          expect(error.message).toContain('argument was empty: version');
        });
    });

    it('should throw error when xpiPath is empty', () => {
      return runSignCmd({
        cmdOptions: {
          xpiPath: null,
        },
      })
        .then(() => {
          throw new Error('unexpected success');
        })
        .catch((error) => {
          expect(error.message).toContain('argument was empty: xpiPath');
        });
    });

    it('should throw error when apiKey is empty', () => {
      return runSignCmd({
        cmdOptions: {
          apiKey: null,
        },
      })
        .then(() => {
          throw new Error('unexpected success');
        })
        .catch((error) => {
          expect(error.message).toContain('argument was empty: apiKey');
        });
    });

    it('should throw error when apiSecret is empty', () => {
      return runSignCmd({
        cmdOptions: {
          apiSecret: null,
        },
      })
        .then(() => {
          throw new Error('unexpected success');
        })
        .catch((error) => {
          expect(error.message).toContain('argument was empty: apiSecret');
        });
    });
  });
});
