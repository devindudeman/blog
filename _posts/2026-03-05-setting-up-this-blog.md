---
title: Setting Up This Blog
description: Jekyll, GitHub Pages, Nix, and Cloudflare — how devin.fitzsky.com came together.
---

Been meaning to set one of these up for a while. I've always liked GitHub Pages, so I went with that. I'd never used Jekyll before, but it felt like the right path for a personal site where the main job is writing and publishing cleanly.

## The Structure

I started from an empty repo and scaffolded a basic Jekyll structure — layouts, includes, posts, a few pages. The first design pass was a little too playful, so I tightened it into something minimal. Sharper typography, cleaner spacing, less decoration. The style should stay out of the way of the writing.

The config is intentionally small:

```yaml
title: Devin Bernosky
url: "https://devin.fitzsky.com"
permalink: /:title/
markdown: kramdown
plugins:
  - jekyll-feed
  - jekyll-seo-tag
defaults:
  - scope:
      path: ""
      type: "posts"
    values:
      layout: post
      author: Devin
```

The `permalink: /:title/` is key — URLs are just the slug with no date prefix. Posts live in `_posts/` as `YYYY-MM-DD-title.md`, but the URL comes out clean: `devin.fitzsky.com/setting-up-this-blog/`.

## Deploy

Deploys run through GitHub Actions on pushes to `main`. The workflow builds the Jekyll site and ships it to Pages automatically.

I hit one gotcha early: `configure-pages` returned a `Not Found` response on the first run. Turns out GitHub Pages isn't enabled on the repo until you either flip it on manually in Settings, or — what I did — set `enablement: true` in the action:

```yaml
- name: Setup Pages
  uses: actions/configure-pages@v5.0.0
  with:
    enablement: true
```

That bootstraps Pages on the first deploy. After that it's invisible.

## Nix Dev Environment

I use Nix and devenv everywhere, so this was an easy choice. The repo has a flake with a devenv shell that pins Ruby, Bundler, and the system dependencies:

```nix
{ pkgs, ... }:
{
  packages = [
    pkgs.ruby_3_4
    pkgs.bundler
    pkgs.libyaml
    pkgs.gnumake
  ];

  scripts.setup.exec = "bundle install";
  scripts.serve.exec = "bundle exec jekyll serve --livereload --host 0.0.0.0 --port 4000";
}
```

Enter the shell, run `devenv run setup` once, then `devenv run serve`. Same result on every machine.

This mattered fast. GitHub Pages gems currently require `commonmarker`, which caps at Ruby < 4.0. I pinned Ruby 3.4.8 and locked the `github-pages` gem at version 232. Without the pin, you'll hit dependency resolution failures the moment Ruby 4.x shows up on your system.

The Gemfile is two lines:

```ruby
source "https://rubygems.org"
gem "github-pages", "= 232", group: :jekyll_plugins
gem "webrick", "= 1.9.2"
```

`webrick` is there because Ruby 3.x dropped it from stdlib and Jekyll's local server needs it.

## DNS and Domain

DNS lives in Cloudflare for all things Fitzsky. Most of it routes through Cloudflare tunnels to self-hosted services — Mattermost, Gitea, that kind of thing. The blog is the exception: it's just a CNAME pointing at GitHub Pages.

```
devin  CNAME  devindudeman.github.io
```

A `CNAME` file in the repo root tells GitHub Pages to serve the custom domain, and HTTPS enforcement is on in the repo settings.

## Writing Flow

This is the best part. Open a file, write Markdown, push. That's it.

```bash
# new post
hx _posts/2026-03-11-whatever-im-writing-about.md

# front matter
---
title: Whatever I'm Writing About
description: One-line summary.
---

# write, commit, push
git add . && git commit -m "New post" && git push
```

Live in about 90 seconds. No build step to think about, no deploy to trigger. Push to `main` and it's on the internet.

Let's see how well I can keep this updated.
