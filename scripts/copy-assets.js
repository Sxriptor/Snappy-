/**
 * Copy static assets (HTML, CSS) to dist folder
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src/renderer');
const distDir = path.join(__dirname, '../dist/renderer');

// Create dist/renderer if it doesn't exist
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Files to copy
const files = ['index.html', 'styles.css'];

files.forEach(file => {
  const src = path.join(srcDir, file);
  const dest = path.join(distDir, file);
  
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${file}`);
  } else {
    console.warn(`Warning: ${file} not found`);
  }
});

console.log('Assets copied successfully');
