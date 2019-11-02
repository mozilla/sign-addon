// @ts-nocheck
import path from 'path';

import jwt from 'jsonwebtoken';

import * as amoClient from '../src/amo-client';
import { MockRequest, MockProgress } from './helpers';

/** @typedef {import('../src/amo-client').ClientParams} ClientParams */

describe(__filename, () => {
  describe('Client', () => {
    const defaultApiUrlPrefix = 'http://not-a-real-amo-api.com/api/v4';

    const createFakeFS = () => {
      return {
        createReadStream() {
          return 'fake-read-stream';
        },
      };
    };

    /**
     * @param {Partial<ClientParams>} overrides
     */
    const createClient = (overrides = {}) => {
      const opt = {
        apiKey: 'fake-api-key',
        apiSecret: 'fake-api-secret',
        apiUrlPrefix: defaultApiUrlPrefix,
        fs: createFakeFS(),
        progressBar: new MockProgress(),
        request: new MockRequest(),
        statusCheckInterval: 0,
        ...overrides,
      };

      return new amoClient.Client(opt);
    };

    describe('signing', function() {
      let client;

      beforeEach(() => {
        client = createClient();
      });

      const sign = (confOverrides = {}) => {
        const conf = {
          guid: 'some-guid',
          version: 'some-version',
          xpiPath: 'some-xpi-path',
          ...confOverrides,
        };
        return client.sign(conf);
      };

      const waitForSignedAddon = (url = '/some-status-url', options = {}) => {
        return client.waitForSignedAddon(url, options);
      };

      const createValidationResponse = (overrides = {}) => {
        const res = {
          active: false,
          automated_signing: true,
          files: [],
          guid: 'an-addon-guid',
          processed: true,
          reviewed: false,
          valid: true,
          validation_url: 'http://amo/validation-results/',
          ...overrides,
        };

        return {
          responseBody: res,
        };
      };

      const createSigningResponse = (overrides = {}) => {
        const res = {
          ...createValidationResponse().responseBody,
          active: true,
          reviewed: true,
          files: [
            {
              signed: true,
              download_url: 'http://amo/some-signed-file-1.2.3.xpi',
            },
          ],
          ...overrides,
        };

        return {
          responseBody: res,
        };
      };

      function getDownloadStubs() {
        const fakeResponse = {
          on() {
            return this;
          },
          pipe() {
            return this;
          },
        };

        const fakeFileWriter = {
          on(event, handler) {
            if (event === 'finish') {
              // Simulate completion of the download immediately when the
              // handler is registered.
              handler();
            }
          },
        };

        const { files } = createSigningResponse().responseBody;
        const fakeRequest = jest.fn().mockReturnValue(fakeResponse);
        const createWriteStream = jest.fn().mockReturnValue(fakeFileWriter);
        const stdout = {
          write() {},
        };

        return { files, request: fakeRequest, createWriteStream, stdout };
      }

      it('lets you sign an add-on', async () => {
        const apiStatusUrl = 'https://api/addon/version/upload/abc123';
        const conf = {
          guid: 'a-guid',
          version: 'a-version',
        };
        const waitForSignedAddonStub = jest.fn();
        client.waitForSignedAddon = waitForSignedAddonStub;

        client._request = new MockRequest({
          httpResponse: { statusCode: 202 },
          // Partial response like:
          // http://olympia.readthedocs.org/en/latest/topics/api/signing.html#checking-the-status-of-your-upload
          responseBody: {
            url: apiStatusUrl,
          },
        });

        await sign(conf);

        const putCall = client._request.calls[0];
        expect(putCall.name).toEqual('put');

        const partialUrl = `/addons/${conf.guid}/versions/${conf.version}`;
        expect(putCall.conf.url).toContain(partialUrl);
        expect(putCall.conf.formData.upload).toEqual('fake-read-stream');
        // When doing a PUT, the version is in the URL not the form data.
        expect(putCall.conf.formData.version).toEqual(undefined);
        // When no channel is supplied, the API is expected to use the most recent channel.
        expect(putCall.conf.formData.channel).toEqual(undefined);

        expect(waitForSignedAddonStub).toHaveBeenCalledWith(apiStatusUrl);
      });

      it('lets you sign an add-on without an ID', async () => {
        const apiStatusUrl = 'https://api/addon/version/upload/abc123';
        const conf = {
          guid: null,
          version: 'a-version',
        };
        const waitForSignedAddonStub = jest.fn();
        client.waitForSignedAddon = waitForSignedAddonStub;

        client._request = new MockRequest({
          httpResponse: { statusCode: 202 },
          // Partial response like:
          // http://olympia.readthedocs.org/en/latest/topics/api/signing.html#checking-the-status-of-your-upload
          responseBody: {
            url: apiStatusUrl,
          },
        });

        await sign(conf);

        const call = client._request.calls[0];
        expect(call.name).toEqual('post');

        // Make sure the endpoint ends with /addons/
        expect(call.conf.url).toMatch(/\/addons\/$/);
        expect(call.conf.formData.upload).toEqual('fake-read-stream');
        expect(call.conf.formData.version).toEqual(conf.version);
        // Channel is not a valid parameter for new add-ons.
        expect(call.conf.formData.channel).toEqual(undefined);

        expect(waitForSignedAddonStub).toHaveBeenCalledWith(apiStatusUrl);
      });

      it('lets you sign an add-on on a specific channel', async () => {
        const conf = {
          channel: 'listed',
        };
        client.waitForSignedAddon = jest.fn();
        client._request = new MockRequest({
          httpResponse: { statusCode: 202 },
        });

        await sign(conf);

        expect(client._request.calls[0].conf.formData.channel).toEqual(
          'listed',
        );
      });

      it('lets you sign an add-on without an ID ignoring channel', async () => {
        const conf = {
          guid: null,
          channel: 'listed',
        };
        client.waitForSignedAddon = jest.fn();
        client._request = new MockRequest({
          httpResponse: { statusCode: 202 },
        });

        await sign(conf);

        expect(client._request.calls[0].conf.formData.channel).toEqual(
          undefined,
        );
      });

      it('handles already validated add-ons', async () => {
        const waitForSignedAddonStub = jest.fn();
        client.waitForSignedAddon = waitForSignedAddonStub;

        client._request = new MockRequest({
          httpResponse: { statusCode: 409 },
          responseBody: { error: 'version already exists' },
        });

        const result = await sign();

        expect(waitForSignedAddonStub).not.toHaveBeenCalled();
        expect(result.success).toEqual(false);
        expect(result.errorCode).toEqual('SERVER_FAILURE');
        expect(result.errorDetails).toEqual('version already exists');
      });

      it('handles incorrect status code for error responses', function() {
        client.waitForSignedAddon = () => {};

        client._request = new MockRequest({
          // For some reason, the API was returning errors with a 200.
          // See https://github.com/mozilla/addons-server/issues/3097
          httpResponse: { statusCode: 200 },
          responseBody: { error: 'some server error' },
        });

        return sign().then((result) => {
          expect(result.success).toEqual(false);
          expect(result.errorCode).toEqual('SERVER_FAILURE');
          expect(result.errorDetails).toEqual('some server error');
        });
      });

      it('throws an error when signing on a 500 server response', function() {
        client._request = new MockRequest({
          httpResponse: { statusCode: 500 },
        });

        return sign()
          .then(function() {
            throw new Error('unexpected success');
          })
          .catch(function(err) {
            expect(err.message).toContain('Received bad response');
          });
      });

      it('waits for passing validation', async () => {
        const downloadSignedFiles = jest
          .fn()
          .mockReturnValue(Promise.resolve({}));
        client.downloadSignedFiles = downloadSignedFiles;

        const files = [
          {
            signed: true,
            download_url: 'http://amo/the-signed-file-1.2.3.xpi',
          },
        ];
        client._request = new MockRequest({
          responseQueue: [
            createValidationResponse({ valid: false, processed: false }),
            createValidationResponse(),
            createSigningResponse({ files }),
          ],
        });

        const statusUrl = '/addons/something/versions/1.2.3/';

        await waitForSignedAddon(statusUrl);

        // Expect exactly three GETs before resolution.
        expect(client._request.calls.length).toEqual(3);
        expect(client._request.calls[0].conf.url).toContain(statusUrl);
        expect(downloadSignedFiles).toHaveBeenCalledWith(files);
      });

      it('resolves with the extension ID in the result', async () => {
        const guid = 'some-addon-guid';
        const files = [
          {
            signed: true,
            download_url: 'http://amo/the-signed-file-1.2.3.xpi',
          },
        ];
        const downloadSignedFiles = jest
          .fn()
          .mockReturnValue(Promise.resolve({ files }));
        client.downloadSignedFiles = downloadSignedFiles;
        client._request = new MockRequest({
          responseQueue: [
            createValidationResponse({ guid }),
            createSigningResponse({ files, guid }),
          ],
        });

        const result = await waitForSignedAddon('/status-url');

        expect(result.files).toEqual(files);
        expect(result.id).toEqual(guid);
      });

      it('waits for for fully reviewed files', async () => {
        const downloadSignedFiles = jest
          .fn()
          .mockReturnValue(Promise.resolve({}));
        client.downloadSignedFiles = downloadSignedFiles;

        client._request = new MockRequest({
          responseQueue: [
            // This is a situation where the upload has been validated but the
            // version object has not been saved yet.
            createValidationResponse({ valid: false, processed: false }),
            createValidationResponse(),
            createSigningResponse({
              valid: true,
              processed: true,
              reviewed: true,
            }),
          ],
        });

        await waitForSignedAddon();

        // Expect exactly 3 GETs before resolution.
        expect(client._request.calls.length).toEqual(3);
        expect(downloadSignedFiles).toHaveBeenCalled();
      });

      it('waits until signed files are ready', async () => {
        const downloadSignedFiles = jest
          .fn()
          .mockReturnValue(Promise.resolve({}));
        client.downloadSignedFiles = downloadSignedFiles;
        client._request = new MockRequest({
          responseQueue: [
            createValidationResponse(),
            createSigningResponse({ files: [] }), // somehow valid & signed, but files aren"t ready yet
            createSigningResponse(), // files are ready
          ],
        });

        await waitForSignedAddon();

        // Expect exactly three GETs before resolution.
        expect(client._request.calls.length).toEqual(3);
        expect(downloadSignedFiles).toHaveBeenCalled();
      });

      it('waits for failing validation', function() {
        client._request = new MockRequest({
          responseQueue: [
            createValidationResponse({ valid: false, processed: false }),
            createValidationResponse({
              valid: false,
              processed: true,
              validation_url: 'http://amo/validation',
            }),
          ],
        });

        return waitForSignedAddon().then((result) => {
          // Expect exactly two GETs before resolution.
          expect(client._request.calls.length).toEqual(2);
          expect(result.success).toEqual(false);
          expect(result.errorCode).toEqual('VALIDATION_FAILED');
          expect(result.errorDetails).toEqual('http://amo/validation');
        });
      });

      it('passes through status check request errors', function() {
        client._request = new MockRequest({
          httpResponse: { statusCode: 500 },
          responseError: new Error('error from status check URL'),
        });

        return waitForSignedAddon()
          .then(() => {
            throw new Error('Unexpected success');
          })
          .catch((error) => {
            expect(error.message).toContain('error from status check URL');
          });
      });

      it('handles complete yet inactive addons', function() {
        client._request = new MockRequest({
          responseQueue: [
            createValidationResponse(),
            createSigningResponse({
              valid: true,
              processed: true,
              automated_signing: false,
            }),
          ],
        });

        return waitForSignedAddon().then(function(result) {
          expect(result.success).toEqual(false);
          expect(result.errorCode).toEqual('ADDON_NOT_AUTO_SIGNED');
        });
      });

      it('aborts validation check after timeout', async () => {
        const _clearTimeout = jest.fn();
        const _client = createClient({
          // This causes an immediate failure.
          statusCheckTimeout: 0,
        });

        await _client
          .waitForSignedAddon('/status-url', {
            _clearTimeout,
            _setStatusCheckTimeout() {
              return 'status-check-timeout-id';
            },
          })
          .then(() => {
            throw new Error('Unexpected success');
          })
          .catch((error) => {
            expect(error.message).toContain('Signing took too long');
          });

        expect(_clearTimeout).toHaveBeenCalledWith('status-check-timeout-id');
      });

      it('aborts signing check after timeout', async () => {
        const _client = createClient({
          // This causes an immediate failure but because a validation response
          // is set, it will fail during the signing check.
          statusCheckTimeout: 0,
        });

        _client._request = new MockRequest({
          responseQueue: [
            createValidationResponse(),
            createSigningResponse({ active: false }),
          ],
        });

        await _client
          .waitForSignedAddon('/status-url')
          .then(() => {
            throw new Error('Unexpected success');
          })
          .catch((error) =>
            expect(error.message).toContain('Signing took too long'),
          );
      });

      it('can use a request proxy', function() {
        const proxyServer = 'http://yourproxy:6000';
        const _client = createClient({ proxyServer });

        const conf = _client.configureRequest({ url: 'http://site' });

        expect(conf.proxy).toEqual(proxyServer);
      });

      it('can arbitrarily configure the request', function() {
        const requestConfig = {
          url: 'http://this-is-ignored',
          tunnel: true,
          strictSSL: true,
        };
        const _client = createClient({ requestConfig });

        const conf = _client.configureRequest({ url: 'http://site' });

        expect(conf.url).toEqual('http://site');
        expect(conf.tunnel).toEqual(requestConfig.tunnel);
        expect(conf.strictSSL).toEqual(requestConfig.strictSSL);
      });

      it('clears abort timeout after resolution', async () => {
        const _clearTimeout = jest.fn();
        client._request = new MockRequest({
          responseQueue: [createValidationResponse(), createSigningResponse()],
        });

        const downloadSignedFiles = jest
          .fn()
          .mockReturnValue(Promise.resolve({}));
        client.downloadSignedFiles = downloadSignedFiles;

        await waitForSignedAddon('/status-url', {
          _clearTimeout,
          _setAbortTimeout() {
            return 'abort-timeout-id';
          },
          _setStatusCheckTimeout() {
            return 'status-check-timeout-id';
          },
        });

        // Assert that signing resolved successfully.
        expect(downloadSignedFiles).toHaveBeenCalled();
        expect(_clearTimeout).toHaveBeenCalledWith('abort-timeout-id');
      });

      it('downloads signed files', function() {
        const fakeResponse = {
          on() {
            return this;
          },
          pipe() {
            return this;
          },
        };

        const fakeFileWriter = {
          on(event, handler) {
            if (event === 'finish') {
              // Simulate completion of the download immediately when the
              // handler is registered.
              handler();
            }
          },
        };

        const { files } = createSigningResponse().responseBody;
        const fakeRequest = jest.fn().mockReturnValue(fakeResponse);
        const createWriteStream = jest.fn().mockReturnValue(fakeFileWriter);

        return client
          .downloadSignedFiles(files, {
            request: fakeRequest,
            createWriteStream,
            stdout: {
              write() {},
            },
          })
          .then(function(result) {
            const filePath = path.join(
              process.cwd(),
              'some-signed-file-1.2.3.xpi',
            );
            expect(result.success).toEqual(true);
            expect(result.downloadedFiles).toEqual([filePath]);
            expect(createWriteStream).toHaveBeenCalledWith(filePath);
            expect(fakeRequest).toHaveBeenCalledWith(
              expect.objectContaining({
                url: files[0].download_url,
              }),
            );
          });
      });

      it('fails for 404 signed file downloads', function() {
        const fakeResponse = {
          on(event, handler) {
            if (event === 'response') {
              // Respond with a 404 to this signed file download.
              handler({
                statusCode: 404,
                headers: {},
              });
            }
            return this;
          },
          pipe() {
            return this;
          },
        };

        const { files } = createSigningResponse().responseBody;
        const fakeRequest = jest.fn().mockReturnValue(fakeResponse);
        const { createWriteStream } = getDownloadStubs();

        return client
          .downloadSignedFiles(files, {
            request: fakeRequest,
            createWriteStream,
            stdout: {
              write() {},
            },
          })
          .then(
            () => {
              throw new Error('Unexpected success');
            },
            (error) => {
              expect(error.message).toContain(
                'Got a 404 response when downloading',
              );
              expect(files[0].download_url).not.toEqual(undefined);
              expect(error.message).toContain(files[0].download_url);
            },
          );
      });

      it('configures a download destination in the contructor', function() {
        const downloadDir = '/some/fake/destination-dir/';
        const _client = createClient({ downloadDir });
        const stubs = getDownloadStubs();

        return _client.downloadSignedFiles(stubs.files, stubs).then(() => {
          const filePath = path.join(downloadDir, 'some-signed-file-1.2.3.xpi');
          expect(stubs.createWriteStream).toHaveBeenCalledWith(filePath);
        });
      });

      it('fails for unsigned files', function() {
        let { files } = createSigningResponse().responseBody;
        files = files.map(function(fileOb) {
          return {
            ...fileOb,
            // This can happen for certain invalid XPIs.
            signed: false,
          };
        });
        const stubs = getDownloadStubs();

        return client
          .downloadSignedFiles(files, stubs)
          .then(function() {
            throw new Error('Unexpected success');
          })
          .catch(function(err) {
            expect(err.message).toContain('no signed files were found');
            expect(stubs.request).not.toHaveBeenCalled();
          });
      });

      it('allows partially signed files', function() {
        const stubs = getDownloadStubs();
        stubs.files.push({
          signed: false,
          download_url: 'http://nope.org/should-not-be-downloaded.xpi',
        });

        return client.downloadSignedFiles(stubs.files, stubs).then((result) => {
          const filePath = path.join(
            process.cwd(),
            'some-signed-file-1.2.3.xpi',
          );
          expect(result.success).toEqual(true);
          expect(result.downloadedFiles).toEqual([filePath]);

          expect(stubs.request).toHaveBeenCalledTimes(stubs.files.length - 1);
          expect(stubs.request).toHaveBeenCalledWith(
            expect.objectContaining({
              url: stubs.files[0].download_url,
            }),
          );
        });
      });

      it('handles download errors', function() {
        const stubs = getDownloadStubs();

        const errorResponse = {
          on(event, handler) {
            if (event === 'error') {
              // Immediately trigger a download error.
              handler(new Error('some download error'));
            }
          },
          pipe() {},
        };

        return client
          .downloadSignedFiles(stubs.files, {
            ...stubs,
            request: () => errorResponse,
          })
          .then(() => {
            throw new Error('Unexpected success');
          })
          .catch((err) => {
            expect(err.message).toContain('download error');
          });
      });

      describe('waitForSignedAddon', () => {
        it('rejects when there is an error in checkSignedStatus', async () => {
          const responseError = new Error('some error');
          client._request = new MockRequest({
            responseQueue: [createValidationResponse(), { responseError }],
          });

          await expect(
            waitForSignedAddon().then(() => {
              throw new Error('Unexpected success');
            }),
          ).rejects.toThrow(responseError);
        });
      });
    });

    describe('debugging', function() {
      let fakeLog;

      beforeEach(function() {
        fakeLog = {
          log: jest.fn(),
        };
      });

      it('can be configured for debug output', function() {
        const cli = new amoClient.Client({
          debugLogging: true,
          logger: fakeLog,
        });

        cli.debug('first', 'second');

        expect(fakeLog.log).toHaveBeenCalledWith(
          '[sign-addon]',
          'first',
          'second',
        );
      });

      it('hides debug output by default', function() {
        const cli = new amoClient.Client({
          logger: fakeLog,
        });

        cli.debug('first', 'second');

        expect(fakeLog.log).not.toHaveBeenCalled();
      });

      it('redacts authorization headers', function() {
        const cli = new amoClient.Client({
          debugLogging: true,
          logger: fakeLog,
        });
        const request = {
          headers: {
            Authorization: 'JWT abcdeabcde...',
          },
        };

        cli.debug('prefix', { request });

        expect(fakeLog.log).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.objectContaining({
            request: {
              ...request,
              headers: { Authorization: '<REDACTED>' },
            },
          }),
        );
      });

      it('redacts set-cookie headers', function() {
        const cli = new amoClient.Client({
          debugLogging: true,
          logger: fakeLog,
        });
        const response = {
          headers: {
            'set-cookie': ['foo=bar'],
          },
        };

        cli.debug('prefix', { response });

        expect(fakeLog.log).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.objectContaining({
            response: {
              ...response,
              headers: { 'set-cookie': '<REDACTED>' },
            },
          }),
        );
      });

      it('redacts cookie headers', function() {
        const cli = new amoClient.Client({
          debugLogging: true,
          logger: fakeLog,
        });
        const request = {
          headers: {
            cookie: ['foo=bar'],
          },
        };

        cli.debug('prefix', { request });

        expect(fakeLog.log).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.objectContaining({
            request: {
              ...request,
              headers: { cookie: '<REDACTED>' },
            },
          }),
        );
      });

      it('handles null objects', function() {
        const cli = new amoClient.Client({
          debugLogging: true,
          logger: fakeLog,
        });
        // This was throwing an error because null is an object.
        cli.debug('prefix', null);
      });

      it('preserves redacted objects', function() {
        const cli = new amoClient.Client({
          debugLogging: true,
          logger: fakeLog,
        });
        const response = {
          headers: {
            'set-cookie': ['foo=bar'],
          },
        };
        cli.debug('prefix', {
          response,
        });
        expect(response.headers['set-cookie']).toEqual(['foo=bar']);
      });
    });

    describe('requests', function() {
      let client;

      beforeEach(function() {
        client = createClient();
      });

      it('makes requests with an auth token', function() {
        const request = { url: '/somewhere' };

        return client.get(request).then(() => {
          const call = client._request.calls[0];
          const headerMatch = call.conf.headers.Authorization.match(/JWT (.*)/);
          const token = headerMatch[1];
          const data = jwt.verify(token, client.apiSecret);
          expect(data.iss).toEqual(client.apiKey);
          expect(data).toHaveProperty('iss');
          expect(data).toHaveProperty('iat');
          expect(data).toHaveProperty('exp');

          // Check that the request was configured with all appropriate headers.
          // However, omit the Authorization header since we already verified that
          // above with jwt.verify(). More importantly, the generation of the
          // Authorization header relies on a timestamp so it's not predictable.
          const expectedConf = client.configureRequest(request);
          delete expectedConf.headers.Authorization;
          delete call.conf.headers.Authorization;
          expect(call.conf).toEqual(expectedConf);
        });
      });

      it('lets you configure the jwt expiration', function() {
        const expiresIn = 60 * 15; // 15 minutes
        const cli = createClient({
          apiJwtExpiresIn: expiresIn,
        });

        const fakeJwt = {
          sign: jest.fn().mockReturnValue('<JWT token>'),
        };
        cli.configureRequest(
          { url: '/somewhere' },
          {
            jwt: fakeJwt,
          },
        );

        expect(fakeJwt.sign).toHaveBeenCalled();
        expect(fakeJwt.sign).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(String), // secret
          // Make sure the JWT expiration is customizable.
          expect.objectContaining({ expiresIn }),
        );
      });

      it('configures a default jwt expiration', function() {
        const defaultExpiry = 60 * 5; // 5 minutes
        const cli = createClient();

        const fakeJwt = {
          sign: jest.fn().mockReturnValue('<JWT token>'),
        };
        cli.configureRequest(
          { url: '/somewhere' },
          {
            jwt: fakeJwt,
          },
        );

        expect(fakeJwt.sign).toHaveBeenCalled();
        expect(fakeJwt.sign).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(String), // secret
          expect.objectContaining({ expiresIn: defaultExpiry }),
        );
      });

      it('lets you configure a request directly', function() {
        const conf = client.configureRequest({ url: '/path' });
        expect(conf).toHaveProperty('headers');
        expect(conf).toHaveProperty('timeout');
        expect(conf).toHaveProperty('url');
        expect(conf.headers).toHaveProperty('Accept');
        expect(conf.headers).toHaveProperty('Authorization');
      });

      it('preserves request headers', function() {
        const headers = { 'X-Custom': 'thing' };
        const conf = client.configureRequest({
          url: '/path',
          headers,
        });
        expect(conf.headers['X-Custom']).toEqual('thing');
      });

      it('allows you to override request headers', function() {
        const headers = { Accept: 'text/html' };
        const conf = client.configureRequest({
          url: '/path',
          headers,
        });
        expect(conf.headers.Accept).toEqual('text/html');
      });

      it('makes relative URLs absolute', function() {
        const urlPath = '/somewhere';
        const conf = client.configureRequest({ url: urlPath });
        expect(conf.url).toEqual(defaultApiUrlPrefix + urlPath);
      });

      it('accepts absolute URLs', function() {
        const absUrl = 'http://some-site/somewhere';
        const conf = client.configureRequest({ url: absUrl });
        expect(conf.url).toEqual(absUrl);
      });

      it('can make any HTTP request', function() {
        const requests = [];
        ['get', 'put', 'post', 'patch', 'delete'].forEach((method) => {
          const urlPath = '/some/path';

          requests.push(
            client[method]({ url: urlPath }).then(() => {
              const call = client._request.callMap[method];
              expect(call.conf.url).toEqual(defaultApiUrlPrefix + urlPath);
              expect(call.conf.headers).toHaveProperty('Accept');
              expect(call.conf.headers).toHaveProperty('Authorization');
            }),
          );
        });
        return Promise.all(requests);
      });

      it('configures a request timeout based on JWT expiration', function() {
        // Set a custom JWT expiration:
        const expiresIn = 60 * 15; // 15 minutes
        const cli = createClient({
          apiJwtExpiresIn: expiresIn,
        });

        const config = cli.configureRequest({ url: '/somewhere' });

        // Make sure the request is configured to timeout after the
        // JWT token times out.
        expect(config.timeout).toBeGreaterThan(expiresIn * 1000);
      });

      it('requires a URL', function() {
        expect(() => {
          client.configureRequest({});
        }).toThrow(Error, /URL was not specified/);
      });

      it('rejects the request promise on > 200 responses', function() {
        client._request = new MockRequest({
          httpResponse: { statusCode: 409 },
        });
        return client
          .get({ url: '/something' })
          .then(function() {
            throw new Error('unexpected success');
          })
          .catch(function(err) {
            expect(err.message).toContain('Received bad response');
          });
      });

      it('rejects the request promise on < 200 responses', function() {
        client._request = new MockRequest({
          httpResponse: { statusCode: 122 },
        });
        return client
          .get({ url: '/something' })
          .then(function() {
            throw new Error('unexpected success');
          })
          .catch(function(err) {
            expect(err.message).toContain('Received bad response');
          });
      });

      it('rejects the request promise with callback error', function() {
        const callbackError = new Error('some error');
        client._request = new MockRequest({ responseError: callbackError });

        return client
          .get({ url: '/something' })
          .then(function() {
            throw new Error('unexpected success');
          })
          .catch(function(err) {
            expect(err).toEqual(callbackError);
          });
      });

      it('can be configured not to throw on a bad response status', function() {
        client._request = new MockRequest({
          httpResponse: { statusCode: 409 },
        });
        return client
          .get(
            {
              url: '/something',
            },
            {
              throwOnBadResponse: false,
            },
          )
          .then(function(result) {
            expect(result[0].statusCode).toEqual(409);
          });
      });

      it('resolves the request promise with the HTTP response', function() {
        const httpResponse = { statusCode: 201 };
        client._request = new MockRequest({ httpResponse });

        return client.get({ url: '/something' }).then((responseResult) => {
          const returnedResponse = responseResult[0];
          expect(returnedResponse).toEqual(httpResponse);
        });
      });

      it('resolves the request promise with the response body', function() {
        const responseBody = 'some text response';
        client._request = new MockRequest({ responseBody });

        return client.get({ url: '/something' }).then((responseResult) => {
          const returnedBody = responseResult[1];
          expect(returnedBody).toEqual(responseBody);
        });
      });

      it('resolves the request promise with a JSON object', async () => {
        const data = { someKey: 'some value' };

        client._request = new MockRequest({
          responseBody: JSON.stringify(data),
          httpResponse: {
            statusCode: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        });

        const response = await client.get({ url: '/something' });
        const result = response[1];

        expect(result).toEqual(data);
      });

      it('ignores broken JSON responses', async () => {
        client._request = new MockRequest({
          responseBody: '}{', // broken JSON
          httpResponse: {
            statusCode: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        });

        const response = await client.get({ url: '/something' });
        const result = response[1];

        expect(typeof result).toEqual('string');
      });
    });
  });

  describe('formatResponse', function() {
    it('should dump JSON objects', function() {
      const res = amoClient.formatResponse({ error: 'some error' });
      expect(res).toEqual('{"error":"some error"}');
    });

    it('should truncate long JSON', function() {
      const res = amoClient.formatResponse(
        { error: 'pretend this is really long' },
        { maxLength: 5 },
      );
      expect(res).toEqual('{"err...');
    });

    it('ignores broken JSON objects', function() {
      const stub = jest.fn().mockImplementation(() => {
        throw new Error();
      });
      const res = amoClient.formatResponse(
        { unserializable: process }, // any complex object
        { _stringifyToJson: stub },
      );
      expect(res).toEqual('[object Object]');
    });

    it('should truncate long HTML', function() {
      const res = amoClient.formatResponse(
        '<h1>pretend this is really long</h1>',
        {
          maxLength: 9,
        },
      );
      expect(res).toEqual('<h1>prete...');
    });

    it('should leave short HTML in tact', function() {
      const text = '<h1>404 or whatever</h1>';
      const res = amoClient.formatResponse(text);
      expect(res).toEqual(text);
    });
  });

  describe('getUrlBasename', function() {
    it('gets a basename', function() {
      const base = amoClient.getUrlBasename('http://foo.com/bar.zip');
      expect(base).toEqual('bar.zip');
    });

    it('strips the query string', function() {
      const base = amoClient.getUrlBasename('http://foo.com/bar.zip?baz=quz');
      expect(base).toEqual('bar.zip');
    });
  });
});
