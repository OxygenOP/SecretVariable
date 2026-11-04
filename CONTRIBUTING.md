# Contributing to SecretVariable

Thanks for helping! This project handles people's secrets, so we value careful, well-tested changes over fast ones.

## Ways to help
- Report bugs and request features in issues (search first).
- Improve docs, error messages and the web UI.
- Pick something from the [roadmap](guide/roadmap.md) (comment on the issue first so we do not duplicate work).
- **Security problems: do not open a public issue.** See [SECURITY.md](SECURITY.md).

## Getting set up
Follow [guide/development.md](guide/development.md). In short: Node 22, pnpm 10, PostgreSQL, then `pnpm install && pnpm build && pnpm test`.

## Making a change
1. Fork, then branch from `main` (`feature/short-name` or `fix/short-name`).
2. Keep the change focused. Include tests: a new permission rule needs a test for the denied case, a new endpoint needs integration tests, UI behaviour needs an e2e step when practical.
3. Run `pnpm build && pnpm typecheck && pnpm test` and fix everything. Run the browser e2e if you touched the web app.
4. For visual changes attach before/after screenshots at desktop (1440px) and phone (390px) widths.
5. Open a pull request using the template. Explain what and why, and note anything you could not test.

## Ground rules for code
- **Never log or return secret values** outside the endpoints whose job is to return them. Audit entries hold names and ids only.
- Reads that return values go through the audited path. Name-only reads must not decrypt.
- New dependencies need a reason; prefer the standard library.
- TypeScript strict; no `any` in new server code unless justified in a comment.
- Database changes are new entries in `apps/server/src/migrations.ts` (never edit a released migration).
- Follow the web design tokens in `apps/web/src/styles.css`.

## Commit messages
Short imperative summary, then a body explaining why when it is not obvious. Squash-merge keeps history tidy.

## Code of conduct
Be kind and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License
By contributing you agree your work is released under the [MIT license](LICENSE).
