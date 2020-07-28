import { fs } from 'mz';

import { Client as DefaultAMOClient } from './amo-client';

/** @typedef {import("request").OptionsWithUrl} RequestConfig */
/** @typedef {import("./amo-client").ClientParams} ClientParams */
/** @typedef {import("./amo-client").ReleaseChannel} ReleaseChannel */

/**
 * @typedef {object} SignAddonParams
 * @property {string} xpiPath
 * @property {string} id
 * @property {string} version
 * @property {ClientParams['apiKey']} apiKey
 * @property {ClientParams['apiSecret']} apiSecret
 * @property {ClientParams['apiUrlPrefix']=} apiUrlPrefix
 * @property {ClientParams['apiJwtExpiresIn']=} apiJwtExpiresIn
 * @property {ClientParams['debugLogging']=} verbose
 * @property {ReleaseChannel=} channel
 * @property {ClientParams['statusCheckTimeout']=} timeout
 * @property {ClientParams['downloadDir']=} downloadDir
 * @property {ClientParams['proxyServer']=} apiProxy
 * @property {ClientParams['requestConfig']=} apiRequestConfig
 * @property {typeof DefaultAMOClient=} AMOClient
 *
 * @param {SignAddonParams} params
 */
const signAddon = async ({
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
  apiUrlPrefix = 'https://addons.mozilla.org/api/v4',
  // Number of seconds until the JWT token for the API request expires.
  // This must match the expiration time that the API server accepts.
  apiJwtExpiresIn,
  verbose = false,
  // The release channel (listed or unlisted).
  // Ignored for new add-ons, which are always unlisted.
  // Defaults to most recently used channel.
  channel,
  // Number of milliseconds to wait before giving up on a
  // response from Mozilla's web service.
  timeout,
  // Absolute directory to save downloaded files in.
  downloadDir,
  // Optional proxy to use for all API requests,
  // such as "http://yourproxy:6000"
  apiProxy,
  // Optional object to pass into request() for additional configuration.
  // Not all properties are guaranteed to be applied.
  apiRequestConfig,
  AMOClient = DefaultAMOClient,
}) => {
  /**
   * @param {string} name
   */
  function reportEmpty(name) {
    throw new Error(`required argument was empty: ${name}`);
  }

  if (!xpiPath) {
    reportEmpty('xpiPath');
  }

  if (!version) {
    reportEmpty('version');
  }

  if (!apiSecret) {
    reportEmpty('apiSecret');
  }

  if (!apiKey) {
    reportEmpty('apiKey');
  }

  try {
    const stats = await fs.stat(xpiPath);

    if (!stats.isFile) {
      throw new Error(`not a file: ${xpiPath}`);
    }
  } catch (statError) {
    throw new Error(`error with ${xpiPath}: ${statError}`);
  }

  const client = new AMOClient({
    apiKey,
    apiSecret,
    apiUrlPrefix,
    apiJwtExpiresIn,
    downloadDir,
    debugLogging: verbose,
    statusCheckTimeout: timeout,
    proxyServer: apiProxy,
    requestConfig: apiRequestConfig,
  });

  return client.sign({
    xpiPath,
    guid: id,
    version,
    channel,
  });
};

/**
 * @param {SignAddonParams} options
 * @param {{
 *   systemProcess?: typeof process,
 *   throwError?: boolean,
 *   logger?: typeof console
 * }} extras
 * @returns {Promise<void>}
 */
export const signAddonAndExit = async (
  options,
  { systemProcess = process, throwError = false, logger = console },
) => {
  try {
    const result = await signAddon(options);
    logger.log(result.success ? 'SUCCESS' : 'FAIL');
    systemProcess.exit(result.success ? 0 : 1);
  } catch (err) {
    logger.error('FAIL');

    if (throwError) {
      throw err;
    }

    logger.error(err.stack);
    systemProcess.exit(1);
  }
};

export default { signAddon, signAddonAndExit };
