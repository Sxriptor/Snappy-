const { Jimp } = require('jimp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');
const fs = require('fs');
const path = require('path');

async function convertIcon() {
  const inputPath = path.join(__dirname, '..', 'iconimage.jpg');
  const pngPath = path.join(__dirname, '..', 'build', 'icon.png');
  const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');

  // Ensure build directory exists
  const buildDir = path.join(__dirname, '..', 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir);
  }

  // Convert JPG to PNG (256x256)
  const image = await Jimp.read(inputPath);
  image.resize({ w: 256, h: 256 });
  await image.write(pngPath);
  console.log('Created PNG:', pngPath);

  // Convert PNG to ICO
  const ico = await pngToIco(pngPath);
  fs.writeFileSync(icoPath, ico);
  console.log('Created ICO:', icoPath);
}

convertIcon().catch(console.error);
