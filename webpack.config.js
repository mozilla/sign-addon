const path = require('path');

const webpack = require('webpack');
const nodeExternals = require('webpack-node-externals');

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
    // Force webpack bundled module to export the content of the default
    // export.
    libraryExport: 'default',
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
  externals: [
    nodeExternals({
      modulesFromFile: true,
    }),
  ],
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
  devtool: 'source-map',
};
