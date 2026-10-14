# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

This is the policy FocusLoop follows for its Windows builds. It says which artifacts carry a
signature, who may approve one, and what a signature on a FocusLoop download does and does not
promise.

## Current status

Releases built with the configuration in the repository today are unsigned. `signExecutable: false`
in `apps/desktop/electron-builder.yml` keeps the Windows signing toolchain out of the build on
purpose, so the demo is published without a signature. Signing begins with the first release built
after this project's certificate is issued, and every release from then on is signed under the rules
below.

## What is signed

Only artifacts that CI builds from a tag in this repository:

- **`FocusLoop-Setup.exe`** — the NSIS x64 installer, built by `.github/workflows/release.yml` from a
  `v*` tag on `main`.
- **`FocusLoop.exe`**, and the installer and uninstaller beside it — the same run; electron-builder
  stamps the product name, the version and the icons before packing them.
- **`focusloop-extension.zip`** — not signed. A browser extension carries no Authenticode signature.

Binaries this project does not own — Electron, the Chromium and Node it embeds, and the dependencies
unpacked beside the asar — are not re-signed with this certificate. Each upstream project signs its
own artifacts, and a signature an upstream project already put on one of them is preserved.

Nothing built on a developer machine is ever signed, and no signing key exists on a developer
machine: signing runs inside CI, against a tagged commit. A signature on `FocusLoop-Setup.exe`
therefore means the file is the untouched output of that run, built from a commit anyone can read.

## Who may approve a signature

- **Committers and reviewers** — the repository owner and anyone the owner has granted write access
  to. The project's own rule, in [CONTRIBUTING.md](../CONTRIBUTING.md), is that nothing is pushed to
  `main` directly and every change arrives as a pull request with an independent review, so the
  release path does not depend on a single person's judgement.
- **Approvers** — [@nianpingy-cpu](https://github.com/nianpingy-cpu), the repository owner, who
  decides whether a given release may be signed.

No release is signed automatically from end to end: an approver approves each signing request by hand
in SignPath.io. Everyone in both roles uses multi-factor authentication for GitHub and for SignPath.

## Release conditions

A Windows release is eligible for signing only when all of these hold:

- the commit is on `main` and carries a `v*` tag;
- `lint`, `typecheck`, `test` and the release-hygiene gate passed in the run that built the installer;
- an approver has approved that run's signing request.

The release then carries `SHA256SUMS.txt` beside the installer, so a download can be checked against
its checksum as well as its signature.

## The metadata a signature covers

The artifact configuration restricts signing to files whose product name is `FocusLoop` and whose
product version is the version of the release being signed. Both are enforced as file metadata
restrictions, so a signature cannot land on an artifact that renamed the product or dropped its
version.

## Privacy

FocusLoop has no account, no telemetry, and no server to send anything to. The full statement is in
[docs/privacy.md](privacy.md).

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it. The two exceptions are both explicit:
the browser bridge speaks to `127.0.0.1` on the user's own machine, and a model provider is contacted
only when the user has configured a key and switched that provider on, for the single request being
made. Configuring a third-party model provider means that provider's own privacy policy applies to
those requests.
