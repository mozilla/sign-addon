const path = require('path');
const fs = require('fs');

const webpack = require('webpack');

const nodeModules = {};

// This is to filter out node_modules as we don't want them
// to be made part of any bundles.
fs.readdirSync('node_modules')
  .filter(function(x) {
    return ['.bin'].indexOf(x) === -1;
  })
  .forEach(function(mod) {
    nodeModules[mod] = `commonjs ${mod}`;
  });

module.exports = {
  entry: './src/index.js',
  target: 'node',
  node: {
    __dirname: true,
    __filename: true,
  },
  output: {
    path: path.join(__dirname, 'dist'),
    filename: 'sign-addon.js',
    libraryTarget: 'commonjs2',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          // babel options are in .babelrc
          loader: 'babel-loader',
        },
        exclude: /(node_modules|bower_components)/,
      },
    ],
  },
  externals: nodeModules,
  plugins: [
    // for when: https://github.com/webpack/webpack/issues/353
    new webpack.IgnorePlugin({
      resourceRegExp: /vertx/,
    }),
    new webpack.BannerPlugin({
      banner: 'require("source-map-support").install();',
      raw: true,
      entryOnly: false,
    }),
  ],
  resolve: {
    extensions: ['.js', '.json'],
    modules: ['src', 'node_modules'],
  },
  devtool: 'sourcemap',
};
