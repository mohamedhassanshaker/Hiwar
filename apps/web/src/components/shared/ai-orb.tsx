"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The AI sphere handoff v2 puts on the assistant launcher and at the head of its panel.
 *
 * It is a WebGL fragment shader: metaballs merged with a smooth minimum, lit along one
 * axis and read through a glass shell, in the website's own light-blue and lavender
 * gradient. A canvas rather than SVG because the shape is a distance field evaluated per
 * pixel; there is no path to draw.
 *
 * Three things keep it from being an animation that never stops. `energy` is the only
 * thing hover and the open panel change, and it eases rather than switching; `still`
 * parks the loop once the eased value has arrived, so the panel's small orb costs one
 * frame and then nothing; and `prefers-reduced-motion` draws a single frame and never
 * starts the loop at all. A machine with no WebGL context gets the gradient fallback.
 */

const VERTEX = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

const FRAGMENT = `precision mediump float;
uniform vec2 uRes;uniform float uT;uniform float uE;uniform float uDark;
float sdC(vec2 p,vec2 c,float r){return length(p-c)-r;}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
void main(){
vec2 uv=(gl_FragCoord.xy*2.-uRes)/min(uRes.x,uRes.y);
const float S=.8;vec2 p=uv/S;float L=length(p);float px=2.4/min(uRes.x,uRes.y)/S;
float sm=1.-smoothstep(1.-px,1.+px,L);
float t=uT,e=uE;
vec2 b=rot(-.25+.35*sin(t*.21))*p;b/=1.+.035*sin(t*.85)+.02*e*sin(t*2.1);
float m=.035+.02*e;
vec2 c1=vec2(-.1,-.09)+m*vec2(sin(t*.7),cos(t*.9));
vec2 c2=vec2(.1,.11)+m*vec2(cos(t*.8+1.),sin(t*.6+2.));
vec2 c3=vec2(.03,.0)+m*1.3*vec2(sin(t*.5+3.),cos(t*.75));
float an=atan(b.y,b.x);
float d=smin(sdC(b,c1,.5),sdC(b,c2,.46),.42);d=smin(d,sdC(b,c3,.44),.36);
d+=(.012+.008*e)*sin(an*3.+t*1.1)+.007*sin(an*5.-t*.9);
vec2 b2=rot(.25*sin(t*.33))*(b-vec2(.07,.05)-.04*vec2(sin(t*.6),cos(t*.5)));
float d2=smin(sdC(b2,c1*.86,.41),sdC(b2,c2*1.04,.37),.36);
float aa=px*1.4;
float bm=1.-smoothstep(-aa,aa,d);
float bm2=(1.-smoothstep(-.05,.05,d2))*bm;
float g=clamp(dot(b,normalize(vec2(.75,.65)))*1.05+.5+.08*sin(t*.4),0.,1.);
vec3 cyan=vec3(.66,.9,1.),blue=vec3(.5,.74,1.),vio=vec3(.6,.72,1.),lav=vec3(.86,.9,.99),amb=vec3(.973,.71,0.);
vec3 bc=g<.5?mix(cyan,blue,g*2.):mix(blue,vio,(g-.5)*2.);
bc=mix(bc,mix(bc,lav,.6),smoothstep(-.16,0.,d)*.5);
bc=mix(bc,mix(bc,vec3(.42,.66,1.),.5),bm2*.5);
bc=mix(bc,lav,smoothstep(.05,0.,abs(d2))*bm*.18);bc+=amb*smoothstep(.12,0.,abs(d+.05))*bm*.07*(.7+.3*sin(t*.6));
bc=mix(bc,bc*.96,smoothstep(.0,-.3,d)*.3);
vec3 vc=vec3(.18,.86,1.),vb=vec3(.12,.52,1.),vv=vec3(.58,.4,1.);
vec3 vbc=g<.5?mix(vc,vb,g*2.):mix(vb,vv,(g-.5)*2.);
vbc=mix(vbc,vec3(.45,.8,1.),bm2*.35);
vbc+=vec3(.05,.12,.25)*smoothstep(-.18,0.,d)*.8;
vbc*=1.+.12*e+.04*sin(t*.7);
bc=mix(bc,vbc,uDark);
float hl=1.-.55*uDark;
vec3 glass=mix(vec3(.88,.94,1.),vec3(1.),.45);
glass=mix(glass,vec3(.635,.8,1.),clamp(dot(p,vec2(.62,-.62))*.55+.3,0.,1.)*.35);
glass=mix(glass,mix(vec3(.07,.1,.24),vec3(.14,.2,.48),clamp(dot(p,vec2(.62,-.62))*.55+.4,0.,1.)),uDark*.9);glass=mix(glass,amb,smoothstep(.5,0.,length(p-vec2(.55,-.6)))*.06);
float inner=1.-smoothstep(.8,.9,L);
vec3 col=mix(glass,bc,bm*.94*inner);
col=mix(col,mix(lav,vec3(1.),.6),smoothstep(.82,.93,L)*.5*hl);
col=mix(col,lav,smoothstep(.02,0.,abs(L-.865))*.3*hl);
float ang=atan(p.y,p.x);
vec3 iri=.5+.5*cos(vec3(0.,2.1,4.2)+ang+t*.15);
vec3 rimc=mix(mix(vec3(.82,.9,1.),vec3(.635,.8,1.),.5+.5*sin(ang+t*.15)),vio,.08);
rimc=mix(rimc,vec3(.36,.56,.98),uDark*.6);
col=mix(col,rimc,smoothstep(.86,1.,L)*.6);
vec2 np=p/max(L,.001);
col=mix(col,vec3(1.),smoothstep(.045,0.,abs(L-.91))*smoothstep(.25,.95,dot(np,normalize(vec2(-.72,.7))))*.8*(1.-.3*uDark));
col=mix(col,vec3(1.),smoothstep(.55,0.,length(p-vec2(-.42,.5)))*.3*hl);
col=min(col,vec3(1.));
float od=max(L-1.,0.);
float halo=exp(-od*14.)*(1.-sm)*(.1+.16*e+.03*sin(t*1.4))*smoothstep(1.24,1.02,L)*(1.+1.1*uDark);
vec3 hc=mix(vec3(.635,.8,1.),vec3(.55,.62,.95),.25+.15*sin(t*.5));hc=mix(hc,mix(vec3(.2,.7,1.),vec3(.5,.4,1.),.4+.2*sin(t*.5)),uDark*.8);
gl_FragColor=vec4(col*sm+hc*halo,sm+halo*(1.-sm));
}`;

