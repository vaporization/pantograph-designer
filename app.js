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
  lockX: true,       // NEW: vertical-only (rails do not translate in X)
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

function stageWarnings(cons){
  const warns = [];
  const baseFixed = (cons.baseL==="fixed") + (cons.baseR==="fixed");
  const topFixed  = (cons.topL==="fixed") + (cons.topR==="fixed");
  if(baseFixed===2) warns.push("Both base ends fixed: can bind unless the top has sufficient sliding freedom.");
  if(topFixed===2)  warns.push("Both top ends fixed: can bind unless the base has sufficient sliding freedom.");
  if(baseFixed===2 && topFixed===2) warns.push("Overconstrained: likely impossible without flex/compliance.");
  return warns;
}

function clamp(val, min, max){
  return Math.max(min, Math.min(max, val));
}

/**
 * Correct scissor stage model:
 * - Base rail is a rigid segment of length baseLen centered at x=0 (grounded).
 * - Top rail is a rigid segment of length topLen centered at x=0.
 * - If lockX is ON: rails do NOT translate in X (pure vertical motion).
 *   Pins slide within the rail extents as angle changes.
 *
 * Arms:
 *  AD and BC are equal length Larm and cross (true scissor).
 */
function computeStage(Larm, baseLen, topLen, alphaDeg, preset){
  const a = rad(alphaDeg);
  const h = Larm * Math.sin(a);
  const s = Larm * Math.cos(a);

  const cons = constraintsFromPreset(preset);
  const warnings = [...stageWarnings(cons)];

  // Rigid rails (centered at x=0)
  const baseLeft  = -baseLen/2;
  const baseRight =  baseLen/2;
  const topLeft   = -topLen/2;
  const topRight  =  topLen/2;

  // Helper for warnings
  function outOfRange(name, x, lo, hi){
    if(x < lo || x > hi){
      warnings.push(`${name} is outside its rail/slot range (${fmt(x)} mm not in [${fmt(lo)}, ${fmt(hi)}]).`);
      return true;
    }
    return false;
  }

  // --- NEW: Vertical-only scissor kinematics ---
  // The physically-real 1DOF scissor uses:
  //   - One fixed pin + one slider per platform (per stage)
  //   - Each arm has exactly ONE fixed end and ONE sliding end
  //
  // Arms:
  //   Arm1: A (base)  -> D (top)
  //   Arm2: B (base)  -> C (top)
  //
  // Length constraint for either arm:
  //   (dx)^2 + h^2 = L^2  ->  |dx| = s
  //
  // If lockX is enabled, the rails DO NOT translate in X.
  if(state.lockX){
    let xA, xB, xC, xD;

    if(preset === "mirrored"){
      // Mirrored:
      //   baseR fixed (B), topR fixed (D)
      //   baseL slider (A), topL slider (C)
      //
      // Choose:
      //   B = baseRight (fixed)
      //   D = topRight  (fixed)
      // Solve sliders:
      //   Arm1 A->D: xA = xD - s
      //   Arm2 B->C: xC = xB - s
      xB = baseRight;
      xD = topRight;

      xA = xD - s;
      xC = xB - s;

      // Validate sliders stay on rails
      outOfRange("Base-left slider (A)", xA, baseLeft, baseRight);
      outOfRange("Top-left slider (C)", xC, topLeft, topRight);

    } else {
      // Classic + others default to Classic behavior:
      //   baseL fixed (A), topL fixed (C)
      //   baseR slider (B), topR slider (D)
      //
      // Choose:
      //   A = baseLeft (fixed)
      //   C = topLeft  (fixed)
      // Solve sliders:
      //   Arm1 A->D: xD = xA + s
      //   Arm2 B->C: xB = xC + s
      xA = baseLeft;
      xC = topLeft;

      xD = xA + s;
      xB = xC + s;

      // Validate sliders stay on rails
      outOfRange("Base-right slider (B)", xB, baseLeft, baseRight);
      outOfRange("Top-right slider (D)", xD, topLeft, topRight);
    }

    // Return stage pins + rigid rail endpoints
    return {
      h, s,
      A:{x:xA,y:0},
      B:{x:xB,y:0},
      C:{x:xC,y:h},
      D:{x:xD,y:h},
      baseSpan: baseLen,
      topSpan: topLen,
      platform: {
        xPlat: 0,
        baseLeft:  {x: baseLeft,  y: 0},
        baseRight: {x: baseRight, y: 0},
        topLeft:   {x: topLeft,   y: h},
        topRight:  {x: topRight,  y: h},
      },
      warnings
    };
  }

  // --- If lockX is OFF, keep your previous experimental solver ---
  // (You can refine later; not needed for vertical-only.)
  const baseLeftNom  = -baseLen/2;
  const baseRightNom =  baseLen/2;
  const topLeftNom   = -topLen/2;
  const topRightNom  =  topLen/2;

  let xA = baseLeftNom, xB = baseRightNom, xC = topLeftNom, xD = topRightNom;

  if(cons.baseL === "fixed") xA = baseLeftNom;
  if(cons.baseR === "fixed") xB = baseRightNom;
  if(cons.topL  === "fixed") xC = topLeftNom;
  if(cons.topR  === "fixed") xD = topRightNom;

  if(cons.topR === "slide") xD = xA + s;
  else if(cons.baseL === "slide") xA = xD - s;

  if(cons.topL === "slide") xC = xB + s;
  else if(cons.baseR === "slide") xB = xC - s;

  const center = (xA + xB + xC + xD) / 4;
  xA -= center; xB -= center; xC -= center; xD -= center;

  return {
    h, s,
    A:{x:xA,y:0}, B:{x:xB,y:0}, C:{x:xC,y:h}, D:{x:xD,y:h},
    baseSpan: xB - xA,
    topSpan: xD - xC,
    platform: {
      xPlat: 0,
      baseLeft:  {x: baseLeftNom,  y: 0},
      baseRight: {x: baseRightNom, y: 0},
      topLeft:   {x: topLeftNom,   y: h},
      topRight:  {x: topRightNom,  y: h},
    },
    warnings
  };
}

