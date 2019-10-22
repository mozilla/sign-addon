import {beforeEach, describe, it} from "mocha";
import path from "path";
import {expect} from "chai";
import sinon from "sinon";
import jwt from "jsonwebtoken";

import * as amoClient from "../src/amo-client";


describe("amoClient.Client", function() {

  function setUp() {
    /* jshint validthis: true */
    this.apiUrlPrefix = "http://not-a-real-amo-api.com/api/v3";

    this.newClient = (opt) => {
      opt = {
        apiKey: "fake-api-key",
        apiSecret: "fake-api-secret",
        apiUrlPrefix: this.apiUrlPrefix,
        signedStatusCheckInterval: 0,
        fs: {
          createReadStream: function() {
            return "fake-read-stream";
          },
        },
        request: new MockRequest(),
        validateProgress: new MockProgress(),
        ...opt,
      };
      return new amoClient.Client(opt);
    };

    this.client = this.newClient();
  }

  describe("signing", function() {

    beforeEach(function() {
      setUp.call(this);

      this.sign = (conf) => {
        conf = {
          guid: "some-guid",
          version: "some-version",
          xpiPath: "some-xpi-path",
          ...conf,
        };
        return this.client.sign(conf);
      };

      this.waitForSignedAddon = (url, options) => {
        url = url || "/some-status-url";
        options = {
          setAbortTimeout: () => {},
          ...options,
        };
        return this.client.waitForSignedAddon(url, options);
      };

    });

    function signedResponse(overrides) {
      var res = {
        guid: "an-addon-guid",
        active: true,
        processed: true,
        valid: true,
        reviewed: true,
        files: [{
          signed: true,
          download_url: "http://amo/some-signed-file-1.2.3.xpi",
        }],
        validation_url: "http://amo/validation-results/",
        ...overrides,
      };

      return {
        responseBody: res,
      };
    }

    function getDownloadStubs() {
      var fakeResponse = {
        on: function() {
          return this;
        },
        pipe: function() {
          return this;
        },
      };

      var fakeFileWriter = {
        on: function(event, handler) {
          if (event === "finish") {
            // Simulate completion of the download immediately when the
            // handler is registered.
            handler();
          }
        },
      };

      var files = signedResponse().responseBody.files;
      var fakeRequest = sinon.spy(() => fakeResponse);
      var createWriteStream = sinon.spy(() => fakeFileWriter);
      var stdout = {
        write: function() {},
      };

      return {files, request: fakeRequest, createWriteStream, stdout};
    }

    it("lets you sign an add-on", function() {
      var apiStatusUrl = "https://api/addon/version/upload/abc123";
      var conf = {
        guid: "a-guid",
        version: "a-version",
      };
      var waitForSignedAddon = sinon.spy(() => {});
      this.client.waitForSignedAddon = waitForSignedAddon;

      this.client._request = new MockRequest({
        httpResponse: {statusCode: 202},
        // Partial response like:
        // http://olympia.readthedocs.org/en/latest/topics/api/signing.html#checking-the-status-of-your-upload
        responseBody: {
          url: apiStatusUrl,
        },
      });

      return this.sign(conf).then(() => {
        var putCall = this.client._request.calls[0];
        expect(putCall.name).to.be.equal("put");

        var partialUrl = "/addons/" + conf.guid + "/versions/" + conf.version;
        expect(putCall.conf.url).to.include(partialUrl);
        expect(putCall.conf.formData.upload).to.be.equal("fake-read-stream");
        // When doing a PUT, the version is in the URL not the form data.
        expect(putCall.conf.formData.version).to.be.undefined;
        // When no channel is supplied, the API is expected to use the most recent channel.
        expect(putCall.conf.formData.channel).to.be.undefined;

        expect(waitForSignedAddon.called).to.be.equal(true);
        expect(waitForSignedAddon.firstCall.args[0])
          .to.be.equal(apiStatusUrl);
      });
    });

    it("lets you sign an add-on without an ID", function() {
      const apiStatusUrl = "https://api/addon/version/upload/abc123";
      const conf = {
        guid: null,
        version: "a-version",
      };
      const waitForSignedAddon = sinon.spy(() => {});
      this.client.waitForSignedAddon = waitForSignedAddon;

      this.client._request = new MockRequest({
        httpResponse: {statusCode: 202},
        // Partial response like:
        // http://olympia.readthedocs.org/en/latest/topics/api/signing.html#checking-the-status-of-your-upload
        responseBody: {
          url: apiStatusUrl,
        },
      });

      return this.sign(conf).then(() => {
        var call = this.client._request.calls[0];
        expect(call.name).to.be.equal("post");

        // Make sure the endpoint ends with /addons/
        expect(call.conf.url).to.match(/\/addons\/$/);
        expect(call.conf.formData.upload).to.be.equal("fake-read-stream");
        expect(call.conf.formData.version).to.be.equal(conf.version);
        // Channel is not a valid parameter for new add-ons.
        expect(call.conf.formData.channel).to.be.undefined;

        expect(waitForSignedAddon.called).to.be.equal(true);
        expect(waitForSignedAddon.firstCall.args[0])
          .to.be.equal(apiStatusUrl);
      });
    });

    it("lets you sign an add-on on a specific channel", function() {
      var conf = {
        channel: "listed",
      };
      var waitForSignedAddon = sinon.spy(() => {});
      this.client.waitForSignedAddon = waitForSignedAddon;

      this.client._request = new MockRequest({
        httpResponse: {statusCode: 202},
      });

      return this.sign(conf).then(() => {
        expect(this.client._request.calls[0].conf.formData.channel)
          .to.be.equal("listed");
      });
    });

    it("lets you sign an add-on without an ID ignoring channel", function() {
      var conf = {
        guid: null,
        channel: "listed",
      };
      var waitForSignedAddon = sinon.spy(() => {});
      this.client.waitForSignedAddon = waitForSignedAddon;

      this.client._request = new MockRequest({
        httpResponse: {statusCode: 202},
      });

      return this.sign(conf).then(() => {
        expect(this.client._request.calls[0].conf.formData.channel)
          .to.be.undefined;
      });
    });

    it("handles already validated add-ons", function() {
      var waitForSignedAddon = sinon.spy(() => {});
      this.client.waitForSignedAddon = waitForSignedAddon;

      this.client._request = new MockRequest({
        httpResponse: {statusCode: 409},
        responseBody: {error: "version already exists"},
      });

      return this.sign().then(function(result) {
        expect(waitForSignedAddon.called).to.be.equal(false);
        expect(result.success).to.be.equal(false);
      });
    });

    it("handles incorrect status code for error responses", function() {
      this.client.waitForSignedAddon = () => {};

      this.client._request = new MockRequest({
        // For some reason, the API was returning errors with a 200.
        // See https://github.com/mozilla/addons-server/issues/3097
        httpResponse: {statusCode: 200},
        responseBody: {error: "some server error"},
      });

      return this.sign().then((result) => {
        expect(result.success).to.be.equal(false);
      });
    });

    it("throws an error when signing on a 500 server response", function() {
      this.client._request = new MockRequest({httpResponse: {statusCode: 500}});

      return this.sign().then(function() {
        throw new Error("unexpected success");
      }).catch(function(err) {
        expect(err.message).to.include("Received bad response");
      });
    });

    it("waits for passing validation", function() {
      var downloadSignedFiles = sinon.spy(() => Promise.resolve({}));
      this.client.downloadSignedFiles = downloadSignedFiles;

      var files = [{
        signed: true,
        download_url: "http://amo/the-signed-file-1.2.3.xpi",
      }];
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse({valid: false, processed: false}),
          signedResponse({valid: true, processed: true, files: files}),
        ],
      });

      var statusUrl = "/addons/something/versions/1.2.3/";
      return this.waitForSignedAddon(statusUrl).then(() => {
        // Expect exactly two GETs before resolution.
        expect(this.client._request.calls.length).to.be.equal(2);
        expect(this.client._request.calls[0].conf.url).to.include(
          statusUrl);
        expect(downloadSignedFiles.firstCall.args[0])
          .to.be.deep.equal(files);
      });
    });

    it("resolves with the extension ID in the result", function() {
      const files = [{
        signed: true,
        download_url: "http://amo/the-signed-file-1.2.3.xpi",
      }];
      const downloadSignedFiles = sinon.spy(() => Promise.resolve({files}));
      this.client.downloadSignedFiles = downloadSignedFiles;

      const guid = "some-addon-guid";
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse({valid: true, processed: true, files, guid}),
        ],
      });

      return this.waitForSignedAddon("/status-url").then((result) => {
        expect(result.files).to.be.deep.equal(files);
        expect(result.id).to.be.deep.equal(guid);
      });
    });

    it("waits for for fully reviewed files", function() {
      var downloadSignedFiles = sinon.spy(() => Promise.resolve({}));
      this.client.downloadSignedFiles = downloadSignedFiles;

      this.client._request = new MockRequest({
        responseQueue: [
          // This is a situation where the upload has been validated
          // but the version object has not been saved yet.
          signedResponse({valid: true, processed: true, reviewed: false}),
          signedResponse({valid: true, processed: true, reviewed: true}),
        ],
      });

      return this.waitForSignedAddon().then(() => {
        // Expect exactly two GETs before resolution.
        expect(this.client._request.calls.length).to.be.equal(2);
        expect(downloadSignedFiles.called).to.be.equal(true);
      });
    });

    it("waits until signed files are ready", function() {
      var downloadSignedFiles = sinon.spy(() => Promise.resolve({}));
      this.client.downloadSignedFiles = downloadSignedFiles;
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse({files: []}),  // valid, but files aren"t ready yet
          signedResponse(),  // files are ready
        ],
      });

      return this.waitForSignedAddon().then(() => {
        // Expect exactly two GETs before resolution.
        expect(this.client._request.calls.length).to.be.equal(2);
        expect(downloadSignedFiles.called).to.be.equal(true);
      });
    });

    it("waits for failing validation", function() {
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse({valid: false, processed: false}),
          signedResponse({valid: false, processed: true}),
        ],
      });

      return this.waitForSignedAddon().then((result) => {
        // Expect exactly two GETs before resolution.
        expect(this.client._request.calls.length).to.be.equal(2);
        expect(result.success).to.be.equal(false);
      });
    });

    it("passes through status check request errors", function() {
      this.client._request = new MockRequest({
        httpResponse: {statusCode: 500},
        responseError: new Error("error from status check URL"),
      });

      return this.waitForSignedAddon()
        .then(() => {
          throw new Error("Unexpected success");
        })
        .catch((error) => {
          expect(error.message).to.include("error from status check URL");
        });
    });

    it("handles complete yet inactive addons", function() {
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse({
            valid: true, processed: true,
            automated_signing: false,
          }),
        ],
      });

      return this.waitForSignedAddon().then(function(result) {
        expect(result.success).to.be.equal(false);
      });
    });

    it("aborts validation check after timeout", function() {
      var clearTimeout = sinon.spy(() => {});

      return this.client.waitForSignedAddon("/status-url", {
        clearTimeout: clearTimeout,
        setStatusCheckTimeout: function() {
          return "status-check-timeout-id";
        },
        abortAfter: 0,
      }).then(function() {
        throw new Error("Unexpected success");
      }).catch(function(err) {
        expect(err.message).to.include("took too long");
        expect(clearTimeout.firstCall.args[0])
          .to.be.equal("status-check-timeout-id");
      });
    });

    it("can configure signing status check timeout", function() {
      var clearTimeout = sinon.stub();
      var client = this.newClient({
        // This should cause an immediate timeout.
        signedStatusCheckTimeout: 0,
      });

      return client.waitForSignedAddon("/status-url", {
        clearTimeout: clearTimeout,
        setStatusCheckTimeout: function() {
          return "status-check-timeout-id";
        },
      }).then(function() {
        throw new Error("Unexpected success");
      }).catch(function(err) {
        expect(err.message).to.include("took too long");
      });
    });

    it("can use a request proxy", function() {
      const proxyServer = "http://yourproxy:6000";
      const client = this.newClient({proxyServer});
      const conf = client.configureRequest({url: "http://site"});
      expect(conf.proxy).to.be.equal(proxyServer);
    });

    it("can arbitrarily configure the request", function() {
      const requestConfig = {
        url: "http://this-is-ignored",
        tunnel: true,
        strictSSL: true,
      };
      const client = this.newClient({requestConfig});
      const conf = client.configureRequest({url: "http://site"});
      expect(conf.url).to.be.equal("http://site");
      expect(conf.tunnel).to.be.equal(requestConfig.tunnel);
      expect(conf.strictSSL).to.be.equal(requestConfig.strictSSL);
    });

    it("clears abort timeout after resolution", function() {
      var clearTimeout = sinon.spy(() => {});
      this.client._request = new MockRequest({
        responseQueue: [
          signedResponse(),
        ],
      });

      var downloadSignedFiles = sinon.spy(() => Promise.resolve({}));
      this.client.downloadSignedFiles = downloadSignedFiles;

      return this.waitForSignedAddon("/status-url/", {
        clearTimeout: clearTimeout,
        setAbortTimeout: function() {
          return "abort-timeout-id";
        },
        setStatusCheckTimeout: function() {
          return "status-check-timeout-id";
        },
      }).then(function() {
        // Assert that signing resolved successfully.
        expect(downloadSignedFiles.called).to.be.equal(true);
        // Assert that the timeout-to-abort was cleared.
        expect(clearTimeout.firstCall.args[0])
          .to.be.equal("abort-timeout-id");
      });
    });

    it("downloads signed files", function() {
      var fakeResponse = {
        on: function() {
          return this;
        },
        pipe: function() {
          return this;
        },
      };

      var fakeFileWriter = {
        on: function(event, handler) {
          if (event === "finish") {
            // Simulate completion of the download immediately when the
            // handler is registered.
            handler();
          }
        },
      };

      var files = signedResponse().responseBody.files;
      var fakeRequest = sinon.spy(() => fakeResponse);
      var createWriteStream = sinon.spy(() => fakeFileWriter);

      return this.client.downloadSignedFiles(files, {
        request: fakeRequest,
        createWriteStream: createWriteStream,
        stdout: {
          write: function() {},
        },
      }).then(function(result) {
        var filePath = path.join(process.cwd(), "some-signed-file-1.2.3.xpi");
        expect(result.success).to.be.equal(true);
        expect(result.downloadedFiles).to.be.deep.equal([filePath]);
        expect(createWriteStream.firstCall.args[0]).to.be.equal(filePath);
        expect(fakeRequest.firstCall.args[0].url)
          .to.be.equal(files[0].download_url);
      });
    });

    it("fails for 404 signed file downloads", function() {
      const fakeResponse = {
        on: function(event, handler) {
          if (event === "response") {
            // Respond with a 404 to this signed file download.
            handler({
              statusCode: 404,
              headers: {},
            });
          }
          return this;
        },
        pipe: function() {
          return this;
        },
      };

      const files = signedResponse().responseBody.files;
      const fakeRequest = sinon.spy(() => fakeResponse);
      const {createWriteStream} = getDownloadStubs();

      return this.client.downloadSignedFiles(files, {
        request: fakeRequest,
        createWriteStream,
        stdout: {
          write: function() {},
        },
      }).then(() => {
        throw new Error("Unexpected success");
      }, (error) => {
        expect(error.message).to.include("Got a 404 response when downloading");
        expect(files[0].download_url).to.not.be.undefined;
        expect(error.message).to.include(files[0].download_url);
      });
    });

    it("configures a download destination in the contructor", function() {
      let downloadDir = "/some/fake/destination-dir/";
      let client = this.newClient({downloadDir});
      let stubs = getDownloadStubs();

      return client.downloadSignedFiles(stubs.files, stubs).then(() => {
        var filePath = path.join(downloadDir, "some-signed-file-1.2.3.xpi");
        expect(stubs.createWriteStream.firstCall.args[0])
          .to.be.equal(filePath);
      });
    });

    it("fails for unsigned files", function() {
      var files = signedResponse().responseBody.files;
      files = files.map(function(fileOb) {
        // This can happen for certain invalid XPIs.
        fileOb.signed = false;
        return fileOb;
      });
      let stubs = getDownloadStubs();

      return this.client.downloadSignedFiles(files, stubs).then(function() {
        throw new Error("Unexpected success");
      }).catch(function(err) {
        expect(err.message).to.match(/no signed files were found/);
        expect(stubs.request.called).to.be.equal(false);
      });
    });

    it("allows partially signed files", function() {
      let stubs = getDownloadStubs();
      stubs.files.push({
        signed: false,
        download_url: "http://nope.org/should-not-be-downloaded.xpi",
      });

      return this.client.downloadSignedFiles(stubs.files, stubs)
        .then((result) => {
          var filePath = path.join(process.cwd(), "some-signed-file-1.2.3.xpi");
          expect(result.success).to.be.equal(true);
          expect(result.downloadedFiles).to.be.deep.equal([filePath]);
          expect(stubs.request.callCount).to.be.equal(stubs.files.length - 1);
          expect(stubs.request.firstCall.args[0].url)
            .to.be.equal(stubs.files[0].download_url);
        });
    });

    it("handles download errors", function() {
      let stubs = getDownloadStubs();

      var errorResponse = {
        on: function(event, handler) {
          if (event === "error") {
            // Immediately trigger a download error.
            handler(new Error("some download error"));
          }
        },
        pipe: function() {},
      };

      return this.client.downloadSignedFiles(stubs.files, {
        ...stubs,
        request: () => errorResponse,
      }).then(() => {
        throw new Error("Unexpected success");
      }).catch((err) => {
        expect(err.message).to.include("download error");
      });
    });
  });


  describe("debugging", function() {
    var fakeLog;

    beforeEach(function() {
      fakeLog = {
        log: sinon.spy(() => {}),
      };
    });

    it("can be configured for debug output", function() {
      var cli = new amoClient.Client({
        debugLogging: true,
        logger: fakeLog,
      });
      cli.debug("first", "second");
      expect(fakeLog.log.firstCall.args[0]).to.be.equal("[sign-addon]");
      expect(fakeLog.log.firstCall.args[1]).to.be.equal("first");
      expect(fakeLog.log.firstCall.args[2]).to.be.equal("second");
    });

    it("hides debug output by default", function() {
      var cli = new amoClient.Client({
        logger: fakeLog,
      });
      cli.debug("first", "second");
      expect(fakeLog.log.called).to.be.equal(false);
    });

    it("redacts authorization headers", function() {
      var cli = new amoClient.Client({
        debugLogging: true,
        logger: fakeLog,
      });
      cli.debug("prefix", {
        request: {
          headers: {
            Authorization: "JWT abcdeabcde...",
          },
        },
      });
      expect(fakeLog.log.firstCall.args[2].request.headers.Authorization)
        .to.be.equal("<REDACTED>");
    });

    it("redacts set-cookie headers", function() {
      var cli = new amoClient.Client({
        debugLogging: true,
        logger: fakeLog,
      });
      cli.debug("prefix", {
        response: {
          headers: {
            "set-cookie": ["foo=bar"],
          },
        },
      });
      expect(fakeLog.log.firstCall.args[2].response.headers["set-cookie"])
        .to.be.equal("<REDACTED>");
    });

    it("redacts cookie headers", function() {
      var cli = new amoClient.Client({
        debugLogging: true,
        logger: fakeLog,
      });
      cli.debug("prefix", {
        request: {
          headers: {
            cookie: ["foo=bar"],
          },
        },
      });
      expect(fakeLog.log.firstCall.args[2].request.headers.cookie)
        .to.be.equal("<REDACTED>");
    });

    it("handles null objects", function() {
      var cli = new amoClient.Client({
        debugLogging: true,
        logger: fakeLog,
      });
      // This was throwing an error because null is an object.
      cli.debug("prefix", null);
    });

    it("preserves redacted objects", function() {
      var cli = new amoClient.Client({
        debugLogging: true,
        logger: fakeLog,
      });
      var response = {
        headers: {
          "set-cookie": ["foo=bar"],
        },
      };
      cli.debug("prefix", {
        response: response,
      });
      expect(response.headers["set-cookie"]).to.be.deep.equal(["foo=bar"]);
    });

  });


  describe("requests", function() {

    beforeEach(function() {
      setUp.call(this);
    });

    it("makes requests with an auth token", function() {
      var request = {url: "/somewhere"};

      return this.client.get(request).then(() => {
        var call = this.client._request.calls[0];
        var headerMatch = call.conf.headers.Authorization.match(/JWT (.*)/);
        var token = headerMatch[1];
        var data = jwt.verify(token, this.client.apiSecret);
        expect(data.iss).to.be.equal(this.client.apiKey);
        expect(data).to.have.keys(["iss", "iat", "exp"]);

        // Check that the request was configured with all appropriate headers.
        // However, omit the Authorization header since we already verified that
        // above with jwt.verify(). More importantly, the generation of the
        // Authorization header relies on a timestamp so it's not predictable.
        const expectedConf =  this.client.configureRequest(request);
        delete expectedConf.headers.Authorization;
        delete call.conf.headers.Authorization;
        expect(call.conf).to.be.deep.equal(expectedConf);
      });
    });

    it("lets you configure the jwt expiration", function() {
      const expiresIn = 60 * 15; // 15 minutes
      const cli = this.newClient({
        apiJwtExpiresIn: expiresIn,
      });

      const fakeJwt = {
        sign: sinon.spy(() => "<JWT token>"),
      };
      cli.configureRequest({url: "/somewhere"}, {
        jwt: fakeJwt,
      });

      expect(fakeJwt.sign.called).to.be.equal(true);
      // Make sure the JWT expiration is customizable.
      expect(fakeJwt.sign.args[0][2].expiresIn).to.be.equal(expiresIn);
    });

    it("configures a default jwt expiration", function() {
      const defaultExpiry = 60 * 5; // 5 minutes
      const cli = this.newClient();

      const fakeJwt = {
        sign: sinon.spy(() => "<JWT token>"),
      };
      cli.configureRequest({url: "/somewhere"}, {
        jwt: fakeJwt,
      });

      expect(fakeJwt.sign.called).to.be.equal(true);
      expect(fakeJwt.sign.args[0][2].expiresIn).to.be.equal(defaultExpiry);
    });

    it("lets you configure a request directly", function() {
      var conf = this.client.configureRequest({url: "/path"});
      expect(conf).to.have.keys(["headers", "timeout", "url"]);
      expect(conf.headers).to.have.keys(["Accept", "Authorization"]);
    });

    it("preserves request headers", function() {
      var headers = {"X-Custom": "thing"};
      var conf = this.client.configureRequest({
        url: "/path",
        headers: headers,
      });
      expect(conf.headers["X-Custom"]).to.be.equal("thing");
    });

    it("allows you to override request headers", function() {
      var headers = {Accept: "text/html"};
      var conf = this.client.configureRequest({
        url: "/path",
        headers: headers,
      });
      expect(conf.headers.Accept).to.be.equal("text/html");
    });

    it("makes relative URLs absolute", function() {
      var urlPath = "/somewhere";
      var conf = this.client.configureRequest({url: urlPath});
      expect(conf.url).to.be.equal(this.apiUrlPrefix + urlPath);
    });

    it("accepts absolute URLs", function() {
      var absUrl = "http://some-site/somewhere";
      var conf = this.client.configureRequest({url: absUrl});
      expect(conf.url).to.be.equal(absUrl);
    });

    it("can make any HTTP request", function() {
      var requests = [];
      ["get", "put", "post", "patch", "delete"].forEach((method) => {
        var urlPath = "/some/path";

        requests.push(this.client[method]({url: urlPath}).then(() => {
          var call = this.client._request.callMap[method];
          expect(call.conf.url).to.be.equal(this.apiUrlPrefix + urlPath);
          expect(call.conf.headers).to.have.keys(["Accept", "Authorization"]);
        }));

      });
      return Promise.all(requests);
    });

    it("configures a request timeout based on JWT expiration", function() {
      // Set a custom JWT expiration:
      const expiresIn = 60 * 15; // 15 minutes
      const cli = this.newClient({
        apiJwtExpiresIn: expiresIn,
      });

      const config = cli.configureRequest({url: "/somewhere"});

      // Make sure the request is configured to timeout after the
      // JWT token times out.
      expect(config.timeout).to.be.above(expiresIn * 1000);
    });

    it("requires a URL", function() {
      expect(() => {
        this.client.configureRequest({});
      }).to.throw(Error, /URL was not specified/);
    });

    it("rejects the request promise on > 200 responses", function() {
      this.client._request = new MockRequest({httpResponse: {statusCode: 409}});
      return this.client.get({url: "/something"}).then(function() {
        throw new Error("unexpected success");
      }).catch(function(err) {
        expect(err.message).to.include("Received bad response");
      });
    });

    it("rejects the request promise on < 200 responses", function() {
      this.client._request = new MockRequest({httpResponse: {statusCode: 122}});
      return this.client.get({url: "/something"}).then(function() {
        throw new Error("unexpected success");
      }).catch(function(err) {
        expect(err.message).to.include("Received bad response");
      });
    });

    it("rejects the request promise with callback error", function() {
      var callbackError = new Error("some error");
      this.client._request = new MockRequest({responseError: callbackError});

      return this.client.get({url: "/something"}).then(function() {
        throw new Error("unexpected success");
      }).catch(function(err) {
        expect(err).to.be.equal(callbackError);
      });
    });

    it("can be configured not to throw on a bad response status", function() {
      this.client._request = new MockRequest({httpResponse: {statusCode: 409}});
      return this.client.get({
        url: "/something",
      }, {
        throwOnBadResponse: false,
      }).then(function(result) {
        expect(result[0].statusCode).to.be.equal(409);
      });
    });

    it("resolves the request promise with the HTTP response", function() {
      var httpResponse = {statusCode: 201};
      this.client._request = new MockRequest({httpResponse: httpResponse});

      return this.client.get({url: "/something"}).then((responseResult) => {
        var returnedResponse = responseResult[0];
        expect(returnedResponse).to.be.equal(httpResponse);
      });
    });

    it("resolves the request promise with the response body", function() {
      var responseBody = "some text response";
      this.client._request = new MockRequest({responseBody: responseBody});

      return this.client.get({url: "/something"}).then((responseResult) => {
        var returnedBody = responseResult[1];
        expect(returnedBody).to.be.equal(responseBody);
      });
    });

    it("resolves the request promise with a JSON object", function() {
      var data = {someKey: "some value"};

      this.client._request = new MockRequest({
        responseBody: JSON.stringify(data),
        httpResponse: {
          statusCode: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      });

      return this.client.get({url: "/something"}).then((responseResult) => {
        var result = responseResult[1];
        expect(result).to.deep.equal(data);
      });
    });

    it("ignores broken JSON responses", function() {
      this.client._request = new MockRequest({
        responseBody: "}{",  // broken JSON
        httpResponse: {
          statusCode: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      });

      return this.client.get({url: "/something"}).then((responseResult) => {
        var result = responseResult[1];
        expect(result).to.be.a("string");
      });
    });
  });
});


