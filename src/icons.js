/**
 * Generates a rounded-square SVG icon suitable for PWA manifests.
 * SVG icons are supported by all modern browsers and require no
 * native image-processing dependencies.
 *
 * @param {string} color  - Background hex color, e.g. "#6366f1"
 * @param {string} letter - Single character to display
 * @returns {string} SVG markup
 */
export function generateSVGIcon(color, letter = '?') {
  const char = String(letter).charAt(0).toUpperCase();

  // Derive a slightly lighter tint for a subtle inner glow
  const tint = lighten(color, 0.15);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="40%" cy="35%" r="65%">
      <stop offset="0%" stop-color="${tint}"/>
      <stop offset="100%" stop-color="${color}"/>
    </radialGradient>
  </defs>
  <!-- Rounded square background -->
  <rect width="512" height="512" rx="112" ry="112" fill="url(#bg)"/>
  <!-- Centred letter -->
  <text
    x="256" y="340"
    font-family="system-ui, -apple-system, sans-serif"
    font-weight="700"
    font-size="280"
    text-anchor="middle"
    fill="rgba(255,255,255,0.95)"
  >${char}</text>
</svg>`;
}

/**
 * Naively lightens a hex color by mixing it toward white.
 * @param {string} hex   - e.g. "#6366f1"
 * @param {number} ratio - 0..1, how much to lighten
 */
function lighten(hex, ratio) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const mix = v => Math.round(v + (255 - v) * ratio);
  return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
