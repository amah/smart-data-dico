// Generate the BNP Paribas pitch deck as a real .pptx (mirrors
// docs/presentation/smart-data-dico-bnp.html). pptxgenjs is NOT a project
// dependency — run ad-hoc:  `npm i pptxgenjs && node scripts/build-pptx.mjs`
import pptxgen from 'pptxgenjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(__dir, '..', 'docs', 'presentation', 'smart-data-dico-bnp.pptx');

// BNP Paribas brand palette (green on white, per their guidelines)
const GREEN='00965E', GREEN_DARK='007348', GREEN_MID='008755', GREEN2='39A87B';
const SOFT='F4F9F6', LINE='E3EEE8', INK='15241D', MUTED='5B6B63', TAGBG='E2F3EA', WHITE='FFFFFF';
// Arial renders as a clean sans on both macOS and Windows. (Segoe UI is
// Windows-only and falls back to a serif on macOS.)
const FONT='Arial';

const p = new pptxgen();
p.defineLayout({ name:'W', width:13.33, height:7.5 });
p.layout = 'W';
p.author = 'Smart Data Dictionary';
p.title = 'Smart Data Dictionary — for BNP Paribas';

const ML = 0.85, MR = 0.85, CW = 13.33 - ML - MR;

function footer(s, n){
  s.addShape(p.ShapeType.line, { x:ML, y:6.95, w:CW, h:0, line:{ color:LINE, width:1 } });
  s.addText([
    { text:'Smart Data Dictionary', options:{ color:INK, bold:true } },
    { text:'  ·  Prepared for BNP Paribas', options:{ color:MUTED } },
  ], { x:ML, y:7.0, w:9, h:0.3, fontFace:FONT, fontSize:10, align:'left', valign:'middle' });
  s.addText(`${n} / 5`, { x:13.33-MR-1.5, y:7.0, w:1.5, h:0.3, fontFace:FONT, fontSize:10, color:MUTED, align:'right', valign:'middle' });
}
function eyebrow(s, t){
  s.addText(t.toUpperCase(), { x:ML, y:0.55, w:CW, h:0.35, fontFace:FONT, fontSize:12, bold:true, color:GREEN, charSpacing:2 });
}
function h2(s, t){
  s.addText(t, { x:ML, y:0.92, w:CW, h:0.75, fontFace:FONT, fontSize:30, bold:true, color:INK });
}

/* ---------- Slide 1 · Title ---------- */
let s = p.addSlide(); s.background = { color: GREEN };
// decorative 4-point stars (white, faint)
[[10.9,0.9,1.5,55],[12.0,2.4,0.8,45],[9.7,4.1,0.6,40],[12.4,5.0,1.1,30],[8.7,2.0,0.45,50]]
  .forEach(([x,y,sz,tr])=> s.addShape(p.ShapeType.star4, { x, y, w:sz, h:sz, fill:{ color:WHITE, transparency:100-tr }, line:{ type:'none' } }));
s.addText('DATA MODELLING & GOVERNANCE PLATFORM', { x:ML, y:1.5, w:CW, h:0.4, fontFace:FONT, fontSize:13, bold:true, color:'CFEEDE', charSpacing:2 });
s.addText('Smart Data Dictionary', { x:ML, y:2.0, w:10.5, h:1.6, fontFace:FONT, fontSize:54, bold:true, color:WHITE });
s.addText('See the whole system — capture the data model, the use cases, and the processes behind it, in one living, shared, governed model.',
  { x:ML, y:3.7, w:9.2, h:1.2, fontFace:FONT, fontSize:19, color:'EAFFF5', lineSpacingMultiple:1.25 });
s.addShape(p.ShapeType.roundRect, { x:ML, y:5.5, w:2.85, h:0.5, rectRadius:0.25, fill:{ type:'none' }, line:{ color:'FFFFFF', width:1, transparency:45 } });
s.addText('Prepared for BNP Paribas', { x:ML, y:5.5, w:2.85, h:0.5, fontFace:FONT, fontSize:12.5, bold:true, color:WHITE, align:'center', valign:'middle' });
s.addText('Visibility into complex systems', { x:ML+3.05, y:5.5, w:5, h:0.5, fontFace:FONT, fontSize:13, color:'DFF7EC', valign:'middle' });

