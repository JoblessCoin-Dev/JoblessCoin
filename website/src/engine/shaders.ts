// GLSL for the Breakout. Particles are positioned entirely on the GPU from a few uniforms,
// so the CPU cost per frame is a handful of numbers regardless of particle count.

export const particleVertex = /* glsl */ `
uniform float uTime, uRot, uForm, uBreak, uShock, uScroll, uPixel, uSize, uScale;
uniform float uGapA, uGapHalf, uPulseT, uPulseA, uPage, uAlive, uMouseStr;
uniform vec2 uCenter, uOffset, uMouse, uJCenter;
attribute vec2 aPolar;
attribute vec2 aTarget;
attribute vec4 aSeed;
attribute float aKind;
varying vec3 vColor;
varying float vAlpha;

const vec3 WHITE = vec3(0.96, 0.97, 0.96);
const vec3 GREEN = vec3(0.21, 1.0, 0.435);
const float PI = 3.14159265;

vec2 toWorld(vec2 p) { return (p - 512.0) * vec2(1.0, -1.0) / 420.0 * uScale + uOffset; }
float angDiff(float a, float b) { return atan(sin(a - b), cos(a - b)); }
float ease(float x) { return x * x * (3.0 - 2.0 * x); }

void main() {
  vec3 pos;
  vec3 col;
  float alpha;
  float size = uSize * (0.55 + aSeed.y * 0.9);
  float t = uTime;

  if (aKind < 1.5) {
    // Both ring and J particles start on the loop, running like a machine.
    float ang = aPolar.x + uRot + sin(t * 0.6 + aSeed.x * 30.0) * 0.004;
    ang += uBreak * sin(t * 0.35 + aSeed.z * 20.0) * 0.03 * (0.5 + aSeed.w); // rhythm lost after the break
    float rad = aPolar.y + sin(t * 1.9 + aSeed.x * 50.0) * (2.0 + uBreak * 6.0);
    vec2 ring = uCenter + vec2(cos(ang), sin(ang)) * rad;

    // data pulses racing around the loop, plus one sent by a click
    float p1 = pow(max(0.0, cos(ang - t * 2.2)), 60.0);
    float p2 = pow(max(0.0, cos(ang * 2.0 + t * 3.1 + 1.7)), 90.0);
    float since = t - uPulseT;
    float pc = exp(-pow(angDiff(ang, uPulseA + since * 3.5) * 5.0, 2.0)) * exp(-since * 0.8) * step(0.0, since);
    float pulse = (p1 + p2) * (1.0 - uBreak * 0.8) + pc;

    if (aKind < 0.5) {
      // RING. Where the J punches through, particles get blasted out and the gap opens.
      float d = angDiff(ang, uGapA);
      float inGap = 1.0 - smoothstep(uGapHalf * 0.75, uGapHalf * 1.15, abs(d));
      float broke = step(0.0, uShock);
      float shockT = max(uShock, 0.0);
      float blast = inGap * broke;
      vec2 outDir = normalize(ring - uCenter);
      vec2 flyDir = normalize(outDir + vec2(aSeed.z - 0.5, aSeed.w - 0.5) * 1.4);
      ring += flyDir * blast * (60.0 + aSeed.w * 420.0) * (1.0 - exp(-shockT * 3.0));

      // shockwave rolling out from the breakout point
      vec2 G = uCenter + vec2(cos(uGapA), sin(uGapA)) * 300.0;
      float dist = length(ring - G);
      float wave = exp(-pow((dist - shockT * 900.0) / 55.0, 2.0)) * broke * exp(-shockT * 1.2);
      ring += normalize(ring - G + 0.001) * wave * 28.0;

      // scroll: the loop falls apart behind the J
      ring = uCenter + (ring - uCenter) * (1.0 + uScroll * (0.5 + aSeed.x * 0.9));
      pos = vec3(toWorld(ring), (aSeed.y - 0.5) * 0.25 - uScroll * aSeed.z * 2.0);
      col = mix(WHITE, GREEN, clamp(pulse * 1.4 + wave * 0.8, 0.0, 1.0));
      alpha = 0.42 + aSeed.x * 0.3 + pulse * 0.9 + wave * 0.6;
      alpha *= 1.0 - blast * smoothstep(0.2, 1.6, shockT);
      alpha *= 1.0 - uScroll * 0.88;
    } else {
      // J. Peels off the ring, assembles trapped inside it, then breaks out.
      vec2 trapped = uCenter + (aTarget - uJCenter) * 0.56 + vec2(0.0, 30.0);
      float f = ease(clamp((uForm - aSeed.x * 0.62) / 0.38, 0.0, 1.0));
      vec2 path = trapped - ring;
      vec2 p = mix(ring, trapped, f) + vec2(-path.y, path.x) * sin(f * PI) * (aSeed.z - 0.5) * 0.35;

      float charge = smoothstep(0.92, 1.0, uForm) * (1.0 - step(0.001, uBreak));
      p += vec2(sin(t * 71.0 + aSeed.w * 9.0), cos(t * 67.0 + aSeed.x * 7.0)) * charge * 3.5;

      float b = clamp((uBreak - aSeed.z * 0.18) / 0.82, 0.0, 1.0); // late particles leave a trail
      float bo = 1.0 + 2.2 * pow(b - 1.0, 3.0) + 1.2 * pow(b - 1.0, 2.0); // overshoot, then settle
      p = mix(p, aTarget, bo);
      p += vec2(sin(t * 0.9 + aSeed.y * 6.0), cos(t * 0.7 + aSeed.x * 6.0)) * 1.8 * b;

      // scroll: the J flies forward, into the site
      float s = uScroll;
      vec2 w = toWorld(p);
      pos = vec3(w * (1.0 + s * 0.35) + vec2(0.0, s * 0.35), s * s * 3.3 + (aSeed.y - 0.5) * 0.12);
      col = mix(mix(WHITE, GREEN, 0.25 + pulse), GREEN, f);
      alpha = mix(0.45 + pulse * 0.8, 0.95, f) * (0.75 + aSeed.w * 0.25);
      alpha += step(0.0, uShock) * exp(-uShock * 3.0) * 0.8;
      alpha *= 1.0 - smoothstep(0.55, 1.0, s);
      size *= 1.0 + f * 0.35;
    }
  } else {
    // DUST. Slow atmospheric particles that live behind the whole page.
    vec3 d = position;
    d.x += sin(t * 0.05 + aSeed.x * 60.0) * 0.35;
    d.y = mod(d.y + t * 0.015 * (0.3 + aSeed.y) + uPage * (0.2 + aSeed.z * 0.5) + 4.5, 9.0) - 4.5;
    pos = d;
    col = mix(WHITE, GREEN, step(0.82, aSeed.w));
    alpha = (0.12 + aSeed.x * 0.22) * (0.6 + 0.4 * sin(t * (0.5 + aSeed.y) + aSeed.z * 40.0));
    size *= 0.8;
  }

  // the cursor pushes particles aside like a finger through water
  vec2 md = pos.xy - uMouse;
  float ml = length(md);
  float push = uMouseStr * exp(-ml * ml * 7.0) * (aKind > 1.5 ? 0.4 : 1.0);
  pos.xy += (md / (ml + 0.0001)) * push * 0.22 + vec2(-md.y, md.x) * push * 0.35;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPixel * (5.0 / max(-mv.z, 0.5));
  vColor = col;
  vAlpha = clamp(alpha, 0.0, 1.0) * uAlive;
}
`;

