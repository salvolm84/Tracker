# Tracker

Desktop activity tracker built with Tauri, React, and Mantine.

## What It Does

- Collects activity records through a structured multi-user form.
- Loads owners, projects, departments, and categories from editable text resource files.
- Persists each submission into one shared JSON database file.
- Stores uploaded attachment bytes in a managed attachment folder beside the JSON database, keeping the database focused on metadata.
- Uses a file lock during writes to reduce corruption risk when multiple app instances save at the same time.

## Run On macOS

```bash
npm install
npm run tauri dev
```

## Build A Deployable App

On this Mac, create a production desktop bundle with:

```bash
npm run package:mac
```

That produces deployable output under `src-tauri/target/release/bundle/`.

On macOS this creates a deployable `.app` bundle.

If you also want a `.dmg`, you can try:

```bash
npm run tauri build
```

On this machine the `.app` build succeeds, while the optional `.dmg` packaging step may fail depending on the local macOS image tools/environment.

For Windows later, run `npm run tauri build` on a Windows machine to generate the native executable and installer for that platform.

## Shared Database Path

By default, the app stores the JSON database as a single file named `activity-db.json`
next to the app location:

- In development, next to the compiled Tauri binary.
- In a packaged macOS deployment, next to `Tracker.app` in the same folder.

If that file does not exist when the app starts, the app creates a new database file there automatically.
Attachments are stored beside the database in a folder named after the database stem, for example `activity-db.attachments`.

To point the app at a different file, set `TRACKER_DB_PATH` before launching it:

```bash
export TRACKER_DB_PATH="/Users/Shared/tracker/activity-db.json"
npm run tauri dev
```

For Windows deployment later, you can set this to a shared network path such as `\\server\share\activity-db.json`.

## Editable Resource Files

- `src-tauri/resources/lists/owners.txt`
- `src-tauri/resources/lists/projects.txt`
- `src-tauri/resources/lists/departments.txt`
- `src-tauri/resources/lists/categories.txt`
