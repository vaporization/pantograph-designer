const el = (id) => document.getElementById(id);

const MM_PER_IN = 25.4;

const state = {
  units: "mm",       // "mm" or "in"
  N: 1,
  arm_mm: 600,       // internal storage in mm
  base_mm: 1200,
  top_mm: 1200,
  alphaDeg: 25,
  preset: "classic",
  lockX: true,       // NEW: vertical-only mode by default
};

function toDisplay(mm){
  return state.units === "mm" ? mm : mm / MM_PER_IN;
}
function toMM(val){
  return state.units === "mm" ? val : val * MM_PER_IN;
}
function fmt(val){
  return (Math.round(val * 1000) / 1000).toString();
}
function rad(deg){ return (deg * Math.PI) / 180; }

function constraintsFromPreset(p){
  switch(p){
    case "classic":
      return { baseL:"fixed", baseR:"slide", topL:"slide", topR:"fixed" };
    case "mirrored":
      return { baseL:"slide", baseR:"fixed", topL:"fixed", topR:"slide" };
    case "bothBaseFixed":
      return { baseL:"fixed", baseR:"fixed", topL:"slide", topR:"fixed" };
    case "bothTopFixed":
      return { baseL:"fixed", baseR:"slide", topL:"fixed", topR:"fixed" };
    default:
      return { baseL:"fixed", baseR:"slide", topL:"slide", topR:"fixed" };
  }
}

function stageWarningsBasic(msgs){
  return msgs.filter(Boolean);
}

/**
 * LOCK-X MODEL (recommended / default)
 * - Rails are rigid, centered in X, and DO NOT change length.
 * - Pins slide along the rails symmetrically as alpha changes.
 * - This produces the “pure vertical” look: platforms only move in Y.
 *
 * Geometry (one stage):
 *   s = L cos(alpha)
 *   h = L sin(alpha)
 * Base pins are at x = ±s/2 on y=0
 * Top  pins are at x = ±s/2 on y=h
 * Arms are A->D and B->C, which cross.
 *
 * Constraint needed:
 *   s <= baseLen AND s <= topLen
 */
function computeStageLockX(Larm, baseLen, topLen, alphaDeg){
  const a = rad(alphaDeg);
  const h = Larm * Math.sin(a);
  const s = Larm * Math.cos(a);

  const baseLeft  = -baseLen/2;
  const baseRight =  baseLen/2;
  const topLeft   = -topLen/2;
  const topRight  =  topLen/2;

  const warns = [];
  if(s > baseLen + 1e-9) warns.push("Stage span s is larger than BASE rail length. Increase base rail length or increase α.");
  if(s > topLen + 1e-9)  warns.push("Stage span s is larger than TOP rail length. Increase top rail length or increase α.");

  // Pins centered, sliding symmetrically
  const xA = -s/2;
  const xB =  s/2;
  const xC = -s/2;
  const xD =  s/2;

  // Slider travel (distance from left rail end to left pin, and right rail end to right pin)
  const baseLeftGap = xA - baseLeft;
  const baseRightGap = baseRight - xB;
  const topLeftGap = xC - topLeft;
  const topRightGap = topRight - xD;

  return {
    model: "lockX",
    h, s,
    rails: {
      base: { L: {x:baseLeft,y:0}, R: {x:baseRight,y:0}, len: baseLen },
      top:  { L: {x:topLeft,y:h},  R: {x:topRight,y:h},  len: topLen  }
    },
    A:{x:xA,y:0}, B:{x:xB,y:0}, C:{x:xC,y:h}, D:{x:xD,y:h},
    baseSpan: baseLen,
    topSpan: topLen,
    sliderGaps_mm: { baseLeftGap, baseRightGap, topLeftGap, topRightGap },
    warnings: stageWarningsBasic(warns),
  };
}

/**
 * NON-LOCKX MODEL (legacy preset model)
 * - Presets choose which endpoints are fixed vs sliding.
 * - Rails may drift in X; this matches more “classic” scissor behavior.
 * - Kept for experimentation.
 */
