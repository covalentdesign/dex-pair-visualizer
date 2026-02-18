// WebGL post-processing: vignette, scan lines, chromatic aberration

const VERT_SRC = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAG_SRC = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_texture;
  uniform float u_time;
  uniform vec2 u_resolution;

  void main() {
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y); // Flip Y — Canvas 2D is top-down, WebGL is bottom-up

    // --- Chromatic aberration ---
    // Subtle RGB channel split that increases toward edges
    vec2 center = uv - 0.5;
    float dist = length(center);
    float aberration = dist * 0.004;

    float r = texture2D(u_texture, uv + center * aberration).r;
    float g = texture2D(u_texture, uv).g;
    float b = texture2D(u_texture, uv - center * aberration).b;
    vec3 color = vec3(r, g, b);

    // --- Vignette ---
    float vignette = 1.0 - dist * 1.1;
    vignette = clamp(vignette, 0.0, 1.0);
    vignette = vignette * vignette; // quadratic falloff
    // Blend: subtle darkening at edges
    color *= 0.7 + 0.3 * vignette;

    // --- Subtle noise grain ---
    float noise = fract(sin(dot(uv * u_time * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
    color += (noise - 0.5) * 0.015;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export interface PostProcessor {
  canvas: HTMLCanvasElement;
  process: (sourceCanvas: HTMLCanvasElement, time: number) => void;
  resize: (width: number, height: number) => void;
  destroy: () => void;
}

export function createPostProcessor(): PostProcessor | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
  if (!gl) return null;

  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vert || !frag) return null;

  const program = gl.createProgram()!;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    return null;
  }

  gl.useProgram(program);

  // Fullscreen quad
  const posBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1,
  ]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Texture
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // Uniforms
  const uTexture = gl.getUniformLocation(program, "u_texture");
  const uTime = gl.getUniformLocation(program, "u_time");
  const uResolution = gl.getUniformLocation(program, "u_resolution");

  gl.uniform1i(uTexture, 0);

  function resize(width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    gl!.viewport(0, 0, canvas.width, canvas.height);
  }

  function process(sourceCanvas: HTMLCanvasElement, time: number) {
    if (!gl) return;

    // Upload 2D canvas as texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

    // Set uniforms
    gl.uniform1f(uTime, time * 0.001);
    gl.uniform2f(uResolution, canvas.width, canvas.height);

    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function destroy() {
    gl?.deleteProgram(program);
    gl?.deleteShader(vert);
    gl?.deleteShader(frag);
    gl?.deleteBuffer(posBuffer);
    gl?.deleteTexture(texture);
  }

  return { canvas, process, resize, destroy };
}
