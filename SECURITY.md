# Security policy

## Reporting a vulnerability
Please report security problems privately, not in public issues or pull requests.

- Use GitHub's **private vulnerability reporting** ("Security" tab > "Report a vulnerability") on this repository.
- Include what you found, how to reproduce it, the version/commit, and the impact you expect.

You can expect an acknowledgement within a few days and a fix or mitigation plan after triage. Please give us reasonable time to release a fix before disclosing publicly; we will credit you if you wish.

## Scope
In scope: the server, web app, CLI, desktop shell and the Docker image, including authentication, authorization, encryption, token handling and the audit log.

Out of scope: vulnerabilities that require a compromised server operator or master key (the [model](guide/security.md) assumes the operator is trusted), denial of service through unreasonable traffic, and findings in third-party services you deploy alongside.

## Supported versions
Only the latest release on `main` receives fixes while the project is `0.x`.

## Hardening guidance
See [guide/security.md](guide/security.md) and [guide/self-hosting.md](guide/self-hosting.md).