function computeStagePreset(Larm, baseLen, topLen, alphaDeg, preset){
  const a = rad(alphaDeg);
  const h = Larm * Math.sin(a);
  const s = Larm * Math.cos(a);

  const cons = constraintsFromPreset(preset);

  // Nominal rail endpoints (centered)
  const baseLeftNom  = -baseLen/2;
  const baseRightNom =  baseLen/2;
  const topLeftNom   = -topLen/2;
  const topRightNom  =  topLen/2;

  let xA = baseLeftNom, xB = baseRightNom, xC = topLeftNom, xD = topRightNom;

  if(cons.baseL === "fixed") xA = baseLeftNom;
  if(cons.baseR === "fixed") xB = baseRightNom;
  if(cons.topL  === "fixed") xC = topLeftNom;
  if(cons.topR  === "fixed") xD = topRightNom;

  // Try to satisfy arm projection constraints in a simple way
  // NOTE: With fixed rail lengths + arbitrary alpha, you cannot generally satisfy all constraints without sliders/drift.
  // This is why lockX is the recommended default model.
  if(cons.topR === "slide") xD = xA + s;
  else if(cons.baseL === "slide") xA = xD - s;

  if(cons.topL === "slide") xC = xB - s;
  else if(cons.baseR === "slide") xB = xC + s;

  const baseSpan = xB - xA;
  const topSpan  = xD - xC;

  const center = (xA + xB + xC + xD) / 4;
  xA -= center; xB -= center; xC -= center; xD -= center;

  const warns = [];
  const baseFixed = (cons.baseL==="fixed") + (cons.baseR==="fixed");
  const topFixed  = (cons.topL==="fixed") + (cons.topR==="fixed");
  if(baseFixed===2) warns.push("Both base ends fixed: can bind unless the top has sufficient sliding freedom.");
  if(topFixed===2)  warns.push("Both top ends fixed: can bind unless the base has sufficient sliding freedom.");
  if(baseFixed===2 && topFixed===2) warns.push("Overconstrained: likely impossible without flex/compliance.");
  if(Math.abs(baseSpan - baseLen) > 1e-6) warns.push("Preset model: computed base span differs from input base rail length (expected with drift/slide presets).");
  if(Math.abs(topSpan - topLen) > 1e-6) warns.push("Preset model: computed top span differs from input top rail length (expected with drift/slide presets).");

  return {
    model: "preset",
    h, s,
    rails: {
      base: { L:{x:xA,y:0}, R:{x:xB,y:0}, len: baseSpan },
      top:  { L:{x:xC,y:h}, R:{x:xD,y:h}, len: topSpan }
    },
    A:{x:xA,y:0}, B:{x:xB,y:0}, C:{x:xC,y:h}, D:{x:xD,y:h},
    baseSpan, topSpan,
    warnings: stageWarningsBasic(warns),
    constraints: cons,
  };
}

function computeAll(){
  const Larm = state.arm_mm;
  const baseLen = state.base_mm;
  const topLen = state.top_mm;

  const stage0 = state.lockX
    ? computeStageLockX(Larm, baseLen, topLen, state.alphaDeg)
    : computeStagePreset(Larm, baseLen, topLen, state.alphaDeg, state.preset);

  // Stack N stages: use the same span model, but y-offset each stage
  const stages = [];
  for(let i=0;i<state.N;i++){
    const yOffset = i * stage0.h;

    stages.push({
      idx: i+1,
      A:{x:stage0.A.x, y:stage0.A.y + yOffset},
      B:{x:stage0.B.x, y:stage0.B.y + yOffset},
      C:{x:stage0.C.x, y:stage0.C.y + yOffset},
      D:{x:stage0.D.x, y:stage0.D.y + yOffset},
      h: stage0.h,
      s: stage0.s
    });
  }

  const totalH = state.N * stage0.h;

  // In lockX mode, rails stay centered and simply move up in Y.
  // Base rail always at y=0, top rail at y=totalH.
  const rails = {
    base: {
      L:{x:-baseLen/2,y:0},
      R:{x: baseLen/2,y:0},
      len: baseLen
    },
    top: {
      L:{x:-topLen/2,y:totalH},
      R:{x: topLen/2,y:totalH},
      len: topLen
    }
  };

  return { stage0, stages, totalH, rails };
}

