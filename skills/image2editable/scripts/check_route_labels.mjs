#!/usr/bin/env node
// Optional evidence generator: connection shafts versus declared live-text boxes.
// No rendering, font measurement, readability verdict, routing, or spec mutation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileSpec,sha256} from './spec_core.mjs';

const EPS=1e-8,round=x=>Number(x.toFixed(6));
const point=(p,b,angle)=>{const cx=b[0]+b[2]/2,cy=b[1]+b[3]/2,r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return [cx+(p[0]-cx)*c-(p[1]-cy)*s,cy+(p[0]-cx)*s+(p[1]-cy)*c];};
const corners=n=>{const [x,y,w,h]=n.bbox;return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p=>point(p,n.bbox,n.rotation??0));};
function clip(a,b,box,pad=0){
 const [x,y,w,h]=box,dx=b[0]-a[0],dy=b[1]-a[1];let enter=0,leave=1;
 const ps=[-dx,dx,-dy,dy],qs=[a[0]-x+pad,x+w+pad-a[0],a[1]-y+pad,y+h+pad-a[1]];
 for(let i=0;i<4;i++){
  if(Math.abs(ps[i])<EPS){if(qs[i]<-EPS)return null;continue;}
  const t=qs[i]/ps[i];if(ps[i]<0)enter=Math.max(enter,t);else leave=Math.min(leave,t);
  if(enter>leave+EPS)return null;
 }
 return {enter:Math.max(0,enter),leave:Math.min(1,leave)};
}
function intersection(segment,label,pad){
 const local=segment.map(p=>point(p,label.bbox,-(label.rotation??0))),hit=clip(local[0],local[1],label.bbox,pad);
 if(!hit)return null;
 const at=t=>segment[0].map((v,i)=>round(v+t*(segment[1][i]-v)));
 return {from:at(hit.enter),to:at(hit.leave),t:[round(hit.enter),round(hit.leave)],centerlineInTextBox:Boolean(clip(local[0],local[1],label.bbox)),contact:hit.leave-hit.enter<EPS?'boundary-touch':'overlap'};
}
function contains(owner,label){
 const [x,y,w,h]=owner.bbox;
 return corners(label).every(p=>{const [px,py]=point(p,owner.bbox,-(owner.rotation??0));return px>=x-EPS&&py>=y-EPS&&px<=x+w+EPS&&py<=y+h+EPS;});
}

/** checkRouteLabels(specPath,{clearancePx=0,labelExceptions=[]}) -> warning report.
 * Optional exceptions are exact {connectionId,textId,reason,evidence} pairs.
 * Their justification is author/reviewer-declared, never silently inferred.
 */
