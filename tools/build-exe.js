const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const tmpDir = path.join(require('os').tmpdir(), 'craftorbit-build');
fs.mkdirSync(tmpDir, { recursive: true });

const bundleJs = path.join(tmpDir, 'bundle.js');
const seaConfig = path.join(tmpDir, 'sea-config.json');
const seaBlob = path.join(tmpDir, 'sea-prep.blob');
const outExe = path.join(rootDir, 'CraftOrbit.exe');

// 1. Refresh embedded assets
const publicDir = path.join(rootDir, 'public');
const assets = {};
for (const f of fs.readdirSync(publicDir)) {
  const p = path.join(publicDir, f);
  if (fs.statSync(p).isFile()) assets[f] = fs.readFileSync(p, 'utf8');
}
const embeddedJs = `// Auto-generated embedded public assets
const fs = require('fs');
const path = require('path');
const EMBEDDED_PUBLIC = ${JSON.stringify(assets, null, 2)};
function ensurePublicAssets(targetDir) {
  const dir = path.join(targetDir, 'public');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(EMBEDDED_PUBLIC)) {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) try { fs.writeFileSync(f, content, 'utf8'); } catch (e) {}
  }
  return dir;
}
module.exports = { ensurePublicAssets, EMBEDDED_PUBLIC };
`;
fs.writeFileSync(path.join(rootDir, 'embedded-assets.js'), embeddedJs, 'utf8');

// 2. Bundle all (including express & ws)
execSync(`npx esbuild "${path.join(rootDir, 'server.js')}" --bundle --platform=node --target=node20 --outfile="${bundleJs}"`, { stdio: 'inherit' });

// 3. Generate SEA blob
fs.writeFileSync(seaConfig, JSON.stringify({ main: bundleJs, output: seaBlob, disableExperimentalSEAWarning: true }));
execSync(`node --experimental-sea-config "${seaConfig}"`, { stdio: 'inherit' });

// 4. Copy node.exe & inject blob
fs.copyFileSync(process.execPath, outExe);
execSync(`npx postject "${outExe}" NODE_SEA_BLOB "${seaBlob}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, { stdio: 'inherit' });

// 5. Patch Subsystem to GUI (Subsystem 2)
const buf = fs.readFileSync(outExe);
const peOffset = buf.readUInt32LE(0x3C);
buf.writeUInt16LE(2, peOffset + 0x5C);
fs.writeFileSync(outExe, buf);

console.log(`CraftOrbit.exe built: ${(fs.statSync(outExe).size / (1024 * 1024)).toFixed(2)} MB`);
