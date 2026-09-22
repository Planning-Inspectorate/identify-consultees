# Security policy

## Supported versions

Security fixes are applied to the default branch (`main`) and released from there. Older tags or forks are not routinely patched.

## Reporting a vulnerability

If you discover a security vulnerability in this repository, please report it privately. Do **not** open a public GitHub issue or pull request that discloses the vulnerability.

### Preferred reporting channel

Use [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) for this repository (Security tab → Report a vulnerability), if it is enabled.

If private reporting is unavailable, contact the Planning Inspectorate via the channels listed on [GOV.UK](https://www.gov.uk/government/organisations/planning-inspectorate) and mark the message as a security disclosure for this service.

### What to include

- A description of the issue and its potential impact
- Steps to reproduce, or a proof of concept if you have one
- Affected component or path (for example manage app, function app, infrastructure)
- Any suggested remediation, if known

### What to expect

We will acknowledge valid reports as soon as practicable, assess impact, and work on a fix. Please give us a reasonable time to remediate before any public disclosure.

### Out of scope

- Issues in third-party dependencies that do not affect this service in a realistic deployment (report those upstream where appropriate)
- Social engineering, physical attacks, or denial-of-service testing against live government systems without prior authorisation

## Secure development

Contributors should:

- Never commit secrets, credentials, or real personal data
- Prefer least-privilege configuration and existing auth patterns in this repo
- Follow dependency and supply-chain practices already enforced in CI and Dependabot

Thank you for helping keep this service and its users safe.
