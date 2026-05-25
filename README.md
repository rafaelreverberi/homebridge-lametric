# Homebridge LaMetric

Homebridge platform plugin for integrating LaMetric Time devices into Apple HomeKit.

This plugin exposes a LaMetric Time as native HomeKit controls for display power, app selection, brightness, volume, mute, and quick actions such as showing a configured crypto app or briefly waking the display.

## Features

- Exposes each LaMetric Time as multiple HomeKit accessories.
- Switch apps from the Home app by using TV input sources.
- Control display brightness with a HomeKit light accessory.
- Control speaker volume and mute with a HomeKit speaker accessory.
- Turn the display "off" by activating a configured blackout widget.
- Turn the display "on" by activating the clock widget.
- Optional helper switch to show a crypto widget temporarily.
- Optional helper switch to wake the display with a short brightness ramp.
- Supports one or more configured LaMetric devices.

## Requirements

- Homebridge 1.8.0 or newer
- Node.js 18, 20, or 22
- A LaMetric Time reachable on the local network
- A LaMetric developer API key for the device

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

### Single Device Example

```json
{
  "platform": "LaMetricPlatform",
  "name": "LaMetric",
  "ip": "192.168.1.52",
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
      "name": "Blackout",
      "package": "com.lametric.bc174be97cb45248d1b7f6003ed71600",
      "widget": "YOUR_BLACKOUT_WIDGET_ID"
    },
    {
      "id": "crypto",
      "name": "Crypto",
      "package": "com.lametric.439e235927e03d3f184562dd909174bf",
      "widget": "YOUR_CRYPTO_WIDGET_ID"
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
      "ip": "192.168.1.52",
      "port": 4343,
      "apiKey": "YOUR_LAMETRIC_API_KEY",
      "apps": [
        {
          "id": "clock",
          "name": "Clock",
          "package": "com.lametric.clock",
          "widget": "00000000000000000000000000000000"
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

Each app entry supports:

| Field | Required | Description |
| --- | --- | --- |
| `id` | No | Short identifier used by helper actions, for example `clock`, `blackout`, or `crypto`. |
| `name` | No | Display name shown in HomeKit input sources. |
| `package` | Yes | LaMetric app package identifier. |
| `widget` | Yes | LaMetric widget identifier. |

## HomeKit Accessories

For every configured LaMetric device, the plugin creates:

| Accessory | Purpose |
| --- | --- |
| LaMetric TV | Main on/off state and app input selection. |
| LaMetric Light | Display brightness and display active state. |
| LaMetric Speaker | Volume and mute controls. |
| Show Crypto | Momentary helper switch for showing the configured crypto widget. |
| Wake Display | Momentary helper switch for a short brightness wake animation. |

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

During development, link the plugin into your local Homebridge installation:

```sh
npm link
```

## Notes

- The plugin communicates with the LaMetric local API over HTTPS on port `4343` by default.
- The local LaMetric API uses a self-signed certificate, so the plugin accepts that certificate for device requests.
- Keep your LaMetric API key private. Do not commit real API keys to GitHub.

## License

Apache-2.0