describe("amoClient.formatResponse", function() {

  it("should dump JSON objects", function() {
    var res = amoClient.formatResponse({error: "some error"});
    expect(res).to.be.equal("{\"error\":\"some error\"}");
  });

  it("should truncate long JSON", function() {
    var res = amoClient.formatResponse(
      {error: "pretend this is really long"},
      {maxLength: 5});
    expect(res).to.be.equal("{\"err...");
  });

  it("ignores broken JSON objects", function() {
    var stub = sinon.stub().throws();
    var res = amoClient.formatResponse(
      {unserializable: process}, // any complex object
      {_stringifyToJson: stub}
    );
    expect(res).to.be.equal("[object Object]");
  });

  it("should truncate long HTML", function() {
    var res = amoClient.formatResponse(
      "<h1>pretend this is really long</h1>",
      {maxLength: 9});
    expect(res).to.be.equal("<h1>prete...");
  });

  it("should leave short HTML in tact", function() {
    var text = "<h1>404 or whatever</h1>";
    var res = amoClient.formatResponse(text);
    expect(res).to.be.equal(text);
  });

});


describe("amoClient.getUrlBasename", function() {

  it("gets a basename", function() {
    var base = amoClient.getUrlBasename("http://foo.com/bar.zip");
    expect(base).to.be.equal("bar.zip");
  });

  it("strips the query string", function() {
    var base = amoClient.getUrlBasename("http://foo.com/bar.zip?baz=quz");
    expect(base).to.be.equal("bar.zip");
  });

});


