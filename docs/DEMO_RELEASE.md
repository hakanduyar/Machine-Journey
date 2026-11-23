# Demo release

The Pages workflow is manual. Pushing or merging a commit does not deploy it.

After an independently reviewed release has passed CI and browser acceptance:

1. Enable GitHub Pages with **GitHub Actions** as its source. Restrict the `github-pages` environment to the `main` branch.
2. Run **Publish accepted demo** from `main`, supplying the full accepted main commit SHA. The workflow rejects a SHA that differs from the dispatched revision and skips other branches.
3. The workflow runs the unit suite and builds with `/Machine-Journey/` as the asset base, then deploys that artifact.
4. Verify the deployment URL, startup, media playback and a city transition before adding or updating a public demo link.

The build uses read-only repository and Pages access. Only the deployment job receives `pages: write` and `id-token: write`, scoped to the `github-pages` environment. No personal token is required. Repository Pages settings must be enabled separately; the workflow does not enable them automatically.

For a local subpath check, run `npm run build:pages`, then `npm run preview -- --base=/Machine-Journey/` and open `http://127.0.0.1:3342/Machine-Journey/`.

Recorded media keeps its individual licences and credits. A deployment is an archive demonstration, not live monitoring. Only accepted release files belong in the artifact.