export async function checkRouteLabels(specPath,{clearancePx=0,labelExceptions=[]}={}){
 if(!Number.isFinite(clearancePx)||clearancePx<0)throw new Error('clearancePx must be a finite nonnegative number');
 if(!Array.isArray(labelExceptions))throw new Error('labelExceptions must be an array');
 const bytes=await fs.readFile(specPath),spec=JSON.parse(bytes.toString('utf8'));
 const report={schema:'route-label-check/v1',specPath:path.resolve(specPath),specSha256:sha256(bytes),status:'unknown',readability:'not-established',regionBasis:'declared-text-bbox',clearancePx,findings:[],excludedIntersections:[],unknowns:[],coverage:{},limitations:[
  'Candidate geometry intersections are warnings, not proof of glyph overlap or readability. Text boxes may contain whitespace; actual glyphs may overflow them.',
  'Only canonical connection shafts are checked. Arrowheads, standalone path routes, image text, and text/text collisions are not assessed.',
  'Dashed/dotted shafts use a continuous conservative envelope; dash gaps, occlusion, masks, and draw-order visibility are not resolved.',
  'Text rotation is handled geometrically, but font metrics and native application rendering are not measured.',
  'Endpoint ownership exclusions use explicit anchor chains or an immediate shared group plus full text-box containment. Exception reasons/evidence are declared, not independently verified.'
 ]};
 let scene;
 try{({scene}=await compileSpec(spec,specPath));}
 catch(e){report.status='invalid';report.unknowns.push({code:'canonical_geometry_unavailable',message:e.message});report.coverage={connectionsChecked:0,completeForCanonicalShafts:false};return report;}
 const nodes=new Map(scene.nodes.map(n=>[n.id,n])),raw=new Map(spec.objects.map(o=>[o.id,o]));
 const labels=scene.nodes.filter(n=>n.type==='text'),connections=new Map(scene.connections.map(c=>[c.id,c])),parents=new Map();
 for(const n of scene.nodes)if(n.type==='group')for(const id of n.children)parents.set(id,n.id);
 const exceptions=new Map();
 for(const e of labelExceptions){
  if(!e||!connections.has(e.connectionId)||nodes.get(e.textId)?.type!=='text'||![e.reason,e.evidence].every(s=>typeof s==='string'&&s.trim()))throw new Error('Each exception requires existing connectionId/textId and nonempty reason/evidence');
  const key=e.connectionId+'\0'+e.textId;if(exceptions.has(key))throw new Error('Duplicate label exception');exceptions.set(key,{...e,justification:'declared-not-verified'});
 }
 function ownership(label,connection){
  for(const role of ['source','target']){
   const ownerId=connection[role].object,owner=nodes.get(ownerId);
   if(label.id===ownerId)return {kind:'endpoint-is-text',role,ownerId};
   let cursor=raw.get(label.id),seen=new Set();
   while(cursor?.anchor&&!seen.has(cursor.id)){
    seen.add(cursor.id);if(cursor.anchor.object===ownerId)return {kind:'explicit-anchor-chain',role,ownerId};cursor=raw.get(cursor.anchor.object);
   }
   const groupId=parents.get(label.id);
   if(groupId&&groupId===parents.get(ownerId)&&contains(owner,label))return {kind:'immediate-group-and-contained-bbox',role,ownerId,groupId};
  }
  return null;
 }
 let segmentCount=0,pairsChecked=0;
 for(const c of scene.connections){
  const pts=c.resolvedPoints;
  if(!Array.isArray(pts)||pts.length<2||pts.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))){report.unknowns.push({code:'unsupported_connection_geometry',connectionId:c.id});continue;}
  const strokeWidth=nodes.get(c.id+'__line')?.stroke?.width??c.stroke.width,pad=strokeWidth/2+clearancePx;
  for(let i=0;i<pts.length-1;i++){
   const segment=[pts[i],pts[i+1]];segmentCount++;
   for(const label of labels){
    pairsChecked++;const hit=intersection(segment,label,pad);if(!hit)continue;
    const identity={connectionId:c.id,textId:label.id,segmentIndex:i,segment:segment.map(p=>p.map(round))};
    const owner=ownership(label,c),exception=exceptions.get(c.id+'\0'+label.id);
    if(owner||exception){report.excludedIntersections.push({...identity,reason:owner??{kind:'explicit-pair-exception',...exception}});continue;}
    report.findings.push({severity:'warning',code:'route_text_candidate',...identity,text:label.text,textBBox:label.bbox.map(round),textRotation:label.rotation??0,textRegionPolygon:corners(label).map(p=>p.map(round)),strokeWidth,strokeDash:c.stroke.dash??'solid',envelopePaddingPx:pad,intersection:hit});
   }
  }
 }
 const paths=spec.objects.filter(o=>o.type==='path');
 for(const o of paths)if(o.commands.some(c=>['Q','C'].includes(c[0])))report.unknowns.push({code:'unassessed_curved_path',objectId:o.id,message:'Authored curved paths are outside canonical connection-shaft coverage; this tool cannot determine whether this is a route or decoration.'});
 report.coverage={connectionsChecked:scene.connections.length,segmentsChecked:segmentCount,textObjects:labels.length,segmentTextPairsChecked:pairsChecked,completeForCanonicalShafts:!report.unknowns.some(u=>u.code==='unsupported_connection_geometry'),standalonePathsNotChecked:paths.map(o=>o.id),arrowheadsChecked:false,paintMetricsMeasured:false};
 report.counts={candidates:report.findings.length,excludedIntersections:report.excludedIntersections.length,unknowns:report.unknowns.length};
 report.status=report.findings.length?'warnings':report.unknowns.length?'unknown':scene.connections.length?'no-candidates':'not-assessed';
 return report;
}

async function cli(){
 const args=process.argv.slice(2),specPath=args.shift(),opts={};
 if(!specPath)throw new Error('Usage: node check_route_labels.mjs spec.json [--out NEW.json] [--clearance PX] [--exceptions pairs.json]');
 for(let i=0;i<args.length;i++){
  const key={'--out':'out','--clearance':'clearance','--exceptions':'exceptions'}[args[i]];if(!key||!args[i+1])throw new Error(`Unknown or incomplete option ${args[i]}`);opts[key]=args[++i];
 }
 if(opts.out){try{await fs.lstat(opts.out);throw new Error(`Refusing to overwrite existing output: ${opts.out}`);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const labelExceptions=opts.exceptions?JSON.parse(await fs.readFile(opts.exceptions,'utf8')):[];
 const report=await checkRouteLabels(path.resolve(specPath),{clearancePx:opts.clearance===undefined?0:Number(opts.clearance),labelExceptions}),json=JSON.stringify(report,null,2)+'\n';
 if(opts.out)await fs.writeFile(opts.out,json,{flag:'wx'});else process.stdout.write(json);
 // Warnings/unknown coverage are evidence, not a pass/fail gate. Invalid input is an error.
 if(report.status==='invalid')process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(e=>{console.error(e.message);process.exitCode=2;});
