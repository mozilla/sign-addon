import {beforeEach, describe, it} from "mocha";
import path from "path";
import {expect} from "chai";
import sinon from "sinon";
import when from "when";

import {signAddonAndExit} from "../src";

const testDir = path.resolve(__dirname);
const fixturePath = path.join(testDir, "fixtures");


describe("sign", function() {
  var mockProcessExit;
  var mockProcess;
  var signingCall;
  var fakeClientContructor;

  beforeEach(function() {
    signingCall = null;
    mockProcessExit = sinon.spy(() => {});
    mockProcess = {
      exit: mockProcessExit,
    };
    fakeClientContructor = sinon.spy(() => {});
  });

  function makeAMOClientStub(options) {
    options = {
      errorToThrow: null,
      result: {success: true},
      ...options,
    };

    function FakeAMOClient() {
      var constructor = fakeClientContructor;
      constructor.apply(constructor, arguments);
      this.debug = function() {};
    }

    signingCall = sinon.spy(() => when.promise((resolve) => {
      if (options.errorToThrow) {
        throw options.errorToThrow;
      }
      resolve(options.result);
    }));
    FakeAMOClient.prototype.sign = signingCall;

    return FakeAMOClient;
  }

  function runSignCmd(options) {
    options = {
      throwError: true,
      StubAMOClient: makeAMOClientStub(),
      cmdOptions: {},
      ...options,
    };

    var cmdOptions = {
      apiKey: "some-key",
      apiSecret: "some-secret",
      id: "some-addon@somewhere",
      xpiPath: path.join(fixturePath, "simple-addon.xpi"),
      version: "0.0.1",
      verbose: false,
      ...options.cmdOptions,
    };

    var cmdConfig = {
      systemProcess: mockProcess,
      throwError: options.throwError,
      AMOClient: options.StubAMOClient,
    };

    return signAddonAndExit(cmdOptions, cmdConfig);
  }

  it("should exit 0 on signing success", function(done) {
    runSignCmd({throwError: false}).then(function() {
      expect(signingCall.called).to.be.equal(true);
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(0);
      done();
    }).catch(done);
  });

  it("passes id/version to the signer", function(done) {
    runSignCmd({
      cmdOptions: {
        id: "@simple-addon",
        version: "1.0.0",
      },
    }).then(function() {
      expect(signingCall.called).to.be.equal(true);
      expect(signingCall.firstCall.args[0].version).to.be.equal("1.0.0");
      expect(signingCall.firstCall.args[0].guid)
        .to.be.equal("@simple-addon");
      done();
    }).catch(done);
  });

  it("throws an error for XPI file errors", function(done) {
    runSignCmd({
      throwError: false,
      cmdOptions: {
        xpiPath: "/not/a/real/path.xpi",
      },
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
      done();
    }).catch(done);
  });

  it("can turn on debug logging", function(done) {
    runSignCmd({
      cmdOptions: {
        verbose: true,
      },
    }).then(function() {
      expect(fakeClientContructor.firstCall.args[0].debugLogging)
        .to.be.equal(true);
      done();
    }).catch(done);
  });

  it("can configure polling timeouts", function(done) {
    runSignCmd({
      cmdOptions: {
        timeout: 5000,
      },
    }).then(function() {
      expect(fakeClientContructor.called).to.be.equal(true);
      expect(fakeClientContructor.firstCall.args[0].signedStatusCheckTimeout)
        .to.be.equal(5000);
      done();
    }).catch(done);
  });

  it("passes custom XPI to the signer", function(done) {
    let xpiPath = path.join(fixturePath, "simple-addon.xpi");
    runSignCmd({
      cmdOptions: {
        id: "some-id",
        version: "0.0.1",
        xpiPath: xpiPath,
      },
    }).then(function() {
      expect(signingCall.called).to.be.equal(true);
      expect(signingCall.firstCall.args[0].xpiPath).to.be.equal(xpiPath);
      done();
    }).catch(done);
  });

  it("should exit 1 on signing failure", function(done) {
    runSignCmd({
      throwError: false,
      StubAMOClient: makeAMOClientStub({
        result: {success: false},
      }),
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
      done();
    }).catch(done);
  });

  it("exits 1 when id/version cannot be detected", function(done) {
    runSignCmd({
      cmdOptions: {
        id: null,
        version: null,
      },
      throwError: false,
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
      done();
    }).catch(done);
  });

  it("should exit 1 on exception", function(done) {
    runSignCmd({
      StubAMOClient: makeAMOClientStub({
        errorToThrow: new Error("some signing error"),
      }),
      throwError: false,
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
      done();
    }).catch(done);
  });

  it("should exit early for missing --api-key", function(done) {
    runSignCmd({
      cmdOptions: {
        apiKey: null,
        apiSecret: "secret",
      },
      throwError: false,
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
      expect(signingCall.called).to.be.equal(false);
      done();
    }).catch(done);
  });

  it("should exit early for missing --api-secret", function(done) {
    runSignCmd({
      cmdOptions: {
        apiKey: "some-key",
        apiSecret: null,
      },
      throwError: false,
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
      expect(signingCall.called).to.be.equal(false);
      done();
    }).catch(done);
  });
});
