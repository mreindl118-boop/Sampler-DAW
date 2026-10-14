import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'dist');
const destinations = ['native/ios/Web', 'native/android/app/src/main/assets/app'];
const check = process.argv.includes('--check');

async function inventory(directory, prefix = '') {
  const result = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in generated assets: ${relative}`);
    if (entry.isDirectory()) Object.assign(result, await inventory(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result[relative] = createHash('sha256').update(await readFile(path.join(directory, entry.name))).digest('hex');
    else throw new Error(`Unsupported generated asset: ${relative}`);
  }
  return result;
}

async function assertSafeDestination(destination) {
  // Only these two disposable generated folders may be replaced; never native source.
  const relative = path.relative(root, destination).split(path.sep).join('/');
  if (!destinations.includes(relative)) throw new Error(`Unexpected asset destination: ${destination}`);
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing linked destination: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

if ((await lstat(source)).isSymbolicLink()) throw new Error('Refusing linked dist directory');
await readFile(path.join(source, 'index.html')); // fail before mutating anything if build is missing
const files = await inventory(source);
for (const relative of destinations) {
  const destination = path.join(root, relative);
  await assertSafeDestination(destination);
  if (check) {
    const copied = await inventory(destination);
    if (JSON.stringify(copied) !== JSON.stringify(files)) throw new Error(`${relative} is stale; run npm run build && npm run native:sync`);
  } else {
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, dereference: false, errorOnExist: true, force: false });
  }
  console.log(`${check ? 'Verified' : 'Bundled'} ${Object.keys(files).length} web assets in ${relative}`);
}
if (!check) {
  const manifest = { generated: true, files };
  await mkdir(path.join(root, 'release'), { recursive: true });
  await writeFile(path.join(root, 'release/native-web-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
