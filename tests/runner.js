// Webpack tests entry point. Bundles all the test files
// into a single file.

var context = require.context('.', true, /.*?test\..*?.js$/);
context.keys().forEach(context);
