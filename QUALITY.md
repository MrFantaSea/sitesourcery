# Static site quality checks

The `Site quality` workflow validates every HTML page, resolves repository-local links, assets, and fragments, parses local and inline JavaScript plus JSON-LD, checks public pricing against `data/public-catalog.json`, and enforces the held-state safety contract of both inquiry forms. It does not contact any external service.

Run the same locked checks locally with:

```sh
npm ci --ignore-scripts
npm test
```

This workflow neither publishes the site nor claims to gate GitHub Pages. Deployment protection depends on the repository's branch and environment settings.
