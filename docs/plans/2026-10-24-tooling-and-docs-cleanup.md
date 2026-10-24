# Plan 07: Tooling and docs cleanup

Fixes F-15 and F-16, and closes the audit's prose-doc coverage gap. Independent of the other plans; can run any time.

## Steps

### 1. Remove dead and hazardous files

1. `grep -rn "cleanup_fonts\|wrap_html\|result.pdf" --exclude-dir=node_modules --exclude-dir=graphify-out --exclude-dir=.git .` and fix any doc references found.
2. `git rm cleanup_fonts.sh wrap_html.sh result.pdf .claude/settings.local.json.bak.1787539082` (all four are tracked).
3. Add `.claude/*.bak*` to `.gitignore`.

Commit: `chore: remove dead scripts and tracked backup files`.

### 2. Rewrite `convert-cli.sh` body handling (F-15)

Read the whole script first, then change:
1. Build the JSON with `jq -n --arg html … --argjson …`. Add `scale` only when `--scale` was passed. This removes the `tonumber` failure on the string `"null"`.
2. Send one request. For `--save`, write the body to a `mktemp` file and read the status with `-w '%{http_code}'`; drop the second `curl` (lines 264 and 267).
3. `API_KEY="${API_KEY:-}"` at line 11 so the environment variable that `--help` documents works.
4. Replace fixed `/tmp/convert_headers` and `/tmp/convert_cli_req.json` with `mktemp` plus `trap 'rm -f …' EXIT`; create with `umask 077`.
5. Drop the python3 fallback (the substitutions at lines 152 and 198-204 are invalid bash). Require `jq`; print `jq is required` and exit 2 otherwise.
6. Send `png` and `single` as JSON booleans (plan 04).
7. Run `bash -n` and `shellcheck convert-cli.sh`.

Test `test/convertCli.test.js`: put a stub `curl` and `jq`-using script on `PATH` via `child_process.execFileSync` with an `env.PATH` override (not `execFileSync` blocking an in-process server, which deadlocked during the audit). Assert one `curl` call with `--save`, no `scale` key without `--scale`, a numeric `scale` with it, key taken from `API_KEY`.

Commit: `fix(cli): single request, optional scale, env key, safe temp files`.

### 3. Spec and docs drift (F-16)

1. `documents/specification.md` §6 (around line 118): replace the `===` key comparison text with the SHA-256 digest plus `timingSafeEqual` wording from R-2.7.
2. `documents/specification.md` §8 (around lines 144-145): label 400 and 413 as JSON, per R-1.16.
3. `documents/deployment.md` (around lines 184 and 380): replace `curl` healthchecks with the `node -e "fetch(...)"` probe (or reference the Dockerfile `HEALTHCHECK` from plan 06).
4. Read in full, which the audit did not: `documents/api_docs.md`, `architecture.md`, `deployment.md`, `development.md`, `fonts.md`, `README.md`. Check every command, env var, default, status code, and file path against `src/config.js`, `server.js`, and `package.json`. List each mismatch in the PR description and fix it. Where a doc describes behavior changed by plans 02 to 05, leave that to those plans.

Commit: `docs: align spec and guides with the code`.

### 4. One source for agent instructions (decision 8)

Confirm with `cmp CLAUDE.md AGENTS.md` and `cmp CLAUDE.md GEMINI.md` that they are still identical. Then `git rm AGENTS.md GEMINI.md && ln -s CLAUDE.md AGENTS.md && ln -s CLAUDE.md GEMINI.md`. If any contributor tool or the Docker build context needs real files, use a one-line pointer file instead.

Commit: `chore: link AGENTS.md and GEMINI.md to CLAUDE.md`.

## Acceptance

- `git ls-files` no longer lists the four removed files.
- `./convert-cli.sh --file example.html --output /tmp/x.pdf` works without `--scale` against a running server; `--save` produces one file.
- `shellcheck convert-cli.sh` is clean.
- Spec §6 and §8 agree with R-2.7 and R-1.16.
- `npm test` passes.

## Risks and rollback

- Someone may use `wrap_html.sh`; git history keeps it.
- Symlinked agent files break tools that do not follow links; fall back to pointer files.
- Revert per commit.
