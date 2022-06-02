import { fileURLToPath } from 'url';

import { jest } from '@jest/globals';

import PseudoProgress from '../src/PseudoProgress.js';

describe(fileURLToPath(import.meta.url), () => {
  describe('PseudoProgress', () => {
    /** @type {typeof clearInterval} */
    let _clearInterval;
    /** @type {typeof setInterval} */
    let _setInterval;
    /** @type {PseudoProgress} */
    let progress;

    const fakeIntervalId = 12345;

    const createFakeStdout = () => {
      return {
        columns: 80,
        isTTY: true,
        // eslint-disable-next-line no-unused-vars
        write(buffer = '') {
          return true;
        },
      };
    };

    beforeEach(() => {
      _clearInterval = jest.fn();
      // @ts-ignore: it's probably fine to not have __promisify__ here.
      _setInterval = jest.fn().mockReturnValue(fakeIntervalId);

      progress = new PseudoProgress({
        _clearInterval,
        _setInterval,
        stdout: createFakeStdout(),
      });
    });

    it('should set an interval', function () {
      progress.animate();
      expect(_setInterval).toHaveBeenCalled();
    });

    it('should clear an interval', function () {
      progress.animate();
      expect(_setInterval).toHaveBeenCalled();
      progress.finish();
      expect(_clearInterval).toHaveBeenCalledWith(fakeIntervalId);
    });
  });
});
