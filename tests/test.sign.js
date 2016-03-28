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
      AMOClient: options.StubAMOClient,
      ...options.cmdOptions,
    };

    var cmdConfig = {
      systemProcess: mockProcess,
      throwError: options.throwError,
    };

    return signAddonAndExit(cmdOptions, cmdConfig);
  }

  it("should exit 0 on signing success", () => {
    return runSignCmd({throwError: false}).then(function() {
      expect(signingCall.called).to.be.equal(true);
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(0);
    });
  });

  it("passes id/version to the signer", () => {
    return runSignCmd({
      cmdOptions: {
        id: "@simple-addon",
        version: "1.0.0",
      },
    }).then(function() {
      expect(signingCall.called).to.be.equal(true);
      expect(signingCall.firstCall.args[0].version).to.be.equal("1.0.0");
      expect(signingCall.firstCall.args[0].guid)
        .to.be.equal("@simple-addon");
    });
  });

  it("throws an error for XPI file errors", () => {
    return runSignCmd({
      throwError: false,
      cmdOptions: {
        xpiPath: "/not/a/real/path.xpi",
      },
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
    });
  });

  it("can turn on debug logging", () => {
    runSignCmd({
      cmdOptions: {
        verbose: true,
      },
    }).then(function() {
      expect(fakeClientContructor.firstCall.args[0].debugLogging)
        .to.be.equal(true);
    });
  });

  it("can configure polling timeouts", () => {
    return runSignCmd({
      cmdOptions: {
        timeout: 5000,
      },
    }).then(function() {
      expect(fakeClientContructor.called).to.be.equal(true);
      expect(fakeClientContructor.firstCall.args[0].signedStatusCheckTimeout)
        .to.be.equal(5000);
    });
  });

  it("can configure a download destination", () => {
    return runSignCmd({
      cmdOptions: {
        downloadDir: "/some/fake/download-destination",
      },
    }).then(function() {
      expect(fakeClientContructor.called).to.be.equal(true);
      expect(fakeClientContructor.firstCall.args[0].downloadDir)
        .to.be.equal("/some/fake/download-destination");
    });
  });

  it("passes custom XPI to the signer", () => {
    let xpiPath = path.join(fixturePath, "simple-addon.xpi");
    return runSignCmd({
      cmdOptions: {
        id: "some-id",
        version: "0.0.1",
        xpiPath: xpiPath,
      },
    }).then(function() {
      expect(signingCall.called).to.be.equal(true);
      expect(signingCall.firstCall.args[0].xpiPath).to.be.equal(xpiPath);
    });
  });

  it("should exit 1 on signing failure", () => {
    return runSignCmd({
      throwError: false,
      StubAMOClient: makeAMOClientStub({
        result: {success: false},
      }),
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
    });
  });

  it("should exit 1 on exception", () => {
    return runSignCmd({
      StubAMOClient: makeAMOClientStub({
        errorToThrow: new Error("some signing error"),
      }),
      throwError: false,
    }).then(function() {
      expect(mockProcessExit.firstCall.args[0]).to.be.equal(1);
    });
  });

  it("should throw error when id is empty", () => {
    return runSignCmd({
      cmdOptions: {
        id: null,
        version: "0.0.1",
      },
    }).then(() => {
      throw new Error("unexpected success");
    }).catch((error) => {
      expect(error.message).to.match(/argument was empty: id/);
    });
  });

  it("should throw error when version is empty", () => {
    return runSignCmd({
      cmdOptions: {
        id: "some-addon@somewhere",
        version: null,
      },
    }).then(() => {
      throw new Error("unexpected success");
    }).catch((error) => {
      expect(error.message).to.match(/argument was empty: version/);
    });
  });

  it("should throw error when xpiPath is empty", () => {
    return runSignCmd({
      cmdOptions: {
        xpiPath: null,
      },
    }).then(() => {
      throw new Error("unexpected success");
    }).catch((error) => {
      expect(error.message).to.match(/argument was empty: xpiPath/);
    });
  });

  it("should throw error when apiKey is empty", () => {
    return runSignCmd({
      cmdOptions: {
        apiKey: null,
      },
    }).then(() => {
      throw new Error("unexpected success");
    }).catch((error) => {
      expect(error.message).to.match(/argument was empty: apiKey/);
    });
  });

  it("should throw error when apiSecret is empty", () => {
    return runSignCmd({
      cmdOptions: {
        apiSecret: null,
      },
    }).then(() => {
      throw new Error("unexpected success");
    }).catch((error) => {
      expect(error.message).to.match(/argument was empty: apiSecret/);
    });
  });

});
