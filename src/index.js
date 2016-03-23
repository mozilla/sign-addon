import fs from "mz/fs";
import when from "when";

import {Client as DefaultAMOClient} from "./amo-client";

const logger = console;


export default function signAddon(
  {
    // Absolute path to add-on XPI file.
    xpiPath,
    // The add-on ID as recognized by AMO. Example: my-addon@jetpack
    id,
    // The add-on version number for AMO.
    version,
    // Your API key (JWT issuer) from AMO Devhub.
    apiKey,
    // Your API secret (JWT secret) from AMO Devhub.
    apiSecret,
    // Optional arguments:
    apiUrlPrefix="https://addons.mozilla.org/api/v3",
    verbose=false,
    // Number of milleseconds to wait before giving up on a
    // response from Mozilla's web service.
    timeout=undefined,
  },
  {
    AMOClient=DefaultAMOClient,
  }) {

  return when.promise(
    (resolve) => {

      function reportEmpty(name) {
        throw new Error(`required argument was empty: ${name}`);
      }

      if (!xpiPath) {
        reportEmpty("xpiPath");
      }
      if (!id) {
        reportEmpty("id");
      }
      if (!version) {
        reportEmpty("version");
      }
      if (!apiSecret) {
        reportEmpty("apiSecret");
      }
      if (!apiKey) {
        reportEmpty("apiKey");
      }

      resolve();
    })
    .then(() => fs.stat(xpiPath))
    .catch((statError) => {
      throw new Error(`error with ${xpiPath}: ${statError}`);
    })
    .then((stats) => {
      if (!stats.isFile) {
        throw new Error(`not a file: ${xpiPath}`);
      }
    })
    .then(() => {

      let client = new AMOClient({
        apiKey: apiKey,
        apiSecret: apiSecret,
        apiUrlPrefix: apiUrlPrefix,
        debugLogging: verbose,
        signedStatusCheckTimeout: timeout,
      });

      return client.sign({
        xpiPath: xpiPath,
        guid: id,
        version: version,
      });

    });
}


export function signAddonAndExit(options, config) {
  config = {
    systemProcess: process,
    throwError: false,
    ...config,
  };
  return signAddon(options, config)
    .then(function(result) {
      logger.log(result.success ? "SUCCESS" : "FAIL");
      config.systemProcess.exit(result.success ? 0 : 1);
    })
    .catch(function(err) {
      logger.error("FAIL");
      if (config.throwError) {
        throw err;
      }
      logger.error(err.stack);
      config.systemProcess.exit(1);
    });
}
