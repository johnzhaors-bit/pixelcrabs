<div align="center">

# 🦀 PixelCrabs

### Have an idea? Make it real.

**A local-first visual AI IDE built on OpenCode.**

Describe an app. Preview it. Point at what you want to change.

**[Download the desktop app](https://pixelcrabs.com/en/#download)** · [Website](https://pixelcrabs.com/en/) · [About](https://pixelcrabs.com/en/about/) · [Release notes](https://pixelcrabs.com/en/updates/)

</div>

---

## Try it before you build on it

PixelCrab brings AI coding, live preview and visual feedback into one workspace. Your project stays on your computer, and OpenCode handles the coding agent: sessions, models, tools and source changes.

Download the full desktop app to experience the workflow today:

| Platform | Download |
| --- | --- |
| Windows x64 | [Get PixelCrab for Windows](https://pixelcrabs.com/en/#download) |
| macOS · Apple Silicon | [Get PixelCrab for macOS](https://pixelcrabs.com/en/#download) |
| Linux x86_64 · preview | [Get the AppImage](https://pixelcrabs.com/en/#download) |

The website always links to the current installers and platform notes. The Windows installer is currently unsigned; Linux distribution compatibility is still being tested.

## From an idea to a working app

**1. Describe it** — Start a project or open existing code. Tell AI what you want to make.

**2. See it** — Run the application beside the conversation and check the actual result.

**3. Point and refine** — Select an element, draw a box, or select several elements. Add your feedback and let AI work with visual context and project source.

**4. Make it yours** — Keep iterating with your own models, local Skills and tools. Your code remains a real project you can manage with Git.

## Why PixelCrab?

- **Visual AI development:** express changes from the running interface instead of guessing which component to describe.
- **Local-first projects:** keep code in your own working directory. Local work and your own models do not require a PixelCrab account.
- **Model freedom:** connect supported providers, bring your own API key, or configure a compatible local or enterprise model service.
- **OpenCode at the core:** build on an established coding agent rather than maintaining a second agent engine.
- **Skills and tools:** bring specialized knowledge and external capabilities into your workflow.

Local-first does not mean every model request is offline. When you choose an online model, the context needed for the task is sent to that service. Model access, capabilities and charges depend on your provider.

## Open-source edition: first modules available

This repository is the home of the **Web-focused open-source edition**. The OpenCode source baseline and the first preview contract and capability registration modules are available here under their MIT licenses. The upstream coding engine is included; the PixelCrabs desktop integration is still being separated and is not buildable as a complete product yet. The full desktop download is available now; it includes capabilities beyond the planned public edition.

| Area | Planned public scope |
| --- | --- |
| Web projects | Local development, preview, visual selection and AI-assisted changes |
| Web delivery | Local build and export; deployment through your own tools and services |
| Models | User-configured providers, API keys and compatible local services |
| Skills and tools | Local Skill support and extension interfaces, subject to dependency and license review |
| Flutter | A later release, after the Web edition |

PixelCrab account services, platform model billing, cloud hosting, marketplace publishing and dedicated mini app preview/publishing integrations are outside the public source scope. Design packs and other third-party resources have their own distribution and licensing requirements.

We publish each module after reviewing its source boundary and verifying it independently. A complete desktop release will follow once the Web workflow builds and runs without private modules. Forking this repository gives you the upstream coding engine source and the foundation modules below. The PixelCrabs preview panel is not connected to that engine yet.

## Development roadmap

We are preparing the public Web edition in small, verifiable steps. The status column distinguishes published modules from work still in preparation.

| Milestone | Status |
| --- | --- |
| Define the Web-first public scope | Complete |
| Import the pinned OpenCode engine source | Available under `upstream/opencode` |
| Separate shared preview contracts and Web capability registration | Published in this repository with tests |
| Extract the static Web preview launch recipe | Implemented; isolated HTTP checks pass with Node |
| Separate framework discovery, process lifecycle and agent tools | In progress |
| Separate visual workbench and generic network integration | Planned |
| Add an independent desktop identity and build configuration | Planned |
| Complete dependency/license review and a clean Web workflow build | Required before the first source release |
| Publish source and license incrementally | First modules available under MIT; desktop build instructions to follow |
| Add Flutter capabilities | After the Web release |

### September 28, 2026 — Web foundation progress

The shared preview contracts and Web capability registration have been separated from the full product's platform registration. The static webpage launch recipe has also been extracted and tested in isolation: HTML, CSS and client-side routes can be served without the platform-specific modules. Existing project discovery tests continue to pass.

The contract and capability modules and a standalone static HTML preview are published here with independent tests. Full desktop integration remains in preparation. Meanwhile, the [full desktop app](https://pixelcrabs.com/en/#download) is available to try.

## Run the OpenCode engine

The [`upstream/opencode`](upstream/opencode) directory contains the official OpenCode source at [commit `9f69463f1d`](https://github.com/anomalyco/opencode/commit/9f69463f1d556af2b5b51d2efa1c04f5f544f911). It is an upstream snapshot, not a copy of the customized private PixelCrab source. Its original [MIT license](upstream/opencode/LICENSE), notices, lockfile and development documentation are preserved.

The [foundation smoke workflow](https://github.com/johnzhaors-bit/pixelcrabs/actions/workflows/opencode-smoke.yml) checks dependency installation, CLI startup and a local API health request on Linux. Full PixelCrabs desktop and model-call validation remain separate. Native dependencies also require a working compiler toolchain and Python; Windows setup has not yet passed our clean-install check.

Install **Bun 1.3.14** and use the pinned lockfile:

```sh
cd upstream/opencode
bun install --frozen-lockfile
bun dev --help
bun dev /absolute/path/to/your/project
```

For a local API server:

```sh
bun dev serve --hostname 127.0.0.1 --port 4096
```

This runs OpenCode with its original identity and provider configuration. It does not include PixelCrab account services, platform models, marketplace integrations or the PixelCrabs visual preview panel. The upstream repository also contains its own console and infrastructure code; those are upstream components, not the PixelCrab backend, and are not required to run the local engine. See the upstream [development guide](upstream/opencode/CONTRIBUTING.md) for its other entry points.

## Preview a static webpage

With **Node.js 24 or later**, serve an existing directory containing `index.html` from the repository root. No package installation or PixelCrab account is required:

```sh
node packages/local-runtime/bin/static-preview.mjs /absolute/path/to/your/site
```

Open the localhost URL printed in the terminal. Edit your files and refresh the browser to see changes; press **Ctrl+C** to stop. Pass a port as the second argument, or `0` to choose an available port:

```sh
node packages/local-runtime/bin/static-preview.mjs /absolute/path/to/your/site 0
```

This explicitly serves static HTML, CSS and browser JavaScript. React, Vue, Next.js and other source projects still need their framework's dev server. Extensionless routes fall back to `index.html`; missing assets return 404. The server binds only to loopback, rejects hidden paths and links outside the project, and does not list directories. Serve only trusted local projects: this is a development server, not a security sandbox or a production hosting service. The visual selection panel and Agent tool integration are not included yet.

## Run the foundation tests

Use **Node.js 24 or later**. No package installation or cloud account is needed for these modules.

```sh
node --test packages/local-runtime/test/public-preview-core.test.mjs packages/local-runtime/test/public-static-preview.test.mjs
```

- [`preview-delivery-protocol.ts`](packages/local-runtime/src/preview-delivery-protocol.ts): action envelopes, project/conversation scope checks and a capability registry.
- [`web-preview-capabilities.ts`](packages/local-runtime/src/web-preview-capabilities.ts): Web capability descriptors and snapshots.
- [`static-web-preview.ts`](packages/local-runtime/src/static-web-preview.ts): a shared Node static-server launch recipe, used by the standalone CLI.

The registry describes capabilities; the static CLI provides one executable preview path. These modules do not execute deployments, enforce operating-system permissions or provide a desktop UI. The host remains responsible for project authorization and integrated runtime management. More modules will arrive in reviewed batches.

## Follow along

Try the desktop app, explore the [product](https://pixelcrabs.com/en/about/), and watch this repository for the next source modules. You can [report a problem or share a use case](https://github.com/johnzhaors-bit/pixelcrabs/issues). Please include the platform, app version and steps to reproduce, and leave out credentials or private project content.

The published source in this repository is available under the [MIT License](LICENSE). This license does not cover the separately distributed full desktop app or unpublished code and design resources.

PixelCrab is built on [OpenCode](https://github.com/anomalyco/opencode). Upstream projects retain their own licenses and attribution; the vendored OpenCode snapshot retains its original copyright and license.

<div align="center">

**Your ideas. Your code. Your models.**

[Start with PixelCrab →](https://pixelcrabs.com/en/#download)

</div>
