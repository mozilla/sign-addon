// @ts-nocheck
/* eslint max-classes-per-file: 0 */
import path from 'path';

import { beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import jwt from 'jsonwebtoken';

import * as amoClient from '../src/amo-client';

class MockProgress {
  animate() {}

  finish() {}
}

class MockRequest {
  constructor(confOverrides) {
    const defaultResponse = {
      httpResponse: { statusCode: 200 },
      responseBody: '',
      responseError: null,
    };
    const conf = {
      // By default, responses will not be queued.
      // I.E. the same response will be returned repeatedly.
      responseQueue: false,
      ...confOverrides,
    };

    this.responseQueue = conf.responseQueue;
    this.returnMultipleResponses = !!this.responseQueue;

    if (!this.returnMultipleResponses) {
      // If the caller did not queue some responses then assume all
      // configuration should apply to the response.
      this.responseQueue = [conf];
    }

    // Make sure each queued response has the default values.
    this.responseQueue.forEach((response, i) => {
      this.responseQueue[i] = { ...defaultResponse, ...response };
    });

    this.calls = [];
    this.callMap = {};
    this.httpResponse = conf.httpResponse;
    this.responseBody = conf.responseBody;
    this.responseError = conf.responseError;
  }

  _mockRequest(method, conf, callback) {
    const info = { conf };
    this.calls.push({ ...info, name: method });
    this.callMap[method] = info;

    let response;
    if (this.returnMultipleResponses) {
      response = this.responseQueue.shift();
    } else {
      // Always return the same response.
      response = this.responseQueue[0];
    }
    if (!response) {
      response = {};
      response.responseError = new Error('Response queue is empty');
    }

    callback(
      response.responseError,
      response.httpResponse,
      response.responseBody,
    );
  }

  get(conf, callback) {
    return this._mockRequest('get', conf, callback);
  }

  post(conf, callback) {
    return this._mockRequest('post', conf, callback);
  }

  put(conf, callback) {
    return this._mockRequest('put', conf, callback);
  }

  patch(conf, callback) {
    return this._mockRequest('patch', conf, callback);
  }

  delete(conf, callback) {
    return this._mockRequest('delete', conf, callback);
  }
}
describe('amoClient.Client', function() {
  function setUp() {
    /* jshint validthis: true */
    this.apiUrlPrefix = 'http://not-a-real-amo-api.com/api/v3';

    this.newClient = (overrides) => {
      const opt = {
        apiKey: 'fake-api-key',
        apiSecret: 'fake-api-secret',
        apiUrlPrefix: this.apiUrlPrefix,
        signedStatusCheckInterval: 0,
        fs: {
          createReadStream() {
            return 'fake-read-stream';
          },
        },
        request: new MockRequest(),
        validateProgress: new MockProgress(),
        ...overrides,
      };
      return new amoClient.Client(opt);
    };

    this.client = this.newClient();
  }

  describe('signing', function() {
    beforeEach(function() {
      setUp.call(this);

      this.sign = (confOverrides) => {
        const conf = {
          guid: 'some-guid',
          version: 'some-version',
          xpiPath: 'some-xpi-path',
          ...confOverrides,
        };
        return this.client.sign(conf);
      };

      this.waitForSignedAddon = (url, overrides) => {
        const options = {
          setAbortTimeout: () => {},
          ...overrides,
        };
        return this.client.waitForSignedAddon(
          url || '/some-status-url',
          options,
        );
      };
    });

    function signedResponse(overrides) {
      const res = {
        guid: 'an-addon-guid',
        active: true,
        processed: true,
        valid: true,
        reviewed: true,
        files: [
          {
            signed: true,
            download_url: 'http://amo/some-signed-file-1.2.3.xpi',
          },
        ],
        validation_url: 'http://amo/validation-results/',
        ...overrides,
      };

      return {
        responseBody: res,
      };
    }

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

      const { files } = signedResponse().responseBody;
      const fakeRequest = sinon.spy(() => fakeResponse);
      const createWriteStream = sinon.spy(() => fakeFileWriter);
      const stdout = {
        write() {},
      };

      return { files, request: fakeRequest, createWriteStream, stdout };
    }

    it('lets you sign an add-on', function() {
      const apiStatusUrl = 'https://api/addon/version/upload/abc123';
      const conf = {
        guid: 'a-guid',
        version: 'a-version',
      };
      const waitForSignedAddon = sinon.spy(() => {});
      this.client.waitForSignedAddon = waitForSignedAddon;

      this.client._request = new MockRequest({
        httpResponse: { statusCode: 202 },
        // Partial response like:
        // http://olympia.readthedocs.org/en/latest/topics/api/signing.html#checking-the-status-of-your-upload
        responseBody: {
          url: apiStatusUrl,
        },
      });

      return this.sign(conf).then(() => {
        const putCall = this.client._request.calls[0];
        expect(putCall.name).to.be.equal('put');

        const partialUrl = `/addons/${conf.guid}/versions/${conf.version}`;
        expect(putCall.conf.url).to.include(partialUrl);
        expect(putCall.conf.formData.upload).to.be.equal('fake-read-stream');
        // When doing a PUT, the version is in the URL not the form data.
        expect(putCall.conf.formData.version).to.be.equal(undefined);
        // When no channel is supplied, the API is expected to use the most recent channel.
        expect(putCall.conf.formData.channel).to.be.equal(undefined);

        expect(waitForSignedAddon.called).to.be.equal(true);
        expect(waitForSignedAddon.firstCall.args[0]).to.be.equal(apiStatusUrl);
      });
    });

    it('lets you sign an add-on without an ID', function() {
      const apiStatusUrl = 'https://api/addon/version/upload/abc123';
      const conf = {
        guid: null,
        version: 'a-version',
      };
      const waitForSignedAddon = sinon.spy(() => {});
      this.client.waitForSignedAddon = waitForSignedAddon;

      this.client._request = new MockRequest({
        httpResponse: { statusCode: 202 },
        // Partial response like:
        // http://olympia.readthedocs.org/en/latest/topics/api/signing.html#checking-the-status-of-your-upload
        responseBody: {
          url: apiStatusUrl,
        },
      });

      return this.sign(conf).then(() => {
        const call = this.client._request.calls[0];
        expect(call.name).to.be.equal('post');

        // Make sure the endpoint ends with /addons/
        expect(call.conf.url).to.match(/\/addons\/$/);
        expect(call.conf.formData.upload).to.be.equal('fake-read-stream');
        expect(call.conf.formData.version).to.be.equal(conf.version);
        // Channel is not a valid parameter for new add-ons.
        expect(call.conf.formData.channel).to.be.equal(undefined);

        expect(waitForSignedAddon.called).to.be.equal(true);
        expect(waitForSignedAddon.firstCall.args[0]).to.be.equal(apiStatusUrl);
      });
    });

    it('lets you sign an add-on on a specific channel', function() {
      const conf = {
        channel: 'listed',
      };
      const waitForSignedAddon = sinon.spy(() => {});
      this.client.waitForSignedAddon = waitForSignedAddon;

      this.client._request = new MockRequest({
        httpResponse: { statusCode: 202 },
      });

      return this.sign(conf).then(() => {
        expect(this.client._request.calls[0].conf.formData.channel).to.be.equal(
          'listed',
        );
      });
    });

    it('lets you sign an add-on without an ID ignoring channel', function() {
      const conf = {
        guid: null,
        channel: 'listed',
      };
      const waitForSignedAddon = sinon.spy(() => {});
      this.client.waitForSignedAddon = waitForSignedAddon;

      this.client._request = new MockRequest({
        httpResponse: { statusCode: 202 },
      });

      return this.sign(conf).then(() => {
        expect(this.client._request.calls[0].conf.formData.channel).to.be.equal(
          undefined,
        );
      });
    });

    it('handles already validated add-ons', function() {
      const waitForSignedAddon = sinon.spy(() => {});
      this.client.waitForSignedAddon = waitForSignedAddon;

      this.client._request = new MockRequest({
        httpResponse: { statusCode: 409 },
        responseBody: { error: 'version already exists' },
      });

      return this.sign().then(function(result) {
        expect(waitForSignedAddon.called).to.be.equal(false);
        expect(result.success).to.be.equal(false);
      });
    });

    it('handles incorrect status code for error responses', function() {
      this.client.waitForSignedAddon = () => {};

      this.client._request = new MockRequest({
        // For some reason, the API was returning errors with a 200.
        // See https://github.com/mozilla/addons-server/issues/3097
        httpResponse: { statusCode: 200 },
        responseBody: { error: 'some server error' },
      });

      return this.sign().then((result) => {
        expect(result.success).to.be.equal(false);
      });
    });

    it('throws an error when signing on a 500 server response', function() {
      this.client._request = new MockRequest({
        httpResponse: { statusCode: 500 },
      });

      return this.sign()
        .then(function() {
          throw new Error('unexpected success');
        })
        .catch(function(err) {
          expect(err.message).to.include('Received bad response');
        });
    });

    it('waits for passing validation', function() {
      const downloadSignedFiles = sinon.spy(() => Promise.resolve({}));
      this.client.downloadSignedFiles = downloadSignedFiles;

      const files = [
        {
          signed: true,
          download_url: 'http://amo/the-signed-file-1.2.3.xpi',
        },
      ];
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse({ valid: false, processed: false }),
          signedResponse({ valid: true, processed: true, files }),
        ],
      });

      const statusUrl = '/addons/something/versions/1.2.3/';
      return this.waitForSignedAddon(statusUrl).then(() => {
        // Expect exactly two GETs before resolution.
        expect(this.client._request.calls.length).to.be.equal(2);
        expect(this.client._request.calls[0].conf.url).to.include(statusUrl);
        expect(downloadSignedFiles.firstCall.args[0]).to.be.deep.equal(files);
      });
    });

    it('resolves with the extension ID in the result', function() {
      const files = [
        {
          signed: true,
          download_url: 'http://amo/the-signed-file-1.2.3.xpi',
        },
      ];
      const downloadSignedFiles = sinon.spy(() => Promise.resolve({ files }));
      this.client.downloadSignedFiles = downloadSignedFiles;

      const guid = 'some-addon-guid';
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse({ valid: true, processed: true, files, guid }),
        ],
      });

      return this.waitForSignedAddon('/status-url').then((result) => {
        expect(result.files).to.be.deep.equal(files);
        expect(result.id).to.be.deep.equal(guid);
      });
    });

    it('waits for for fully reviewed files', function() {
      const downloadSignedFiles = sinon.spy(() => Promise.resolve({}));
      this.client.downloadSignedFiles = downloadSignedFiles;

      this.client._request = new MockRequest({
        responseQueue: [
          // This is a situation where the upload has been validated
          // but the version object has not been saved yet.
          signedResponse({ valid: true, processed: true, reviewed: false }),
          signedResponse({ valid: true, processed: true, reviewed: true }),
        ],
      });

      return this.waitForSignedAddon().then(() => {
        // Expect exactly two GETs before resolution.
        expect(this.client._request.calls.length).to.be.equal(2);
        expect(downloadSignedFiles.called).to.be.equal(true);
      });
    });

    it('waits until signed files are ready', function() {
      const downloadSignedFiles = sinon.spy(() => Promise.resolve({}));
      this.client.downloadSignedFiles = downloadSignedFiles;
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse({ files: [] }), // valid, but files aren"t ready yet
          signedResponse(), // files are ready
        ],
      });

      return this.waitForSignedAddon().then(() => {
        // Expect exactly two GETs before resolution.
        expect(this.client._request.calls.length).to.be.equal(2);
        expect(downloadSignedFiles.called).to.be.equal(true);
      });
    });

    it('waits for failing validation', function() {
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse({ valid: false, processed: false }),
          signedResponse({ valid: false, processed: true }),
        ],
      });

      return this.waitForSignedAddon().then((result) => {
        // Expect exactly two GETs before resolution.
        expect(this.client._request.calls.length).to.be.equal(2);
        expect(result.success).to.be.equal(false);
      });
    });

    it('passes through status check request errors', function() {
      this.client._request = new MockRequest({
        httpResponse: { statusCode: 500 },
        responseError: new Error('error from status check URL'),
      });

      return this.waitForSignedAddon()
        .then(() => {
          throw new Error('Unexpected success');
        })
        .catch((error) => {
          expect(error.message).to.include('error from status check URL');
        });
    });

    it('handles complete yet inactive addons', function() {
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse({
            valid: true,
            processed: true,
            automated_signing: false,
          }),
        ],
      });

      return this.waitForSignedAddon().then(function(result) {
        expect(result.success).to.be.equal(false);
      });
    });

    it('aborts validation check after timeout', function() {
      const clearTimeout = sinon.spy(() => {});

      return this.client
        .waitForSignedAddon('/status-url', {
          clearTimeout,
          setStatusCheckTimeout() {
            return 'status-check-timeout-id';
          },
          abortAfter: 0,
        })
        .then(function() {
          throw new Error('Unexpected success');
        })
        .catch(function(err) {
          expect(err.message).to.include('took too long');
          expect(clearTimeout.firstCall.args[0]).to.be.equal(
            'status-check-timeout-id',
          );
        });
    });

    it('can configure signing status check timeout', function() {
      const clearTimeout = sinon.stub();
      const client = this.newClient({
        // This should cause an immediate timeout.
        signedStatusCheckTimeout: 0,
      });

      return client
        .waitForSignedAddon('/status-url', {
          clearTimeout,
          setStatusCheckTimeout() {
            return 'status-check-timeout-id';
          },
        })
        .then(function() {
          throw new Error('Unexpected success');
        })
        .catch(function(err) {
          expect(err.message).to.include('took too long');
        });
    });

    it('can use a request proxy', function() {
      const proxyServer = 'http://yourproxy:6000';
      const client = this.newClient({ proxyServer });
      const conf = client.configureRequest({ url: 'http://site' });
      expect(conf.proxy).to.be.equal(proxyServer);
    });

    it('can arbitrarily configure the request', function() {
      const requestConfig = {
        url: 'http://this-is-ignored',
        tunnel: true,
        strictSSL: true,
      };
      const client = this.newClient({ requestConfig });
      const conf = client.configureRequest({ url: 'http://site' });
      expect(conf.url).to.be.equal('http://site');
      expect(conf.tunnel).to.be.equal(requestConfig.tunnel);
      expect(conf.strictSSL).to.be.equal(requestConfig.strictSSL);
    });

    it('clears abort timeout after resolution', function() {
      const clearTimeout = sinon.spy(() => {});
      this.client._request = new MockRequest({
        responseQueue: [signedResponse()],
      });

      const downloadSignedFiles = sinon.spy(() => Promise.resolve({}));
      this.client.downloadSignedFiles = downloadSignedFiles;

      return this.waitForSignedAddon('/status-url/', {
        clearTimeout,
        setAbortTimeout() {
          return 'abort-timeout-id';
        },
        setStatusCheckTimeout() {
          return 'status-check-timeout-id';
        },
      }).then(function() {
        // Assert that signing resolved successfully.
        expect(downloadSignedFiles.called).to.be.equal(true);
        // Assert that the timeout-to-abort was cleared.
        expect(clearTimeout.firstCall.args[0]).to.be.equal('abort-timeout-id');
      });
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

      const { files } = signedResponse().responseBody;
      const fakeRequest = sinon.spy(() => fakeResponse);
      const createWriteStream = sinon.spy(() => fakeFileWriter);

      return this.client
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
          expect(result.success).to.be.equal(true);
          expect(result.downloadedFiles).to.be.deep.equal([filePath]);
          expect(createWriteStream.firstCall.args[0]).to.be.equal(filePath);
          expect(fakeRequest.firstCall.args[0].url).to.be.equal(
            files[0].download_url,
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

      const { files } = signedResponse().responseBody;
      const fakeRequest = sinon.spy(() => fakeResponse);
      const { createWriteStream } = getDownloadStubs();

      return this.client
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
            expect(error.message).to.include(
              'Got a 404 response when downloading',
            );
            expect(files[0].download_url).to.not.be.equal(undefined);
            expect(error.message).to.include(files[0].download_url);
          },
        );
    });

    it('configures a download destination in the contructor', function() {
      const downloadDir = '/some/fake/destination-dir/';
      const client = this.newClient({ downloadDir });
      const stubs = getDownloadStubs();

      return client.downloadSignedFiles(stubs.files, stubs).then(() => {
        const filePath = path.join(downloadDir, 'some-signed-file-1.2.3.xpi');
        expect(stubs.createWriteStream.firstCall.args[0]).to.be.equal(filePath);
      });
    });

    it('fails for unsigned files', function() {
      let { files } = signedResponse().responseBody;
      files = files.map(function(fileOb) {
        return {
          ...fileOb,
          // This can happen for certain invalid XPIs.
          signed: false,
        };
      });
      const stubs = getDownloadStubs();

      return this.client
        .downloadSignedFiles(files, stubs)
        .then(function() {
          throw new Error('Unexpected success');
        })
        .catch(function(err) {
          expect(err.message).to.match(/no signed files were found/);
          expect(stubs.request.called).to.be.equal(false);
        });
    });

    it('allows partially signed files', function() {
      const stubs = getDownloadStubs();
      stubs.files.push({
        signed: false,
        download_url: 'http://nope.org/should-not-be-downloaded.xpi',
      });

      return this.client
        .downloadSignedFiles(stubs.files, stubs)
        .then((result) => {
          const filePath = path.join(
            process.cwd(),
            'some-signed-file-1.2.3.xpi',
          );
          expect(result.success).to.be.equal(true);
          expect(result.downloadedFiles).to.be.deep.equal([filePath]);
          expect(stubs.request.callCount).to.be.equal(stubs.files.length - 1);
          expect(stubs.request.firstCall.args[0].url).to.be.equal(
            stubs.files[0].download_url,
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

      return this.client
        .downloadSignedFiles(stubs.files, {
          ...stubs,
          request: () => errorResponse,
        })
        .then(() => {
          throw new Error('Unexpected success');
        })
        .catch((err) => {
          expect(err.message).to.include('download error');
        });
    });
  });

  describe('debugging', function() {
    let fakeLog;

    beforeEach(function() {
      fakeLog = {
        log: sinon.spy(() => {}),
      };
    });

    it('can be configured for debug output', function() {
      const cli = new amoClient.Client({
        debugLogging: true,
        logger: fakeLog,
      });
      cli.debug('first', 'second');
      expect(fakeLog.log.firstCall.args[0]).to.be.equal('[sign-addon]');
      expect(fakeLog.log.firstCall.args[1]).to.be.equal('first');
      expect(fakeLog.log.firstCall.args[2]).to.be.equal('second');
    });

    it('hides debug output by default', function() {
      const cli = new amoClient.Client({
        logger: fakeLog,
      });
      cli.debug('first', 'second');
      expect(fakeLog.log.called).to.be.equal(false);
    });

    it('redacts authorization headers', function() {
      const cli = new amoClient.Client({
        debugLogging: true,
        logger: fakeLog,
      });
      cli.debug('prefix', {
        request: {
          headers: {
            Authorization: 'JWT abcdeabcde...',
          },
        },
      });
      expect(
        fakeLog.log.firstCall.args[2].request.headers.Authorization,
      ).to.be.equal('<REDACTED>');
    });

    it('redacts set-cookie headers', function() {
      const cli = new amoClient.Client({
        debugLogging: true,
        logger: fakeLog,
      });
      cli.debug('prefix', {
        response: {
          headers: {
            'set-cookie': ['foo=bar'],
          },
        },
      });
      expect(
        fakeLog.log.firstCall.args[2].response.headers['set-cookie'],
      ).to.be.equal('<REDACTED>');
    });

    it('redacts cookie headers', function() {
      const cli = new amoClient.Client({
        debugLogging: true,
        logger: fakeLog,
      });
      cli.debug('prefix', {
        request: {
          headers: {
            cookie: ['foo=bar'],
          },
        },
      });
      expect(fakeLog.log.firstCall.args[2].request.headers.cookie).to.be.equal(
        '<REDACTED>',
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
      expect(response.headers['set-cookie']).to.be.deep.equal(['foo=bar']);
    });
  });

  describe('requests', function() {
    beforeEach(function() {
      setUp.call(this);
    });

    it('makes requests with an auth token', function() {
      const request = { url: '/somewhere' };

      return this.client.get(request).then(() => {
        const call = this.client._request.calls[0];
        const headerMatch = call.conf.headers.Authorization.match(/JWT (.*)/);
        const token = headerMatch[1];
        const data = jwt.verify(token, this.client.apiSecret);
        expect(data.iss).to.be.equal(this.client.apiKey);
        expect(data).to.have.keys(['iss', 'iat', 'exp']);

        // Check that the request was configured with all appropriate headers.
        // However, omit the Authorization header since we already verified that
        // above with jwt.verify(). More importantly, the generation of the
        // Authorization header relies on a timestamp so it's not predictable.
        const expectedConf = this.client.configureRequest(request);
        delete expectedConf.headers.Authorization;
        delete call.conf.headers.Authorization;
        expect(call.conf).to.be.deep.equal(expectedConf);
      });
    });

    it('lets you configure the jwt expiration', function() {
      const expiresIn = 60 * 15; // 15 minutes
      const cli = this.newClient({
        apiJwtExpiresIn: expiresIn,
      });

      const fakeJwt = {
        sign: sinon.spy(() => '<JWT token>'),
      };
      cli.configureRequest(
        { url: '/somewhere' },
        {
          jwt: fakeJwt,
        },
      );

      expect(fakeJwt.sign.called).to.be.equal(true);
      // Make sure the JWT expiration is customizable.
      expect(fakeJwt.sign.args[0][2].expiresIn).to.be.equal(expiresIn);
    });

    it('configures a default jwt expiration', function() {
      const defaultExpiry = 60 * 5; // 5 minutes
      const cli = this.newClient();

      const fakeJwt = {
        sign: sinon.spy(() => '<JWT token>'),
      };
      cli.configureRequest(
        { url: '/somewhere' },
        {
          jwt: fakeJwt,
        },
      );

      expect(fakeJwt.sign.called).to.be.equal(true);
      expect(fakeJwt.sign.args[0][2].expiresIn).to.be.equal(defaultExpiry);
    });

    it('lets you configure a request directly', function() {
      const conf = this.client.configureRequest({ url: '/path' });
      expect(conf).to.have.keys(['headers', 'timeout', 'url']);
      expect(conf.headers).to.have.keys(['Accept', 'Authorization']);
    });

    it('preserves request headers', function() {
      const headers = { 'X-Custom': 'thing' };
      const conf = this.client.configureRequest({
        url: '/path',
        headers,
      });
      expect(conf.headers['X-Custom']).to.be.equal('thing');
    });

    it('allows you to override request headers', function() {
      const headers = { Accept: 'text/html' };
      const conf = this.client.configureRequest({
        url: '/path',
        headers,
      });
      expect(conf.headers.Accept).to.be.equal('text/html');
    });

    it('makes relative URLs absolute', function() {
      const urlPath = '/somewhere';
      const conf = this.client.configureRequest({ url: urlPath });
      expect(conf.url).to.be.equal(this.apiUrlPrefix + urlPath);
    });

    it('accepts absolute URLs', function() {
      const absUrl = 'http://some-site/somewhere';
      const conf = this.client.configureRequest({ url: absUrl });
      expect(conf.url).to.be.equal(absUrl);
    });

    it('can make any HTTP request', function() {
      const requests = [];
      ['get', 'put', 'post', 'patch', 'delete'].forEach((method) => {
        const urlPath = '/some/path';

        requests.push(
          this.client[method]({ url: urlPath }).then(() => {
            const call = this.client._request.callMap[method];
            expect(call.conf.url).to.be.equal(this.apiUrlPrefix + urlPath);
            expect(call.conf.headers).to.have.keys(['Accept', 'Authorization']);
          }),
        );
      });
      return Promise.all(requests);
    });

    it('configures a request timeout based on JWT expiration', function() {
      // Set a custom JWT expiration:
      const expiresIn = 60 * 15; // 15 minutes
      const cli = this.newClient({
        apiJwtExpiresIn: expiresIn,
      });

      const config = cli.configureRequest({ url: '/somewhere' });

      // Make sure the request is configured to timeout after the
      // JWT token times out.
      expect(config.timeout).to.be.above(expiresIn * 1000);
    });

    it('requires a URL', function() {
      expect(() => {
        this.client.configureRequest({});
      }).to.throw(Error, /URL was not specified/);
    });

    it('rejects the request promise on > 200 responses', function() {
      this.client._request = new MockRequest({
        httpResponse: { statusCode: 409 },
      });
      return this.client
        .get({ url: '/something' })
        .then(function() {
          throw new Error('unexpected success');
        })
        .catch(function(err) {
          expect(err.message).to.include('Received bad response');
        });
    });

    it('rejects the request promise on < 200 responses', function() {
      this.client._request = new MockRequest({
        httpResponse: { statusCode: 122 },
      });
      return this.client
        .get({ url: '/something' })
        .then(function() {
          throw new Error('unexpected success');
        })
        .catch(function(err) {
          expect(err.message).to.include('Received bad response');
        });
    });

    it('rejects the request promise with callback error', function() {
      const callbackError = new Error('some error');
      this.client._request = new MockRequest({ responseError: callbackError });

      return this.client
        .get({ url: '/something' })
        .then(function() {
          throw new Error('unexpected success');
        })
        .catch(function(err) {
          expect(err).to.be.equal(callbackError);
        });
    });

    it('can be configured not to throw on a bad response status', function() {
      this.client._request = new MockRequest({
        httpResponse: { statusCode: 409 },
      });
      return this.client
        .get(
          {
            url: '/something',
          },
          {
            throwOnBadResponse: false,
          },
        )
        .then(function(result) {
          expect(result[0].statusCode).to.be.equal(409);
        });
    });

    it('resolves the request promise with the HTTP response', function() {
      const httpResponse = { statusCode: 201 };
      this.client._request = new MockRequest({ httpResponse });

      return this.client.get({ url: '/something' }).then((responseResult) => {
        const returnedResponse = responseResult[0];
        expect(returnedResponse).to.be.equal(httpResponse);
      });
    });

    it('resolves the request promise with the response body', function() {
      const responseBody = 'some text response';
      this.client._request = new MockRequest({ responseBody });

      return this.client.get({ url: '/something' }).then((responseResult) => {
        const returnedBody = responseResult[1];
        expect(returnedBody).to.be.equal(responseBody);
      });
    });

    it('resolves the request promise with a JSON object', function() {
      const data = { someKey: 'some value' };

      this.client._request = new MockRequest({
        responseBody: JSON.stringify(data),
        httpResponse: {
          statusCode: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      });

      return this.client.get({ url: '/something' }).then((responseResult) => {
        const result = responseResult[1];
        expect(result).to.deep.equal(data);
      });
    });

    it('ignores broken JSON responses', function() {
      this.client._request = new MockRequest({
        responseBody: '}{', // broken JSON
        httpResponse: {
          statusCode: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      });

      return this.client.get({ url: '/something' }).then((responseResult) => {
        const result = responseResult[1];
        expect(result).to.be.a('string');
      });
    });
  });
});

describe('amoClient.formatResponse', function() {
  it('should dump JSON objects', function() {
    const res = amoClient.formatResponse({ error: 'some error' });
    expect(res).to.be.equal('{"error":"some error"}');
  });

  it('should truncate long JSON', function() {
    const res = amoClient.formatResponse(
      { error: 'pretend this is really long' },
      { maxLength: 5 },
    );
    expect(res).to.be.equal('{"err...');
  });

  it('ignores broken JSON objects', function() {
    const stub = sinon.stub().throws();
    const res = amoClient.formatResponse(
      { unserializable: process }, // any complex object
      { _stringifyToJson: stub },
    );
    expect(res).to.be.equal('[object Object]');
  });

  it('should truncate long HTML', function() {
    const res = amoClient.formatResponse(
      '<h1>pretend this is really long</h1>',
      {
        maxLength: 9,
      },
    );
    expect(res).to.be.equal('<h1>prete...');
  });

  it('should leave short HTML in tact', function() {
    const text = '<h1>404 or whatever</h1>';
    const res = amoClient.formatResponse(text);
    expect(res).to.be.equal(text);
  });
});

describe('amoClient.getUrlBasename', function() {
  it('gets a basename', function() {
    const base = amoClient.getUrlBasename('http://foo.com/bar.zip');
    expect(base).to.be.equal('bar.zip');
  });

  it('strips the query string', function() {
    const base = amoClient.getUrlBasename('http://foo.com/bar.zip?baz=quz');
    expect(base).to.be.equal('bar.zip');
  });
});

describe('amoClient.PseudoProgress', function() {
  beforeEach(function() {
    this.setIntervalMock = sinon.spy(() => 'interval-id');
    this.clearIntervalMock = sinon.spy(() => {});

    this.progress = new amoClient.PseudoProgress({
      setInterval: this.setIntervalMock,
      clearInterval: this.clearIntervalMock,
      stdout: {
        columns: 80,
        isTTY: true,
        write() {},
      },
    });
  });

  it('should set an interval', function() {
    this.progress.animate();
    expect(this.setIntervalMock.called).to.be.equal(true);
  });

  it('should clear an interval', function() {
    this.progress.animate();
    expect(this.setIntervalMock.called).to.be.equal(true);
    this.progress.finish();
    expect(this.clearIntervalMock.firstCall.args[0]).to.be.equal('interval-id');
  });
});
