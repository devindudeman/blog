---
title: "Just Plane Mosher: Real-Time Flights on a 7-Color E-Ink Display"
description: I built a flight tracker for a friend in San Francisco. A Raspberry Pi, a 7-color e-ink display, and some free APIs. The hard part was making text readable on a dithered watercolor map.
---

A friend of mine, Mosher, lives in San Francisco. He's into planes. I wanted to build him something that would show what's flying overhead right now, updated every few minutes, displayed on something that looks good sitting on a shelf. Not a phone app, not a web dashboard. A physical thing.

The result is [just-plane-mosher](https://github.com/devindudeman/just-plane-mosher): a Raspberry Pi Zero 2 W connected to a Pimoroni Inky Impression 7.3" e-ink display. It pulls live aircraft positions from free ADS-B APIs, plots them on a Stamen Watercolor map centered on the Haight, and renders the whole thing to a 7-color 800x480 screen. Planes show up as little colored arrows pointing in their heading direction, labeled with callsigns and routes. An info bar along the bottom shows the flight count and last update time.

The display refreshes every five minutes. Between refreshes it draws zero power from the screen. The whole thing runs headless off a micro USB cable.

## The display

The Inky Impression is a 7-color ACeP (Advanced Color ePaper) panel. "7-color" means it can show black, white, red, orange, yellow, green, and blue. That's it. Every pixel on the screen is exactly one of those seven colors. No gradients, no alpha blending, no antialiasing. If you want to show a photograph or a watercolor map, you have to quantize the entire image down to seven values per pixel and use dithering to fake the rest.

This is where the interesting problem starts.

## Two-layer rendering

Floyd-Steinberg dithering does a good job of making a 7-color image look like it has a much wider palette. The watercolor map tiles come back from Stadia Maps as full RGB, and after dithering they look beautiful on the display — soft blues for the bay, warm tans for land, the kind of thing you'd actually want on a shelf.

But dithering destroys small details. Text becomes unreadable. Thin lines dissolve into noise. A callsign label like "SWA2046" rendered onto the map before dithering comes out as a smeared mess of scattered pixels. The dithering algorithm doesn't know that those pixels are supposed to be letters. It just sees color values and spreads the quantization error around.

The fix is to never dither the things that need to be crisp. The renderer works in two passes:

**Layer 1** renders the watercolor map and a 10-nautical-mile range ring as a normal RGB image, then quantizes it to the 7-color palette with Floyd-Steinberg dithering. This produces a beautiful, soft background.

**Layer 2** draws directly onto the palette-indexed result using exact palette indices. Aircraft arrows, callsign labels, the altitude legend, and the info bar are all placed after dithering, pixel by pixel, in pure palette colors. Black text on white backgrounds. Colored arrows with black borders for contrast.

The key insight is that the Inky library skips its own internal dithering when it receives a pre-quantized palette image. So the crisp Layer 2 content passes through to the hardware untouched. Text stays sharp. Arrows stay clean. The map underneath stays beautifully dithered. Two rendering strategies on one screen, and the display driver doesn't need to know about either of them.

## Flight data

Aircraft positions come from [ADSB.lol](https://www.adsb.lol/), which aggregates data from volunteer-run ADS-B receivers worldwide. The API is free, requires no authentication, and returns every aircraft within a configurable radius of a lat/lon point. Each aircraft record includes position, altitude, heading, ground speed, callsign, registration, and aircraft type.

Callsigns alone aren't that interesting. "UAL875" tells you it's a United flight but not where it's going. So each flight gets enriched with route data from [ADSBdb](https://www.adsbdb.com/), another free API that maps callsigns to airline names and origin/destination airports. The label for a United flight becomes two lines: "UAL875" on top, "SFO>NRT" underneath. Now you're looking at a map and you can see that one is headed to Tokyo.

ADSBdb gets rate-limited to one request every 200ms, and results are cached for an hour. Callsigns that return 404 (charter flights, military, private aviation) get cached as misses so they don't keep hammering the API.

## Altitude as color

The seven available colors map naturally to altitude bands:

- **Red**: below 5,000 feet (departures, arrivals, low approaches)
- **Orange**: 5,000–15,000 feet (climbing, descending)
- **Yellow**: 15,000–30,000 feet (mid-altitude)
- **Blue**: above 30,000 feet (cruise)

Against the watercolor map, this works well. You can glance at the display and immediately tell which planes are coming or going (red/orange near SFO and OAK) versus which are passing through at cruise altitude (blue dots crossing the bay). Aircraft without heading data render as circles instead of arrows, which usually means they're on the ground or the receiver has incomplete data.

## Labels that don't collide

Thirteen flights over San Francisco means thirteen labels, and they overlap. The renderer checks each label's bounding box against every previously placed label. If there's a collision, it shifts the new label down. If the label would run off the right edge of the screen, it flips to the left side of the arrow. It's simple box collision, not a layout solver, but it handles the common case of three planes stacked on the SFO approach without turning the display into an unreadable mess.

## Map tiles and caching

The background map is assembled from [Stamen](http://maps.stamen.com/) tiles fetched through Stadia Maps. The tiles are 256x256 PNGs that get stitched together and cropped to fit the display's viewport. Three styles are available — Watercolor, Toner, and Terrain — and you can cycle between them with the buttons on the back of the display.

Map tiles are cached to disk. Stamen's tile set is static (the watercolor paintings aren't going to change), so the cache effectively never expires. The setup script pre-fetches all the tiles needed for the configured location and zoom level, so the first boot doesn't have to wait for network requests before it can render.

## Change detection

E-ink refreshes are slow. The 7-color ACeP panel takes about 40 seconds for a full refresh — you can watch the colors settle in waves across the screen. You don't want to do that if nothing has changed.

Before pushing a frame to the display, the renderer computes a SHA-256 hash of the image buffer and compares it to the last one sent. If the hash matches, it skips the refresh entirely. Late at night when air traffic drops off, the display might go an hour without updating. During the morning departure rush, it refreshes every cycle.

## Buttons

The Inky Impression has four physical buttons on the back, exposed via GPIO. Two of them are wired up:

- **Button A**: force an immediate refresh (wakes the main loop from its sleep)
- **Button B**: cycle through map styles

The button listener is interrupt-driven using `gpiod` edge detection, so it burns zero CPU while waiting. A press just sets a flag and nudges the main loop.

## Running it

The whole thing runs as a systemd service on Raspbian. A setup script handles SPI/I2C configuration, Python venv creation, dependency installation, tile pre-caching, and service registration. After setup, it starts on boot and restarts automatically on failure with exponential backoff.

The project is [on GitHub](https://github.com/devindudeman/just-plane-mosher). It's built for one specific display and one specific location, but the location is configurable via `.env` and the rendering approach would work for any 7-color e-ink panel. If you have an Inky Impression and want to watch planes, it's a `git clone` and a setup script away.
