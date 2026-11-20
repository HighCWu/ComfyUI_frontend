// @ts-check
const marker = 'sourceMappingURL';
/** @param {number} value */
const whitespace = value => value === 32 || value >= 9 && value <= 13;

/** @param {string} path */
export function isComfySourceMapCarrier(path) {
  return /\.(?:[cm]?js|css|html?|svg|xml|jsx|tsx?)$/i.test(path);
}

/** Match comment-shaped inline directives; not a JS/CSS parser, and never
 * decode or print the payload. Ordinary external map references are unchanged.
 * @param {string} path @param {Buffer} bytes */
export function assertNoComfyInlineSourceMap(path, bytes) {
  if (!isComfySourceMapCarrier(path)) return;
  for (let start = bytes.indexOf(marker); start >= 0; start = bytes.indexOf(marker, start + marker.length)) {
    let prefix = start - 1;
    while (whitespace(bytes[prefix])) prefix--;
    if ((bytes[prefix] !== 35 && bytes[prefix] !== 64) || bytes[prefix - 2] !== 47
      || (bytes[prefix - 1] !== 47 && bytes[prefix - 1] !== 42)) continue;
    let after = start + marker.length;
    while (whitespace(bytes[after])) after++;
    if (bytes[after++] !== 61) continue;
    while (whitespace(bytes[after])) after++;
    if (bytes.toString('ascii', after, after + 5).toLowerCase() === 'data:')
      throw new Error(`ComfyUI inline source map in public asset: ${path}`);
  }
}
