// electron-builder afterPack-Hook: entfernt erweiterte Attribute (Finder-
// Informationen, iCloud-Markierungen, Resource Forks) aus der gepackten App.
// Liegt das Repo in iCloud Drive, hängt das System sie an jede Datei, und
// codesign bricht mit „resource fork, Finder information, or similar detritus
// not allowed“ ab (Live-Befund 02.10.2026, erster signierter Build).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("xattr", ["-cr", appPath], { stdio: "inherit" });
  console.log(`  • xattr bereinigt  ${appPath}`);
};
