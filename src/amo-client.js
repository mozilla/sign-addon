/* eslint max-classes-per-file: 0 */
import defaultFs from 'fs';
import url from 'url';
import path from 'path';

import deepcopy from 'deepcopy';
import defaultJwt from 'jsonwebtoken';
import defaultRequest from 'request';
import { oneLine } from 'common-tags';

import PseudoProgress from './PseudoProgress';

/** @typedef {import("request").OptionsWithUrl} RequestConfig */

/** @typedef {import("request").Response} Response */

/**
 * @typedef {"listed" | "unlisted"} ReleaseChannel
 */

/**
 * See: https://addons-server.readthedocs.io/en/latest/topics/api/signing.html#checking-the-status-of-your-upload
 *
 * @typedef {{
 *   guid: string,
 *   active: boolean,
 *   automated_signing: boolean,
 *   files: File[],
 *   passed_review: boolean,
 *   pk: string,
 *   processed: boolean,
 *   reviewed: boolean,
 *   url: string,
 *   valid: boolean,
 *   validation_results: object,
 *   validation_url: string,
 *   version: string,
 * }} SigningStatus
 */

/**
 * @typedef {object} ClientParams
 * @property {string} apiKey - API key string from the Developer Hub
 * @property {string} apiSecret - API secret string from the Developer Hub
 * @property {string} apiUrlPrefix - API URL prefix, including any leading paths
 * @property {number=} apiJwtExpiresIn - Number of seconds until the JWT token for the API request expires. This must match the expiration time that the API server accepts
 * @property {boolean=} debugLogging - When true, log more information
 * @property {number=} statusCheckInterval - A period in millesconds between checks when waiting on add-on status
 * @property {number=} statusCheckTimeout -  A length in millesconds to give up if the add-on hasn't been validated and signed
 * @property {typeof console=} logger
 * @property {string=} downloadDir - Absolute path to save downloaded files to. The working directory will be used by default
 * @property {typeof defaultFs=} fs
 * @property {typeof defaultRequest=} request
 * @property {string=} proxyServer - Optional proxy server to use for all requests, such as "http://yourproxy:6000"
 * @property {RequestConfig=} requestConfig - Optional configuration object to pass to request(). Not all parameters are guaranteed to be applied
 * @property {PseudoProgress=} progressBar
 */

/**
 * @typedef {object} SignParams
 * @property {string=} guid - optional add-on GUID (ID in install.rdf)
 * @property {string} version - add-on version string
 * @property {ReleaseChannel=} channel - release channel (listed or unlisted)
 * @property {string} xpiPath - path to xpi file
 */

/**
 * @typedef {("SERVER_FAILURE"|"ADDON_NOT_AUTO_SIGNED"|"VALIDATION_FAILED")} SignErrorCode
 */

/**
 * @typedef {{
 *   success: boolean,
 *   id: string | null,
 *   downloadedFiles: string[] | null,
 *   errorCode: SignErrorCode | null,
 *   errorDetails: string | null
 * }} SignResult
 */

/**
 * Returns a nicely formatted HTTP response.
 * This makes the response suitable for logging.
 *
 * @param {string|object} response - either the response's body or an object representing a JSON API response.
 * @param {object=} overrides
 * @returns {string}
 */
export function formatResponse(response, overrides = {}) {
  const options = {
    _stringifyToJson: JSON.stringify,
    maxLength: 500,
    ...overrides,
  };
  let prettyResponse = response;
  const stringify = options._stringifyToJson || JSON.stringify;
  if (typeof prettyResponse === 'object') {
    try {
      prettyResponse = stringify(prettyResponse);
    } catch (e) {
      //
    }
  }
  if (typeof prettyResponse === 'string') {
    if (prettyResponse.length > options.maxLength) {
      prettyResponse = `${prettyResponse.substring(0, options.maxLength)}...`;
    }
  }
  return prettyResponse.toString();
}

