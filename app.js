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
  // For each rail end: "fixed" (x,y fixed) or "slide" (y fixed, x variable) or "fixedWarn"
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

/**
 * Compute a single stage geometry in 2D.
 * We model endpoints on base rail (y=0) and top rail (y=h).
 *
 * Let:
 *  A = base left endpoint (xA, 0)
 *  B = base right endpoint (xB, 0)
 *  C = top left endpoint (xC, h)
 *  D = top right endpoint (xD, h)
 *
 * Arms:
 *  Arm1 connects A -> D (length Larm)
 *  Arm2 connects B -> C (length Larm)
 *
 * For a scissor with arm angle alpha relative to horizontal:
 *  Vertical rise of each arm end-to-end is h = Larm * sin(alpha)
 *  Horizontal projection is s = Larm * cos(alpha)
 *
 * Then:
 *  xD - xA = s
 *  xC - xB = s
 *
 * And rail lengths constrain:
 *  base rail length = xB - xA (nominal)
 *  top rail length  = xD - xC (nominal)
 *
 * We resolve based on constraints preset:
 *  - fixed ends keep their x pinned to rail endpoints
 *  - sliding ends adjust x within rails
 *
 * V1 approach: keep rail endpoints symmetric around center,
 * then satisfy fixed endpoints and solve the sliding ones.
 */
function computeStage(Larm, baseLen, topLen, alphaDeg, preset){
  const a = rad(alphaDeg);
  const h = Larm * Math.sin(a);
  const s = Larm * Math.cos(a);

  const cons = constraintsFromPreset(preset);

  // Define nominal rail endpoints (centered at 0)
  const baseLeftNom  = -baseLen/2;
  const baseRightNom =  baseLen/2;
  const topLeftNom   = -topLen/2;
  const topRightNom  =  topLen/2;

  // Start with nominal positions
  let xA = baseLeftNom, xB = baseRightNom, xC = topLeftNom, xD = topRightNom;

  // Apply "fixed" constraints to lock rail endpoints
  // Slide constraints will be solved by the arm projection equations.
  if(cons.baseL === "fixed") xA = baseLeftNom;
  if(cons.baseR === "fixed") xB = baseRightNom;
  if(cons.topL  === "fixed") xC = topLeftNom;
  if(cons.topR  === "fixed") xD = topRightNom;

  // Now satisfy arm projection:
  // xD = xA + s
  // xC = xB + s
  // For sliding endpoints, we allow those to move to satisfy equations.
  if(cons.topR === "slide") xD = xA + s;
  else if(cons.baseL === "slide") xA = xD - s;

  if(cons.topL === "slide") xC = xB + s;
  else if(cons.baseR === "slide") xB = xC - s;

  // After solving, we can compute actual rail lengths implied
  const baseSpan = xB - xA;
  const topSpan  = xD - xC;

  // Center correction: keep overall assembly centered near 0
  // (prevents drift when both top ends slide etc.)
  const center = (xA + xB + xC + xD) / 4;
  xA -= center; xB -= center; xC -= center; xD -= center;

  return {
    h, s,
    A:{x:xA,y:0}, B:{x:xB,y:0}, C:{x:xC,y:h}, D:{x:xD,y:h},
    baseSpan, topSpan,
    warnings: stageWarnings(cons),
  };
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

function computeAll(){
  const Larm = state.arm_mm;
  const baseLen = state.base_mm;
  const topLen = state.top_mm;

  const stage = computeStage(Larm, baseLen, topLen, state.alphaDeg, state.preset);

  // Stack N stages vertically: each stage adds height h
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

  // View mapping
  const W = 980, H = 560;
  const margin = 70;

  // Extents in mm (rough)
  const xMin = Math.min(stage0.A.x, stage0.B.x, stage0.C.x, stage0.D.x) - 150;
  const xMax = Math.max(stage0.A.x, stage0.B.x, stage0.C.x, stage0.D.x) + 150;
  const yMin = -120;
  const yMax = totalH + 180;

  const sx = (W - 2*margin) / (xMax - xMin);
  const sy = (H - 2*margin) / (yMax - yMin);
  const s = Math.min(sx, sy);

  const tx = (x) => margin + (x - xMin) * s;
  const ty = (y) => H - margin - (y - yMin) * s;

  // rails (base & top)
  const baseLeft = {x: stage0.A.x, y: 0};
  const baseRight= {x: stage0.B.x, y: 0};
  const topLeft  = {x: stage0.C.x, y: totalH};
  const topRight = {x: stage0.D.x, y: totalH};

  line(svg, tx(baseLeft.x), ty(baseLeft.y), tx(baseRight.x), ty(baseRight.y), 6, "rgba(255,255,255,.25)");
  line(svg, tx(topLeft.x),  ty(topLeft.y),  tx(topRight.x),  ty(topRight.y),  6, "rgba(255,255,255,.25)");

  // draw stages
  for(const st of stages){
    // Arms: A->D and B->C for each stage
    line(svg, tx(st.A.x), ty(st.A.y), tx(st.D.x), ty(st.D.y), 5, "rgba(122,162,247,.95)");
    line(svg, tx(st.B.x), ty(st.B.y), tx(st.C.x), ty(st.C.y), 5, "rgba(122,162,247,.95)");

    // joints
    joint(svg, tx(st.A.x), ty(st.A.y));
    joint(svg, tx(st.B.x), ty(st.B.y));
    joint(svg, tx(st.C.x), ty(st.C.y));
    joint(svg, tx(st.D.x), ty(st.D.y));
  }

  // labels
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
      constraints: cons
    },
    outputs: {
      stageHeight: toDisplay(stage0.h),
      stageSpanProjection: toDisplay(stage0.s),
      totalHeight: toDisplay(totalH),
      pinCoords_mm: {
        A: stage0.A, B: stage0.B, C: stage0.C, D: stage0.D
      }
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

Constraints:
  base left  = ${cons.baseL}
  base right = ${cons.baseR}
  top left   = ${cons.topL}
  top right  = ${cons.topR}

Outputs (${state.units}):
  stage height h = ${fmt(toDisplay(stage0.h))} ${state.units}
  stage projection s = ${fmt(toDisplay(stage0.s))} ${state.units}
  total height H = ${fmt(toDisplay(totalH))} ${state.units}

Pin coordinates (mm, stage 1):
  A (${fmt(stage0.A.x)}, ${fmt(stage0.A.y)})
  B (${fmt(stage0.B.x)}, ${fmt(stage0.B.y)})
  C (${fmt(stage0.C.x)}, ${fmt(stage0.C.y)})
  D (${fmt(stage0.D.x)}, ${fmt(stage0.D.y)})

Tip:
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
    // Convert displayed fields to new units but keep internal mm consistent
    const newUnits = e.target.value;
    if(newUnits === state.units) return;

    // read current displayed values, convert to mm using OLD units
    const armDisp = Number(el("arm").value);
    const baseDisp = Number(el("base").value);
    const topDisp = Number(el("top").value);

    // Convert those display numbers from old units -> mm
    const oldUnits = state.units;
    state.units = oldUnits; // temporarily ensure toMM uses old units
    state.arm_mm = toMM(armDisp);
    state.base_mm = toMM(baseDisp);
    state.top_mm = toMM(topDisp);

    // switch units, then rewrite fields in new units
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