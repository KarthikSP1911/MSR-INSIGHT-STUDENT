@AGENTS.md

# Project Guidelines

## Stack
- Next.js (App Router) + TypeScript + Tailwind CSS
- ESLint for linting, Lefthook for git hooks, Commitlint (Conventional Commits) for commit messages

## Professional Standards
- Follow professional software engineering practices: write clear, maintainable, well-typed code.
- Prefer small, focused, incremental changes over large sweeping ones.
- Do not add unused dependencies, dead code, or speculative abstractions.
- Run `npm run lint` before committing; fix all lint errors (Lefthook also enforces this automatically on commit).
- Keep components, hooks, and utilities organized under `src/` following Next.js App Router conventions.
- Write self-documenting code; only add comments to explain non-obvious "why", not "what".

## Git Workflow
- **Never commit directly to `main`.** Always work on a feature/fix branch and open a PR for review.
- Branch naming: `feat/<short-description>`, `fix/<short-description>`, `chore/<short-description>`, `docs/<short-description>`, `refactor/<short-description>`.
- Commit **regularly**, in small logical units — one concern per commit.
- Commit messages **must** follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by Commitlint via Lefthook's `commit-msg` hook:
  ```
  <type>(<optional scope>): <short summary>

  [optional body]

  [optional footer]
  ```
  Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
  Examples:
  - `feat(dashboard): add student attendance chart`
  - `fix(api): handle null response from grades endpoint`
  - `chore: update eslint config`
- Lefthook runs ESLint on staged files before every commit (`pre-commit`) and validates the commit message (`commit-msg`). Do not bypass these with `--no-verify` unless explicitly instructed.

## Setup
- `npm install` will automatically run `lefthook install` via the `prepare` script.