/* ---------- Slide 2 · Challenge → Goal ---------- */
s = p.addSlide(); s.background = { color:WHITE };
eyebrow(s,'The challenge & the goal'); h2(s,'Complex systems lose their shared picture');
const colY=2.0, colW=(CW-0.8)/2;
s.addText('TODAY', { x:ML, y:colY, w:colW, h:0.35, fontFace:FONT, fontSize:14, bold:true, color:MUTED, charSpacing:2 });
s.addText('WITH SMART DATA DICTIONARY', { x:ML+colW+0.8, y:colY, w:colW, h:0.35, fontFace:FONT, fontSize:14, bold:true, color:GREEN, charSpacing:1 });
const today=['Knowledge scattered across services, schemas, slides & people','No single source of truth — diagrams drift from reality','Hard to see how data, rules & lifecycles connect','Governance & impact analysis are manual and slow'];
const withSdd=['One living model of the whole landscape','Version-controlled in git — auditable, reviewable, shareable','Data, business rules and processes captured together','Visibility & impact at a glance, for every stakeholder'];
const bullets=(arr,color,dot)=>arr.map(t=>({ text:t, options:{ bullet:{ indent:18 }, color, breakLine:true, paraSpaceAfter:10 } }));
s.addText(bullets(today,MUTED), { x:ML, y:colY+0.5, w:colW, h:3.8, fontFace:FONT, fontSize:16, lineSpacingMultiple:1.1, color:MUTED });
s.addText(bullets(withSdd,INK), { x:ML+colW+0.8, y:colY+0.5, w:colW, h:3.8, fontFace:FONT, fontSize:16, lineSpacingMultiple:1.1, color:INK });
// accent bar between
s.addShape(p.ShapeType.rect, { x:ML+colW+0.35, y:colY, w:0.06, h:3.9, fill:{ color:LINE } });
footer(s,2);

/* ---------- Slide 3 · Capture the full picture ---------- */
s = p.addSlide(); s.background = { color:WHITE };
eyebrow(s,'One model, three connected facets'); h2(s,'Capture the full picture of a system');
s.addText('Most tools stop at boxes and lines. Smart Data Dictionary models what the data is, how the business uses it, and how it behaves over time.',
  { x:ML, y:1.65, w:CW, h:0.7, fontFace:FONT, fontSize:16, color:MUTED, lineSpacingMultiple:1.2 });
const cards=[
  { t:'Data model', d:'Packages, entities & typed attributes with validation, relationships, DB-enforced constraints and reusable derived types.', tags:['Entities','Relationships','Validation','Constraints'] },
  { t:'Use cases & views', d:'Business "cases" and perspectives resolve a focused sub-model from any starting point — the view each audience needs.', tags:['Cases','Perspectives','Business rules'] },
  { t:'Process & state machines', d:"Model an entity's lifecycle — states, transitions, guards and the actions/events fired along the way. Behaviour, not just structure.", tags:['State machines','Transitions','Actions'] },
];
const cy=2.55, ch=3.7, gap=0.4, cw=(CW-2*gap)/3;
cards.forEach((c,idx)=>{
  const cx=ML+idx*(cw+gap);
  s.addShape(p.ShapeType.roundRect, { x:cx, y:cy, w:cw, h:ch, rectRadius:0.12, fill:{ color:SOFT }, line:{ color:LINE, width:1 } });
  s.addShape(p.ShapeType.rect, { x:cx, y:cy, w:0.08, h:ch, fill:{ color:GREEN } });
  s.addShape(p.ShapeType.roundRect, { x:cx+0.3, y:cy+0.32, w:0.55, h:0.55, rectRadius:0.08, fill:{ color:GREEN }, line:{ type:'none' } });
  s.addText(['◧','★','⮎'][idx], { x:cx+0.3, y:cy+0.32, w:0.55, h:0.55, fontFace:FONT, fontSize:18, color:WHITE, align:'center', valign:'middle' });
  s.addText(c.t, { x:cx+0.3, y:cy+1.05, w:cw-0.6, h:0.5, fontFace:FONT, fontSize:18, bold:true, color:INK });
  s.addText(c.d, { x:cx+0.3, y:cy+1.55, w:cw-0.6, h:1.5, fontFace:FONT, fontSize:13.5, color:MUTED, lineSpacingMultiple:1.15 });
  s.addText(c.tags.map(t=>({ text:'  '+t+'  ', options:{ fill:{ color:TAGBG }, color:GREEN_DARK, fontSize:10.5, bold:true } })).flatMap((o,i)=>i? [{text:' ',options:{fontSize:8}},o]:[o]),
    { x:cx+0.3, y:cy+ch-0.75, w:cw-0.6, h:0.5, fontFace:FONT });
});
footer(s,3);

