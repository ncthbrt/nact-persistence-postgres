module.exports = () => {
  return {
    files: [
      'lib/**/*.js'
    ],
    tests: [
      'test/**/*.js'
    ],
    env: {
      type: 'node',
      runner: 'node'  // or full path to any node executable
    },
    debug: true
  };
};