function draw(){
  const svg = el("viz");
  svg.innerHTML = "";

  const { stage0, stages, totalH, rails } = computeAll();

  const W = 980, H = 560;
  const margin = 70;

  const xMin = Math.min(rails.base.L.x, rails.top.L.x, ...stages.flatMap(s=>[s.A.x,s.B.x,s.C.x,s.D.x])) - 150;
  const xMax = Math.max(rails.base.R.x, rails.top.R.x, ...stages.flatMap(s=>[s.A.x,s.B.x,s.C.x,s.D.x])) + 150;
  const yMin = -120;
  const yMax = totalH + 180;

  const sx = (W - 2*margin) / (xMax - xMin);
  const sy = (H - 2*margin) / (yMax - yMin);
  const sc = Math.min(sx, sy);

  const tx = (x) => margin + (x - xMin) * sc;
  const ty = (y) => H - margin - (y - yMin) * sc;

  // draw rails exactly as user entered
  line(svg, tx(rails.base.L.x), ty(rails.base.L.y), tx(rails.base.R.x), ty(rails.base.R.y), 6, "rgba(255,255,255,.25)");
  line(svg, tx(rails.top.L.x),  ty(rails.top.L.y),  tx(rails.top.R.x),  ty(rails.top.R.y),  6, "rgba(255,255,255,.25)");

  // stages
  for(const st of stages){
    line(svg, tx(st.A.x), ty(st.A.y), tx(st.D.x), ty(st.D.y), 5, "rgba(122,162,247,.95)");
    line(svg, tx(st.B.x), ty(st.B.y), tx(st.C.x), ty(st.C.y), 5, "rgba(122,162,247,.95)");

    joint(svg, tx(st.A.x), ty(st.A.y));
    joint(svg, tx(st.B.x), ty(st.B.y));
    joint(svg, tx(st.C.x), ty(st.C.y));
    joint(svg, tx(st.D.x), ty(st.D.y));
  }

  text(svg, 20, 26, `α = ${state.alphaDeg}°  |  N = ${state.N}  |  H = ${fmt(toDisplay(totalH))} ${state.units}  |  mode = ${state.lockX ? "Lock X" : "Preset"}`, 14);
  if(stage0.warnings.length){
    text(svg, 20, 48, `⚠ ${stage0.warnings.join(" ")}`, 12, "rgba(247,118,142,.95)");
  }
}

function updateOutputs(){
  el("alphaVal").textContent = `${state.alphaDeg}°`;

  el("armUnit").textContent = state.units;
  el("baseUnit").textContent = state.units;
  el("topUnit").textContent = state.units;

  const { stage0, totalH, rails } = computeAll();
  const cons = constraintsFromPreset(state.preset);

  const outputObj = {
    units: state.units,
    mode: state.lockX ? "lockX" : "preset",
    inputs: {
      stages: state.N,
      arm: toDisplay(state.arm_mm),
      baseRail: toDisplay(state.base_mm),
      topRail: toDisplay(state.top_mm),
      alphaDeg: state.alphaDeg,
      lockPlatformX: state.lockX,
      presetConstraints: state.lockX ? null : cons
    },
    outputs: {
      stageHeight: toDisplay(stage0.h),
      stageSpanProjection: toDisplay(stage0.s),
      totalHeight: toDisplay(totalH),
      rails_mm: rails,
      pinCoords_mm: { A: stage0.A, B: stage0.B, C: stage0.C, D: stage0.D },
      sliderGaps_mm: stage0.sliderGaps_mm || null
    },
    warnings: stage0.warnings
  };

  const lockLine = state.lockX ? "ON (vertical-only)" : "OFF";
  const presetLine = state.lockX ? "(preset ignored)" : `${state.preset}`;

  let extra = "";
  if(stage0.sliderGaps_mm){
    const g = stage0.sliderGaps_mm;
    extra =
`Slider gaps (mm, stage 1):
  baseLeftGap = ${fmt(g.baseLeftGap)}   baseRightGap = ${fmt(g.baseRightGap)}
  topLeftGap  = ${fmt(g.topLeftGap)}    topRightGap  = ${fmt(g.topRightGap)}

`;
  }

  el("out").textContent =
`Inputs (${state.units}):
  N = ${state.N}
  arm = ${fmt(toDisplay(state.arm_mm))} ${state.units}  (pin-to-pin)
  base rail = ${fmt(toDisplay(state.base_mm))} ${state.units}
  top rail  = ${fmt(toDisplay(state.top_mm))} ${state.units}
  α = ${state.alphaDeg}°
  lock X = ${lockLine}
  preset = ${presetLine}

Outputs (${state.units}):
  stage height h = ${fmt(toDisplay(stage0.h))} ${state.units}
  stage projection s = ${fmt(toDisplay(stage0.s))} ${state.units}
  total height H = ${fmt(toDisplay(totalH))} ${state.units}

Rail endpoints (mm):
  Base: (${fmt(rails.base.L.x)}, ${fmt(rails.base.L.y)}) -> (${fmt(rails.base.R.x)}, ${fmt(rails.base.R.y)})
  Top:  (${fmt(rails.top.L.x)}, ${fmt(rails.top.L.y)}) -> (${fmt(rails.top.R.x)}, ${fmt(rails.top.R.y)})

Pin coordinates (mm, stage 1):
  A (${fmt(stage0.A.x)}, ${fmt(stage0.A.y)})
  B (${fmt(stage0.B.x)}, ${fmt(stage0.B.y)})
  C (${fmt(stage0.C.x)}, ${fmt(stage0.C.y)})
  D (${fmt(stage0.D.x)}, ${fmt(stage0.D.y)})

${extra}Tip:
  Copy JSON and paste into your CAD notes. Use the pin coords as centerpoints.
`;

  el("copy").onclick = async () => {
    try{
      await navigator.clipboard.writeText(JSON.stringify(outputObj, null, 2));
      el("copy").textContent = "Copied!";
      setTimeout(()=> el("copy").textContent = "Copy JSON", 900);
    }catch(e){
      alert("Clipboard blocked by browser. Copy from the Design Sheet text instead.");
    }
  };
}