function computeAll(){
  const stage = computeStage(state.arm_mm, state.base_mm, state.top_mm, state.alphaDeg, state.preset);

  const stages = [];
  for(let i=0;i<state.N;i++){
    const yOffset = i * stage.h;
    stages.push({
      idx: i+1,
      A:{x:stage.A.x, y:stage.A.y + yOffset},
      B:{x:stage.B.x, y:stage.B.y + yOffset},
      C:{x:stage.C.x, y:stage.C.y + yOffset},
      D:{x:stage.D.x, y:stage.D.y + yOffset},
      h: stage.h,
      s: stage.s
    });
  }

  const totalH = state.N * stage.h;

  return { stage0: stage, stages, totalH };
}

function draw(){
  const svg = el("viz");
  svg.innerHTML = "";

  const { stage0, stages, totalH } = computeAll();

  const W = 980, H = 560;
  const margin = 70;

  // Use platform endpoints for rails (rigid members)
  const baseLeft = {x: stage0.platform.baseLeft.x, y: 0};
  const baseRight= {x: stage0.platform.baseRight.x, y: 0};
  const topLeft  = {x: stage0.platform.topLeft.x, y: totalH};
  const topRight = {x: stage0.platform.topRight.x, y: totalH};

  const allX = [baseLeft.x, baseRight.x, topLeft.x, topRight.x];
  for(const st of stages){
    allX.push(st.A.x, st.B.x, st.C.x, st.D.x);
  }

  const xMin = Math.min(...allX) - 150;
  const xMax = Math.max(...allX) + 150;
  const yMin = -120;
  const yMax = totalH + 180;

  const sx = (W - 2*margin) / (xMax - xMin);
  const sy = (H - 2*margin) / (yMax - yMin);
  const s = Math.min(sx, sy);

  const tx = (x) => margin + (x - xMin) * s;
  const ty = (y) => H - margin - (y - yMin) * s;

  // rails
  line(svg, tx(baseLeft.x), ty(baseLeft.y), tx(baseRight.x), ty(baseRight.y), 6, "rgba(255,255,255,.25)");
  line(svg, tx(topLeft.x),  ty(topLeft.y),  tx(topRight.x),  ty(topRight.y),  6, "rgba(255,255,255,.25)");

  // stages
  for(const st of stages){
    line(svg, tx(st.A.x), ty(st.A.y), tx(st.D.x), ty(st.D.y), 5, "rgba(122,162,247,.95)");
    line(svg, tx(st.B.x), ty(st.B.y), tx(st.C.x), ty(st.C.y), 5, "rgba(122,162,247,.95)");

    joint(svg, tx(st.A.x), ty(st.A.y));
    joint(svg, tx(st.B.x), ty(st.B.y));
    joint(svg, tx(st.C.x), ty(st.C.y));
    joint(svg, tx(st.D.x), ty(st.D.y));
  }

  text(svg, 20, 26, `α = ${state.alphaDeg}°  |  N = ${state.N}  |  H = ${fmt(toDisplay(totalH))} ${state.units}`, 14);
  if(stage0.warnings.length){
    text(svg, 20, 48, `⚠ ${stage0.warnings.join(" ")}`, 12, "rgba(247,118,142,.95)");
  }
}

