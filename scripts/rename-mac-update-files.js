const fs = require('fs');
const path = require('path');

const releaseDir = path.join(process.cwd(), 'release');

function renameIfExists(srcName, destName) {
  const srcPath = path.join(releaseDir, srcName);
  const destPath = path.join(releaseDir, destName);

  if (!fs.existsSync(srcPath)) return false;

  if (fs.existsSync(destPath)) {
    fs.unlinkSync(destPath);
  }

  fs.renameSync(srcPath, destPath);
  console.log(`Renamed ${srcName} -> ${destName}`);
  return true;
}

if (!fs.existsSync(releaseDir)) {
  console.log('Release directory not found, skipping mac update file renames');
  process.exit(0);
}

renameIfExists('builder-debug.yml', 'mac-builder-debug.yml');

// Prefer the mac-specific metadata file when available.
const renamedLatestMac = renameIfExists('latest-mac.yml', 'mac-latest.yml');
if (!renamedLatestMac) {
  renameIfExists('latest.yml', 'mac-latest.yml');
}
