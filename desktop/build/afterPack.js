// electron-builder afterPack hook — macOS ad-hoc code signing.
//
// At $0 (no Apple Developer ID) the app is built UNSIGNED (`mac.identity: null`).
// Apple Silicon refuses to launch a binary with NO signature at all, so we apply
// a free *ad-hoc* signature (`codesign --sign -`). This is NOT notarization —
// users still do the one-time Gatekeeper "Open Anyway" — it only makes arm64
// willing to execute the binary. Notarization ($99/yr) is the Tier 2 upgrade.
const { execSync } = require('node:child_process');

exports.default = async ({ appOutDir, electronPlatformName, packager }) => {
  if (electronPlatformName !== 'darwin') return;
  const appPath = `${appOutDir}/${packager.appInfo.productFilename}.app`;
  console.log(`[afterPack] ad-hoc signing ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
};