export const particleFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = smoothstep(0.22, 0.0, d);
  float halo = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor, (core * 0.85 + halo * halo * 0.45) * vAlpha);
}
`;

export const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Liquid darkness: domain-warped noise, volumetric light from the J, a deep green pool of
// light, vignette. Rendered at reduced resolution, it's smooth by nature so nobody can tell.
export const atmosphereFragment = /* glsl */ `
uniform vec2 uRes;
uniform float uTime, uLightStr, uPage, uFlash;
uniform vec2 uLight, uMouse;
varying vec2 vUv;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.04;

  vec2 md = p - m;
  p += md * exp(-dot(md, md) * 6.0) * 0.12; // soft distortion under the cursor

  vec2 q = vec2(fbm(p * 1.4 + vec2(t, -t * 0.7) + uPage * 0.08), fbm(p * 1.4 + vec2(5.2, 1.3) - t));
  float n = fbm(p * 1.8 + q * 2.2 + vec2(0.0, uPage * 0.12));

  vec3 col = vec3(0.028, 0.035, 0.032);
  col += vec3(0.020, 0.055, 0.038) * smoothstep(0.35, 0.95, n) * 1.6;
  col += vec3(0.010, 0.020, 0.018) * q.x;

  vec2 ld = p - (uLight - 0.5) * vec2(aspect, 1.0);
  float r = length(ld);
  float rays = fbm(vec2(atan(ld.y, ld.x) * 2.5, t * 2.0 + r * 0.5));
  col += vec3(0.21, 1.0, 0.44) * (uLightStr / (1.0 + r * r * 18.0)) * (0.10 + 0.10 * n);
  col += vec3(0.21, 1.0, 0.44) * pow(rays, 3.0) * exp(-r * 2.5) * 0.07 * uLightStr;
  col += vec3(0.21, 1.0, 0.44) * uFlash * exp(-r * 3.0) * 0.35;
  col += vec3(0.0, 0.65, 0.24) * 0.045 * exp(-length(p - vec2(-0.85 * aspect, -0.55)) * 1.4) * (0.6 + 0.4 * n);

  col *= 1.0 - 0.55 * pow(length(vUv - 0.5) * 1.25, 2.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Upscales the atmosphere and adds a whisper of film grain so gradients never band.
export const compositeFragment = /* glsl */ `
uniform sampler2D uTex;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  c += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * (3.0 / 255.0);
  gl_FragColor = vec4(c, 1.0);
}
`;