/**
 * Returns the basename of a URL, suitable for saving to disk.
 *
 * @param {string} absUrl
 * @returns {string}
 */
export function getUrlBasename(absUrl) {
  // TODO: `url.parse()` might return `undefined` so we need to check that first.
  // @ts-ignore
  const urlPath = path.basename(url.parse(absUrl).path);
  const parts = urlPath.split('?');

  return parts[0];
}
/**
 * addons.mozilla.org API client.
 */
export class Client {
  /**
   * Type for `this.request()`.
   *
   * @typedef {object} RequestMethodOptions
   * @property {boolean=} throwOnBadResponse - if true, an error will be thrown when response status is not 2xx
   */

  /**
   * Type for `this.request()`.
   *
   * @typedef {Promise<[Response, SigningStatus]>} RequestMethodReturnValue
   */

  /**
   * See: https://addons-server.readthedocs.io/en/latest/topics/api/signing.html#get--api-v4-addons-(string-guid)-versions-(string-version)-[uploads-(string-upload-pk)-]
   *
   * @typedef {{ signed: boolean, download_url: string, hash: string }} File
   */

  /**
   * @param {ClientParams} params
   */
  constructor({
    apiKey,
    apiSecret,
    apiUrlPrefix,
    // TODO: put this back to something sane after we
    // address the file upload issue on AMO:
    // https://github.com/mozilla/addons-server/issues/3688
    apiJwtExpiresIn = 60 * 5, // 5 minutes
    debugLogging = false,
    statusCheckInterval = 1000,
    statusCheckTimeout = 900000, // 15 minutes.
    logger = console,
    downloadDir = process.cwd(),
    fs = defaultFs,
    request = defaultRequest,
    proxyServer,
    requestConfig,
    progressBar,
  }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.apiUrlPrefix = apiUrlPrefix; // default set in CLI options.
    this.apiJwtExpiresIn = apiJwtExpiresIn;
    this.statusCheckInterval = statusCheckInterval;
    this.statusCheckTimeout = statusCheckTimeout;
    this.debugLogging = debugLogging;
    this.logger = logger;
    this.downloadDir = downloadDir;
    this.proxyServer = proxyServer;
    this.requestConfig = requestConfig || {};

    // Set up external dependencies, allowing for overrides.
    this._progressBar =
      progressBar ||
      new PseudoProgress({
        preamble: 'Validating add-on',
      });
    this._fs = fs;
    this._request = request;
  }

  /**
   * Sign a new version of your add-on at addons.mozilla.org.
   *
   * @param {SignParams} signParams
   * @returns {Promise<SignResult>}
   */
  sign({ guid, version, channel, xpiPath }) {
    /**
     * @type {{
     *   upload: defaultFs.ReadStream;
     *   channel?: string;
     *   version?: string;
     * }}
     */
    const formData = {
      upload: this._fs.createReadStream(xpiPath),
    };
    let addonUrl = '/addons/';
    let httpMethod = this.put;
    if (guid) {
      // PUT to a specific URL for this add-on + version.
      addonUrl += `${encodeURIComponent(guid)}/versions/${encodeURIComponent(
        version,
      )}/`;
      if (channel) {
        formData.channel = channel;
      }
    } else {
      // POST to a generic URL to create a new add-on.
      this.debug('Signing add-on without an ID');
      httpMethod = this.post;
      formData.version = version;
      if (channel) {
        this.logger.warn(
          'Specifying a channel for a new add-on is unsupported. ' +
            'New add-ons are always in the unlisted channel.',
        );
      }
    }

    return httpMethod
      .bind(this)(
        {
          url: addonUrl,
          formData,
        },
        {
          throwOnBadResponse: false,
        },
      )
      .then(
        /**
         * @param {[
         *   Response,
         *   { error?: string, headers?: {[name: string]: string}, url: string }
         * ]} requestValue
         * @returns {Promise<SignResult>} result
         */
        ([httpResponse, body]) => {
          const response = body;

          const acceptableStatuses = [200, 201, 202];
          const receivedError = !!response.error;
          if (
            acceptableStatuses.indexOf(httpResponse.statusCode) === -1 ||
            receivedError
          ) {
            if (response.error) {
              this.logger.error(
                `Server response: ${response.error}`,
                `(status: ${httpResponse.statusCode})`,
              );
              return Promise.resolve({
                success: false,
                id: null,
                downloadedFiles: null,
                errorCode: 'SERVER_FAILURE',
                errorDetails: response.error,
              });
            }

            throw new Error(
              `Received bad response from the server while requesting ${this.absoluteURL(
                addonUrl,
              )}\n\n` +
                `status: ${httpResponse.statusCode}\n` +
                `response: ${formatResponse(response)}\n` +
                `headers: ${JSON.stringify(httpResponse.headers || {})}\n`,
            );
          }

          return this.waitForSignedAddon(response.url);
        },
      );
  }

