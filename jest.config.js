module.exports = {
  testEnvironment: 'node',
  transform: {
    '\\.m?jsx?$': 'jest-esm-transformer'
  },
//  transformIgnorePatterns: ['<rootDir>/node_modules/got/'],
  transformIgnorePatterns: [],
  testPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/node_modules/'],
};
