var { signAddon } = require('./dist/sign-addon.js');

signAddon({
  xpiPath: 'cobster-loraboon-giraccork.zip',
  version: '1.0',
  apiKey: 'user:10642187:774',
  apiSecret: 'd8437863d47de4918ce4d6e631a2ff18b872327f796dae62187e94f519d86a83',
  apiUrlPrefix: 'https://addons-dev.allizom.org/api/v4',
  quiet: true,
})
  .then(function (result) {
    if (result.success) {
      console.log('The following signed files were downloaded:');
      console.log(result.downloadedFiles);
      console.log('Your extension ID is:');
      console.log(result.id);
    } else {
      console.error('Your add-on could not be signed!');
      console.error('Error code: ' + result.errorCode);
      console.error('Details: ' + result.errorDetails);
    }
    console.log(result.success ? 'SUCCESS' : 'FAIL');
  })
  .catch(function (error) {
    console.error('Signing error:', error);
  });
