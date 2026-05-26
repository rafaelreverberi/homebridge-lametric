# Homebridge LaMetric

Homebridge platform plugin for integrating LaMetric Time devices into Apple HomeKit.

This plugin exposes a LaMetric Time as native HomeKit controls for display power, app selection, brightness, volume, mute, and optional configurable actions. It uses the LaMetric local API and does not require any cloud service for normal HomeKit control.

The plugin does not include analytics, telemetry, or user tracking.

## Features

- Exposes each LaMetric Time as one HomeKit accessory with multiple services.
- Switch apps from the Home app by using TV input sources.
- Control display brightness from the same HomeKit accessory.
- Control speaker volume and mute from the same HomeKit accessory.
- Turn the display "off" by activating a configured blackout widget.
- Turn the display "on" by activating the clock widget.
- Optional configurable helper switches for temporary app display and display wake actions.
- Supports one or more configured LaMetric devices.
- Automatically removes stale HomeKit accessories when a device IP changes.

## Requirements

- Homebridge 1.8.0 or newer
- Node.js 22 or 24
- A LaMetric Time reachable on the local network
- A LaMetric developer API key for the device
- The [BlackScreen LaMetric app](https://apps.lametric.com/apps/blackscreen/15495?apps_for=time) if you want HomeKit off/on to blank the display

### BlackScreen App

LaMetric Time does not provide a real hardware display-off command through the local API. To make the HomeKit power toggle blank the display, install the BlackScreen app on your LaMetric Time:

- App Store: [BlackScreen for LaMetric Time](https://apps.lametric.com/apps/blackscreen/15495?apps_for=time)
- Source: [rafaelreverberi/lametric-blackscreen](https://github.com/rafaelreverberi/lametric-blackscreen)

The plugin can discover the installed BlackScreen app automatically. You can also add it explicitly in `apps` with the id `blackout` if you want stable naming.

## Installation

Install the plugin in your Homebridge environment:

```sh
npm install -g homebridge-lametric
```

Then add the platform to your Homebridge configuration.

## Configuration

The platform name is:

```json
"platform": "LaMetricPlatform"
```

The LaMetric API port is `4343` by default. Only change it if you know your device is using a custom local API port.

### Single Device Example

```json
{
  "platform": "LaMetricPlatform",
  "name": "LaMetric",
  "ip": "192.168.1.21",
  "port": 4343,
  "apiKey": "YOUR_LAMETRIC_API_KEY",
  "apps": [
    {
      "id": "clock",
      "name": "Clock",
      "package": "com.lametric.clock",
      "widget": "00000000000000000000000000000000"
    },
    {
      "id": "blackout",
      "name": "BlackScreen",
      "package": "YOUR_BLACKSCREEN_PACKAGE_ID",
      "widget": "YOUR_BLACKOUT_WIDGET_ID"
    },
    {
      "id": "crypto",
      "name": "Crypto",
      "package": "com.lametric.439e235927e03d3f184562dd909174bf",
      "widget": "YOUR_CRYPTO_WIDGET_ID"
    }
  ],
  "actions": [
    {
      "enabled": false,
      "id": "showCrypto",
      "name": "Show Crypto",
      "type": "temporaryApp",
      "appId": "crypto",
      "restoreAppId": "clock",
      "durationMs": 80500
    },
    {
      "enabled": false,
      "id": "wakeDisplay",
      "name": "Wake Display",
      "type": "wakeDisplay",
      "restoreAppId": "clock",
      "durationMs": 5000,
      "minBrightness": 2,
      "maxBrightness": 25,
      "step": 5,
      "stepIntervalMs": 200
    }
  ]
}
```

### Multiple Device Example

```json
{
  "platform": "LaMetricPlatform",
  "name": "LaMetric",
  "devices": [
    {
      "id": "office",
      "name": "Office LaMetric",
      "ip": "192.168.1.21",
      "port": 4343,
      "apiKey": "YOUR_LAMETRIC_API_KEY",
      "apps": [
        {
          "id": "clock",
          "name": "Clock",
          "package": "com.lametric.clock",
          "widget": "00000000000000000000000000000000"
        }
      ],
      "actions": [
        {
          "enabled": false,
          "id": "wakeDisplay",
          "name": "Wake Display",
          "type": "wakeDisplay"
        }
      ]
    }
  ]
}
```

## App Configuration

LaMetric apps are identified by package and widget IDs. The plugin can discover installed apps from the device, but defining important apps explicitly gives stable names and enables special actions.

Recommended app IDs:

- `clock`: used when HomeKit turns the display on.
- `blackout`: used when HomeKit turns the display off.
- `crypto`: used by the `Show Crypto` helper switch.

For display-off support, install the [BlackScreen app](https://apps.lametric.com/apps/blackscreen/15495?apps_for=time). The app is maintained at [rafaelreverberi/lametric-blackscreen](https://github.com/rafaelreverberi/lametric-blackscreen).

Each app entry supports:

| Field | Required | Description |
| --- | --- | --- |
| `id` | No | Short identifier used by helper actions, for example `clock`, `blackout`, or `crypto`. |
| `name` | No | Display name shown in HomeKit input sources. |
| `package` | Yes | LaMetric app package identifier. |
| `widget` | Yes | LaMetric widget identifier. |

## Action Configuration

Actions are optional HomeKit switches. They are hidden unless `enabled` is set to `true`.

Supported action types:

| Type | Purpose |
| --- | --- |
| `temporaryApp` | Activates an app/widget for a configured duration, then restores another app. |
| `wakeDisplay` | Briefly raises display brightness, then dims back down and restores the previous app. |

Each action supports:

| Field | Description |
| --- | --- |
| `enabled` | Set to `true` to expose the action as a HomeKit switch. |
| `id` | Stable action identifier. Keep this stable after pairing to avoid duplicate HomeKit services. |
| `name` | Display name shown in HomeKit. |
| `type` | `temporaryApp` or `wakeDisplay`. |
| `appId` | App id/name/package from the `apps` list. Used by `temporaryApp`. |
| `package` / `widget` | Direct LaMetric app package and widget IDs. Alternative to `appId`. |
| `restoreAppId` | App to restore after the action, typically `clock`. |
| `durationMs` | Action duration in milliseconds. |
| `minBrightness`, `maxBrightness`, `step`, `stepIntervalMs` | Brightness ramp settings for `wakeDisplay`. |

## HomeKit Accessory

For every configured LaMetric device, the plugin creates one accessory containing:

| Service | Purpose |
| --- | --- |
| Television | Main on/off state and app input selection. |
| Lightbulb | Display brightness and display active state. |
| TelevisionSpeaker | Volume and mute controls. |
| Switch | One switch per enabled action. |

## Development

Install dependencies:

```sh
npm install
```

Build the plugin:

```sh
npm run build
```

Run linting:

```sh
npm run lint
```

Start a local Homebridge instance with the Homebridge UI and the local plugin build:

```sh
npm run debug:homebridge
```

The local UI opens at `http://localhost:8581`. The test storage lives in `.local-homebridge-test/` and is ignored by git.

To install a local package into another Homebridge installation:

```sh
npm pack
npm install -g ./homebridge-lametric-1.1.1.tgz
```

If Homebridge runs on the same machine and you prefer npm linking:

```sh
npm link
```

Restart Homebridge after linking or installing a local package.

## Release Checklist

Before publishing a new version:

```sh
npm install
npm run lint
npm run build
npm pack --dry-run
```

Publish to npm:

```sh
npm publish
```

Push to GitHub:

```sh
git status
git add README.md config.schema.json package.json package-lock.json src/platform.ts src/platformAccessory.ts scripts/local-homebridge-ui.sh .gitignore
git commit -m "Release v1.1.1"
git push origin main
git tag v1.1.1
git push origin v1.1.1
```

Then create a GitHub release for the same version tag with release notes.

After publishing, users can update with:

```sh
npm install -g homebridge-lametric@latest
```

Then restart Homebridge.

## Notes

- The plugin communicates with the LaMetric local API over HTTPS on port `4343` by default.
- The local LaMetric API uses a self-signed certificate, so the plugin accepts that certificate for device requests.
- Keep your LaMetric API key private. Do not commit real API keys to GitHub.
- If the LaMetric IP changes, update the Homebridge config and restart Homebridge. The plugin removes stale cached LaMetric accessories automatically.

## License

Apache-2.0
