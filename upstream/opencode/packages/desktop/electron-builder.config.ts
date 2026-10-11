import type { Configuration } from "electron-builder"

const raw = process.env.OPENCODE_CHANNEL
const channel = raw === "prod" || raw === "beta" ? raw : "dev"
const suffix = channel === "prod" ? "" : `.${channel}`
const appId = `com.pixelcrabs.open${suffix}`
const productName = `PixelCrabs Open${channel === "prod" ? "" : channel === "beta" ? " Beta" : " Dev"}`

// Public source builds have no automatic release feed or upstream signing service.
const config: Configuration = {
  appId,
  productName,
  artifactName: "PixelCrabs-Open-${version}-${os}-${arch}.${ext}",
  publish: null,
  directories: { output: "dist", buildResources: "resources" },
  extraMetadata: {
    name: "pixelcrabs-open",
    version: "0.1.0-preview.1",
    homepage: "https://github.com/johnzhaors-bit/pixelcrabs",
    author: { name: "PixelCrabs contributors" },
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*", "!resources/linux/**", "!resources/*.metainfo.xml"],
  extraResources: [{ from: "native/", to: "native/", filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"] }],
  protocols: { name: "PixelCrabs Open", schemes: ["pixelcrabs-open"] },
  mac: {
    category: "public.app-category.developer-tools", icon: "resources/icons/icon.icns",
    hardenedRuntime: true, gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist", entitlementsInherit: "resources/entitlements.plist",
    target: ["dmg", "zip"],
  },
  win: { icon: "resources/icons/icon.ico", target: ["nsis"] },
  nsis: { oneClick: true, perMachine: false, installerIcon: "resources/icons/icon.ico", installerHeaderIcon: "resources/icons/icon.ico" },
  linux: {
    icon: "resources/icons", category: "Development", executableName: appId,
    desktop: { entry: { StartupWMClass: appId } }, target: ["AppImage"],
  },
}
export default config
