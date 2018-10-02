# CONTRIBUTING

We welcome contributions from everyone!

## Getting Started

Make sure you have NodeJS 0.10 or higher and npm installed.

1. Fork this repository and clone your fork
1. Install dependencies: `npm install`
1. Run a development server: `npm start`
1. Navigate to [`http://localhost:9999/`][local] for a local test player

### Making Changes

Refer to the [video.js plugin standards][standards] for more detail on best practices and tooling for video.js plugin authorship.

Be sure to run `npm run lint -- --errors` prior to opening a pull request. This may output a bunch of warnings, but errors will result in a non-0 exit status which will be clearly presented to you with a line similar to `npm ERR! Exit status 1`

When you've made your changes, push your commit(s) to your fork and issue a pull request against the original repository. The pull request template will include a checklist of things you may need to do before merging your changes.

### Running Tests

Testing is a crucial part of any software project. For all but the most trivial changes (typos, etc) test cases are expected. Tests are run in actual browsers using [Karma][karma].

- In all available and supported browsers: `npm test`
- In a specific browser: `npm run test:chrome`, `npm run test:firefox`, etc.
- While development server is running (`npm start`), navigate to [`http://localhost:9999/test/`][local]

[karma]: http://karma-runner.github.io/
[local]: http://localhost:9999/test/
[standards]: https://github.com/videojs/generator-videojs-plugin/blob/master/docs/standards.md
