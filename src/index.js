import _ from "lodash";
import fs from "mz/fs";
import when from "when";

import {Client as DefaultAMOClient} from "./amo-client";

const logger = console;
const AMO_API_PREFIX = "https://addons.mozilla.org/api/v3";


export default function signAddon(options, config) {
  config = _.assign({
    AMOClient: DefaultAMOClient,
  }, config);

  options = _.assign({
    // The add-on ID as recognized by AMO. Example: my-addon@jetpack
    id: null,
    // The add-on version number for AMO.
    version: null,
    apiUrlPrefix: AMO_API_PREFIX,
    verbose: false,
  }, options);

  return when.promise(
    (resolve) => {
      var toCheck = [
        "apiKey",
        "apiSecret",
        "id",
        "version",
        "xpiPath",
      ];

      for (let opt of toCheck) {
        if (!options[opt]) {
          throw new Error(`missing required option ${opt}`);
        }
      }

      resolve();
    })
    .then(() => fs.stat(options.xpiPath))
    .catch((statError) => {
      throw new Error(`error with ${options.xpiPath}: ${statError}`);
    })
    .then((stats) => {
      if (!stats.isFile) {
        throw new Error(`not a file: ${options.xpiPath}`);
      }
    })
    .then(() => {

      var client = new config.AMOClient({
        apiKey: options.apiKey,
        apiSecret: options.apiSecret,
        apiUrlPrefix: options.apiUrlPrefix,
        debugLogging: options.verbose,
        signedStatusCheckTimeout: options.timeout || undefined,
      });

      return client.sign({
        xpiPath: options.xpiPath,
        guid: options.id,
        version: options.version,
      });

    });
}


export function signAddonAndExit(options, config) {
  config = _.assign({
    systemProcess: process,
    throwError: false,
  }, config);
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
      console.error(err.stack);
      config.systemProcess.exit(1);
    });
}
