# homekit-camera-proxy

A minimal HomeKit proxy for [Frigate](https://frigate.video) cameras. Publishes each Frigate
camera to Apple Home as its own standalone accessory (accessory mode — HAP serializes
requests per connection, so bridged cameras would delay each other) with:

- **Live streaming** — ffmpeg relays the go2rtc RTSP restream as SRTP (H.264 `-c:v copy` by default)
- **Snapshots** — served from Frigate's `latest.jpg` API (no ffmpeg spawn)
- **Motion sensors** — fed by Frigate's WebSocket API (raw motion or object labels like `person`)
- **Two-way audio** — talkback via go2rtc's backchannel on supported cameras
- **Doorbell** — HomeKit Doorbell accessory; button presses come from the camera's ONVIF `Visitor` event (Reolink)

Explicitly **not** supported: HomeKit Secure Video recording (Frigate is the NVR), web UI, plugins.

## Configuration

See [config.example.yaml](config.example.yaml). Values may reference environment variables
with `${VAR_NAME}`.

Notes:

- `hap.usernameSeed` + the camera name derive each accessory's stable HAP identity.
  Changing the seed, renaming a camera, or losing `persistDir` unpairs that accessory
  from HomeKit (room assignments and automations for it are lost).
- `streams.main`/`streams.sub` are go2rtc stream names, or full `rtsp://` URLs to bypass
  Frigate and connect to a camera directly.
- Two-way audio requires the camera's go2rtc source to have a backchannel (e.g. Reolink:
  `rtsp://…#backchannel=1`; Dahua/Amcrest: `dvrip://`) in the Frigate config.

## Running

```sh
npm ci
npm run dev -- config.local.yaml     # requires Node 22+ and ffmpeg with libfdk_aac
```

The Docker image bundles a static ffmpeg with `libfdk_aac` (AAC-ELD) from
[ffmpeg-for-homebridge](https://github.com/homebridge/ffmpeg-for-homebridge).

Deployment manifests live in the homie-lab repo (`apps/home/homekit-camera-proxy/`):
`hostNetwork: true` so mDNS advertisement and SRTP UDP reach the LAN, with HAP pairing
state on a persistent volume at `persistDir`.

## Health

`GET /healthz` (default port 9891) returns `{bridgePublished, wsConnected, cameras, activeStreams}`.
Returns 503 only if the bridge failed to publish — a dropped Frigate connection degrades
motion/snapshots but must not restart the pod, since live streaming still works.
