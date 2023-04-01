# Collaborator Guide

## Table of Contents

* [Releases](#releases)
  * [Getting dependencies](#getting-dependencies)
    * [npm access](#npm-access)
  * [Deciding what type of version release](#deciding-what-type-of-version-release)
  * [Doing a release](#doing-a-release)
* [Doc credit](#doc-credit)

## Releases

Releasing http-streaming is partially automated through various scripts.
To do a release, you need a couple of things: npm access, GitHub personal access token.

Releases are done on npm and GitHub and eventually posted on the CDN.
These are the instructions for the npm/GitHub releases.

### Getting dependencies

#### npm access

To see who currently has access run this:

```sh
npm owner ls @videojs/http-streaming
```

If you are a core committer, you can request access to npm from one of the current owners.
Access is managed via an [npm organization][npm org] for [Video.js][vjs npm].

### Deciding what type of version release

Since we follow the [conventional changelog conventions][conventions], all commits are prepended with a type, most commonly `feat` and `fix`.
If all the commits are fix or other types such as `test` or `chore`, then the release will be a `patch` release.
If there's even one `feat`, the release will be a `minor` release.
If any commit has a `BREAKING CHANGE` footer, then the release will be a `major` release.
Most common releases will be either `patch` or `minor`.

### Doing a release

To make the release process easier, and in case you have a dirty repo from development, it is recommended that you checkout a clean clone of http-streaming.

```sh
git clone git@github.com:videojs/http-streaming vhs-release
cd vhs-release
```

Install the latest compatible version of node for the project. By not specifying a version, [nvm will default to the .nvmrc file if available](https://github.com/creationix/nvm#nvmrc).

```sh
nvm install
```

Install dependencies for the project.

```sh
npm install
```

Update version.

```sh
npm version {major|minor|patch}
```

Depending on the commits that have been merged, you can choose from `major`, `minor`, or `patch` as the versioning values.
See [deciding what type of version release section](#deciding-what-type-of-version-release).

Optionally, you can run `git show` now to verify that the version update and CHANGELOG automation worked as expected.

Afterwards, you want to push the commit and the tag to the repo.

```sh
git push --follow-tags origin main
```

After the tag was pushed, GitHub actions will trigger the `release` workflow, which will do the following:

* Publish to npm with `next` or `next-{n}` depending on your current major version.
* Create GitHub release with changelog and Netlify preview.
* Create a GitHub `releases` discussion linked to the GitHub release.

If it's a large enough release, consider writing a blog post as well.

## Doc credit

This collaborator guide was heavily inspired by [node.js's guide](https://github.com/nodejs/node/blob/main/COLLABORATOR_GUIDE.md) and [video.js's guide](https://github.com/videojs/video.js/blob/main/COLLABORATOR_GUIDE.md)

[conventions]: https://github.com/videojs/conventional-changelog-videojs/blob/main/convention.md

[vjs npm]: http://npmjs.com/org/videojs

[npm org]: https://docs.npmjs.com/misc/orgs
