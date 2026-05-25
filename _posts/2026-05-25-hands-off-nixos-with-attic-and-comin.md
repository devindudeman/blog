---
title: "Hands-off NixOS across my laptops with Attic + comin"
description: How I keep three NixOS laptops on the same config without thinking about it, with a self-hosted Attic binary cache so they pull expensive builds instead of recompiling, and comin for GitOps pull-deploys.
---

Nix's whole appeal is reproducibility: declare a system once and rebuild it anywhere to get the same machine, the same configuration everywhere. The catch is that reproducibility is a property of one build on one machine. It says nothing about keeping a fleet in step, or about sharing build work so the same package doesn't get compiled on each box. That's the gap I wanted to close across my laptops.

I run NixOS on three laptops, an LG Gram, an ASUS Zenbook Duo, and a ThinkPad, all built from a single flake. I only ever use one at a time, whichever suits my mood that day.

The goal: whichever laptop I open should already be running my latest config, and any builds it needs should come from a local cache instead of compiling on the machine. No rebuild waiting when I lift the lid, and no battery burned on something another machine already built.

Two pieces get there. A self-hosted [Attic](https://github.com/zhaofengli/attic) binary cache holds the builds, and [comin](https://github.com/nlewo/comin) handles automatic switching as a GitOps pull-deploy.

## The problem: catch-up rebuilds eat laptop battery

Before this, picking a laptop meant catching it up. Whichever one I grabbed had fallen behind whatever I'd changed since I last used it, so I'd rebuild, and on a laptop some of those rebuilds are a real battery and thermal event.

The reason is that some packages have to be built locally no matter what. Unfree packages aren't on the public Hydra cache by policy, and veracrypt is a good example. Its license was historically marked unfree, so Hydra hasn't built it since 2021. Every flake bump that perturbs one of its transitive deps (wxGTK, fuse, lvm2, gtk3) means a local rebuild of around ten minutes. Electron apps are worse, often 30 to 60 minutes from source. Pinning to an older nixpkgs doesn't help, because no commit has a cached binary either.

On a desktop that's just annoying. On a laptop it costs you fan noise and a chunk of charge. And because I rotate between machines, the same ten-minute veracrypt build happened independently on each one, three separate compiles for a single config change, spread out over whenever I happened to pick each laptop up.

## Attic: build once, pull everywhere

Attic is a self-hosted Nix binary cache. Mine runs as a native container on my always-on Unraid box, reachable over Tailscale. Pull is unauthenticated over the tailnet, since it's only ever reachable on my private network.

The point is that nothing builds twice across the fleet. Every host pushes new store paths as it produces them, so the first machine to rebuild after a change seeds the cache and the others just pull. There's no dedicated builder. Whichever laptop I'm on when I first rebuild eats that compile once, and my desktop (a 5950X with an RTX 3090) chips in its CUDA builds on the occasions I wake it over Wake-on-LAN for GPU work, like running a 27b model in opencode. Pushing is an async systemd service rather than a build hook:

```nix
systemd.services.attic-watch-store = {
  description = "Push new nix store paths to the racer5 attic cache";
  wantedBy = ["multi-user.target"];
  serviceConfig = {
    ExecStart = "${pkgs.attic-client}/bin/attic watch-store nix-config";
    Restart = "always";
    RestartSec = 30;
  };
};
```

`watch-store` runs in the background and never blocks a build. I tried a `nix` post-build-hook first and it was the wrong tool, since it's synchronous and pushes whole closures, which stalled deploys. Attic filters out `cache.nixos.org` paths automatically, so only genuinely uncached stuff gets stored, and it's content addressed, so two hosts pushing the same path store it once. One caveat: keep `-j` at 5 or below, because atticd's SQLite serializes writes and a higher count exhausts the connection pool.

The payoff is exactly the problem above. That veracrypt build now happens once, anywhere, and every other machine substitutes the binary.

## comin: push to main, laptops switch themselves

The cache solves what gets built. comin solves who triggers the build. It's a GitOps pull-deploy: each host polls the repo and rebuilds its own config, selected by hostname, whenever main advances, with automatic rollback if the new generation fails.

```nix
services.comin = {
  enable = true;
  remotes = [{
    name = "origin";
    url = "https://github.com/devindudeman/nix-config.git";
    branches.main.name = "main";
    auth.access_token_path = config.sops.secrets.github_pat.path;
    poller.period = 60;  # new commits land within 60s
  }];
};
```

No control node pushing anywhere; each laptop pulls for itself. comin runs as a service, and the result is that whichever machine I open is already current. It caught up in the background the last time it was awake. If it ever gets intrusive on battery, I can raise `poller.period` or require a deploy confirmation.

## Every device on the same config, all the time

This is the part I didn't expect to love so much. Because every host converges on main automatically, the laptop I'm not using stays just as current as the one I am. Switching machines on a whim stops being a "let me rebuild first" moment. That matters most for the things I tweak constantly:

- Agent skills. My Claude Code and Codex skills are declared in the flake. I add a skill in one place, push, and the next time each laptop is awake it has it. No copying files around, no wondering which machine has the good version.
- MCP servers. Same story. The declarative MCP config lands on every host, so an agent behaves identically whether I'm on the Gram or the ThinkPad.
- Everything else. Shell, editor, fonts, secrets wiring. The same on whichever machine I reach for, continuously, instead of being the same only on the day I last remembered to rebuild it.

`just update` ties it together: bump flake inputs, rebuild locally, auto-commit, push, and the bump fans out to every laptop via comin.

## What's next: CI that builds each host ahead of time

Today the cache only warms when a machine happens to build first, and that machine is usually a laptop eating the compile I was trying to avoid. The next step is to make seeding deliberate, with a CI pipeline that builds every host's full configuration on each push to main and pushes the results to Attic before any laptop polls.

That flips the timing. Instead of the first machine I happen to open eating the rebuild and seeding the cache for the rest, the cache would already be warm by the time any host checks for changes. Every laptop would do a pure substitute with no local compilation at all, even for the unfree and Electron packages. It also turns a broken commit into a red build instead of a failed deploy I notice later. Garnix or a small self-hosted runner pointed at the same Attic cache would both do the job.

## Gotchas worth knowing

- comin watches main, so merge before you activate comin on a new host, or it'll happily deploy the old main.
- Pull is unauthenticated over the tailnet by design. It's only reachable on the private network, so don't expose that port.
- Keep `-j` at 5 or below on pushes. A higher count exhausts atticd's SQLite connection pool.
