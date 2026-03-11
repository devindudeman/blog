---
title: "NixClaw: Declarative AI Agents on NixOS"
description: How I built a single-purpose NixOS VM that runs AI agents with their own git-backed workspaces, deployed in one command from a MacBook to Proxmox.
toc: true
---

I wanted AI agents I could spin up per-project, each with its own workspace and chat channel, running on infrastructure I control. A proper declarative system where the entire machine — disk layout, services, secrets, agent bindings — lives in version-controlled Nix.

NixClaw is what I ended up building. It's a dedicated NixOS VM on Proxmox that runs an [OpenClaw](https://github.com/openclaw/openclaw) agent gateway connected to my self-hosted Mattermost. Each agent gets a private Gitea repo, a Mattermost channel, and a workspace that auto-syncs every 15 minutes. The whole thing deploys from my MacBook in one command.

## The Stack

The pieces:

- **Proxmox 8.x** — QEMU/KVM hypervisor, already running my homelab
- **NixOS 25.11** — the OS, declared in ~300 lines of Nix
- **nixos-anywhere + disko** — remote provisioning, declarative disk partitioning
- **OpenClaw** — the agent gateway, MIT licensed, Mattermost-native
- **Mattermost** — self-hosted chat at `mattermost.fitzsky.com`
- **Gitea** — self-hosted git at `gitea.fitzsky.com`, HTTPS auth
- **sops-nix + age** — encrypted secrets, one key, one file
- **Tailscale** — SSH access, zero open ports
- **Podman** — rootless containers for agent tool sandboxing
- **Brave Search API** — gives agents web search as a built-in tool

Everything is Nix except the mutable agent bindings file (`agents.json5`), which the gateway hot-reloads. That's intentional — I don't want to `nixos-rebuild` every time I create an agent.

## Architecture

```
Proxmox VM "nixclaw" (NixOS 25.11, x86_64-linux)
├─ devinbernosky (admin) — SSH over Tailscale
└─ openclaw (service user)
   ├─ openclaw-gateway — HM user service, loopback-only :18789
   ├─ Mattermost bot "Operator" — routes messages to agents
   ├─ Per-project workspaces — git repos on Gitea
   ├─ Shared files — USER.md + TOOLS.md symlinked into all workspaces
   ├─ Podman sandbox — rootless containers for tool execution
   ├─ Brave web search — built-in tool
   └─ git-sync timer — auto-commits every 15min
```

Two users. The admin (`devinbernosky`) SSHs in over Tailscale and manages config. The service user (`openclaw`) runs the gateway as a Home Manager user service and owns all the workspaces. Clean separation.

## Prerequisites

Before touching Nix, I needed three external services ready.

**Mattermost:** Create a bot account (I called mine "Operator"), save the token. Grab your team ID:

```bash
curl -s https://mattermost.fitzsky.com/api/v4/teams \
  -H "Authorization: Bearer <bot-token>" | jq '.[0].id'
```

**Gitea:** Create a "NixClaw" organization, a `skills` repo for shared agent skills, and an access token. One thing to know: if Gitea runs behind Docker, SSH won't work because the host's sshd grabs port 22 first. Everything goes over HTTPS.

