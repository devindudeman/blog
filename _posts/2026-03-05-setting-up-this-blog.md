---
title: Setting Up This Blog
description: How I put devin.fitzsky.com together with Jekyll, GitHub Pages, Cloudflare, and a reproducible dev setup.
---

Been meaning to set one of these up for a while. I have always liked GitHub Pages, so I went with that. I had never used Jekyll before, but it felt like the right path for a personal site where the main job is writing and publishing cleanly.

I started from an empty repo and scaffolded a basic Jekyll structure with layouts, includes, posts, and a small set of pages. The first pass looked a little too playful, so I tightened the design into something sleeker and more minimal. Sharper typography, cleaner spacing, less decoration, and a style that stays out of the way of the writing.

Deploys run through GitHub Actions on pushes to `main`. The workflow builds the Jekyll site and ships it to Pages automatically. I hit one setup error early where `configure-pages` returned a `Not Found` response. That turned out to be a bootstrap issue, and setting the action to enable Pages during the run fixed it.

I love Nix and devenv, so that part was an easy choice. The repo now has a reproducible dev environment, which means setup is consistent across machines instead of relying on whatever Ruby version happens to be installed.

That mattered quickly, because GitHub Pages dependencies currently cap part of the stack below Ruby 4. I pinned the latest compatible Ruby line, locked gem versions with `Gemfile.lock`, and kept the toolchain stable.

Writing flow feels super easy. Open a post file, write in Markdown, push, done. And who does not love Markdown.

DNS is in Cloudflare for all things Fitzsky. A lot of that routes back to Tailscale, and I like carving out little pieces for static public content like this.

Let's see how well I can keep this updated, shall we?
