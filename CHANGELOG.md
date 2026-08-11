# Changelog

All notable changes to Homebridge LaMetric are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.7] - 2026-08-11

### Changed

- Reduced normal Homebridge log output to important lifecycle events, warnings, and errors.
- Moved HTTP traffic, status polling, app detection, brightness, volume, and remote-control details to debug logging.

### Fixed

- Log an unreachable LaMetric device only once until it recovers.
- Pause repeated requests to an unavailable device and allow only one retry probe per minute.
- Suppress repeated Homebridge write-handler errors while an unavailable device is in its retry pause.
- Report once when an unavailable device becomes reachable again.
- Added release-gating tests for logging and connection retry behavior.

## [1.1.6] - 2026-07-13

### Added

- Added Homebridge Verified and sponsor badges to the README.

## [1.1.5] - 2026-07-13

### Changed

- Updated repository metadata to use the public HTTPS GitHub URL.
- Added sponsor metadata to the npm package.

## [1.1.4] - 2026-05-27

### Fixed

- Fixed the radio play/pause remote-control toggle.

[1.1.7]: https://github.com/rafaelreverberi/homebridge-lametric/compare/v1.1.6...v1.1.7
[1.1.6]: https://github.com/rafaelreverberi/homebridge-lametric/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/rafaelreverberi/homebridge-lametric/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/rafaelreverberi/homebridge-lametric/compare/v1.1.3...v1.1.4
