import sinon from 'sinon';
import { beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';

import PseudoProgress from '../src/PseudoProgress';

describe(__filename, () => {
  describe('PseudoProgress', () => {
    /** @type {sinon.SinonSpy} */
    let _clearInterval;
    /** @type {sinon.SinonSpy} */
    let _setInterval;
    /** @type {PseudoProgress} */
    let progress;

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
      _setInterval = sinon.spy(() => 'interval-id');
      _clearInterval = sinon.spy(() => {});

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
      expect(_clearInterval.firstCall.args[0]).to.be.equal('interval-id');
    });
  });
});
