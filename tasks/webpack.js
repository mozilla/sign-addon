const path = require('path');

const webpackConfig = require('../webpack.config.js');

module.exports = {
  options: webpackConfig,
  build: {},
  test: {
    entry: './tests/runner.js',
    output: {
      path: path.join(__dirname, '../dist'),
      filename: 'tests.js',
    },
  },
};