  /**
   * Poll a status URL, waiting for the queued add-on to be signed.
   *
   * @typedef {object} WaitForSignedAddonParams
   * @property {typeof clearTimeout=} _clearTimeout
   * @property {typeof setTimeout=} _setAbortTimeout
   * @property {typeof setTimeout=} _setStatusCheckTimeout
   *
   * @param {string} statusUrl - URL to GET for add-on status
   * @param {WaitForSignedAddonParams} options
   * @returns {Promise<SignResult>}
   */
  waitForSignedAddon(
    statusUrl,
    {
      _clearTimeout = clearTimeout,
      _setAbortTimeout = setTimeout,
      _setStatusCheckTimeout = setTimeout,
    } = {},
  ) {
    /** @type {SigningStatus=} */
    let lastStatus;

    return new Promise((resolve, reject) => {
      /** @type {NodeJS.Timer} */
      let statusCheckTimeout;

      /** @type {NodeJS.Timer} */
      const abortTimeout = _setAbortTimeout(() => {
        this._progressBar.finish();
        _clearTimeout(statusCheckTimeout);

        reject(
          new Error(oneLine`Signing took too long to complete; last status:
            ${formatResponse(lastStatus || '[null]')}`),
        );
      }, this.statusCheckTimeout);

      // This function polls the API until the add-on is signed or requires
      // manual review. If the add-on is signed, we download the signed files.
      //
      // This function resolves the main `Promise` in both cases.
      const checkSignedStatus = async () => {
        try {
          const [
            // eslint-disable-next-line no-unused-vars
            httpResponse,
            status,
          ] = await this.get({ url: statusUrl });
          lastStatus = status;

          const canBeAutoSigned = status.automated_signing;
          // The add-on passed validation and all files have been created. There
          // are many checks for this state because the data will be updated
          // incrementally by the API server.
          const signedAndReady =
            status.valid &&
            status.active &&
            status.reviewed &&
            status.files &&
            status.files.length > 0;
          // The add-on is valid but requires a manual review before it can be
          // signed.
          const requiresManualReview = status.valid && !canBeAutoSigned;

          if (signedAndReady || requiresManualReview) {
            this._progressBar.finish();
            _clearTimeout(abortTimeout);

            if (requiresManualReview) {
              this.logger.log(oneLine`Your add-on has been submitted for review.
              It passed validation but could not be automatically signed
              because this is a listed add-on.`);

              resolve({
                success: false,
                id: null,
                downloadedFiles: null,
                errorCode: 'ADDON_NOT_AUTO_SIGNED',
                errorDetails: null,
              });
              return;
            }

            if (signedAndReady) {
              // TODO: show some validation warnings if there are any. We should
              // show things like "missing update URL in manifest"
              const result = await this.downloadSignedFiles(status.files);
              resolve({ ...result, id: status.guid });
            }
          } else {
            // The add-on has not been fully processed yet.
            statusCheckTimeout = _setStatusCheckTimeout(
              checkSignedStatus,
              this.statusCheckInterval,
            );
          }
        } catch (err) {
          _clearTimeout(abortTimeout);
          reject(err);
        }
      };

      // This function polls the API until the add-on is processed/validated.
      // This function only rejects when the add-on is not valid. When the
      // add-on is valid, we call `checkSignedStatus()`.
      const checkValidationStatus = async () => {
        try {
          const [
            // eslint-disable-next-line no-unused-vars
            httpResponse,
            status,
          ] = await this.get({ url: statusUrl });
          lastStatus = status;

          if (status.processed) {
            this._progressBar.finish();
            this.logger.log('Validation results:', status.validation_url);
            // Update pseudo progress preamble for the signing step.
            this._progressBar.setPreamble('Signing add-on');
            this._progressBar.animate();

            if (status.valid) {
              checkSignedStatus();
            } else {
              this.logger.log(
                'Your add-on failed validation and could not be signed',
              );

              _clearTimeout(abortTimeout);

              resolve({
                success: false,
                id: null,
                downloadedFiles: null,
                errorCode: 'VALIDATION_FAILED',
                errorDetails: status.validation_url,
              });
            }
          } else {
            // Validation is not completed yet.
            statusCheckTimeout = _setStatusCheckTimeout(
              checkValidationStatus,
              this.statusCheckInterval,
            );
          }
        } catch (err) {
          _clearTimeout(abortTimeout);
          reject(err);
        }
      };

      // Goooo
      this._progressBar.animate();
      checkValidationStatus();
    });
  }

