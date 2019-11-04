// @ts-nocheck
/* eslint max-classes-per-file: 0 */
export class MockProgress {
  animate() {}

  finish() {}
}

export class MockRequest {
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
