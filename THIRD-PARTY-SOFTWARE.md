# Third-Party Software and License Inventory

**Project:** Relay REST/SOAP API Tester  
**Inventory date:** 2026-10-17
**Scope:** Current `package.json`, installed npm dependency tree, Windows x64 portable/NSIS packaging, and software embedded in the packaged Electron runtime.

This is a project inventory for engineering and security review, not legal advice. Package license identifiers below come from the installed package manifests. Exact resolved npm versions are recorded in `package-lock.json`; the appendix deduplicates package names and groups them by declared license expression.

## Summary

Relay's application dependencies use MIT, ISC, or BSD-3-Clause licenses. These are generally permissive and do not require a paid license, but redistribution still requires retaining applicable copyright and license notices. The wider development/build dependency tree also contains Apache-2.0, MPL-2.0, CC-BY-4.0, BlueOak-1.0.0, Python-2.0, PSF-2.0, WTFPL, 0BSD, and multi-license expressions. Those terms and any corporate open-source policy must be reviewed before wider distribution.

The packaged Windows app contains Electron, Chromium, V8, and Node.js. Electron's packaged output provides an MIT notice (`LICENSE.electron.txt`) and bundled third-party notices (`LICENSES.chromium.html`), which includes Node.js license text. Packaging output is generated under `release/` and is not part of this source checkout; verify the notices in each actual release build.

No trusted code-signing certificate is configured. The current Windows executables are unsigned, which can cause SmartScreen warnings; this is a signing/distribution issue, not an open-source license fee.

## Application Runtime Dependencies

These are the direct npm production dependencies and their purpose in Relay. Their transitive production dependencies are listed below.

| Package | Locked version | Declared license | Use and impact |
|---|---:|---|---|
| `@apidevtools/swagger-parser` | 13.1.0 | MIT | Validates and resolves supported API definition files for conversion into Relay collections. Preserve license and copyright notices. |
| `@xmldom/xmldom` | 0.8.15 | MIT | Parses XML responses for SOAP/XPath validation. Permissive; preserve license and copyright notice when redistributed. |
| `ajv` | 8.20.0 | MIT | Validates REST responses against JSON Schema. Permissive; preserve notices. |
| `lucide-react` | 0.468.0 | ISC | Supplies UI icons. ISC is permissive; retain the notice and license text. |
| `react` | 19.3.1 | MIT | Renderer UI framework. Permissive; preserve notices. |
| `react-dom` | 19.3.1 | MIT | Renders React in the Electron renderer. Permissive; preserve notices. |
| `xpath` | 0.0.34 | MIT | Evaluates XPath assertions on SOAP XML. Permissive; preserve notices. |

### Transitive Production Dependencies

| Package | Locked version | Declared license | Use and impact |
|---|---:|---|---|
| `@apidevtools/json-schema-ref-parser` | 16.0.5 | MIT | Resolves local API-definition references; HTTP resolution is disabled in Relay. |
| `@apidevtools/openapi-schemas` | 2.1.0 | MIT | API-definition validation schemas; notice retention. |
| `@apidevtools/swagger-methods` | 3.0.2 | MIT | HTTP method definitions used by the API parser; notice retention. |
| `@types/json-schema` | 7.0.15 | MIT | JSON Schema type declarations used by parser dependencies. |
| `ajv-draft-04` | 1.0.0 | MIT | Swagger 2.0 schema validation support; notice retention. |
| `fast-deep-equal` | 3.1.3 | MIT | AJV support dependency; notice retention. |
| `fast-uri` | 3.1.8 | BSD-3-Clause | AJV URI handling; retain notices and do not imply endorsement. |
| `json-schema-traverse` | 1.0.0 | MIT | AJV schema traversal; notice retention. |
| `require-from-string` | 2.0.2 | MIT | AJV support dependency; notice retention. |
| `scheduler` | 0.28.0 | MIT | React scheduling support; notice retention. |
| `call-me-maybe` | 1.0.2 | MIT | Parser callback/promise interoperability; notice retention. |
| `openapi-types` | 12.1.3 | MIT | API-definition type declarations. |
| `js-yaml` | 5.5.0 | MIT | YAML parsing for API-definition imports. |
| `argparse` | 3.0.3 | PSF-2.0 | YAML parser command-line argument support; review applicable license terms. |

