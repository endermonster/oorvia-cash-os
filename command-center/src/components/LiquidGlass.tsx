'use client'

import { useEffect } from 'react'
import map from '../../assets/plates/map.png'

/**
 * Liquid glass, drawn on the GPU in one pass. A fixed WebGL canvas behind the page paints the night (the same
 * close-up city light as the .night fallback) and, under every `.glass` panel, the same light seen through thick
 * glass: frosted in the middle, bent and split into colour at the rim, with a sheen near the pointer.
 *
 * It draws only when something moves (scroll, resize, pointer, layout), never on a loop, so an idle dashboard
 * costs nothing. Without WebGL2 the panels keep their CSS backdrop blur and the .night image.
 */
const MAX = 16
const BEZEL = 34 // px of rim that refracts
const SCALE = 54 // max rim displacement, px

const VERT = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uImg;
uniform vec4 uRects[${MAX}];
uniform float uRad[${MAX}];
uniform int uCount;
uniform vec2 uPtr;
out vec4 o;

const float ZOOM = 2.4;
const vec2 ORIGIN = vec2(0.52, 0.30);
const vec3 GROUND = vec3(6.0, 10.0, 19.0) / 255.0;

vec2 uvAt(vec2 p) {
  vec2 O = ORIGIN * uRes;
  vec2 q = O + (p - O) / ZOOM;
  float s0 = max(uRes.x / uImg.x, uRes.y / uImg.y);
  vec2 off = (uRes - uImg * s0) * 0.5;
  return (q - off) / (s0 * uImg);
}
vec3 lightAt(vec2 p, float lod) {
  vec3 c = textureLod(uTex, uvAt(p), lod).rgb * 0.8;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, 1.25);
}
vec3 dusk(vec3 c, vec2 p) {
  vec2 uv = p / uRes;
  vec2 d = (uv - vec2(0.5, 0.4)) / vec2(1.2, 0.9);
  c = mix(c, GROUND, mix(0.15, 0.7, clamp(length(d) / 0.78, 0.0, 1.0)));
  c = mix(c, GROUND, mix(0.25, 0.5, uv.y));
  vec2 g = (p - vec2(0.08 * uRes.x, -0.06 * uRes.y)) / vec2(800.0, 576.0);
  return c + vec3(70.0, 120.0, 210.0) / 255.0 * 0.22 * clamp(1.0 - length(g) / 0.7, 0.0, 1.0);
}
float sdRR(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  // Haze fades to the blue-black ground; only bright cities stay, as soft points of gold. A light blur keeps them soft.
  vec3 bg = lightAt(p, 1.0);
  float lum = dot(bg, vec3(0.299, 0.587, 0.114));
  vec3 col = dusk(GROUND + bg * smoothstep(0.16, 0.7, lum) * 0.85, p);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    vec4 R = uRects[i];
    vec2 b = R.zw * 0.5;
    vec2 c = R.xy + b;
    float r = min(uRad[i], min(b.x, b.y));
    vec2 q = p - c;
    float d = sdRR(q, b, r);
    if (d >= 0.0) continue;
    float bez = min(${BEZEL}.0, min(b.x, b.y) * 0.66);
    float t = clamp(1.0 + d / bez, 0.0, 1.0);
    float mag = t * t * (3.0 - 2.0 * t);
    float e = 0.75;
    vec2 n = normalize(vec2(sdRR(q + vec2(e, 0.0), b, r) - sdRR(q - vec2(e, 0.0), b, r),
                            sdRR(q + vec2(0.0, e), b, r) - sdRR(q - vec2(0.0, e), b, r)) + 1e-6);
    vec2 off = -n * mag * ${SCALE}.0 * 0.5;
    vec3 frost = lightAt(p + off * 0.94, 1.9);
    vec3 rim = vec3(lightAt(p + off, 0.6).r, lightAt(p + off * 0.94, 0.6).g, lightAt(p + off * 0.88, 0.6).b);
    vec3 g = dusk(mix(frost, rim, clamp(mag * 1.8, 0.0, 1.0)), p);
    float l = dot(g, vec3(0.299, 0.587, 0.114));
    g = mix(vec3(l), g, 1.45) * 1.04;
    g = mix(g * vec3(0.82, 0.94, 1.22), vec3(0.085, 0.13, 0.23), 0.16); // blue smoke, not grey
    g += vec3(0.075) * clamp(1.0 - length(p - uPtr) / 322.0, 0.0, 1.0);
    col = g;
    break;
  }
  o = vec4(col, 1.0);
}`

export function LiquidGlass() {
  useEffect(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' })
    if (!gl) return
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    let prog: WebGLProgram
    try {
      prog = gl.createProgram()!
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link')
    } catch (err) {
      console.warn('Liquid glass off:', err)
      return
    }
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'a')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const U = (n: string) => gl.getUniformLocation(prog, n)
    const uRes = U('uRes'), uDpr = U('uDpr'), uImg = U('uImg'), uRects = U('uRects'), uRad = U('uRad'), uCount = U('uCount'), uPtr = U('uPtr')

    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '-1', pointerEvents: 'none' })
    canvas.setAttribute('aria-hidden', 'true')

    let ready = false
    let raf = 0
    let ptr = { x: -9999, y: -9999 }
    const radius = new WeakMap<Element, number>()
    let panels: HTMLElement[] = []
    const rects = new Float32Array(MAX * 4)
    const rads = new Float32Array(MAX)

    const draw = () => {
      raf = 0
      if (!ready) return
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const w = window.innerWidth, h = window.innerHeight
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr)
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph }
      gl.viewport(0, 0, pw, ph)
      let n = 0
      for (const el of panels) {
        if (n >= MAX) break
        const r = el.getBoundingClientRect()
        if (r.bottom < 0 || r.top > h || r.width === 0) continue
        rects.set([r.left, r.top, r.width, r.height], n * 4)
        rads[n] = radius.get(el) ?? 20
        n++
      }
      gl.uniform2f(uRes, w, h)
      gl.uniform1f(uDpr, dpr)
      gl.uniform4fv(uRects, rects)
      gl.uniform1fv(uRad, rads)
      gl.uniform1i(uCount, n)
      gl.uniform2f(uPtr, ptr.x, ptr.y)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const request = () => { if (!raf) raf = requestAnimationFrame(draw) }

    const ro = new ResizeObserver(request)
    const scan = () => {
      panels = [...document.querySelectorAll<HTMLElement>('.glass')]
      for (const el of panels) {
        if (!radius.has(el)) { radius.set(el, parseFloat(getComputedStyle(el).borderTopLeftRadius) || 20); ro.observe(el) }
      }
      request()
    }
    const mo = new MutationObserver(scan)

    // Cleanup can run before the image loads (Strict Mode replays effects): a late onload must not reattach the canvas.
    let disposed = false
    let followRaf = 0
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      if (disposed) return
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.uniform2f(uImg, img.naturalWidth, img.naturalHeight)
      gl.uniform1i(U('uTex'), 0)
      ready = true
      document.body.appendChild(canvas)
      document.documentElement.classList.add('gl-glass')
      scan()
      // Panels rise in on load; follow them for that second.
      const until = performance.now() + 1200
      const follow = () => { draw(); followRaf = performance.now() < until ? requestAnimationFrame(follow) : 0 }
      followRaf = requestAnimationFrame(follow)
    }
    // The same optimised file the .night image already loaded, so it comes from cache.
    img.src = `/_next/image?url=${encodeURIComponent(map.src)}&w=1920&q=75`

    const onPtr = (e: PointerEvent) => { ptr = { x: e.clientX, y: e.clientY }; request() }
    window.addEventListener('scroll', request, { passive: true, capture: true })
    window.addEventListener('resize', request)
    window.addEventListener('pointermove', onPtr, { passive: true })
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      disposed = true
      img.onload = null
      cancelAnimationFrame(raf)
      cancelAnimationFrame(followRaf)
      window.removeEventListener('scroll', request, { capture: true })
      window.removeEventListener('resize', request)
      window.removeEventListener('pointermove', onPtr)
      ro.disconnect()
      mo.disconnect()
      canvas.remove()
      document.documentElement.classList.remove('gl-glass')
    }
  }, [])
  return null
}
