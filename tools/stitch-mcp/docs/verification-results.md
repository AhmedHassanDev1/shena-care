# Verification results

The adapter's `npm test` suite passed all 15 tests on 2026-09-30 after moving it into this repository. The suite covers stdio transport, authenticated upstream simulation, input validation, write gating, exports, URL restrictions, size limits, and error behavior.

On this workstation, `--check` reached `https://stitch.googleapis.com/mcp` with the existing Stitch credential. It discovered `get_project`, `list_projects`, `list_screens`, `get_screen`, `get_screen_content`, and `export_screen`, and reported `writesEnabled: false`. This is live authentication and discovery, not a new project/screen export test. Previous project/screen and export checks are described in [the adapter README](../README.md).

No Stitch write operation was invoked during this verification. The API key and machine CA bundle are stored outside this repository.
