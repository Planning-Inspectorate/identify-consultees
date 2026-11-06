# Security policy

## Supported versions

Security fixes are applied to the default branch (`main`) and released from there. Older tags or forks are not routinely patched.

## Reporting a vulnerability

If you discover a security vulnerability in this repository or the Identify Consultees service, report it privately. Do **not** open a public GitHub issue or pull request that discloses the vulnerability.

### How to report

Use one of these routes:

- **The [Government Vulnerability Reporting Service](https://vulnerability-reporting.service.security.gov.uk/)** — the UK government's central disclosure route, run by the Government Cyber Coordination Centre (GC3). GC3 accepts reports on behalf of government system owners and routes them to us. This is the preferred channel for a public-sector service.
- **GitHub private vulnerability reporting** for this repository (Security tab → Report a vulnerability), where enabled.
- The Planning Inspectorate via the channels listed on [GOV.UK](https://www.gov.uk/government/organisations/planning-inspectorate), marked as a security disclosure for this service.

We do not offer monetary rewards for vulnerability disclosures.

### What to include

- The website, IP or page where the vulnerability can be observed
- A brief description of the type of vulnerability (for example; "XSS vulnerability")
- Steps to reproduce — a benign, non-destructive proof of concept
- The affected component or path (for example manage app, function app, infrastructure)

### What to expect

- We will respond within **five working days** and aim to triage your report within **ten working days**, keeping you informed of progress.
- Remediation is prioritised by impact, severity and exploit complexity, so reports may take time to triage or address. You are welcome to enquire on status, but no more than once every 14 days.
- We will notify you when the reported vulnerability is remediated, and you may be invited to confirm the fix adequately covers it.
- Once resolved, we welcome requests to disclose your report — please continue to coordinate public release with us so guidance to affected users stays unified. Tell us when reporting if you would like to be acknowledged.

### Guidelines for reporters

You must **not**:

- break any applicable law or regulations
- access unnecessary, excessive or significant amounts of data
- modify data in our systems or services
- use high-intensity, invasive or destructive scanning tools to find vulnerabilities
- attempt or report any form of denial of service, such as overwhelming a service with requests
- disrupt the service or its systems
- social engineer, phish or physically attack staff or infrastructure
- demand financial compensation in order to disclose a vulnerability
- share, redistribute or fail to properly secure data retrieved from the systems or services

You **must** always comply with data protection rules and not violate the privacy of users, staff, contractors or the service — securely delete all data retrieved during research as soon as it is no longer required, or within one month of the vulnerability being resolved, whichever occurs first (or as otherwise required by data protection law).

This policy does not give you permission to act in any manner inconsistent with the law, or which might cause the Planning Inspectorate or partner organisations to breach legal obligations. However, if legal action is initiated by a third party against you and you have complied with this policy, we can take steps to make it known that your actions were conducted in compliance with it.

### Out of scope

- Volumetric attacks and denial of service — overwhelming a service with a high volume of requests
- Non-exploitable findings, or reports that the service does not fully align with "best practice" (for example missing security headers or TLS configuration weaknesses such as TLS 1.0 support)
- Social engineering, phishing, physical attacks, or denial-of-service testing against live government systems without prior authorisation
- Issues in third-party dependencies that do not affect this service in a realistic deployment — report those upstream where appropriate

## Secure development

Contributors should:

- Never commit secrets, credentials, or real personal data
- Prefer least-privilege configuration and existing auth patterns in this repo
- Follow dependency and supply-chain practices already enforced in CI and Dependabot

Thank you for helping keep this service and its users safe.