## Bundled Runtime and Build Software

| Software | Version | License | Role and impact |
|---|---:|---|---|
| Electron | 44.7.2 | MIT | Desktop application framework; bundled in the desktop app. Preserve Electron and third-party notices. |
| Chromium | Version bundled by Electron 44.7.2 | Multiple third-party licenses | Browser engine in the app. The bundled `LICENSES.chromium.html` contains upstream license and attribution notices. |
| V8 | Version bundled by Electron 44.7.2 | BSD-style and third-party notices | JavaScript engine in the app; covered by bundled runtime notices. |
| Node.js | 24.22.0 for local development; Electron-bundled runtime version follows Electron | MIT plus third-party notices | Local build/runtime tooling and Electron's embedded Node runtime. The bundled Chromium notice page contains Node.js license text. |
| npm | 11.19.1 | Artistic License 2.0 | Local package manager only; not part of the Relay app package. Its own dependencies have their own licenses. |
| TypeScript | 5.9.3 | Apache-2.0 | Compile-time tooling; not shipped as the app runtime. Include the Apache license and required notices if redistributing the tool itself. |
| Electron Vite | 6.0.0 | MIT | Main/preload/renderer build and dev server. Build-time only. |
| Vite | 6.4.4 | MIT | Renderer build tooling. Build-time only. |
| `@vitejs/plugin-react` | 4.7.0 | MIT | React integration for Vite. Build-time only. |
| Tailwind CSS | 4.3.3 | MIT | CSS framework. Build-time processing plus generated application CSS. Preserve notices. |
| `@tailwindcss/vite` | 4.3.3 | MIT | Tailwind integration for Vite. Build-time only. |
| Electron Builder | 26.15.3 | MIT | Creates the Windows NSIS installer and portable executable. Build-time only. |
| `@types/node` | 22.20.5 | MIT | TypeScript declarations; development-only. |
| `@types/react` | 19.3.0 | MIT | TypeScript declarations; development-only. |
| `@types/react-dom` | 19.3.0 | MIT | TypeScript declarations; development-only. |

### Windows Packaging Components

| Software | License | Role and impact |
|---|---|---|
| NSIS 3.0.4.1 | Primarily zlib/libpng; included compression modules have separate terms (bzip2 and CPL-1.0, with an LZMA exception) | Used by Electron Builder for the installer and portable launcher. Packaging-only, but the NSIS stub is part of the generated executable. Preserve applicable notices and have legal review confirm which module terms apply to the shipped artifact. |
| 7-Zip x64 component | LGPL-2.1-or-later for most code; some BSD-2-Clause/BSD-3-Clause components and an unRAR restriction | Downloaded/used by Electron Builder during packaging, not a Relay runtime dependency. Do not use its unRAR-derived code to implement RAR compression; review binary redistribution notices if distributing the packaging tool itself. |
| Windows 10/11 x64 | Microsoft proprietary operating system license | Build and target platform, not bundled as Relay software. The recipient needs a compatible Windows x64 system. |

## Build-Only Direct npm Dependencies

These packages are listed as development dependencies and are not intended as Relay runtime features. They are used to build, type-check, package, or author the app.

