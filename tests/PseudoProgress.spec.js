import sinon from 'sinon';
import { beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';

import PseudoProgress from '../src/PseudoProgress';

describe(__filename, () => {
  describe('PseudoProgress', () => {
    /** @type {sinon.SinonSpy<[NodeJS.Timeout|number|undefined], void>} */
    let _clearInterval;
    /** @type {sinon.SinonSpy<any, any>} */
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
      _clearInterval = sinon.spy(
        /**
         * @param {NodeJS.Timeout|number|undefined} handle
         */
        // eslint-disable-next-line no-unused-vars
        (handle) => {},
      );
      _setInterval = sinon.spy(() => fakeIntervalId);

      progress = new PseudoProgress({
        _clearInterval,
        _setInterval,
        stdout: createFakeStdout(),
      });
    });

    it('should set an interval', function() {
      progress.animate();
      expect(_setInterval.called).to.be.equal(true);
    });

    it('should clear an interval', function() {
      progress.animate();
      expect(_setInterval.called).to.be.equal(true);
      progress.finish();
      expect(_clearInterval.firstCall.args[0]).to.be.equal(fakeIntervalId);
    });
  });
});