/** What the draw loop reads. Held in a ref: none of it belongs in a render. */
type Motion = { energy: number; hover: boolean; active: boolean; time: number; still: boolean; kick?: () => void };

/**
 * The orb, `size` pixels square, drawn on a canvas 1.25 times that size for the halo. `active`
 * raises its energy, hovering or focusing the enclosing `[data-orb-host]` (or button) raises it
 * less, and `still` lets the loop stop once the energy settles. Falls back to a CSS gradient when
 * WebGL is unavailable or the program fails to link.
 */
export function AiOrb({ active, size = 60, still = false }: { active?: boolean; size?: number; still?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const motion = useRef<Motion>({ energy: 0.15, hover: false, active: false, time: 3, still: false });
  const [fallback, setFallback] = useState(false);

  // The draw loop reads its inputs from a ref, because it runs outside React: keeping them
  // in sync is an effect, not something the render does on its way past.
  useEffect(() => {
    motion.current.active = !!active;
    motion.current.still = !!still;
    motion.current.kick?.();
  }, [active, still]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const gl = element.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) {
      setFallback(true);
      return;
    }

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFallback(true);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "uRes");
    const uT = gl.getUniformLocation(program, "uT");
    const uE = gl.getUniformLocation(program, "uE");
    const uDark = gl.getUniformLocation(program, "uDark");
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // The halo spills outside the sphere, so the canvas is drawn larger than the orb's box.
    const css = size * 1.25;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(css * ratio);
    element.height = Math.round(css * ratio);
    gl.viewport(0, 0, element.width, element.height);

    const draw = () => {
      const state = motion.current;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, element.width, element.height);
      gl.uniform1f(uT, state.time);
      gl.uniform1f(uE, state.energy);
      gl.uniform1f(uDark, document.documentElement.dataset.theme === "dark" ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const state = motion.current;
      // Seconds since the last frame, capped at 50 ms so a resumed tab does not jump; energy
      // eases toward its target and time runs faster the more energy there is.
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      const target = state.active ? 1 : state.hover ? 0.6 : 0.15;
      state.energy += (target - state.energy) * Math.min(delta * 3, 1);
      state.time += delta * (0.55 + 0.9 * state.energy);
      draw();
      const settled = state.still && !state.hover && !state.active && Math.abs(state.energy - target) < 0.01;
      frame = document.hidden || settled ? 0 : requestAnimationFrame(step);
    };
    // Restarts the loop if it is parked. Under reduced motion it draws one frame at a fixed
    // energy for the current state instead.
    const kick = () => {
      if (reduced.matches) {
        const state = motion.current;
        state.energy = state.active ? 0.7 : state.hover ? 0.45 : 0.2;
        draw();
        return;
      }
      if (!frame && !document.hidden) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    };
    motion.current.kick = kick;

    // The host is the launcher or the hero, not the canvas: the canvas has no pointer
    // events of its own, and the label pill beside it is part of the same hover.
    const host = element.closest<HTMLElement>("[data-orb-host]") ?? element.closest("button");
    const enter = () => {
      motion.current.hover = true;
      kick();
    };
    const leave = () => {
      motion.current.hover = false;
      kick();
    };
    host?.addEventListener("pointerenter", enter);
    host?.addEventListener("pointerleave", leave);
    host?.addEventListener("focus", enter);
    host?.addEventListener("blur", leave);

    // A parked orb still has to repaint when the theme changes under it.
    const themed = new MutationObserver(() => {
      if (!frame) draw();
    });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const visible = () => kick();
    document.addEventListener("visibilitychange", visible);
    reduced.addEventListener("change", kick);
    kick();

    return () => {
      themed.disconnect();
      cancelAnimationFrame(frame);
      frame = -1;
      document.removeEventListener("visibilitychange", visible);
      reduced.removeEventListener("change", kick);
      host?.removeEventListener("pointerenter", enter);
      host?.removeEventListener("pointerleave", leave);
      host?.removeEventListener("focus", enter);
      host?.removeEventListener("blur", leave);
    };
  }, [size]);

  return (
    <span className="awp-orb" style={{ width: size, height: size }}>
      {fallback ? <span className="awp-orb-fb" /> : <canvas ref={canvas} style={{ width: size * 1.25, height: size * 1.25 }} />}
    </span>
  );
}