/* ---------- Slide 4 · Platform features ---------- */
s = p.addSlide(); s.background = { color:WHITE };
eyebrow(s,'A platform, not a drawing'); h2(s,'Built for governance at scale');
const feats=[
  ['Interactive visualization','Explore entities & relationships as a live graph, by package or across the whole model.'],
  ['Git versioning','Every change tracked, diffed, reviewed and published — full history, no database.'],
  ['Quality & integrity','Validation, constraints and business rules in one pane; documentation scoring.'],
  ['Import & export','Export JSON Schema for code-gen; capture physical constraints from SQL DDL / live DBs.'],
  ['AI assistance','In-app chat grounded in your model — author, search and explain, with MCP tools.'],
  ['CI validation','npx … --validate catches model errors before they ever reach the app.'],
];
const fy=2.0, fgap=0.35, fcw=(CW-2*fgap)/3, fch=1.95, rgap=0.35;
feats.forEach((f,idx)=>{
  const r=Math.floor(idx/3), col=idx%3;
  const fx=ML+col*(fcw+fgap), fyy=fy+r*(fch+rgap);
  s.addShape(p.ShapeType.roundRect, { x:fx, y:fyy, w:fcw, h:fch, rectRadius:0.1, fill:{ color:WHITE }, line:{ color:LINE, width:1 } });
  s.addShape(p.ShapeType.roundRect, { x:fx+0.28, y:fyy+0.3, w:0.42, h:0.42, rectRadius:0.07, fill:{ color:TAGBG }, line:{ type:'none' } });
  s.addText('✦', { x:fx+0.28, y:fyy+0.3, w:0.42, h:0.42, fontFace:FONT, fontSize:14, color:GREEN, align:'center', valign:'middle' });
  s.addText(f[0], { x:fx+0.85, y:fyy+0.26, w:fcw-1.1, h:0.45, fontFace:FONT, fontSize:15, bold:true, color:INK });
  s.addText(f[1], { x:fx+0.85, y:fyy+0.72, w:fcw-1.05, h:1.1, fontFace:FONT, fontSize:12, color:MUTED, lineSpacingMultiple:1.12 });
});
footer(s,4);

/* ---------- Slide 5 · Get started ---------- */
s = p.addSlide(); s.background = { color:SOFT };
eyebrow(s,'How it works'); h2(s,'Lightweight to run, ready to scale');
const steps=[
  ['01 · STORE','File-based & git-native','The model lives as YAML/JSON in a project folder, versioned with git. No database to operate.'],
  ['02 · RUN','Desktop or server','Single-user desktop, or a shared multi-user server with roles (admin / editor / viewer).'],
  ['03 · GOVERN','Review & publish','Draft → review → approve workflows, quality & integrity gates, impact analysis.'],
];
const sy=2.0, sgap=0.4, scw=(CW-2*sgap)/3, sch=2.4;
steps.forEach((st,idx)=>{
  const sx=ML+idx*(scw+sgap);
  s.addShape(p.ShapeType.roundRect, { x:sx, y:sy, w:scw, h:sch, rectRadius:0.12, fill:{ color:WHITE }, line:{ color:LINE, width:1 } });
  s.addText(st[0], { x:sx+0.32, y:sy+0.3, w:scw-0.6, h:0.35, fontFace:FONT, fontSize:12.5, bold:true, color:GREEN, charSpacing:1 });
  s.addText(st[1], { x:sx+0.32, y:sy+0.7, w:scw-0.6, h:0.5, fontFace:FONT, fontSize:17, bold:true, color:INK });
  s.addText(st[2], { x:sx+0.32, y:sy+1.25, w:scw-0.6, h:1.0, fontFace:FONT, fontSize:13, color:MUTED, lineSpacingMultiple:1.18 });
});
// CTA band
s.addShape(p.ShapeType.roundRect, { x:ML, y:4.85, w:CW, h:1.25, rectRadius:0.14, fill:{ color:GREEN } });
s.addText([
  { text:'Try it in one command   ', options:{ color:WHITE, fontSize:18, bold:true } },
  { text:'npx @hamak/smart-data-dico', options:{ color:'EAFFF5', fontSize:16, fontFace:'Courier New' } },
], { x:ML+0.5, y:4.95, w:CW-1, h:0.55, fontFace:FONT, valign:'middle' });
s.addText('Bring visibility, governance and shared understanding to BNP Paribas’s complex systems.',
  { x:ML+0.5, y:5.5, w:CW-1, h:0.45, fontFace:FONT, fontSize:13.5, color:'DFF7EC', valign:'middle' });
footer(s,5);

await p.writeFile({ fileName: OUT });
console.log('wrote', OUT);
