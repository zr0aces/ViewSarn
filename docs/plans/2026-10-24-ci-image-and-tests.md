# Plan 06: CI, image, and remaining test gaps

Fixes F-17 and the test gaps in audit §6 that plans 01 to 05 do not cover. Depends on plans 01 and 03. The `npm audit` gate is in plan 02.

## Steps

### 1. Smoke script

Add `scripts/smoke.mjs` (2-space indent, ESM like the other `.mjs` tooling). Arguments: base URL, API key. It:
1. Polls `/health` up to 60 s.
2. POSTs a Thai HTML sample (`<h1>รายงานประจำเดือน</h1>`) as PDF; asserts HTTP 200, body starts with `%PDF`, size above 1 KB.
3. POSTs the same as PNG; asserts the `\x89PNG` signature.
4. Optional `--container <name>`: runs `docker exec <name> fc-list` and asserts Sarabun and Noto Sans Thai (R-5.6).
Exit 1 with a clear message on any failure.

Commit: `test(smoke): render a Thai document against a running image`.

### 2. CI image job

`.github/workflows/ci.yml`: new job `image` (needs `test`): `docker/setup-buildx-action`, `docker/build-push-action` with `load: true` and `cache-from/to: type=gha`, `docker run -d --name viewsarn-smoke -e API_KEY=ci-key -e OUTPUT_DIR=/tmp/out -p 3000:3000 …`, `node scripts/smoke.mjs http://localhost:3000 ci-key --container viewsarn-smoke`, dump `docker logs` on failure. Run on pushes to `main` and on PRs touching `Dockerfile`, `fonts/**`, `package*.json`, `src/**`, `server.js`.

Verify: break the Dockerfile on a scratch branch (delete one font line), confirm CI fails, then discard.

Commit: `ci: build the image and run the smoke render`.

### 3. Dockerfile and supply chain

- `Dockerfile:2`: pin base image by digest, keep the tag in a comment (`# node:24-slim`). Get the digest with `docker buildx imagetools inspect`.
- Add `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`. Keep the compose healthcheck only if it differs; one source.
- Pin all GitHub Actions by commit SHA with the version in a comment.
- Add `.github/dependabot.yml`: `npm`, `github-actions`, `docker`, weekly.
- `.github/workflows/docker-publish.yml`: run `npm audit --omit=dev --audit-level=high` (release tags are where the hard audit gate belongs, see plan 02), build to a local tag, run the smoke script against it, run Trivy (`aquasecurity/trivy-action`, pinned by SHA, `severity: HIGH,CRITICAL`, `ignore-unfixed: true`, fail the job), then push. `latest` is pushed only after both pass.

Commits: `chore(docker): pin base image, add HEALTHCHECK`; `ci: pin actions, add dependabot`; `ci(publish): smoke test and scan before push`.

### 4. Test quality fixes

- `test/rateLimit.test.js` bounded-storage test: replace real timers with `mock.timers.enable({ apis: ['Date'] })` and advance with `mock.timers.tick()` (R9). No source change. Assert the exact bound (`_size()` after the sweep) instead of `≤ 2×WAVE+10`.
- `test/renderTimeout.test.js`: add a stub whose `newContext` throws `Target closed` and one whose `page.pdf` rejects, asserting a 500 and a released slot (matches Chromium failure shape).
- `test/validate.test.js`: tests for `png`, `single`, `save`, `outPath` come with plan 04; add a table test that every key in `validateOptions`'s destructure has at least one rejecting case.
- `package.json`: `"test:browser": "RUN_BROWSER_TESTS=1 node --test test/browser/*.test.js"`. Keep it out of `npm test`. The image copies only `server.js` and `src/` (Dockerfile lines 69-70) and has no `test/`, so mount the tests read-only and override the command: `docker run --rm -e RUN_BROWSER_TESTS=1 -v "$PWD/test:/app/test:ro" viewsarn node --test test/browser/*.test.js`. The image already has `playwright` and Chromium; `node:test` is built in.
- After plan 07: add a `shellcheck convert-cli.sh` step to CI.

Commit: `test: deterministic rate-limit clock, Chromium-shaped failures, browser suite`.

## Acceptance

- CI fails on a deliberately broken Dockerfile and on a removed font; passes on `main`.
- Publish does not push `latest` if smoke or scan fails (dry-run with a failing scan on a scratch tag in a fork).
- `npm test` has no real-timer assertions in `rateLimit.test.js`.

## Risks and rollback

- CI time: layer cache and path filters.
- Trivy noise from base-image CVEs: `ignore-unfixed`; review exceptions in PRs.
- Digest pins go stale; Dependabot opens the bump PRs.
- Revert per job.
