// Commit message rules. This file is the contract `commitlint.yml` enforces, and the
// repository treats that workflow as a required status check, so anything named here is a
// rule every commit — human or Dependabot — has to satisfy to reach `main`.
//
// `deps-dev` is not decoration. `.github/dependabot.yml` sets
// `commit-message.prefix-development: "chore(deps-dev)"`, which makes `deps-dev` the scope on
// every development-dependency commit Dependabot writes. The scope has to be listed here or
// those commits fail `scope-enum` and the pull requests are unmergeable — which is exactly
// what happened: the Dependabot config promised the scope and this list did not honour it.
// Keep the two files in step; a scope in one and not the other is a silent dead end.
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [2, "always", 120],
    "header-max-length": [2, "always", 100],
    "scope-enum": [
      2,
      "always",
      [
        "frontend",
        "backend",
        "contracts",
        "scripts",
        "docs",
        "readme",
        "e2e",
        "sdk",
        "infra",
        "ci",
        "deps",
        "deps-dev",
        "release",
      ],
    ],
  },
};

