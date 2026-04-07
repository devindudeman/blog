---
title: "Streaming Expedition 33 from a Headless NixOS Desktop"
description: I wanted to play Expedition 33 well, and the Steam Deck couldn't do it. So I turned my desktop into a headless Sunshine box and streamed it to XR glasses through the Deck.
---

I wanted to play Expedition 33 well, and the Steam Deck couldn't do it. The game is built on Unreal Engine 5 and it asks for a lot of GPU. On the Deck it launched as "Unsupported," eventually got upgraded to "Playable," and even after the post-launch optimization update the recommended settings cap you at 30fps with the rendering preset cranked all the way down. Combat still drops below 25fps in some areas. People have written entire performance mods just to make it tolerable. The Deck does its best, but the APU is being asked to do something it can't.

The display side was already fine. I plug a pair of [Viture Pro XR glasses](https://www.viture.com/) into the Deck over USB-C and get a 1080p 120Hz virtual screen at around 135 inches floating in front of me. The Deck plus the glasses is a great portable display setup. The rendering is what falls over.

Meanwhile, my actual gaming desktop (5950X, 3090) sits in another room, doing nothing most of the time, and I'd rather play a JRPG on the couch than at a desk. So: Sunshine on the desktop, Moonlight on the Deck, full-fat NVENC streaming over the LAN. The 3090 renders Expedition 33 at high settings and a real frame rate, NVENC encodes the result, the Deck decodes it and pipes it straight to the glasses. The Deck stops trying to be a renderer and goes back to what it's actually good at: receiving input, decoding video, and sitting in my hands.

The catch is that the desktop has to behave like a normal GNOME session with no human and no monitor present, because there isn't one. Every weird piece of this config exists because of that constraint.

## Lying to the GPU

The 3090 won't bring up a video output without EDID data on the wire. With no monitor plugged in, GNOME boots into a dummy headless mode and Sunshine has nothing to capture. The fix is a passive HDMI EDID emulator: a [$10 dongle from Amazon](https://www.amazon.com/dp/B0D4Z7MR9G) that returns a fake "I am a 4K monitor" handshake. The kernel and NVIDIA driver bring up DP-1 with real modes, GNOME boots a normal session, and Sunshine has something to capture.

This is the cheapest part of the build. Without it, the rest of this config has nothing to point at.

## Lying to GDM

For Sunshine to capture a session, a session has to exist. So GDM auto-logs me in on boot:

```nix
services.displayManager.autoLogin = {
  enable = true;
  user = "devinbernosky";
};
```

A few extra knobs disable the foot-guns:

* `services.xserver.displayManager.gdm.autoSuspend = false`. By default GDM suspends the box at the login screen if nobody moves a mouse, which would defeat the entire point.
* The `gdm-autologin` PAM stack gets `enableGnomeKeyring = true` so the keyring unlocks without typing a password. Otherwise Steam, browsers, and everything else spam keyring prompts forever.
* Screen lock and idle activation are off in dconf, but I left inactive suspend after 30 minutes alone to save power. Wake-on-LAN handles the rest. Moonlight has built-in WoL support, so the Deck can cold-start the box from the couch.

## Lying to bwrap about Sunshine's parent

This was the hardest part to figure out and the most worth writing about.

Sunshine on Wayland captures via KMS, and KMS capture needs `CAP_SYS_ADMIN`. The NixOS module exposes that as one knob:

```nix
services.sunshine = {
  capSysAdmin = true;
  package = pkgs.sunshine.override { cudaSupport = true; };
};
```

`cudaSupport = true` flips Sunshine onto NVENC, which is the entire reason a 3090 is worth using as a streaming source. It also means this build can't come from the binary cache, it has to compile locally.

The non-obvious part is that `capSysAdmin = true` is poison for bubblewrap. Steam (and anything else sandboxed via bwrap) refuses to launch from a process tree that carries elevated capabilities, which is reasonable on bwrap's part but breaks every Sunshine "launch app" entry that just calls `steam`. I tracked this down through nixpkgs#463989 after spending way too long on Steam launching and immediately dying with no useful error.

The fix is that any command Sunshine launches has to drop back to a normal user context first. My "Steam Big Picture" entry looks like this:

```bash
sudo -u devinbernosky setsid steam -bigpicture
```

`sudo -u` strips the inherited capabilities. `setsid` detaches the new process from Sunshine's process group, so closing the stream from the Deck doesn't kill Steam along with it. Two small flags, a lot of pain saved.

## Lying to mutter about which monitor it has

The desktop's actual panel, when one is plugged in, is a 5120x1440 ultrawide at 120 Hz. The Steam Deck with the Viture glasses attached asks for 1080p at 120 Hz, which is what the glasses want. I don't want games launching at ultrawide resolutions and getting downscaled, and I don't want the Deck and the glasses negotiating with weird non-standard modes.

Sunshine has a `global_prep_cmd` setting that runs a script when a client connects and an "undo" script when it disconnects. Mine uses `gdctl`, the new GNOME display CLI that ships with mutter 49+, to actually reconfigure the compositor on the fly:

* `sunshine-switch` reads `$SUNSHINE_CLIENT_WIDTH` and `$SUNSHINE_CLIENT_HEIGHT`, asks `gdctl show -v` for a matching mode on DP-1, and switches to it.
* `sunshine-restore` puts the desktop back to 5120x1440@119.999 when the stream ends.

The wrinkle is that `gdctl` has to talk to the user's mutter over D-Bus, and Sunshine's user service doesn't inherit that environment cleanly. Each call gets wrapped:

```bash
sudo -u devinbernosky DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gdctl ...
```

Same `sudo -u` trick as the Steam launcher, doing double duty: dropping caps and re-entering the right session bus.

## Cleaning up after suspend

Resuming from suspend leaves NVENC in a strange state. Sunshine keeps running but its encoder handles are stale, so streams fail to start until I restart the service manually. A small oneshot fixes this automatically:

```nix
systemd.services.sunshine-resume = {
  after = [ "systemd-suspend.service" "nvidia-resume.service" ];
  wantedBy = [ "suspend.target" "hibernate.target" "hybrid-sleep.target" ];
  serviceConfig = {
    Type = "oneshot";
    ExecStartPre = "${pkgs.coreutils}/bin/sleep 5";
    ExecStart = "systemctl --user --machine=devinbernosky@.host restart sunshine.service";
  };
};
```

The `--machine=devinbernosky@.host` flag is what lets a system unit poke the user's systemd instance. It's the cleanest way to bounce a user service from PID 1 without writing a polkit rule.

There's also an `ExecStartPre = sleep 10` on the Sunshine user service itself, to give GNOME enough time to bring DP-1 up before Sunshine probes for displays on first boot. Without it, Sunshine occasionally latches onto a "no monitors" state and just sulks.

## Input

`hardware.uinput.enable = true`, plus adding my user to the `input` group, is the workaround for nixpkgs#455737. Sunshine needs to write to `/dev/uinput` to inject controller and keyboard events from the Deck. Without it the stream connects fine but the controller does nothing, which is its own kind of frustrating.

## Desktop-only gaming polish

A bunch of this stuff doesn't belong on my travel laptops. They shouldn't be opening Steam Remote Play firewall ports or disabling OpenSnitch. So I split it out into `hosts/desktop/gaming.nix` and only the desktop pulls it in:

* `proton-ge-bin` and `protontricks` for games that need community Proton builds. Expedition 33 was a GE-fork target early on.
* `programs.gamemode` enabled with `renice = 10` so launched games get `nice -10`.
* OpenSnitch off, because per-connection prompts will absolutely ruin a streaming session.
* `programs.steam.remotePlay.openFirewall = true` and `localNetworkGameTransfers.openFirewall = true`.

And on the Home Manager side, in `hosts/desktop/home.nix`:

* Tiling Shell instead of Pop Shell. Pop's tiling assumes 16:9-ish geometry and is miserable at 5120x1440. Tiling Shell lets me draw custom snap zones for the ultrawide.
* NVIDIA shader cache pinned to 10 GB with `__GL_SHADER_DISK_CACHE_SIZE` and `__GL_SHADER_DISK_CACHE_SKIP_CLEANUP=1`. The driver's default tiny cache evicts compiled shaders mid-game and you get stutter every time it has to recompile.
* An XDG autostart entry that launches `steam -silent` on login. The moment GDM auto-logs in, Steam is already sitting in the tray waiting for Moonlight to connect.

## The little things

* `boot.kernelPackages = pkgs.linuxPackages_latest` and `boot.initrd.systemd.enable = true` for a fast headless boot. I dropped Plymouth because there's nobody to look at the splash screen.
* `hardware.nvidia.open = true` because Ampere is on the open kernel modules now per NVIDIA's recommendation.
* `services.ollama.acceleration = "cuda"`. The same 24 GB of VRAM that streams Expedition 33 also runs local LLMs when nobody is gaming.
* `networking.interfaces.enp39s0.wakeOnLan.enable = true` so the Deck can wake the box from a cold suspend.
* CoolerControl for the NZXT Kraken AIO, so the 5950X doesn't thermal-throttle mid-session.

## Does it work?

Yes, perfectly. The desktop sits suspended most of the time. When I want to play, I put on the glasses, pick up the Deck, and open Moonlight. Moonlight's built-in Wake-on-LAN wakes the box, GDM auto-logs in, Sunshine comes up, the resolution switches to 1080p120 to match what the glasses want, and Steam launches into Big Picture. The 3090 renders Expedition 33, NVENC encodes the stream, the Deck decodes it, and the glasses show me the result. When I close the stream the desktop drops back to idle, hits the 30-minute inactivity timeout, and goes back to sleep on its own.

The Wake-on-LAN piece matters more than it might sound. A 3090 at idle still pulls real wattage, and the whole system sitting up 24/7 just to be "available" would burn 80-100W around the clock for nothing. With WoL doing the heavy lifting, the desktop is at near-zero power most of the day. The Deck wakes it on demand, I get full 3090 performance for as long as I want, and then it puts itself back to sleep without any thought from me.

The whole thing is in my NixOS config. If you find this post by searching for some variant of "Sunshine launches Steam and Steam immediately dies on Wayland," the answer is `sudo -u $USER setsid <command>`. The bubblewrap-vs-`CAP_SYS_ADMIN` interaction took me longer to track down than I'd like to admit, and I'm leaving this here so the next person doesn't have to.