**Brave Search:** Grab an API key from [brave.com/search/api](https://brave.com/search/api/). That's it.

## The VM

In Proxmox, create a VM with UEFI (OVMF), q35 machine type, VirtIO SCSI, and QEMU agent enabled. I gave mine 256GB disk, 10 CPU threads, and 8GB RAM. That's probably overkill for what amounts to a gateway process, but I had the headroom.

Boot the NixOS 25.11 minimal ISO. At the boot menu, pick "Linux LTS" — that's a kernel option in the boot menu, not a separate ISO.

## Deploying in One Shot

This is where it gets fun. nixos-anywhere lets you go from a live ISO to a fully configured NixOS install in one command, from your local machine.

On the VM console, set a temp root password and note the IP:

```bash
sudo passwd root
ip addr
```

On your Mac, stage the age key so sops-nix can decrypt secrets on the new system:

```bash
mkdir -p /tmp/nixclaw-extra/root/.config/sops/age
cp ~/.config/sops/age/keys.txt /tmp/nixclaw-extra/root/.config/sops/age/keys.txt
chmod 600 /tmp/nixclaw-extra/root/.config/sops/age/keys.txt
```

Then deploy:

```bash
nix run github:nix-community/nixos-anywhere -- \
  --flake "path:$HOME/Github/nix-config#nixclaw" \
  --extra-files /tmp/nixclaw-extra \
  root@<VM_IP>
```

This partitions the disk (via disko), installs NixOS from the flake, copies the age key into place, and reboots. The whole system — users, services, secrets, agent gateway — materializes from the flake definition.

One subtlety: nixos-anywhere SSHs into the live ISO's sshd, which allows root login by default. The `PermitRootLogin = "no"` in my system config only takes effect after install. No conflict.

## Post-Boot

SSH in as the admin user with the default password:

```bash
ssh devinbernosky@<VM_IP>
# password: changeme
```

**Tailscale first:**

```bash
sudo tailscale up --ssh
passwd  # change from default immediately
```

After Tailscale is up, `ssh nixclaw` works from any device on the tailnet. No passwords, no port forwarding, no DNS records. From here on, everything goes through Tailscale.

**Clone the nix-config repo.** On a fresh system, Home Manager hasn't activated yet, so `gh` isn't on PATH. Bootstrap with `nix run`:

```bash
nix run nixpkgs#gh -- auth login
nix run nixpkgs#gh -- repo clone devindudeman/nix-config ~/nix-config
```

**Rebuild:**

```bash
cd ~/nix-config/hosts/nixclaw
just deploy
```

This activates everything — sops secrets get decrypted, the gateway starts, `GH_TOKEN` lands in fish shell, SSH sessions start auto-cd'ing to the host config directory. Reconnect and verify:

```bash
ssh nixclaw
just status   # gateway should be active
just logs     # should show "connected as Operator"
```

One more thing — clone the shared skills repo:

```bash
just clone-skills
```

## Creating Agents

This is the daily workflow. One command:

```bash
just new-agent <project-name>
```

Behind the scenes, this:

1. Creates a private Gitea repo in the NixClaw org
2. Initializes a workspace from template (real files, not symlinks)
3. Symlinks shared `USER.md` and `TOOLS.md` into the workspace
4. Pushes initial commit to Gitea
5. Creates a public Mattermost channel (or restores it if soft-deleted)
6. Adds the bot and my user as channel members
7. Patches `agents.json5` — the gateway hot-reloads, no restart needed

Send a message in the new channel. The agent responds immediately, no @mention required (`chatmode: "onmessage"`).

Tearing one down is just as clean:

```bash
just delete-agent <project-name>
```

## Day-to-Day

SSH sessions land in the host config directory automatically. Everything runs through the justfile:

```bash
# Gateway
just status     # is it running?
just logs       # tail the log
just restart    # bounce it

# Config updates
just pull       # git pull --rebase
just deploy     # nixos-rebuild switch
just push       # push changes back

# Agents
just new-agent <name>
just delete-agent <name>
just sync       # trigger manual git sync
```

Config changes go through the normal Nix workflow: edit, rebuild, push. Agent lifecycle is entirely outside Nix — just the justfile and the mutable `agents.json5`.

## What's Automated, What's Not

**Automated:**
- Gateway starts on boot (systemd lingering)
- Mattermost config injected via `ExecStartPre`
- Secrets decrypted from sops at service start
- Workspaces sync to Gitea every 15 minutes
- `GH_TOKEN` available in shell from sops

**Manual:**
- Initial `gh auth login` (chicken-and-egg with `GH_TOKEN` on first deploy)
- One-time Tailscale auth
- Agent creation (`just new-agent`)
- Updating shared USER.md and TOOLS.md content

The line between automated and manual is intentional. Agent creation is a human decision. Everything after that decision is automated.

## Design Decisions Worth Noting

**Why not SSH for Gitea?** I run Gitea in Docker, and the host's sshd intercepts port 22. I could remap ports, but HTTPS with token auth works fine and is one less thing to debug.

**Why a mutable agents.json5?** I didn't want agent creation to require a full Nix rebuild. The gateway watches this file and hot-reloads when it changes. Nix manages the system, the justfile manages agents.

**Why public Mattermost channels?** I want to be able to browse agent conversations from any device. The Mattermost instance is self-hosted and private anyway — "public" just means visible within the team.

**Why file-based gateway logs?** OpenClaw logs to `/tmp/openclaw/openclaw-gateway.log`, not journald. That's how the upstream packages it. `just logs` wraps `tail -f` on that path.

**Why Podman, not Docker?** Rootless. The `openclaw` user runs containers without root privileges. This matters when you're giving AI agents the ability to execute code.

## What I'd Do Differently

Honestly, not much. The deploy story with nixos-anywhere is excellent — going from bare VM to running agents in one command still feels like magic. If I were starting over, I might explore running the gateway in a container itself for even more isolation, but the current setup with a dedicated service user and rootless Podman for tool execution is clean enough.

The biggest friction point is the initial `gh auth login` bootstrap. On a completely fresh system, you need `gh` to clone the repo that provides `gh`. The `nix run nixpkgs#gh` workaround handles it, but it's one of those things that makes you appreciate the chicken-and-egg problems in declarative systems.

If you're running OpenClaw or thinking about self-hosted AI agents, the NixOS approach is worth the investment. Declarative config means I can blow away the VM and rebuild it from scratch in minutes. Every decision is documented in code. And when something breaks, `just logs` is one command away from the answer.
