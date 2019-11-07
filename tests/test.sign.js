import path from 'path';

import { beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';

import { signAddonAndExit } from '../src';

const testDir = path.resolve(__dirname);
const fixturePath = path.join(testDir, 'fixtures');

/**
 * @typedef {import('../src/amo-client').ClientParams} ClientParams
 * @typedef {import('../src/amo-client').SignParams} SignParams
 * @typedef {import('../src/amo-client').SignResult} SignResult
 */

describe('sign', function() {
  /** @type {sinon.SinonSpy<[number], void>} */
  let mockProcessExit;
  /** @type {typeof process} */
  let mockProcess;
  /** @type {sinon.SinonSpy<[SignParams], Promise<SignResult>>} */
  let signingCall;
  /** @type {sinon.SinonSpy<[ClientParams], void>} */
  let fakeClientContructor;

  beforeEach(function() {
    mockProcessExit = sinon.spy(
      /**
       * @param {number} exitCode
       */
      // eslint-disable-next-line no-unused-vars
      (exitCode) => {},
    );
    mockProcess = {
      ...process,
      // `mockProcessExit` is not compatible with the type of `process.exit()`
      // because we are using a mock.
      // @ts-ignore
      exit: mockProcessExit,
    };
    fakeClientContructor = sinon.spy(
      /**
       * @param {ClientParams} params
       */
      // eslint-disable-next-line no-unused-vars
      (params) => {},
    );
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
      this.debug = sinon.stub();

      signingCall = sinon.spy(
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
    return runSignCmd({ throwError: false }).then(function() {
      expect(signingCall.called).to.be.equal(true);
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(0);
    });
  });

  it('passes id/version to the signer', () => {
    return runSignCmd({
      cmdOptions: {
        id: '@simple-addon',
        version: '1.0.0',
      },
    }).then(function() {
      expect(signingCall.called).to.be.equal(true);
      expect(signingCall.firstCall.args[0].version).to.be.equal('1.0.0');
      expect(signingCall.firstCall.args[0].guid).to.be.equal('@simple-addon');
    });
  });

  it('passes release channel to the signer', () => {
    const channel = 'listed';
    return runSignCmd({
      cmdOptions: { channel },
    }).then(function() {
      expect(signingCall.called).to.be.equal(true);
      expect(signingCall.firstCall.args[0].channel).to.be.equal(channel);
    });
  });

  it('passes JWT expiration to the signing client', () => {
    const expiresIn = 60 * 15; // 15 minutes
    return runSignCmd({
      cmdOptions: {
        apiJwtExpiresIn: expiresIn,
      },
    }).then(() => {
      expect(
        fakeClientContructor.firstCall.args[0].apiJwtExpiresIn,
      ).to.be.equal(expiresIn);
    });
  });

  it('throws an error for XPI file errors', () => {
    return runSignCmd({
      throwError: false,
      cmdOptions: {
        xpiPath: '/not/a/real/path.xpi',
      },
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
    });
  });

  it('can turn on debug logging', () => {
    return runSignCmd({
      cmdOptions: {
        verbose: true,
      },
    }).then(function() {
      expect(fakeClientContructor.firstCall.args[0].debugLogging).to.be.equal(
        true,
      );
    });
  });

  it('can configure an API proxy', () => {
    const apiProxy = 'http://yourproxy:6000';
    return runSignCmd({
      cmdOptions: { apiProxy },
    }).then(function() {
      expect(fakeClientContructor.firstCall.args[0].proxyServer).to.be.equal(
        apiProxy,
      );
    });
  });

  it('can configure an API request', () => {
    const apiRequestConfig = { tunnel: true };
    return runSignCmd({
      cmdOptions: { apiRequestConfig },
    }).then(function() {
      expect(
        fakeClientContructor.firstCall.args[0].requestConfig,
      ).to.be.deep.equal(apiRequestConfig);
    });
  });

  it('can configure polling timeouts', () => {
    return runSignCmd({
      cmdOptions: {
        timeout: 5000,
      },
    }).then(function() {
      expect(fakeClientContructor.called).to.be.equal(true);
      expect(
        fakeClientContructor.firstCall.args[0].signedStatusCheckTimeout,
      ).to.be.equal(5000);
    });
  });

  it('can configure a download destination', () => {
    return runSignCmd({
      cmdOptions: {
        downloadDir: '/some/fake/download-destination',
      },
    }).then(function() {
      expect(fakeClientContructor.called).to.be.equal(true);
      expect(fakeClientContructor.firstCall.args[0].downloadDir).to.be.equal(
        '/some/fake/download-destination',
      );
    });
  });

  it('passes custom XPI to the signer', () => {
    const xpiPath = path.join(fixturePath, 'simple-addon.xpi');
    return runSignCmd({
      cmdOptions: {
        id: 'some-id',
        version: '0.0.1',
        xpiPath,
      },
    }).then(function() {
      expect(signingCall.called).to.be.equal(true);
      expect(signingCall.firstCall.args[0].xpiPath).to.be.equal(xpiPath);
    });
  });

  it('should exit 1 on signing failure', () => {
    return runSignCmd({
      throwError: false,
      AMOClientStub: makeAMOClientStub({
        result: { success: false },
      }),
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
    });
  });

  it('should exit 1 on exception', () => {
    return runSignCmd({
      AMOClientStub: makeAMOClientStub({
        errorToThrow: new Error('some signing error'),
      }),
      throwError: false,
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
    });
  });

  it('should allow an empty id', () => {
    return runSignCmd({
      cmdOptions: {
        id: null,
        version: '0.0.1',
      },
    }).then(() => {
      expect(signingCall.called).to.be.equal(true);
      expect(signingCall.firstCall.args[0].guid).to.be.equal(null);
    });
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
        expect(error.message).to.match(/argument was empty: version/);
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
        expect(error.message).to.match(/argument was empty: xpiPath/);
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
        expect(error.message).to.match(/argument was empty: apiKey/);
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
        expect(error.message).to.match(/argument was empty: apiSecret/);
      });
  });
});
