# actionlint (with shellcheck) for CI and for local runs, pinned by digest.
# Dependabot (ecosystem "docker", this directory) keeps the tag and the digest fresh; an image
# reference inside a workflow's run: script would never be updated.
#
# Local run from the repository root (lists the files explicitly: actionlint's own discovery
# needs a .git directory, which a git worktree does not have):
#   docker build -t goenn-actionlint .github/actionlint
#   docker run --rm --network none -v "$PWD:/repo:ro" -w /repo goenn-actionlint .github/workflows/ci.yml .github/workflows/docker.yml
FROM rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667