function bind(){
  el("units").addEventListener("change", (e)=>{
    const newUnits = e.target.value;
    if(newUnits === state.units) return;

    const armDisp = Number(el("arm").value);
    const baseDisp = Number(el("base").value);
    const topDisp = Number(el("top").value);

    const oldUnits = state.units;
    state.units = oldUnits;
    state.arm_mm = toMM(armDisp);
    state.base_mm = toMM(baseDisp);
    state.top_mm = toMM(topDisp);

    state.units = newUnits;
    el("arm").value  = fmt(toDisplay(state.arm_mm));
    el("base").value = fmt(toDisplay(state.base_mm));
    el("top").value  = fmt(toDisplay(state.top_mm));

    updateOutputs(); draw();
  });

  el("N").addEventListener("input",(e)=>{
    state.N = Math.max(1, Math.min(6, Number(e.target.value)));
    updateOutputs(); draw();
  });

  [["arm","arm_mm"],["base","base_mm"],["top","top_mm"]].forEach(([id,key])=>{
    el(id).addEventListener("input",(e)=>{
      const valDisp = Number(e.target.value);
      state[key] = toMM(valDisp);
      updateOutputs(); draw();
    });
  });

  el("alpha").addEventListener("input",(e)=>{
    state.alphaDeg = Number(e.target.value);
    updateOutputs(); draw();
  });

  el("preset").addEventListener("change",(e)=>{
    state.preset = e.target.value;
    updateOutputs(); draw();
  });

  el("lockX").addEventListener("change",(e)=>{
    state.lockX = !!e.target.checked;
    updateOutputs(); draw();
  });
}

function line(svg,x1,y1,x2,y2,width,stroke){
  const l = document.createElementNS("http://www.w3.org/2000/svg","line");
  l.setAttribute("x1",x1); l.setAttribute("y1",y1);
  l.setAttribute("x2",x2); l.setAttribute("y2",y2);
  l.setAttribute("stroke",stroke);
  l.setAttribute("stroke-width",String(width));
  l.setAttribute("stroke-linecap","round");
  svg.appendChild(l);
}

function joint(svg,cx,cy){
  const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
  c.setAttribute("cx",cx); c.setAttribute("cy",cy);
  c.setAttribute("r","6");
  c.setAttribute("fill","rgba(231,233,239,.92)");
  c.setAttribute("stroke","rgba(0,0,0,.25)");
  c.setAttribute("stroke-width","2");
  svg.appendChild(c);
}

function text(svg,x,y,txt,size=12,fill="rgba(230,233,239,.9)"){
  const t = document.createElementNS("http://www.w3.org/2000/svg","text");
  t.setAttribute("x",x); t.setAttribute("y",y);
  t.setAttribute("fill",fill);
  t.setAttribute("font-size",String(size));
  t.setAttribute("font-family","ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace");
  t.textContent = txt;
  svg.appendChild(t);
}

// init
bind();
el("arm").value  = fmt(toDisplay(state.arm_mm));
el("base").value = fmt(toDisplay(state.base_mm));
el("top").value  = fmt(toDisplay(state.top_mm));
el("lockX").checked = state.lockX;
updateOutputs();
draw();