| Package | Locked version | Declared license | Use and impact |
|---|---:|---|---|
| `@tailwindcss/vite` | 4.3.3 | MIT | Tailwind/Vite integration. |
| `@types/node` | 22.20.5 | MIT | Node.js declarations for TypeScript. |
| `@types/react` | 19.3.0 | MIT | React declarations for TypeScript. |
| `@types/react-dom` | 19.3.0 | MIT | React DOM declarations for TypeScript. |
| `@vitejs/plugin-react` | 4.7.0 | MIT | React plugin for Vite. |
| `electron` | 44.7.2 | MIT | Electron runtime downloaded for local development and packaging. |
| `electron-builder` | 26.15.3 | MIT | Windows installer/portable packaging. |
| `electron-vite` | 6.0.0 | MIT | Electron-aware Vite build configuration. |
| `tailwindcss` | 4.3.3 | MIT | CSS generation. |
| `typescript` | 5.9.3 | Apache-2.0 | Type-checking and compilation. |
| `vite` | 6.4.4 | MIT | Renderer development server and bundler. |

`lucide-react` icons use ISC licensing. The active UI uses the Windows-provided Candara font with Segoe UI fallback and Bahnschrift for display labels; no font files are bundled by this project.

## Full Installed npm Dependency Name Inventory

The following names cover the installed npm tree, including transitive and development/build dependencies. A package can appear under more than one license expression when different resolved versions declare different terms. Exact name/version resolution is in `package-lock.json`. Review the license file shipped by each package version before external release.

### `(MIT OR CC0-1.0)`

`type-fest`

### `(WTFPL OR MIT)`

`utf8-byte-length`

### `0BSD`

`tslib`

### `Apache-2.0`

`@malept/cross-spawn-promise`, `baseline-browser-mapping`, `detect-libc`, `ejs`, `exponential-backoff`, `filelist`, `jake`, `sumchecker`, `typescript`

### `BlueOak-1.0.0`

`chownr`, `isexe`, `minimatch`, `minipass`, `sax`, `tar`, `yallist`

### `BSD-2-Clause`

`@electron/osx-sign`, `@electron/windows-sign`, `@electron-internal/extract-zip`, `dotenv`, `dotenv-expand`, `http-cache-semantics`

### `BSD-3-Clause`

`asn1js`, `bytestreamjs`, `duplexer2`, `fast-uri`, `global-agent`, `pkijs`, `roarr`, `source-map`, `source-map-js`, `sprintf-js`

### `CC-BY-4.0`

`caniuse-lite`

### `ISC`

`@isaacs/fs-minipass`, `abbrev`, `at-least-node`, `cliui`, `electron-to-chromium`, `fs.realpath`, `get-caller-file`, `glob`, `graceful-fs`, `hosted-git-info`, `inflight`, `inherits`, `isexe`, `json-stringify-safe`, `lru-cache`, `lucide-react`, `minimatch`, `nopt`, `once`, `picocolors`, `proc-log`, `rimraf`, `semver`, `signal-exit`, `which`, `wrappy`, `y18n`, `yallist`, `yargs-parser`

### `MIT`