function updateOutputs(){
  el("alphaVal").textContent = `${state.alphaDeg}°`;

  el("armUnit").textContent = state.units;
  el("baseUnit").textContent = state.units;
  el("topUnit").textContent = state.units;

  const { stage0, totalH } = computeAll();
  const cons = constraintsFromPreset(state.preset);

  const outputObj = {
    units: state.units,
    inputs: {
      stages: state.N,
      arm: toDisplay(state.arm_mm),
      baseRail: toDisplay(state.base_mm),
      topRail: toDisplay(state.top_mm),
      alphaDeg: state.alphaDeg,
      constraints: cons,
      lockX: state.lockX
    },
    outputs: {
      stageHeight: toDisplay(stage0.h),
      stageSpanProjection: toDisplay(stage0.s),
      totalHeight: toDisplay(totalH),
      railEndpoints_mm: stage0.platform,
      pinCoords_mm: { A: stage0.A, B: stage0.B, C: stage0.C, D: stage0.D }
    },
    warnings: stage0.warnings
  };

  el("out").textContent =
`Inputs (${state.units}):
  N = ${state.N}
  arm = ${fmt(toDisplay(state.arm_mm))} ${state.units}  (pin-to-pin)
  base rail = ${fmt(toDisplay(state.base_mm))} ${state.units}
  top rail  = ${fmt(toDisplay(state.top_mm))} ${state.units}
  α = ${state.alphaDeg}°
  lock X = ${state.lockX ? "ON (vertical-only)" : "OFF"}

Constraints:
  base left  = ${cons.baseL}
  base right = ${cons.baseR}
  top left   = ${cons.topL}
  top right  = ${cons.topR}

Outputs (${state.units}):
  stage height h = ${fmt(toDisplay(stage0.h))} ${state.units}
  stage projection s = ${fmt(toDisplay(stage0.s))} ${state.units}
  total height H = ${fmt(toDisplay(totalH))} ${state.units}

Rail endpoints (mm, stage 1):
  Base: (${fmt(stage0.platform.baseLeft.x)}, 0) -> (${fmt(stage0.platform.baseRight.x)}, 0)
  Top : (${fmt(stage0.platform.topLeft.x)}, ${fmt(stage0.platform.topLeft.y)}) -> (${fmt(stage0.platform.topRight.x)}, ${fmt(stage0.platform.topRight.y)})

Pin coordinates (mm, stage 1):
  A (${fmt(stage0.A.x)}, ${fmt(stage0.A.y)})
  B (${fmt(stage0.B.x)}, ${fmt(stage0.B.y)})
  C (${fmt(stage0.C.x)}, ${fmt(stage0.C.y)})
  D (${fmt(stage0.D.x)}, ${fmt(stage0.D.y)})

Tip:
  Copy JSON and paste into your CAD notes. Use the coords as centerpoints.
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
    state.lockX = e.target.checked;
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
el("arm").value = fmt(toDisplay(state.arm_mm));
el("base").value = fmt(toDisplay(state.base_mm));
el("top").value = fmt(toDisplay(state.top_mm));
updateOutputs();
draw();