  /**
   * Download the signed files.
   *
   * @param {File[]} signedFiles - Array of file objects returned from the API.
   * @param {{
   *   createWriteStream?: typeof defaultFs.createWriteStream,
   *   request?: typeof defaultRequest,
   *   stdout?: typeof process.stdout
   * }} options
   * @returns {Promise<SignResult>}
   */
  async downloadSignedFiles(
    signedFiles,
    {
      createWriteStream = defaultFs.createWriteStream,
      request = this._request,
      stdout = process.stdout,
    } = {},
  ) {
    /** @type {Promise<string>[]} */
    const allDownloads = [];
    /** @type {null | number} */
    let dataExpected = null;
    let dataReceived = 0;

    function showProgress() {
      let progress = '...';
      if (dataExpected !== null) {
        const amount = ((dataReceived / dataExpected) * 100).toFixed();
        // Pad the percentage amount so that the line length is consistent.
        // This should do something like '  0%', ' 25%', '100%'
        let padding = '';
        try {
          padding = Array(4 - amount.length).join(' ');
        } catch (e) {
          // Ignore Invalid array length and such.
        }
        progress = `${padding + amount}% `;
      }
      stdout.write(`\rDownloading signed files: ${progress}`);
    }

    /**
     * @param {string} fileUrl
     * @returns {Promise<string>}
     */
    const download = (fileUrl) => {
      return new Promise((resolve, reject) => {
        // The API will give us a signed file named in a sane way.
        const fileName = path.join(this.downloadDir, getUrlBasename(fileUrl));
        const out = createWriteStream(fileName);

        request(
          this.configureRequest({
            method: 'GET',
            url: fileUrl,
            followRedirect: true,
          }),
        )
          .on('error', reject)
          .on(
            'response',
            /**
             * @param {Response} response
             * @returns {void}
             */
            (response) => {
              if (response.statusCode < 200 || response.statusCode >= 300) {
                throw new Error(
                  `Got a ${response.statusCode} response ` +
                    `when downloading ${fileUrl}`,
                );
              }
              const contentLength = response.headers['content-length'];
              if (contentLength) {
                if (dataExpected !== null) {
                  dataExpected += parseInt(contentLength, 10);
                } else {
                  dataExpected = parseInt(contentLength, 10);
                }
              }
            },
          )
          .on(
            'data',
            /**
             * @param {string} chunk
             * @returns {void}
             */
            (chunk) => {
              dataReceived += chunk.length;
              showProgress();
            },
          )
          .pipe(out)
          .on('error', reject);

        out.on('finish', function () {
          stdout.write('\n'); // end the progress output
          resolve(fileName);
        });
      });
    };

    let foundUnsignedFiles = false;
    signedFiles.forEach((file) => {
      if (file.signed) {
        allDownloads.push(download(file.download_url));
      } else {
        this.debug('This file was not signed:', file);

        foundUnsignedFiles = true;
      }
    });

    let downloadedFiles;
    if (allDownloads.length) {
      if (foundUnsignedFiles) {
        this.logger.log(oneLine`Some files were not signed. Re-run with
        --verbose for details.`);
      }

      showProgress();

      downloadedFiles = await Promise.all(allDownloads);
    } else {
      throw new Error(oneLine`The XPI was processed but no signed files were
      found. Check your manifest and make sure it targets Firefox as an
      application.`);
    }

    this.logger.log('Downloaded:');
    downloadedFiles.forEach((fileName) => {
      this.logger.log(`    ${fileName.replace(process.cwd(), '.')}`);
    });

    return {
      success: true,
      id: null,
      downloadedFiles,
      errorCode: null,
      errorDetails: null,
    };
  }

