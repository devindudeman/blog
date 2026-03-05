# devin.fitzsky.com

Personal blog built with Jekyll and deployed with GitHub Pages.

## Reproducible Dev Environment (Nix + devenv)

If you use Nix, this repo includes a pinned dev shell:

```bash
nix develop --no-pure-eval
devenv run setup
devenv run serve
```

Optional with `direnv`:

```bash
direnv allow
devenv run setup
devenv run serve
```

Note: `devenv` with flakes needs `--no-pure-eval` when using `nix develop` directly.

## Local Development

1. Install Ruby `3.4.x` and Bundler.
   ```bash
   rbenv install 3.4.8
   rbenv local 3.4.8
   gem install bundler
   ```
2. Install dependencies:
   ```bash
   bundle install
   ```
3. Run the site:
   ```bash
   bundle exec jekyll serve --livereload
   ```
4. Open `http://127.0.0.1:4000`.

## Publish To GitHub Pages

1. Push this repository to GitHub.
2. In **Settings -> Pages**:
   - **Source:** `GitHub Actions`
3. Ensure the default branch is `main` (the workflow deploys on pushes to `main`).
4. Confirm `CNAME` contains:
   ```
   devin.fitzsky.com
   ```

## Cloudflare DNS For `devin.fitzsky.com`

Create this DNS record in Cloudflare:

- **Type:** `CNAME`
- **Name:** `devin`
- **Target:** `<your-github-username>.github.io`
- **Proxy status:** `DNS only` (recommended for initial setup)
- **TTL:** `Auto`

Then in GitHub repository **Settings -> Pages**:

- Set **Custom domain** to `devin.fitzsky.com`
- Enable **Enforce HTTPS** after DNS resolves

## Content Editing

- Posts live in `_posts/` and follow `YYYY-MM-DD-title.md`.
- Main styles are in `assets/css/main.css`.
- Layouts are in `_layouts/`.

## Notes

- `url` is set to `https://devin.fitzsky.com` in `_config.yml`.
- `baseurl` is intentionally empty for root-domain hosting.
- Ruby `2.6` will fail dependency resolution for current `github-pages` gems.
- Ruby `4.x` is currently incompatible with `github-pages` (`commonmarker` requires Ruby `< 4.0`), so this repo pins Ruby `3.4.8`.
- Current pinned versions: Ruby `3.4.8` (latest compatible with `github-pages`), `github-pages` gem `232`, `webrick` `1.9.2`.
