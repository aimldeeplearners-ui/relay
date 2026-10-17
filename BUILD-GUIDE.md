# Relay Build Guide

This guide is for developers building Relay from source or producing Windows desktop packages. For using the Relay UI to test APIs, see [USER-GUIDE.md](USER-GUIDE.md).

## Prerequisites

- Windows 10 or later for the Windows desktop app and package targets.
- Node.js 24.x and npm. This is the version used for development and verification.
- Git, if cloning the source repository.
- Internet access or access to a configured npm registry to download dependencies.

## Get the Source

Clone the repository, then work from its root directory (the directory containing `package.json`):

```powershell
git clone https://github.com/<YOUR-USERNAME>/relay.git
cd relay
```

If the source is already on the computer, open PowerShell in the existing project directory instead.

## Install Dependencies

The project commits `package.json` and `package-lock.json`. The former declares direct dependencies and scripts; the latter pins the dependency tree. `node_modules` is intentionally excluded from Git and is recreated on each computer.

From the project root, run:

```powershell
npm ci
```

This downloads the locked dependencies from the npm registry into `node_modules`. If PowerShell cannot find `node` or `npm`, install Node.js or add its installation directory to `PATH`.

## Run and Verify

Start the development app:

```powershell
npm run dev
```

Run the offline tests, TypeScript check, and app-bundle build:

```powershell
npm test
npm run typecheck
npm run build
```

`npm run build` compiles the Electron main, preload, and renderer bundles into `out/`. It does not create a Windows installer or portable executable.

## Build Windows Packages

Run these commands from the project root on Windows after installing dependencies.

Create the NSIS installer:

```powershell
npm run package:win
```

The installer is written to `release/` as `Relay-Setup-<version>.exe`.

Create the portable executable instead:

```powershell
npm run package:portable
```

The portable package is written to `release/` as `Relay-Portable-<version>.exe`. The version comes from `package.json`.

These package commands build the app before invoking Electron Builder. They produce Windows artifacts; do not assume a package built on another operating system is a Windows package.

## Local Test API

To support the local CRUD sample while developing Relay, start the in-memory test API in a separate terminal:

```powershell
npm run api:local
```

It binds to loopback only and resets its records when stopped. See [LOCAL-API-SERVER.md](LOCAL-API-SERVER.md) for details.

## Distribution Notes

- The `.gitignore` excludes `node_modules/`, `out/`, and `release/`; do not commit generated dependency or build directories.
- Review collection files for credentials, internal hostnames, identifiers, and company data before sharing the source or packages.
- Windows builds are unsigned unless a signing setup is added. Review signing and SmartScreen implications before distributing packages to others.