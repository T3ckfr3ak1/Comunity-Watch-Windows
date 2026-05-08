# Intel rules (self-updating database)

This folder holds the app's classification intelligence.

- `rules.bundled.json`: shipped with the app so it can categorize activity even on first run.
- Future: download a signed `rules.latest.json` from a trusted endpoint, validate signature, then atomically swap the local rules file.

Privacy note: these rules are for **local classification**. The default bark is blind and includes no category/location/device info.