  /**
   * Make a GET request.
   *
   * @param {RequestConfig} requestConf
   * @param {RequestMethodOptions=} options
   * @returns {RequestMethodReturnValue}
   */
  get(requestConf, options) {
    return this.request('get', requestConf, options);
  }

  /**
   * Make a POST request.
   *
   * @param {RequestConfig} requestConf
   * @param {RequestMethodOptions=} options
   * @returns {RequestMethodReturnValue}
   */
  post(requestConf, options) {
    return this.request('post', requestConf, options);
  }

  /**
   * Make a PUT request.
   *
   * @param {RequestConfig} requestConf
   * @param {RequestMethodOptions=} options
   * @returns {RequestMethodReturnValue}
   */
  put(requestConf, options) {
    return this.request('put', requestConf, options);
  }

  /**
   * Make a PATCH request.
   *
   * @param {RequestConfig} requestConf
   * @param {RequestMethodOptions=} options
   * @returns {RequestMethodReturnValue}
   */
  patch(requestConf, options) {
    return this.request('patch', requestConf, options);
  }

  /**
   * Make a DELETE request.
   *
   * @param {RequestConfig} requestConf
   * @param {RequestMethodOptions=} options
   * @returns {RequestMethodReturnValue}
   */
  delete(requestConf, options) {
    return this.request('delete', requestConf, options);
  }

  /**
   * Returns a URL that is guaranteed to be absolute.
   *
   * @param {string} urlString - a relative or already absolute URL
   * @returns {string} url - an absolute URL, prefixed by the API prefix if necessary.
   */
  absoluteURL(urlString) {
    if (!urlString.match(/^http/i)) {
      return this.apiUrlPrefix + urlString;
    }

    return urlString;
  }

  /**
   * Configures a request with defaults such as authentication headers.
   *
   * @param {RequestConfig} config - as accepted by the `request` module
   * @param {{ jwt?: typeof defaultJwt}} options
   * @returns {RequestConfig}
   */
  configureRequest(config, { jwt = defaultJwt } = {}) {
    const requestConf = {
      ...this.requestConfig,
      ...config,
    };

    if (!requestConf.url) {
      throw new Error('request URL was not specified');
    }

    // eslint-disable-next-line no-param-reassign
    requestConf.url = this.absoluteURL(String(requestConf.url));

    if (this.proxyServer) {
      // eslint-disable-next-line no-param-reassign
      requestConf.proxy = this.proxyServer;
    }

    const authToken = jwt.sign({ iss: this.apiKey }, this.apiSecret, {
      algorithm: 'HS256',
      expiresIn: this.apiJwtExpiresIn,
    });

    // Make sure the request won't time out before the JWT expires.
    // This may be useful for slow file uploads.
    // eslint-disable-next-line no-param-reassign
    requestConf.timeout = this.apiJwtExpiresIn * 1000 + 500;

    // eslint-disable-next-line no-param-reassign
    requestConf.headers = {
      Authorization: `JWT ${authToken}`,
      Accept: 'application/json',
      ...requestConf.headers,
    };

    return requestConf;
  }

