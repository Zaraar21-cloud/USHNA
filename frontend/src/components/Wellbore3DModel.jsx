/**
 * USHNA — single-file React / Three.js wellbore visualisation.
 * Dependencies: react >=18, three >=0.150.0 (tested against 0.170.0).
 * Usage: import Wellbore3DModel from './Wellbore3DModel'; <Wellbore3DModel />
 * Give the parent a height, or use the default 760 px component height.
 * No assets or network calls: rock textures (with black heavy-oil patches) are
 * drawn procedurally on canvases at mount.
 *
 * TWIN HOOKS (all optional)
 * heat {radius, core} replaces the illustrative cooling curve; steam strengthens
 * the travelling thermal wave; speed multiplies the visual stroke rate; view
 * names a camera preset the parent drives (tweened over tweenMs); info {thermal,
 * oil} fills the two clickable hotspots with {title, rows:[[label,value]], note}.
 *
 * ENGINEERING SCOPE
 * Depth readouts and rod diameters follow the supplied build brief. The upper
 * well is compressed to 12% height; the bottom 70 m and reservoir stay 1:1.
 * Well hardware diameters are exaggerated 50x for a readable cutaway. Surface
 * equipment is schematic. Pump diameter exceeds tubing ID in the brief, so the
 * tubing terminates at the pump assembly (not a through-tubing installation).
 * Cooling and default FMI are illustrative, NOT calibrated engineering models.
 * coreTemp and heatedRadius are day-zero values; day applies exponential decay.
 * Pass fmi to override illustrative FMI. Callbacks let a parent persist edits.
 * day/spm/animating props resynchronise internal controls when their values change.
 * pumpDepth moves the pump and pay-zone together; default geometry is 1100 m.
 * Reservoir temperature, radius, SPM and all other numerical inputs are bounded.
 * GPU budget: 24-step volume shader, low-poly solids, capped DPR, no shadows or
 * post-processing. 60 fps is a target, not a hardware-independent guarantee.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const H = 50;
// Presentation coordinates are separate from engineering depths. The long
// upper column is compact; the bottom 70 m retains the heater's true shape.
const COLUMN_SCALE = .12;
function displayDepth(depth, pumpDepth) {
  const knee = pumpDepth - 70;
  return depth <= knee ? depth * COLUMN_SCALE : knee * COLUMN_SCALE + depth - knee;
}
function realDepth(display, pumpDepth) {
  const knee = pumpDepth - 70, seam = knee * COLUMN_SCALE;
  return display <= seam ? display / COLUMN_SCALE : knee + display - seam;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const number = (v, fallback, lo, hi) => clamp(Number.isFinite(v) ? v : fallback, lo, hi);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const sectionAt = (d, p) => d < p * 760 / 1100 ? '1″ steel · Ø25.4 mm' : d < p * 1030 / 1100 ? '⅞″ steel · Ø22.2 mm' : '1½″ sinker bars · Ø38.1 mm';
function thermal(day, radius, core, cold) {
  // Explicit, editable demonstration curves. No claim of field calibration.
  return { radius: radius * Math.exp(-day / 90), core: cold + (core - cold) * Math.exp(-day / 42) };
}
function temperature(depth, radial, s) {
  const q = Math.hypot(radial / s.hot.radius, (depth - s.pumpDepth) / Math.min(10, s.hot.radius));
  return s.reservoirTemp + (s.hot.core - s.reservoirTemp) * Math.exp(-3.2 * q * q);
}

// GPU ray-marched ellipsoid: integrated density, soft edge, absolute °C colours.
// Sampling in world coordinates avoids a camera-facing sprite or hard shell.
const volumeVertex = `varying vec3 vWorld;
void main(){vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
const volumeFragment = `precision highp float;
varying vec3 vWorld;
uniform vec3 center;
uniform vec3 radii;
uniform float hot;
uniform float cold;
uniform float time;
uniform float wave;
vec3 ramp(float t){
 if(t<70.) return mix(vec3(.045,.13,.28),vec3(.46,.11,.08),clamp((t-47.)/23.,0.,1.));
 if(t<140.) return mix(vec3(.46,.11,.08),vec3(.95,.38,.055),(t-70.)/70.);
 if(t<210.) return mix(vec3(.95,.38,.055),vec3(1.,.72,.23),(t-140.)/70.);
 return mix(vec3(1.,.72,.23),vec3(1.,.96,.79),clamp((t-210.)/40.,0.,1.));
}
void main(){
 vec3 dir=normalize(vWorld-cameraPosition);
 vec3 origin=(cameraPosition-center)/radii;
 vec3 ray=dir/radii;
 float a=dot(ray,ray), b=dot(origin,ray), c=dot(origin,origin)-1.;
 float disc=b*b-a*c;if(disc<0.)discard;
 float start=max(0.,(-b-sqrt(disc))/a), end=(-b+sqrt(disc))/a;
 float ds=(end-start)/24.;vec4 acc=vec4(0.);
 for(int i=0;i<24;i++){
   vec3 q=(cameraPosition+dir*(start+(float(i)+.5)*ds)-center)/radii;
   float r=length(q);
   // Thermal wave: rings travel outward from the well; wave=1 while steaming.
   float ripple=.5+.5*sin(r*14.-time*3.2);
   float excess=(hot-cold)*exp(-3.2*r*r)*(1.+.22*wave*(ripple-.5));
   float t=cold+excess;
   float density=(1.-smoothstep(.62,1.,r))*.19*clamp((hot-cold)/90.,.09,1.)*mix(1.,.3+1.5*ripple,wave);
   float alpha=1.-exp(-density*ds);
   acc.rgb+=(1.-acc.a)*ramp(t)*alpha;acc.a+=(1.-acc.a)*alpha;
 }
 if(acc.a<.003)discard;
 gl_FragColor=vec4(acc.rgb/max(acc.a,.0001),acc.a);
}`;

// ── Geometry builders: all generated locally, no external models ─────────────
function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: .77, metalness: .25, ...extra });
}
function mesh(parent, geometry, mat, position = [0, 0, 0]) {
  const m = new THREE.Mesh(geometry, mat); m.position.set(...position); parent.add(m); return m;
}
function box(parent, dimensions, mat, position) {
  return mesh(parent, new THREE.BoxGeometry(...dimensions), mat, position);
}
function cylinder(parent, radius, length, mat, position, open = false) {
  return mesh(parent, new THREE.CylinderGeometry(radius, radius, length, 24, 1, open, open ? Math.PI / 2 : 0, open ? Math.PI : Math.PI * 2), mat, position);
}
// A solid half-annulus gives each cut pipe an inner bore, wall thickness,
// end rims and flat section faces, rather than a paper-thin cylinder shell.
function cutPipe(parent, outer, inner, length, mat, position, edges = true) {
  const shape = new THREE.Shape();
  shape.moveTo(outer, 0);
  shape.absarc(0, 0, outer, 0, Math.PI, false);
  shape.lineTo(-inner, 0);
  shape.absarc(0, 0, inner, Math.PI, 0, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {depth:length, bevelEnabled:false, curveSegments:32, steps:1});
  // Local shape y becomes negative world z; extrusion becomes world y.
  geo.rotateX(-Math.PI/2); geo.translate(0,-length/2,0);
  const pipe = mesh(parent,geo,mat,position);
  if(!edges)return pipe;
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo,35),
    new THREE.LineBasicMaterial({color:'#c3d1d8',transparent:true,opacity:.30}));
  edge.raycast=()=>{};pipe.add(edge);
  return pipe;
}
// Rock is a half-cylinder (60 m drainage radius) with a bore-shaped notch, so
// the formation reads as a cylindrical well and the cut face exposes the pipes.
const ROCK_R = 60, BORE = .224/2*H;
function rockBand(parent, length, mat, position) {
  return cutPipe(parent, ROCK_R, BORE, length, mat, position, false);
}
// Seeded (stable between mounts) tileable rock: grain speckle plus soft black
// blotches for heavy oil. oil = number of patches, size = patch scale.
function rockTexture(base, oil, size, seed) {
  let a = seed;
  const rnd = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) {
    const w = 1 + rnd() * 4;
    g.fillStyle = rnd() < .5 ? `rgba(0,0,0,${.05 + .14 * rnd()})` : `rgba(255,255,255,${.04 + .09 * rnd()})`;
    g.fillRect(rnd() * 256, rnd() * 256, w, w * (.5 + rnd()));
  }
  for (let i = 0; i < oil; i++) {
    const x = rnd() * 256, y = rnd() * 256, r = (6 + rnd() * 16) * size, turn = rnd() * Math.PI, squash = .4 + rnd() * .5;
    for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) { // wrap so the texture tiles seamlessly
      g.save(); g.translate(x + dx, y + dy); g.rotate(turn); g.scale(1, squash);
      const fill = g.createRadialGradient(0, 0, 0, 0, 0, r);
      fill.addColorStop(0, 'rgba(4,4,6,.97)'); fill.addColorStop(.6, 'rgba(8,8,10,.85)'); fill.addColorStop(1, 'rgba(8,8,10,0)');
      g.fillStyle = fill; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1 / 16, 1 / 16); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function beamBetween(parent, a, b, width, mat) {
  const delta = b.clone().sub(a);
  const m = box(parent, [width, delta.length(), width], mat, a.clone().add(b).multiplyScalar(.5).toArray());
  m.quaternion.setFromUnitVectors(V(0,1,0), delta.normalize()); return m;
}
function label(parent, text, pos, width = 15, color = '#c4d0da') {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,512,96);
  ctx.fillStyle = color; ctx.font = '500 38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text,256,48);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map:texture, transparent:true, depthTest:false, depthWrite:false }));
  sprite.position.set(...pos); sprite.scale.set(width,width*96/512,1); parent.add(sprite); return sprite;
}
function buildPumpjack(parent) {
  const steel=material('#859297'), dark=material('#39484f'), pale=material('#b4bebd');
  box(parent,[25,.7,9],dark,[-9,.6,0]);
  beamBetween(parent,V(-11,1,-2),V(-11,10,0),.7,steel);
  beamBetween(parent,V(-16,1,2),V(-11,10,0),.7,steel);
  const walking=new THREE.Group(); walking.position.set(-11,10,0); parent.add(walking);
  box(walking,[18,.75,1.25],steel,[2,0,0]);
  // Curved horsehead, centre of curvature at walking-beam pivot. Its front
  // tangent remains x=0, so the bridle stays aligned with the polished rod.
  const shape=new THREE.Shape();
  for(let i=0;i<=20;i++){const a=-.30+i*.60/20; const x=11*Math.cos(a),y=11*Math.sin(a); i?shape.lineTo(x,y):shape.moveTo(x,y);}
  for(let i=20;i>=0;i--){const a=-.30+i*.60/20;shape.lineTo(9.7*Math.cos(a),9.7*Math.sin(a));} shape.closePath();
  mesh(walking,new THREE.ExtrudeGeometry(shape,{depth:1.25,bevelEnabled:false}),dark,[0,0,-.625]);
  const crank=new THREE.Group(); crank.position.set(-17,4.5,0);parent.add(crank);
  box(parent,[3,3,3],dark,[-17,2.5,0]);
  const axle=cylinder(crank,.5,4,steel,[0,0,0]);axle.rotation.x=Math.PI/2;
  box(crank,[4,.55,1],steel,[0,0,1.8]);box(crank,[2,2,.8],dark,[-1.5,0,1.8]);
  const pitman=beamBetween(parent,V(-16,4.5,2),V(-16,10,2),.3,pale);
  const bridle=cylinder(parent,.07,2,steel,[0,8,0]);
  const polished=cylinder(parent,.0254/2*H,7,pale,[0,5,0]);
  // Flanges, stuffing box, side valve and schematic insulated steam generator.
  cylinder(parent,2.3,2,dark,[0,1.2,0]);
  cylinder(parent,5,.35,dark,[0,.1,0]);
  [0.3,.8,1.7,2.2].forEach(y=>cylinder(parent,2.8,.18,steel,[0,y,0]));
  const valve=box(parent,[3,.5,.5],steel,[1.5,1.4,0]); valve.name='Wellhead valve';
  cylinder(parent,.7,.15,dark,[2.7,2,0]);
  cylinder(parent,2.1,6,pale,[13,3,0]);
  box(parent,[6,.5,6],dark,[13,.3,0]);
  beamBetween(parent,V(11,1.5,0),V(3,1.5,0),.65,pale);
  cylinder(parent,.4,4,dark,[13,8,0]);
  return {walking, crank, pitman, bridle, polished};
}
function buildScene(scene, pumpDepth, darkMode) {
  const D=d=>displayDepth(d,pumpDepth), wellHeight=D(pumpDepth);
  const groups={}; ['rock','casing','tubing','rods','heat'].forEach(k=>{groups[k]=new THREE.Group();scene.add(groups[k]);});
  const neutral=material('#75838c'), casing=material('#51616d',{side:THREE.DoubleSide,metalness:.55,roughness:.48}), tubing=material('#b0c1ca',{side:THREE.DoubleSide,metalness:.65,roughness:.34});
  // Rear half-block leaves the front cross-section permanently exposed.
  const boundaries=[...[0,180,420,620,760,920].map(d=>d*pumpDepth/1100),pumpDepth-10,pumpDepth+10,pumpDepth+50];
  boundaries.slice(0,-1).forEach((a,i)=>{
    const b=boundaries[i+1], pay=Math.abs(a-(pumpDepth-10))<.01, below=Math.abs(a-(pumpDepth+10))<.01;
    const colors=['#756c5c','#636b70','#8d826d','#586369','#857968','#626d74'];
    // Oil-soaked pay zone is dense with black patches; the rock below it less so.
    const map=pay?rockTexture('#6b5a43',34,1.3,i+1):below?rockTexture('#7a6c58',14,1,i+1):rockTexture(colors[i%colors.length],3,.6,i+1);
    const m=rockBand(groups.rock,D(b)-D(a),material('#ffffff',{map,metalness:0,roughness:.95}),[0,-(D(a)+D(b))/2,0]);
    m.userData.component=pay?'Jodhpur Sandstone · pay zone (heavy oil)':below?'Oil-bearing sandstone':'Sedimentary rock';
  });
  const cap=mesh(groups.rock,new THREE.CylinderGeometry(ROCK_R,ROCK_R,.3,48,1,false,Math.PI/2,Math.PI),material('#939387',{metalness:0}),[0,.05,0]);cap.name='Ground';
  cutPipe(groups.casing,.20/2*H,.178/2*H,wellHeight,casing,[0,-wellHeight/2,0]).userData.component='Casing · Ø200 mm';
  cutPipe(groups.tubing,.074/2*H,.062/2*H,D(pumpDepth-10),tubing,[0,-D(pumpDepth-10)/2,0]).userData.component='VIT tubing · 62 mm ID';
  // Restrained coupling collars clarify section scale and pipe construction.
  [200,400,600,760,900,1030].map(d=>d*pumpDepth/1100).forEach(d=>{
    cutPipe(groups.casing,.214/2*H,.20/2*H,.75,casing,[0,-D(d),0]).userData.component='Casing coupling';
  });
  const rodMat=material('#c99543',{metalness:.55,roughness:.43});
  const splitA=pumpDepth*760/1100,splitB=pumpDepth*1030/1100;
  [[0,splitA,.0254],[splitA,splitB,.0222],[splitB,pumpDepth,.0381]].forEach(([a,b,d])=>{
    const m=cylinder(groups.rods,d/2*H,D(b)-D(a),rodMat,[0,-(D(a)+D(b))/2,0]);m.userData.component=sectionAt((a+b)/2,pumpDepth);
  });
  // Barrel stays still; plunger belongs to the moving rod group.
  cutPipe(groups.tubing,.09/2*H,.068/2*H,10,tubing,[0,-wellHeight+5,0]).userData.component='Downhole pump barrel';
  cylinder(groups.rods,.047/2*H,2.5,rodMat,[0,-wellHeight+3,0]).userData.component='Pump plunger';
  const surface=new THREE.Group();scene.add(surface);const jack=buildPumpjack(surface);
  const heatMaterial=new THREE.ShaderMaterial({vertexShader:volumeVertex,fragmentShader:volumeFragment,
    uniforms:{center:{value:V(0,-displayDepth(pumpDepth,pumpDepth),0)},radii:{value:V(13,10,13)},hot:{value:250},cold:{value:47},time:{value:0},wave:{value:.3}},
    transparent:true,depthWrite:false,side:THREE.FrontSide});
  const volume=mesh(groups.heat,new THREE.BoxGeometry(2,2,2),heatMaterial,[0,-wellHeight,0]); volume.renderOrder=2;
  // Drainage outline: full true-scale 60 m circle; the heater never fills it.
  const points=Array.from({length:97},(_,i)=>{const a=i/96*Math.PI*2;return V(ROCK_R*Math.cos(a),-wellHeight+10.2,60*Math.sin(a));});
  const ring=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#688098',transparent:true,opacity:.55}));groups.rock.add(ring);
  const labels=new THREE.Group();scene.add(labels);
  const color=darkMode?'#c4d0da':'#334452';
  label(labels,'JODHPUR SANDSTONE',[-33,-wellHeight+12,3],34,color);
  label(labels,'60 m drainage radius',[39,-wellHeight+13,40],30,color);
  const ruler=new THREE.Group();scene.add(ruler);
  return {groups,rodMat,jack,heatMaterial,volume,labels,ruler,neutral};
}

export default function Wellbore3DModel({
  day:dayProp=41, heatedRadius=13, coreTemp=250, reservoirTemp=47,
  pumpDepth:depthProp=1100, spm:spmProp=6.2, strokeLength=1.22,
  fmi, animating:animatingProp=true, theme='dark', height=760,
  heat, steam=false, speed=1, view:viewProp, tweenMs=950, info, phaseLabel,
  onDayChange, onSpmChange, onAnimatingChange,
} = {}) {
  const host=useRef(null), engine=useRef(null), live=useRef(null);
  const spots={thermal:useRef(null),oil:useRef(null)};
  const [spot,setSpot]=useState(null);
  const [day,setDay]=useState(()=>number(dayProp,41,0,120));
  const [spm,setSpm]=useState(()=>number(spmProp,6.2,2,9));
  const [animating,setAnimating]=useState(animatingProp);
  const [layers,setLayers]=useState({rock:true,casing:true,tubing:true,rods:true,heat:true});
  const [view,setView]=useState('Full Well');
  const [inspect,setInspect]=useState(null),[error,setError]=useState('');
  const pumpDepth=number(depthProp,1100,100,5000), darkMode=theme!=='light';
  const cold=number(reservoirTemp,47,0,200), core=number(coreTemp,250,cold,400);
  const hot=heat?{radius:number(heat.radius,13,.5,60),core:number(heat.core,250,cold,400)}:thermal(day,number(heatedRadius,13,.5,60),core,cold);
  const margin=fmi===undefined?clamp(.212+(41-day)*.0045,0,1):number(fmi,.212,0,1);
  const status=margin<=.15?'Rod float risk':margin<=.40?'Caution':'Normal';
  live.current={day,spm,animating,layers,hot,fmi:margin,pumpDepth,reservoirTemp:cold,strokeLength:number(strokeLength,1.22,0,5),
    steam,speed:number(speed,1,0,40),view:viewProp,tweenMs:number(tweenMs,950,200,5000)};
  useEffect(()=>setDay(number(dayProp,41,0,120)),[dayProp]);
  useEffect(()=>setSpm(number(spmProp,6.2,2,9)),[spmProp]);
  useEffect(()=>setAnimating(Boolean(animatingProp)),[animatingProp]);

  // ── Scene lifecycle: one renderer per mount; props read from a live ref ────
  useEffect(()=>{
    const element=host.current;if(!element)return;
    let renderer;
    try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'}); }
    catch {setError('WebGL is unavailable. Enable hardware acceleration or use a WebGL-capable browser.');return;}
    setError('');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label','Interactive 3D wellbore. Use the view presets, layer switches and depth inspector for accessible navigation.');
    const scene=new THREE.Scene();scene.background=new THREE.Color(darkMode?'#101a23':'#eaf0f3');
    scene.add(new THREE.HemisphereLight('#e3efff','#4d453c',2.1));
    const key=new THREE.DirectionalLight('#fff3da',2.6);key.position.set(90,70,100);scene.add(key);
    const camera=new THREE.PerspectiveCamera(42,1,.05,16000);
    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;controls.dampingFactor=.09;controls.minPolarAngle=.12;controls.maxPolarAngle=Math.PI*.68;
    const wellHeight=displayDepth(pumpDepth,pumpDepth);
    controls.minDistance=7;controls.maxDistance=(wellHeight+50)*3;controls.screenSpacePanning=true;
    const built=buildScene(scene,pumpDepth,darkMode);
    let transition=null, raf=0, last=0, phase=0, lastRuler=0, rulerKey="", disposed=false, visible=true;
    const presets={
      Surface:{target:V(-2,5,0),offset:V(32,22,45)},
      'Full Well':{target:V(0,-(wellHeight+30)/2,0),offset:V((wellHeight+50)*.42,(wellHeight+50)*.10,(wellHeight+50)*1.55)},
      'Pump & Pay Zone':{target:V(0,-wellHeight+5,0),offset:V(36,16,55)},
      'Heated Zone':{target:V(0,-displayDepth(pumpDepth,pumpDepth),0),offset:V(58,30,83)},
    };
    const go=(name,immediate=false)=>{
      const p=presets[name]||presets['Pump & Pay Zone'];
      // Widen camera distance on small viewports to preserve horizontal context.
      const dest=p.target.clone().add(p.offset.clone().multiplyScalar(Math.max(1,.95/camera.aspect)));
      if(immediate){camera.position.copy(dest);controls.target.copy(p.target);controls.update();}
      else transition={from:camera.position.clone(),targetFrom:controls.target.clone(),to:dest,targetTo:p.target.clone(),start:performance.now(),ms:live.current.tweenMs};
    };
    const resize=()=>{const {width,height:h}=element.getBoundingClientRect();if(width<1||h<1)return;camera.aspect=width/h;camera.updateProjectionMatrix();renderer.setSize(width,h,false);};
    const first=presets[live.current.view]?live.current.view:'Full Well';
    resize();go(first,true);setView(first);
    const ro=new ResizeObserver(resize);ro.observe(element);
    const io=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;}):null;io?.observe(element);
    const cancelTransition=()=>{transition=null;};controls.addEventListener('start',cancelTransition);
    const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let lastPointer=0;
    const inspectEvent=(event)=>{
      if(event.type==='pointermove' && (event.buttons||performance.now()-lastPointer<80))return;
      lastPointer=performance.now();const rect=renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      raycaster.setFromCamera(pointer,camera);
      // Analytic camera-facing inspection plane through the well centre. This
      // remains usable even at overview scale or when all layers are hidden.
      const plane=new THREE.Plane(V(0,0,1),0),point=V(0,0,0);
      if(!raycaster.ray.intersectPlane(plane,point))return;
      if(point.y>2||point.y<-displayDepth(pumpDepth+50,pumpDepth))return;
      const depth=clamp(realDepth(-point.y,pumpDepth),0,pumpDepth+50);
      const targets=Object.entries(built.groups).filter(([k])=>live.current.layers[k]&&k!=='heat').map(([,g])=>g);
      const hit=raycaster.intersectObjects(targets,true)[0];
      const d=hit?clamp(realDepth(-hit.point.y,pumpDepth),0,pumpDepth+50):depth;
      setInspect({depth:Math.round(d*10)/10,radial:hit?Math.hypot(hit.point.x,hit.point.z)/(hit.object.parent===built.groups.rock?1:H):Math.hypot(point.x,point.z),component:hit?.object.userData.component||'Cross-section probe'});
    };
    renderer.domElement.addEventListener('pointermove',inspectEvent);
    renderer.domElement.addEventListener('click',inspectEvent);
    const contextLost=(e)=>{e.preventDefault();setError('The graphics context was lost. Reload this component to restore the 3D view.');};
    renderer.domElement.addEventListener('webglcontextlost',contextLost);
    // Track every disposable, including ruler sprites replaced during zoom.
    function disposeTree(root){
      const geometries=new Set(),materials=new Set(),textures=new Set();
      root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{materials.add(m);Object.values(m).forEach(v=>{if(v?.isTexture)textures.add(v);});});});
      textures.forEach(t=>t.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
    }
    function updateRuler(){
      const distance=camera.position.distanceTo(controls.target);
      const span=Math.max(8,distance*.68),center=-controls.target.y;
      const upper=clamp(realDepth(center-span*.6,pumpDepth),0,pumpDepth+50);
      const lower=clamp(realDepth(center+span*.6,pumpDepth),0,pumpDepth+50);
      const trueSpan=lower-upper;
      const step=trueSpan>500?200:trueSpan>150?50:trueSpan>65?20:trueSpan>25?5:1;
      const lo=Math.ceil(upper/step)*step,hi=lower;
      const nextKey=[lo,Math.floor(hi/step),step,Math.round(span)].join(":");
      if(nextKey===rulerKey)return;rulerKey=nextKey;
      disposeTree(built.ruler);built.ruler.clear();
      const x=-Math.min(68,Math.max(9,span*.31)),z=6;
      const lines=[],ticks=[];
      for(let d=lo;d<=hi;d+=step)ticks.push(d);
      if(pumpDepth>=upper&&pumpDepth<=lower){
        // Always identify total depth, even when it is between coarse ticks.
        for(let i=ticks.length-1;i>=0;i--)if(Math.abs(displayDepth(ticks[i],pumpDepth)-wellHeight)<span*.045)ticks.splice(i,1);
        ticks.push(pumpDepth);
      }
      ticks.sort((a,b)=>a-b);let previous=-Infinity;
      for(const d of ticks){
        const y=displayDepth(d,pumpDepth);if(y-previous<span*.035)continue;previous=y;
        lines.push(V(x,-y,z),V(x+span*.015,-y,z));
        label(built.ruler,`${d} m`,[x-span*.055,-y,z],span*.11,darkMode?'#a7bdcd':'#314754');
      }
      if(lines.length){lines.push(V(x,-displayDepth(lo,pumpDepth),z),V(x,-displayDepth(hi,pumpDepth),z));built.ruler.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines),new THREE.LineBasicMaterial({color:darkMode?'#627e92':'#607c8e'})));}
    }
    const armA=V(0,0,0),armB=V(0,0,0),delta=V(0,0,0),up=V(0,1,0);
    // ── Animation: real SPM, common phase for crank/beam/rod/plunger ──────────
    function frame(now){
      if(disposed)return;raf=requestAnimationFrame(frame);
      const dt=last?Math.min((now-last)/1000,.1):0;last=now;
      if(!visible||document.hidden)return;
      const s=live.current;
      Object.entries(built.groups).forEach(([k,g])=>{g.visible=s.layers[k];});
      if(s.animating)phase=(phase+dt*s.spm/60*s.speed*Math.PI*2)%(Math.PI*2);
      const lift=s.strokeLength*.5*Math.sin(phase);
      built.groups.rods.position.y=lift;
      built.jack.walking.rotation.z=lift/11;
      built.jack.crank.rotation.z=phase;
      built.jack.polished.position.y=5+lift;
      const bridleBottom=8.5+lift;built.jack.bridle.position.y=(10+bridleBottom)/2;built.jack.bridle.scale.y=(10-bridleBottom)/2;
      built.jack.walking.updateMatrixWorld();built.jack.crank.updateMatrixWorld();
      armA.set(1.5,0,1.8);built.jack.crank.localToWorld(armA);
      armB.set(-5,0,1.8);built.jack.walking.localToWorld(armB);
      delta.copy(armB).sub(armA);built.jack.pitman.position.copy(armA).add(armB).multiplyScalar(.5);
      built.jack.pitman.scale.y=delta.length()/5.5;built.jack.pitman.quaternion.setFromUnitVectors(up,delta.normalize());
      built.rodMat.color.set(s.fmi<=.15?'#d85850':s.fmi<=.40?'#c99543':'#b9c5cc');
      built.rodMat.emissive.set(s.fmi<=.15?'#8b211b':'#000000');built.rodMat.emissiveIntensity=s.fmi<=.15?.12+.10*Math.sin(now*.004):0;
      const r=s.hot.radius,ry=Math.min(10,r);built.volume.scale.set(r,ry,r);
      built.heatMaterial.uniforms.radii.value.set(r,ry,r);built.heatMaterial.uniforms.hot.value=s.hot.core;built.heatMaterial.uniforms.cold.value=s.reservoirTemp;
      built.heatMaterial.uniforms.time.value+=dt*(s.steam?1.6:1);built.heatMaterial.uniforms.wave.value=s.steam?1:.3;
      if(transition){const t=clamp((now-transition.start)/(transition.ms||950),0,1),ease=t*t*(3-2*t);camera.position.lerpVectors(transition.from,transition.to,ease);controls.target.lerpVectors(transition.targetFrom,transition.targetTo,ease);if(t===1)transition=null;}
      // Bound panning to the physical model, without upside-down or lost views.
      controls.target.x=clamp(controls.target.x,-90,90);controls.target.y=clamp(controls.target.y,-wellHeight-60,35);controls.target.z=clamp(controls.target.z,-65,65);
      controls.update();built.labels.visible=camera.position.distanceTo(controls.target)<300;
      if(now-lastRuler>450){updateRuler();lastRuler=now;}
      renderer.render(scene,camera);
      // Hotspots: HTML buttons pinned to world points on the section face.
      const w=renderer.domElement.clientWidth,h=renderer.domElement.clientHeight;
      place(spots.thermal.current,spotAt.set(Math.max(3,r*.5),-wellHeight-1,2),s.layers.heat,w,h);
      place(spots.oil.current,spotAt.set(clamp(r+16,20,54),-wellHeight+4,1),s.layers.rock,w,h);
    }
    const spotAt=V(0,0,0);
    function place(el,p,show,w,h){
      if(!el)return;p.project(camera);
      const on=show&&p.z<1&&Math.abs(p.x)<1.02&&Math.abs(p.y)<1.02;el.style.display=on?'':'none';if(!on)return;
      const x=(p.x+1)/2*w,y=(1-p.y)/2*h;el.style.transform=`translate(${x}px,${y}px)`;
      // Open the info box toward the free side so it never clips at the edges.
      el.style.setProperty('--dx',x>w-270?'-262px':'14px');el.style.setProperty('--dy',y>h-210?'-200px':'10px');
    }
    engine.current={go,probe:(depth)=>{setInspect({depth,radial:0,component:depth>pumpDepth?'Reservoir below well':'Well centreline'});transition={from:camera.position.clone(),targetFrom:controls.target.clone(),to:V(12,-displayDepth(depth,pumpDepth)+5,23),targetTo:V(0,-displayDepth(depth,pumpDepth),0),start:performance.now()};}};
    raf=requestAnimationFrame(frame);
    return ()=>{
      disposed=true;cancelAnimationFrame(raf);ro.disconnect();io?.disconnect();
      controls.removeEventListener('start',cancelTransition);controls.dispose();
      renderer.domElement.removeEventListener('pointermove',inspectEvent);renderer.domElement.removeEventListener('click',inspectEvent);renderer.domElement.removeEventListener('webglcontextlost',contextLost);
      disposeTree(scene);built.neutral.dispose();renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();engine.current=null;
    };
  },[pumpDepth,darkMode]);
  // Parent-driven camera (e.g. the demo cycle): tween when the named preset changes.
  useEffect(()=>{if(viewProp&&engine.current){setView(viewProp);engine.current.go(viewProp);}},[viewProp]);

  // ── Responsive HTML controls and readouts (no texture-based UI) ───────────
  const text=darkMode?'#dce6ed':'#243746', muted=darkMode?'#92a8b9':'#536b7d';
  const panel=darkMode?'#15232e':'#ffffff',border=darkMode?'#2b3c49':'#d1dde5';
  const button={border:`1px solid ${border}`,borderRadius:7,padding:'7px 10px',background:panel,color:text,cursor:'pointer',font:'inherit',fontSize:12};
  const input={accentColor:darkMode?'#b6d2e3':'#466c83',width:'100%',minWidth:0};
  const cell={background:panel,border:`1px solid ${border}`,borderRadius:9,padding:'9px 12px',flex:'1 1 90px'};
  const selectedDepth=inspect?.depth??pumpDepth;
  const inspectorTemp=temperature(selectedDepth,inspect?.radial??0,live.current);
  return <section aria-label="USHNA wellbore digital twin" style={{height,width:'100%',minWidth:0,minHeight:640,boxSizing:'border-box',display:'flex',flexDirection:'column',background:darkMode?'#101a23':'#eaf0f3',color:text,fontFamily:'Inter, system-ui, sans-serif',border:`1px solid ${border}`,borderRadius:14,overflow:'hidden'}}>
    <header style={{padding:'14px 16px 10px',display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
      <div><div style={{fontSize:10,letterSpacing:2,color:muted}}>USHNA / SUBSURFACE</div><strong style={{fontSize:20,fontWeight:600}}>Subsurface Wellbore Model</strong></div>
      <div style={{fontSize:11,color:muted,alignSelf:'center'}}>BAGHEWALA · CSS + SRP<br/>{phaseLabel||`Production phase · day ${day}`}</div>
    </header>
    <div style={{display:'flex',gap:7,padding:'0 14px 10px',flexWrap:'wrap'}}>
      <div style={cell}><div style={{fontSize:10,color:muted}}>CORE TEMPERATURE</div><strong>{hot.core.toFixed(0)} °C</strong></div>
      <div style={cell}><div style={{fontSize:10,color:muted}}>HEATED RADIUS</div><strong>{hot.radius.toFixed(1)} m</strong></div>
      <div style={cell}><div style={{fontSize:10,color:muted}}>FLOAT MARGIN INDEX</div><strong>{margin.toFixed(3)}</strong> <small>{status}</small></div>
    </div>
    <nav aria-label="Camera presets" style={{display:'flex',gap:5,padding:'0 14px 9px',flexWrap:'wrap'}}>
      {['Surface','Full Well','Pump & Pay Zone','Heated Zone'].map(name=><button key={name} type="button" aria-pressed={view===name} style={{...button,background:view===name?(darkMode?'#304958':'#d8e7ef'):panel}} onClick={()=>{setView(name);engine.current?.go(name);}}>{name}</button>)}
    </nav>
    <div style={{position:'relative',flex:'1 1 auto',minHeight:240}}>
      <div ref={host} style={{position:'absolute',inset:0,touchAction:'none'}} />
      {error&&<div role="alert" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',padding:25,background:panel,textAlign:'center'}}>{error}</div>}
      <div style={{position:'absolute',top:9,left:14,fontSize:10,color:muted,pointerEvents:'none'}}>DEPTH BELOW GROUND · m<br/>Drag to rotate · scroll or pinch to zoom</div>
      <div style={{position:'absolute',bottom:10,left:14,pointerEvents:'none',fontSize:10,color:muted,maxWidth:'calc(100% - 150px)'}}>Compressed depth view · pipe diameters exaggerated 50×<br/>Upper column shown at 12% height · lowest 70 m and reservoir at 1:1 scale</div>
      <div style={{position:'absolute',bottom:10,right:14,width:120,pointerEvents:'none',fontSize:9,color:text}}>
        <div style={{height:5,borderRadius:3,background:'linear-gradient(90deg,#0c2147,#751c14,#ed600e,#ffb83b,#fff5c9)'}}/>
        <div style={{display:'flex',justifyContent:'space-between',marginTop:3}}><span>47</span><span>140</span><span>250 °C</span></div>
      </div>
      {Object.entries({thermal:'#ff8a2a',oil:'#9aa7b3'}).map(([key,color])=>{const box=info?.[key];if(!box)return null;const open=spot===key;return(
        <div key={key} ref={spots[key]} style={{position:'absolute',left:0,top:0,display:'none',zIndex:open?3:2}}>
          <button type="button" className="group" aria-expanded={open} aria-label={`${box.title}: ${open?'hide':'show'} pumping details`} onClick={()=>setSpot(open?null:key)}
            style={{position:'absolute',left:-11,top:-11,width:22,height:22,display:'grid',placeItems:'center',border:0,padding:0,background:'none',cursor:'pointer'}}>
            <span className="animate-ping" style={{position:'absolute',inset:0,borderRadius:'50%',background:color,opacity:.55}}/>
            <span style={{position:'relative',width:12,height:12,borderRadius:'50%',background:color,boxShadow:'0 0 0 2px #fff, 0 0 10px '+color}}/>
            <span className="pointer-events-none opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" style={{position:'absolute',left:24,whiteSpace:'nowrap',fontSize:10,padding:'3px 7px',borderRadius:5,background:'rgba(8,14,20,.85)',color:'#fff'}}>{box.title} · click for details</span>
          </button>
          {open&&<div role="dialog" aria-label={box.title} style={{position:'absolute',left:'var(--dx)',top:'var(--dy)',width:248,background:panel,color:text,border:`1px solid ${border}`,borderTop:`3px solid ${color}`,borderRadius:9,padding:'10px 12px',fontSize:11,boxShadow:'0 8px 24px rgba(0,0,0,.35)'}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}><strong style={{fontSize:12}}>{box.title}</strong><button type="button" aria-label="Close" onClick={()=>setSpot(null)} style={{marginLeft:'auto',border:0,background:'none',color:muted,cursor:'pointer',fontSize:14,lineHeight:1}}>×</button></div>
            <dl style={{margin:'7px 0 0',display:'grid',gridTemplateColumns:'1fr auto',gap:'4px 10px'}}>{box.rows.map(([k,v])=><React.Fragment key={k}><dt style={{color:muted}}>{k}</dt><dd style={{margin:0,fontWeight:600,textAlign:'right'}}>{v}</dd></React.Fragment>)}</dl>
            {box.note&&<p style={{margin:'8px 0 0',color:muted,lineHeight:1.4}}>{box.note}</p>}
          </div>}
        </div>);})}
    </div>
    <div style={{padding:'10px 14px',borderTop:`1px solid ${border}`,display:'flex',gap:'8px 16px',flexWrap:'wrap',fontSize:11}}>
      {Object.entries({rock:'Rock',casing:'Casing',tubing:'Tubing and pump',rods:'Rod string',heat:'Heated Zone'}).map(([key,title])=><label key={key} style={{display:'flex',alignItems:'center',gap:4}}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers(prev=>({...prev,[key]:e.target.checked}))}/>{title}</label>)}
    </div>
    <div style={{display:'flex',gap:'10px 22px',flexWrap:'wrap',padding:'0 14px 12px'}}>
      <label style={{flex:'2 1 170px',fontSize:12}}>Production day <strong style={{float:'right'}}>{day} / 120</strong><input aria-label="Production day" type="range" min="0" max="120" value={day} style={input} onChange={e=>{const v=+e.target.value;setDay(v);onDayChange?.(v);}}/></label>
      <div style={{flex:'1 1 145px',display:'flex',gap:10,alignItems:'center'}}><button type="button" aria-pressed={animating} style={button} onClick={()=>{setAnimating(!animating);onAnimatingChange?.(!animating);}}>{animating?'Pause Pump':'Start Pump'}</button>{onSpmChange?<label style={{flex:1,fontSize:11}}>SPM {spm.toFixed(1)}<input aria-label="Strokes per minute" type="range" min="2" max="9" step=".1" value={spm} style={input} onChange={e=>{const v=+e.target.value;setSpm(v);onSpmChange(v);}}/></label>:<span style={{flex:1,fontSize:11,color:muted}}>SPM {spm.toFixed(1)}{speed!==1&&` · shown ${+speed.toFixed(2)}× faster`}</span>}</div>
    </div>
    <footer style={{padding:'10px 14px',background:panel,borderTop:`1px solid ${border}`,fontSize:11,display:'flex',gap:'8px 16px',flexWrap:'wrap',alignItems:'center'}}>
      <label>Inspect depth <input aria-label="Inspect depth in metres" type="number" min="0" max={pumpDepth+50} step="1" value={Math.round(selectedDepth)} style={{...button,width:66,padding:'4px 6px'}} onChange={e=>{const d=number(+e.target.value,pumpDepth,0,pumpDepth+50);setInspect({depth:d,radial:0,component:'Well centreline'});}}/> m</label>
      <button type="button" style={{...button,padding:'4px 8px'}} onClick={()=>engine.current?.probe(selectedDepth)}>Focus depth</button>
      <span>{selectedDepth<=pumpDepth?sectionAt(selectedDepth,pumpDepth):'Below total depth'} · {inspectorTemp.toFixed(1)} °C</span>
      <span style={{color:muted}}>{inspect?.component||'Downhole pump · pay zone'}</span>
      <div style={{width:'100%',fontSize:10,color:muted}}>{heat&&fmi!==undefined?'Heated zone and FMI from the twin (synthetic wells); not operational advice.':<>Illustrative cooling{fmi===undefined?' and FMI':''}; connect calibrated model data for engineering decisions.</>} Rod: steel &gt;0.40 · amber 0.15–0.40 · red ≤0.15.</div>
    </footer>
  </section>;
}
