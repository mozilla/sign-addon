# Sign Add-on

Sign a Firefox add-on with Mozilla's [web service](http://addons-server.readthedocs.org/en/latest/topics/api/signing.html).

[![Build Status](https://travis-ci.org/mozilla/sign-addon.svg?branch=master)](https://travis-ci.org/mozilla/sign-addon)

## Installation

    npm install sign-addon

## Programatic use

You first need to generate API credentials, a JWT issuer and secret, from the
[AMO Developer Hub](https://addons.mozilla.org/en-US/developers/addon/api/key/).

````javascript
import signAddon from 'sign-addon';

signAddon(
  {
    id: 'your-addon-id@somewhere',
    version: '0.0.1',
    apiKey: 'JWT issuer',
    apiSecret: 'JWT secret',
    xpiPath: '/path/to/your/addon.xpi',
  })
  .then((result) => {
    console.log(result.success ? "SUCCESS" : "FAIL");
  });
````

## Development

Here's how to set up a development environment for the `sign-addon` package.
Install all requirements and run tests from the source:

    npm install
    npm start
