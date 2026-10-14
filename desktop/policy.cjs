const path = require('node:path');

const APP_URL = 'soundlab://app/index.html';
const MIDI_PERMISSIONS = new Set(['midi', 'midiSysex']);

function isBundleURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'soundlab:' && url.hostname === 'app' &&
      !url.username && !url.password && !url.port;
  } catch { return false; }
}

function resolveBundlePath(root, value) {
  if (!isBundleURL(value)) return null;
  try {
    const pathname = decodeURIComponent(new URL(value).pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return null;
    const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return target;
  } catch { return null; }
}

function isTrustedRequest(contents, expectedContents, requestingURL, isMainFrame) {
  return !!contents && contents === expectedContents && !contents.isDestroyed() &&
    isBundleURL(contents.getURL()) && isBundleURL(requestingURL) && isMainFrame !== false;
}

module.exports = { APP_URL, MIDI_PERMISSIONS, isBundleURL, resolveBundlePath, isTrustedRequest };
