# KambioX landing page

Static marketing page for KambioX, hosted on Netlify (config in the repo-root `netlify.toml`).

- `index.html` is a single self-contained file exported from the Claude artifact. Its fonts and images are embedded, and it loads its scripts from unpkg.
- There is no build step. Netlify publishes this folder as-is.
- To update the page, replace `index.html` with a fresh export and open a PR.