  /**
   * Make any HTTP request to the addons.mozilla.org API.
   *
   * This includes the necessary authorization header.
   *
   * The returned promise will be resolved with an array of arguments that
   * match the arguments sent to the callback as specified in the `request`
   * module.
   *
   * @param {string} httpMethod - HTTP method name.
   * @param {RequestConfig} config - options accepted by the `request` module
   * @param {RequestMethodOptions} options
   * @returns {RequestMethodReturnValue}
   */
  async request(httpMethod, config, { throwOnBadResponse = true } = {}) {
    const method = httpMethod.toLowerCase();
    const requestConf = this.configureRequest(config);

    let [
      // eslint-disable-next-line prefer-const
      httpResponse,
      body,
    ] = await new Promise((resolve, reject) => {
      this.debug(`[API] ${method.toUpperCase()} request:\n`, requestConf);

      // Get the caller, like request.get(), request.put() ...
      // @ts-ignore
      const requestMethod = this._request[method].bind(this._request);
      // Wrap the request callback in a promise. Here is an example without
      // promises:
      //
      // request.put(requestConf, function(err, httpResponse, body) {
      //   // promise gets resolved here
      // })
      requestMethod(
        /** @type RequestConfig */
        requestConf,
        /**
         * @param {Error} error
         * @param {Response} response
         * @param {string} responseBody
         */
        (error, response, responseBody) => {
          if (error) {
            reject(error);
            return;
          }

          resolve([response, responseBody]);
        },
      );
    });

    if (throwOnBadResponse) {
      if (httpResponse.statusCode > 299 || httpResponse.statusCode < 200) {
        throw new Error(
          `Received bad response from ${this.absoluteURL(
            String(requestConf.url),
          )}; ` +
            `status: ${httpResponse.statusCode}; ` +
            `response: ${formatResponse(body)}`,
        );
      }
    }

    if (
      httpResponse.headers &&
      httpResponse.headers['content-type'] === 'application/json' &&
      typeof body === 'string'
    ) {
      try {
        body = JSON.parse(body);
      } catch (e) {
        this.logger.log('Failed to parse JSON response from server:', e);
      }
    }

    this.debug(
      `[API] ${method.toUpperCase()} response:\n`,
      `Status: ${httpResponse.statusCode}\n`,
      { headers: httpResponse.headers, response: body },
    );

    return [httpResponse, body];
  }

  /**
   * Output some debugging info if this instance is configured for it.
   */
  debug() {
    if (!this.debugLogging) {
      return;
    }

    /**
     * @param {{ headers: {[key: string]: string} } & {[prop: string]: any}} obj
     */
    function redact(obj) {
      if (typeof obj !== 'object' || !obj) {
        return obj;
      }
      if (obj.headers) {
        ['Authorization', 'cookie', 'set-cookie'].forEach(function (hdr) {
          if (obj.headers[hdr]) {
            // eslint-disable-next-line no-param-reassign
            obj.headers[hdr] = '<REDACTED>';
          }
        });
      }

      Object.keys(obj).forEach(function (key) {
        // eslint-disable-next-line no-param-reassign
        obj[key] = redact(obj[key]);
      });

      return obj;
    }

    // TODO: remove the use of `arguments`
    // eslint-disable-next-line prefer-rest-params
    const args = Array.prototype.map.call(arguments, function (val) {
      let newVal = val;
      if (typeof newVal === 'object') {
        newVal = deepcopy(newVal);
        newVal = redact(newVal);
      }
      return newVal;
    });
    this.logger.log('[sign-addon]', ...args);
  }
}