`@babel/code-frame`, `@babel/compat-data`, `@babel/core`, `@babel/generator`, `@babel/helper-compilation-targets`, `@babel/helper-globals`, `@babel/helper-module-imports`, `@babel/helper-module-transforms`, `@babel/helper-plugin-utils`, `@babel/helpers`, `@babel/helper-string-parser`, `@babel/helper-validator-identifier`, `@babel/helper-validator-option`, `@babel/parser`, `@babel/plugin-transform-arrow-functions`, `@babel/plugin-transform-react-jsx-self`, `@babel/plugin-transform-react-jsx-source`, `@babel/template`, `@babel/traverse`, `@babel/types`, `@electron/asar`, `@electron/fuses`, `@electron/get`, `@electron/notarize`, `@electron/rebuild`, `@electron/universal`, `@esbuild/win32-x64`, `@jridgewell/gen-mapping`, `@jridgewell/remapping`, `@jridgewell/resolve-uri`, `@jridgewell/sourcemap-codec`, `@jridgewell/trace-mapping`, `@malept/flatpak-bundler`, `@noble/hashes`, `@oxc-project/types`, `@peculiar/asn1-schema`, `@peculiar/json-schema`, `@peculiar/utils`, `@peculiar/webcrypto`, `@rolldown/binding-win32-x64-msvc`, `@rolldown/pluginutils`, `@rollup/rollup-win32-x64-gnu`, `@rollup/rollup-win32-x64-msvc`, `@sindresorhus/is`, `@szmarczak/http-timer`, `@tailwindcss/node`, `@tailwindcss/oxide`, `@tailwindcss/oxide-win32-x64-msvc`, `@tailwindcss/vite`, `@types/babel__core`, `@types/babel__generator`, `@types/babel__template`, `@types/babel__traverse`, `@types/cacheable-request`, `@types/debug`, `@types/estree`, `@types/fs-extra`, `@types/http-cache-semantics`, `@types/keyv`, `@types/ms`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/responselike`, `@vitejs/plugin-react`, `@xmldom/xmldom`, `agent-base`, `ajv`, `ansi-regex`, `ansi-styles`, `app-builder-lib`, `async`, `async-exit-hook`, `asynckit`, `aws4`, `balanced-match`, `base64-js`, `bluebird`, `boolean`, `brace-expansion`, `browserslist`, `buffer-from`, `builder-util`, `builder-util-runtime`, `cac`, `cacheable-lookup`, `cacheable-request`, `call-bind-apply-helpers`, `chalk`, `chromium-pickle-js`, `ci-info`, `clone-response`, `color-convert`, `color-name`, `combined-stream`, `commander`, `compare-version`, `concat-map`, `convert-source-map`, `core-util-is`, `cross-dirname`, `cross-spawn`, `csstype`, `debug`, `decompress-response`, `defer-to-connect`, `define-data-property`, `define-properties`, `delayed-stream`, `detect-node`, `dir-compare`, `dmg-builder`, `dunder-proto`, `electron`, `electron-builder`, `electron-builder-squirrel-windows`, `electron-publish`, `electron-vite`, `electron-winstaller`, `emoji-regex`, `end-of-stream`, `enhanced-resolve`, `env-paths`, `err-code`, `es6-error`, `esbuild`, `escalade`, `escape-string-regexp`, `es-define-property`, `es-errors`, `es-object-atoms`, `es-set-tostringtag`, `fast-deep-equal`, `fdir`, `form-data`, `fs-extra`, `function-bind`, `gensync`, `get-intrinsic`, `get-proto`, `get-stream`, `globalthis`, `gopd`, `got`, `has-flag`, `hasown`, `has-property-descriptors`, `has-symbols`, `has-tostringtag`, `http2-wrapper`, `http-proxy-agent`, `https-proxy-agent`, `isarray`, `isbinaryfile`, `is-fullwidth-code-point`, `jiti`, `jsesc`, `json5`, `json-buffer`, `jsonfile`, `json-schema-traverse`, `js-tokens`, `js-yaml`, `keyv`, `lazy-val`, `lodash`, `lowercase-keys`, `magic-string`, `matcher`, `math-intrinsics`, `mime`, `mime-db`, `mime-types`, `mimic-response`, `minimist`, `minizlib`, `mkdirp`, `ms`, `nanoid`, `node-abi`, `node-api-version`, `node-gyp`, `node-int64`, `node-releases`, `normalize-url`, `object-keys`, `path-is-absolute`, `path-key`, `p-cancelable`, `pe-library`, `picomatch`, `p-limit`, `plist`, `postcss`, `postject`, `process-nextick-args`, `progress`, `promise-retry`, `proper-lockfile`, `pump`, `pvtsutils`, `pvutils`, `quick-lru`, `react`, `react-dom`, `react-refresh`, `readable-stream`, `read-binary-file-arch`, `require-directory`, `require-from-string`, `resedit`, `resolve-alpn`, `responselike`, `retry`, `rolldown`, `rollup`, `safe-buffer`, `scheduler`, `semver-compare`, `serialize-error`, `shebang-command`, `shebang-regex`, `simple-update-notifier`, `source-map-support`, `stat-mode`, `string_decoder`, `string-width`, `strip-ansi`, `supports-color`, `tailwindcss`, `tapable`, `temp`, `temp-file`, `tiny-async-pool`, `tinyglobby`, `tmp`, `tmp-promise`, `undici`, `undici-types`, `universalify`, `unzipper`, `update-browserslist-db`, `util-deprecate`, `vite`, `webcrypto-core`, `wrap-ansi`, `xmlbuilder`, `xpath`, `yargs`, `yocto-queue`

### `MPL-2.0`

`lightningcss`, `lightningcss-win32-x64-msvc`

### `Python-2.0`

`argparse`

### `WTFPL`

`truncate-utf8-bytes`

### `WTFPL OR ISC`

`sanitize-filename`

## License Impact Guide

| License family | Practical impact when redistributed |
|---|---|
| MIT, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, Python-2.0 | Generally permit commercial/proprietary use without a purchase fee. Keep the required copyright/license notices; BSD licenses also restrict endorsement using contributor names. |
| Apache-2.0 | Permissive; include the license and applicable NOTICE text, preserve attribution, identify modified files, and observe its patent terms. |
| MPL-2.0 | File-level copyleft. If MPL-covered files are modified and distributed, make those modified files available under MPL; it does not automatically relicense the whole app. |
| CC-BY-4.0 | Attribution is required; identify changes if the licensed material is modified and do not imply endorsement. |
| WTFPL | Broadly permissive wording but uncommon in corporate policies; obtain legal/policy approval. For `WTFPL OR MIT` and `WTFPL OR ISC`, use the documented MIT or ISC alternative where permitted. |
| `MIT OR CC0-1.0` | Alternative license expression; choose and record the applicable option. |
| NSIS compression modules / 7-Zip components | Packaging-only components have separate license terms. Retain their notices and have legal confirm which modules are present in the distributed wrapper. |

## External Services and Items Not Used

- **JSONPlaceholder** is an external demo API endpoint, not software bundled with Relay. Its service terms apply. Do not send credentials or confidential data to it.
- REST requests use the built-in `fetch` implementation supplied by the Electron/Node runtime; Axios is not installed.
- Monaco Editor and CodeMirror are mentioned as options in the product brief but are not installed or used.
- No external font files are bundled; the UI uses fonts available on Windows.

## Project and Compliance Notes

- Relay itself is marked `private` in `package.json` and has no `license` field. This inventory does not grant a license to Relay's own source code; its owner must decide the project's distribution license separately.
- `release/` output is generated and ignored by Git. After packaging, confirm Electron and Chromium/Node notices exist in `release/win-unpacked` and preserve them in distributed builds; no package artifacts are available in this checkout to re-inspect.
- Most permissive licenses do not require paying a license fee, but redistribution still has notice and attribution obligations. This file is a summary, not a replacement for the upstream license texts.
- `npm audit` could not be completed in this environment because registry TLS verification failed. An earlier install reported 8 moderate advisories; their status and applicability remain unverified and should be resolved separately from license review.
- Rebuild this inventory after dependency changes. Use `package-lock.json` for exact versions and re-check package metadata and notices before each external release.

## References

- Resolved npm versions: [`package-lock.json`](package-lock.json)
- npm package license identifiers: each resolved package's `package.json` `license` field
- Electron notice in the packaged app: `release/win-unpacked/LICENSE.electron.txt`
- Chromium, V8, Node.js, and bundled third-party notices: `release/win-unpacked/LICENSES.chromium.html`
- Electron upstream license: <https://github.com/electron/electron/blob/main/LICENSE>
- NSIS license and compression-module terms: <https://nsis.sourceforge.io/License>
- 7-Zip license and binary redistribution terms: <https://www.7-zip.org/license.txt>
- SPDX license identifiers: <https://spdx.org/licenses/>

For an external release, retain the exact license and attribution texts corresponding to the locked versions; upstream web pages may change over time.