describe("amoClient.PseudoProgress", function() {

  beforeEach(function() {
    this.setIntervalMock = sinon.spy(() => "interval-id");
    this.clearIntervalMock = sinon.spy(() => {});

    this.progress = new amoClient.PseudoProgress({
      setInterval: this.setIntervalMock,
      clearInterval: this.clearIntervalMock,
      stdout: {
        columns: 80,
        isTTY: true,
        write: function() {},
      },
    });
  });

  it("should set an interval", function() {
    this.progress.animate();
    expect(this.setIntervalMock.called).to.be.equal(true);
  });

  it("should clear an interval", function() {
    this.progress.animate();
    expect(this.setIntervalMock.called).to.be.equal(true);
    this.progress.finish();
    expect(this.clearIntervalMock.firstCall.args[0])
      .to.be.equal("interval-id");
  });
});


class MockProgress {
  animate() {}
  finish() {}
}


class MockRequest {

  constructor(conf) {
    var defaultResponse = {
      httpResponse: {statusCode: 200},
      responseBody: "",
      responseError: null,
    };
    conf = {
      // By default, responses will not be queued.
      // I.E. the same response will be returned repeatedly.
      responseQueue: false,
      ...conf,
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
      this.responseQueue[i] = {...defaultResponse, ...response};
    });

    this.calls = [];
    this.callMap = {};
    this.httpResponse = conf.httpResponse;
    this.responseBody = conf.responseBody;
    this.responseError = conf.responseError;
  }

  _mockRequest(method, conf, callback) {
    var info = {conf: conf};
    this.calls.push({...info, name: method});
    this.callMap[method] = info;

    var response;
    if (this.returnMultipleResponses) {
      response = this.responseQueue.shift();
    } else {
      // Always return the same response.
      response = this.responseQueue[0];
    }
    if (!response) {
      response = {};
      response.responseError = new Error("Response queue is empty");
    }

    callback(
      response.responseError,
      response.httpResponse,
      response.responseBody
    );
  }

  get(conf, callback) {
    return this._mockRequest("get", conf, callback);
  }

  post(conf, callback) {
    return this._mockRequest("post", conf, callback);
  }

  put(conf, callback) {
    return this._mockRequest("put", conf, callback);
  }

  patch(conf, callback) {
    return this._mockRequest("patch", conf, callback);
  }

  delete(conf, callback) {
    return this._mockRequest("delete", conf, callback);
  }
}
