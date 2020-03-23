/**
 * @typedef {{
 *   isTTY: boolean;
 *   columns: number;
 *   write: (buffer: string) => boolean;
 * }} Stdout
 */

/**
 * A pseudo progress indicator.
 *
 * This is just a silly shell animation that was meant to simulate how lots of
 * tests would be run on an add-on file. It sort of looks like a torrent file
 * randomly getting filled in.
 */
class PseudoProgress {
  /**
   * @typedef {object} PseudoProgressParams
   * @property {string=} preamble
   * @property {typeof clearInterval=} _clearInterval
   * @property {Stdout=} stdout
   * @property {typeof setInterval=} _setInterval
   *
   * @param {PseudoProgressParams} params
   */
  constructor({
    _clearInterval = clearInterval,
    _setInterval = setInterval,
    preamble = '',
    stdout = process.stdout,
  } = {}) {
    this.interval = null;
    this.motionCounter = 1;

    this.setInterval = _setInterval;
    this.clearInterval = _clearInterval;
    this.stdout = stdout;

    /** @type {string[]} */
    this.bucket = [];
    /** @type {number[]} */
    this.emptyBucketPointers = [];

    this.setPreamble(preamble);
  }

  /**
   * @param {string} preamble
   */
  setPreamble(preamble) {
    this.preamble = `${preamble} [`;
    this.addendum = ']';

    let shellWidth = 80;
    if (this.stdout.isTTY) {
      shellWidth = Number(this.stdout.columns);
    }

    this.emptyBucketPointers = [];
    this.bucket = [];

    const bucketSize = shellWidth - this.preamble.length - this.addendum.length;
    for (let i = 0; i < bucketSize; i++) {
      this.bucket.push(' ');
      this.emptyBucketPointers.push(i);
    }
  }

  /**
   * @typedef {object} AnimateConfig
   * @property {number} speed
   *
   * @param {AnimateConfig=} animateConfig
   */
  animate(animateConfig) {
    const conf = {
      speed: 100,
      ...animateConfig,
    };
    let bucketIsFull = false;
    this.interval = this.setInterval(() => {
      if (bucketIsFull) {
        this.moveBucket();
      } else {
        bucketIsFull = this.randomlyFillBucket();
      }
    }, conf.speed);
  }

  finish() {
    if (this.interval) {
      this.clearInterval(this.interval);
    }

    this.fillBucket();
    // The bucket has already filled to the terminal width at this point
    // but for copy/paste purposes, add a new line:
    this.stdout.write('\n');
  }

  randomlyFillBucket() {
    // randomly fill a bucket (the width of the shell) with dots.
    const randomIndex = Math.floor(
      Math.random() * this.emptyBucketPointers.length,
    );
    this.bucket[this.emptyBucketPointers[randomIndex]] = '.';

    this.showBucket();

    let isFull = true;
    /** @type {number[]} */
    const newPointers = [];
    this.emptyBucketPointers.forEach((pointer) => {
      if (this.bucket[pointer] === ' ') {
        isFull = false;
        newPointers.push(pointer);
      }
    });
    this.emptyBucketPointers = newPointers;

    return isFull;
  }

  fillBucket() {
    // fill the whole bucket with dots to indicate completion.
    this.bucket = this.bucket.map(function () {
      return '.';
    });
    this.showBucket();
  }

  moveBucket() {
    // animate dots moving in a forward motion.
    for (let i = 0; i < this.bucket.length; i++) {
      this.bucket[i] = (i - this.motionCounter) % 3 ? ' ' : '.';
    }
    this.showBucket();

    this.motionCounter++;
  }

  showBucket() {
    this.stdout.write(
      `\r${this.preamble}${this.bucket.join('')}${this.addendum}`,
    );
  }
}

export default PseudoProgress;
