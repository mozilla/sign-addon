var path = require("path");
var spawn = require("child_process").spawn;
var semver = require("semver");

module.exports = function(grunt) {

  // Looking for something?
  // The source of a grunt task or its configuration might be in:
  // 1. this file :)
  // 2. ./node_modules/grunt-*<task_name>/
  // 3. ./tasks/<task_name>.js


  // This loads all grunt tasks matching the grunt-*, @*/grunt-* patterns.
  require("load-grunt-tasks")(grunt);

  var configs = require("load-grunt-configs")(grunt, {
    config: {
      src: "tasks/*.js",
    },
  });
  grunt.initConfig(configs);

  grunt.registerTask("build", [
    "clean",
    "webpack:build",
  ]);

  grunt.registerTask("build-tests", [
    "build",
    "webpack:test",
  ]);

  grunt.registerTask("test", [
    "build-tests",
    "mochaTest",
    "lint",
  ]);

  grunt.registerTask("develop", [
    "watch:develop",
  ]);

  grunt.registerTask("lint", [
    "newer:eslint",
  ]);

  grunt.registerTask(
    "lint-commit-msg", "checks for commit message lint", function() {
      var done = this.async();
      if (semver.satisfies(process.version, ">= 4.0.0")) {
        gruntExec(grunt, "conventional-changelog-lint", ["--from", "master"],
                  done);
      } else {
        grunt.log.writeln(
          "task skipped because this version of Node is too old");
        done(true);
      }
    });

  grunt.registerTask(
    "changelog", "Create a changelog from commits", function() {
      // See https://github.com/mozilla/web-ext/blob/master/CONTRIBUTING.md#writing-commit-messages
      gruntExec(grunt, "conventional-changelog", ["-p", "angular", "-u"],
                this.async());
    });

};


function gruntExec(grunt, cmd, args, onCompletion) {
  var PATH = process.env.PATH || "";
  // Make sure the script dir for local node modules is on the path.
  process.env.PATH =
    PATH + ":" + path.resolve(__dirname) + "/node_modules/.bin";
  var proc = spawn(cmd, args);

  proc.stderr.on("data", function(data) {
    grunt.log.write(data);
  });

  proc.stdout.on("data", function(data) {
    grunt.log.write(data);
  });

  proc.on("close", function(code) {
    var succeeded = code === 0;
    onCompletion(succeeded);
  });
}
