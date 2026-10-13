#!/usr/bin/env node
/** Structural audit for newly designed figures; never a layout or truth engine.
 * auditDesign(plan, spec, specPath, {review?, stage='draft'}) -> report (no writes).
 * Plan schema: design-plan/v1. Required arrays: sources, claims, references,
 * unknowns; structure.nodes/relations; design.alternatives; bindings.nodes/
 * relations/claims. Nodes and claims must be nonempty; other arrays may be empty.
 * IDs are unique within their namespace. Additional descriptive fields are allowed.
 * Supported/user-provided claims require a content sourceRef with a locator;
 * proposed claims may be uncited. objectIds/shapeId refer to authored spec.objects,
 * connectionId to spec.connections. A node needs live text among its bound objects;
 * label wording is not compared, allowing abbreviations and mixed-media nodes.
 * Node requiresLiveLabel is an optional boolean (default true). Explicit false
 * permits text-free illustrations while retaining the semantic metadata label
 * and valid bindings; this choice is recorded in coverage and a review warning.
 * Relation bidirectional is an optional boolean (default false): ordinary
 * relations require arrow:'end'; explicit bidirectional:true requires 'both'.
 * Canonical connections with no plan-relation binding produce warnings only.
 * Final review: design-review/v1, exact raw-file specSha256, findings array, and
 * checks.semantic/visual/editability each {status:'pass', evidence:nonempty string}.
 * Findings use severity blocking|major|minor and boolean resolved. Native checks
 * are optional {status:'pass'|'fail'|'not-checked', evidence:string}; omission is
 * disclosed as not-checked, never inferred as a native pass. All review evidence
 * is reviewer-declared, not independently verified by this audit. Final review also
 * requires artifacts:[{path,sha256,kind?}] with at least one existing SVG/PNG/PPTX/
 * PDF. Paths are relative to and confined within the spec directory (including
 * symlink resolution); kind, when supplied, must match the extension.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {compileSpec,sha256} from './spec_core.mjs';

const ID=/^[A-Za-z][A-Za-z0-9_-]*$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.trim().length>0;

export async function auditDesign(plan,spec,specPath,{review,stage='draft'}={}){
  const issues=[],add=(severity,code,where,message)=>issues.push({severity,code,path:where,message});
  const error=(code,where,message)=>add('error',code,where,message);
  const warning=(code,where,message)=>add('warning',code,where,message);
  const requireText=(v,where)=>{if(!text(v))error('missing_text',where,'Expected a nonempty string');};
  const array=(v,where,nonempty=false)=>{
    if(!Array.isArray(v)){error('invalid_array',where,'Expected an array');return [];}
    if(nonempty&&!v.length)error('empty_array',where,'At least one item is required');return v;
  };
  const strings=(v,where)=>array(v,where).forEach((s,i)=>requireText(s,`${where}[${i}]`));
  const index=(items,where,key='id')=>{
    const map=new Map();for(const [i,item]of items.entries()){
      if(!object(item)){error('invalid_object',`${where}[${i}]`,'Expected an object');continue;}
      const id=item[key];if(typeof id!=='string'||!ID.test(id)){error('invalid_id',`${where}[${i}].${key}`,'Expected an identifier');continue;}
      if(map.has(id))error('duplicate_id',`${where}[${i}].${key}`,`Duplicate ${key}: ${id}`);else map.set(id,item);
    }return map;
  };
  const refs=(values,map,where)=>{
    const seen=new Set();for(const [i,id]of array(values,where).entries()){
      if(!map.has(id))error('unresolved_reference',`${where}[${i}]`,`Unknown ID: ${String(id)}`);
      if(seen.has(id))error('duplicate_reference',`${where}[${i}]`,`Duplicate reference: ${String(id)}`);seen.add(id);
    }
  };
  if(!['draft','final'].includes(stage))error('invalid_stage','stage','Expected draft or final');
  let specSha256=null,scene=null;
  try{
    const bytes=await fs.readFile(specPath);specSha256=sha256(bytes);
    const diskSpec=JSON.parse(bytes.toString('utf8'));
    if(!isDeepStrictEqual(spec,diskSpec))error('spec_input_mismatch','spec','Supplied spec differs from the exact file being hashed');
    ({scene}=await compileSpec(spec,specPath));
  }catch(e){error('invalid_spec','spec',e.message);}
  if(!object(plan))error('invalid_plan','plan','Expected a design plan object');
  plan=object(plan)?plan:{};
  if(plan.schema!=='design-plan/v1')error('invalid_schema','plan.schema','Expected design-plan/v1');
  if(!['framework','poster','graphic'].includes(plan.kind))error('invalid_kind','plan.kind','Expected framework, poster, or graphic');
  requireText(plan.brief?.goal,'plan.brief.goal');requireText(plan.brief?.audience,'plan.brief.audience');
  const targetApps=array(plan.brief?.targetApps,'plan.brief.targetApps',true);targetApps.forEach((v,i)=>requireText(v,`plan.brief.targetApps[${i}]`));
  const sourceList=array(plan.sources,'plan.sources'),claimList=array(plan.claims,'plan.claims',true);
  const nodeList=array(plan.structure?.nodes,'plan.structure.nodes',true),relationList=array(plan.structure?.relations,'plan.structure.relations');
  const sources=index(sourceList,'plan.sources'),claims=index(claimList,'plan.claims'),nodes=index(nodeList,'plan.structure.nodes'),relations=index(relationList,'plan.structure.relations');
  for(const [id,s]of sources){
    requireText(s.title,`sources.${id}.title`);requireText(s.uri,`sources.${id}.uri`);
    if(!['content','style'].includes(s.role))error('invalid_source_role',`sources.${id}.role`,'Expected content or style');
    if(!['paper','user','data'].includes(s.kind))error('invalid_source_kind',`sources.${id}.kind`,'Expected paper, user, or data');
  }
  for(const [id,c]of claims){
    requireText(c.text,`claims.${id}.text`);
    if(!['supported','user-provided','proposed'].includes(c.status))error('invalid_claim_status',`claims.${id}.status`,'Expected supported, user-provided, or proposed');
    if(typeof c.required!=='boolean')error('invalid_required',`claims.${id}.required`,'Expected boolean');
    let contentRefs=0;for(const [i,r]of array(c.sourceRefs,`claims.${id}.sourceRefs`).entries()){
      if(!object(r)){error('invalid_reference',`claims.${id}.sourceRefs[${i}]`,'Expected {sourceId, locator}');continue;}
      requireText(r.locator,`claims.${id}.sourceRefs[${i}].locator`);
      if(!sources.has(r.sourceId))error('unresolved_source',`claims.${id}.sourceRefs[${i}].sourceId`,`Unknown source ${String(r.sourceId)}`);
      else if(sources.get(r.sourceId).role==='content'&&text(r.locator))contentRefs++;
    }
    if(['supported','user-provided'].includes(c.status)&&!contentRefs)error('missing_content_support',`claims.${id}.sourceRefs`,'Factual claims require a content-role source with a locator; style sources are not factual support');
  }
  for(const [id,n]of nodes){
    requireText(n.label,`structure.nodes.${id}.label`);refs(n.claimRefs,claims,`structure.nodes.${id}.claimRefs`);
    if(n.requiresLiveLabel!==undefined&&typeof n.requiresLiveLabel!=='boolean')error('invalid_live_label_requirement',`structure.nodes.${id}.requiresLiveLabel`,'Expected boolean when provided');
  }
  for(const [id,r]of relations){
    if(!nodes.has(r.source))error('unresolved_node',`structure.relations.${id}.source`,`Unknown node ${String(r.source)}`);
    if(!nodes.has(r.target))error('unresolved_node',`structure.relations.${id}.target`,`Unknown node ${String(r.target)}`);
    if(r.bidirectional!==undefined&&typeof r.bidirectional!=='boolean')error('invalid_bidirectional',`structure.relations.${id}.bidirectional`,'Expected boolean when provided');
    requireText(r.type,`structure.relations.${id}.type`);refs(r.claimRefs,claims,`structure.relations.${id}.claimRefs`);
  }
  for(const [i,r]of array(plan.references,'plan.references').entries()){
    const where=`plan.references[${i}]`;
    if(!object(r)){error('invalid_reference',where,'Expected a visual-reference record');continue;}
    if(!sources.has(r.sourceId))error('unresolved_source',where+'.sourceId',`Unknown source ${String(r.sourceId)}`);
    if(!text(r.figure)&&!(typeof r.figure==='number'&&Number.isFinite(r.figure)))error('missing_figure',where+'.figure','Identify the inspected figure');
    if(typeof r.inspected!=='boolean')error('invalid_inspection',where+'.inspected','Expected boolean');
    else if(!r.inspected)warning('reference_not_inspected',where,'Reference inspection remains unverified/incomplete');
    strings(r.lessons,where+'.lessons');strings(r.avoidCopy,where+'.avoidCopy');
    if(r.inspected&&(!r.lessons?.length||!r.avoidCopy?.length))warning('thin_reference_notes',where,'Inspected references should record lessons and what not to copy');
  }
  const alternatives=index(array(plan.design?.alternatives,'plan.design.alternatives',true),'plan.design.alternatives');
  for(const [id,a]of alternatives)requireText(a.description,`design.alternatives.${id}.description`);
  if(!alternatives.has(plan.design?.chosen))error('unknown_alternative','plan.design.chosen','Chosen alternative must exist');
  requireText(plan.design?.rationale,'plan.design.rationale');strings(plan.unknowns,'plan.unknowns');
  if(alternatives.size===1)warning('single_alternative','plan.design.alternatives','Only one design alternative was recorded');
  if(plan.unknowns?.length)warning('open_unknowns','plan.unknowns','Unknowns require explicit consideration in semantic review');
  const authoredObjects=new Map((Array.isArray(spec?.objects)?spec.objects:[]).filter(object).map(o=>[o.id,o]));
  const authoredConnections=new Map((Array.isArray(spec?.connections)?spec.connections:[]).filter(object).map(c=>[c.id,c]));
  const nb=index(array(plan.bindings?.nodes,'plan.bindings.nodes'),'plan.bindings.nodes','nodeId');
  const rb=index(array(plan.bindings?.relations,'plan.bindings.relations'),'plan.bindings.relations','relationId');
  const cb=index(array(plan.bindings?.claims,'plan.bindings.claims'),'plan.bindings.claims','claimId');
  const nodeCoverage=[],claimCoverage=[],relationCoverage=[],boundNumericObjects=new Set();
  for(const [id,b]of nb){
    if(!nodes.has(id))error('unresolved_node_binding',`bindings.nodes.${id}`,`Unknown structure node ${id}`);
    if(!authoredObjects.has(b.shapeId))error('missing_bound_shape',`bindings.nodes.${id}.shapeId`,`Unknown authored shape ${String(b.shapeId)}`);
    refs(b.objectIds,authoredObjects,`bindings.nodes.${id}.objectIds`);
    const ids=[b.shapeId,...(Array.isArray(b.objectIds)?b.objectIds:[])],labels=ids.map(x=>authoredObjects.get(x)).filter(x=>x?.type==='text'&&text(x.text));
    const requiresLiveLabel=nodes.get(id)?.requiresLiveLabel!==false;
    if(requiresLiveLabel&&!labels.length)error('missing_live_label',`bindings.nodes.${id}`,'A bound shape or associated object must provide a live text label');
    if(!requiresLiveLabel)warning('live_label_opt_out',`structure.nodes.${id}.requiresLiveLabel`,'Live label requirement explicitly disabled; semantic review must assess the text-free visual and its metadata label');
    nodeCoverage.push({nodeId:id,shapeId:b.shapeId,objectIds:b.objectIds,requiresLiveLabel,hasLiveLabel:labels.length>0,labelObjectIds:labels.map(o=>o.id),labelTexts:labels.map(o=>o.text)});
  }
  for(const id of nodes.keys())if(!nb.has(id))error('missing_node_binding',`structure.nodes.${id}`,'Every structure node must be bound');
  for(const [id,b]of rb){
    if(!relations.has(id)){error('unresolved_relation_binding',`bindings.relations.${id}`,`Unknown relation ${id}`);continue;}
    const rel=relations.get(id),conn=authoredConnections.get(b.connectionId),from=nb.get(rel.source)?.shapeId,to=nb.get(rel.target)?.shapeId;
    if(!conn)error('missing_bound_connection',`bindings.relations.${id}.connectionId`,`Unknown authored connection ${String(b.connectionId)}`);
    else{
      if(!from||!to||conn.source?.object!==from||conn.target?.object!==to)error('relation_direction_mismatch',`bindings.relations.${id}`,'Connection source/target must match the bound source/target shapes in order');
      const expectedArrow=rel.bidirectional===true?'both':'end';
      if((conn.arrow??'end')!==expectedArrow)error('relation_arrow_mismatch',`bindings.relations.${id}`,`Relation requires arrow:${expectedArrow}; reverse direction must be explicitly declared with bidirectional:true`);
    }
    relationCoverage.push({relationId:id,connectionId:b.connectionId,sourceShapeId:from,targetShapeId:to});
  }
  for(const id of relations.keys())if(!rb.has(id))error('missing_relation_binding',`structure.relations.${id}`,'Every structure relation must be bound');
  const boundConnections=new Set([...rb].filter(([id])=>relations.has(id)).map(([,b])=>b.connectionId));
  for(const id of authoredConnections.keys())if(!boundConnections.has(id))warning('unbound_spec_connection',`spec.connections.${id}`,'Connection has no plan-relation binding; review whether it is semantic, decorative, or a legend example');
  for(const [id,b]of cb){
    if(!claims.has(id))error('unresolved_claim_binding',`bindings.claims.${id}`,`Unknown claim ${id}`);
    refs(b.objectIds,authoredObjects,`bindings.claims.${id}.objectIds`);
    for(const oid of Array.isArray(b.objectIds)?b.objectIds:[])if(authoredObjects.has(oid))boundNumericObjects.add(oid);
  }
  for(const [id,c]of claims){
    const ids=cb.get(id)?.objectIds,covered=Array.isArray(ids)&&ids.length>0&&ids.every(oid=>authoredObjects.has(oid));
    if(c.required&&!covered)error('missing_required_claim_coverage',`claims.${id}`,'Required claim needs an explicit binding to existing authored objects');
    claimCoverage.push({claimId:id,required:c.required,covered,objectIds:Array.isArray(ids)?ids:[]});
  }
  for(const o of authoredObjects.values())if(o.type==='text'&&/\d/u.test(o.text)&&!boundNumericObjects.has(o.id))warning('unbound_numeric_text',`spec.objects.${o.id}`,'Text contains digits without a claim binding; review whether it is a factual number, citation, index, or label');
  const reviewedArtifacts=[];
  let nativeChecks={status:'not-checked',evidence:'No native application check was supplied.',verification:'not independently verified'};
  if(stage==='final'&&!review)error('missing_final_review','review','Final stage requires design-review/v1');
  if(review!==undefined){
    if(!object(review)||review.schema!=='design-review/v1')error('invalid_review_schema','review.schema','Expected design-review/v1');
    if(!specSha256||review?.specSha256!==specSha256)error('stale_review','review.specSha256','Review must name the SHA256 of the exact current raw spec file bytes');
    for(const [i,f]of array(review?.findings,'review.findings').entries()){
      if(!object(f)||!['blocking','major','minor'].includes(f.severity)||typeof f.resolved!=='boolean'){error('invalid_finding',`review.findings[${i}]`,'Finding requires a valid severity and boolean resolved');continue;}
      if(!f.resolved){if(stage==='final'&&['blocking','major'].includes(f.severity))error('unresolved_review_finding',`review.findings[${i}]`,'Unresolved blocking/major finding prevents final approval');else warning('open_review_finding',`review.findings[${i}]`,'An unresolved review finding remains');}
    }
    for(const name of ['semantic','visual','editability']){
      const check=review?.checks?.[name];
      if(!object(check)||!['pass','fail','not-checked'].includes(check.status))error('invalid_review_check',`review.checks.${name}`,'Expected status pass, fail, or not-checked');
      if(stage==='final'&&check?.status!=='pass')error('review_check_not_passed',`review.checks.${name}`,'Final review requires pass');
      if(check?.status==='pass'||stage==='final')requireText(check?.evidence,`review.checks.${name}.evidence`);
    }
    if(stage==='final'&&(!Array.isArray(review?.artifacts)||!review.artifacts.length))error('missing_review_artifacts','review.artifacts','Final review must identify at least one existing reviewed artifact');
    if(review?.artifacts!==undefined){
      const artifacts=array(review.artifacts,'review.artifacts'),seen=new Set();
      for(const [i,a]of artifacts.entries()){
        const where=`review.artifacts[${i}]`;
        if(!object(a)||!text(a.path)||path.isAbsolute(a.path)||!/^[a-f0-9]{64}$/.test(a.sha256??'')){error('invalid_review_artifact',where,'Expected a relative artifact path and lowercase SHA256');continue;}
        const kind=path.extname(a.path).slice(1).toLowerCase();
        if(!['svg','png','pptx','pdf'].includes(kind)||a.kind!==undefined&&a.kind!==kind){error('invalid_artifact_kind',where,'Reviewed artifacts must be SVG, PNG, PPTX, or PDF; optional kind must match');continue;}
        try{
          const base=await fs.realpath(path.dirname(specPath)),absolute=await fs.realpath(path.resolve(base,a.path)),relative=path.relative(base,absolute);
          if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)){error('artifact_path_escape',where,'Artifact must remain within the spec directory');continue;}
          if(seen.has(absolute)){error('duplicate_artifact',where,'Artifact appears more than once');continue;}seen.add(absolute);
          if(!(await fs.stat(absolute)).isFile()){error('invalid_review_artifact',where,'Artifact must be an ordinary file');continue;}
          const actualSha256=sha256(await fs.readFile(absolute)),matches=actualSha256===a.sha256;
          reviewedArtifacts.push({path:a.path,kind,sha256:actualSha256,matches});
          if(!matches)error('stale_review_artifact',where,'Reviewed artifact bytes no longer match the recorded SHA256');
        }catch(e){error('missing_review_artifact',where,`Cannot read reviewed artifact: ${e.message}`);}
      }
    }
    if(review?.nativeChecks!==undefined){
      const nc=review.nativeChecks;
      if(!object(nc)||!['pass','fail','not-checked'].includes(nc.status)||!text(nc.evidence))error('invalid_native_check','review.nativeChecks','Expected status pass/fail/not-checked and nonempty evidence');
      else nativeChecks={...nc,verification:'reviewer-declared; not independently verified'};
    }
  }
  if(nativeChecks.status!=='pass')warning('native_not_passed','review.nativeChecks',`Native application status: ${nativeChecks.status}. This is disclosed separately from the structural result.`);
  const errors=issues.filter(x=>x.severity==='error'),warnings=issues.filter(x=>x.severity==='warning');
  return {schema:'design-audit/v1',stage,status:errors.length?'fail':'pass',passed:errors.length===0,specSha256,
    counts:{errors:errors.length,warnings:warnings.length,sources:sources.size,claims:claims.size,nodes:nodes.size,relations:relations.size},errors,warnings,
    spec:{compiled:Boolean(scene),canvas:scene?.canvas??null,consumedPaths:['$.canvas','$.provenance','$.palette','$.fonts','$.assets','$.objects','$.connections','$.groups','$.curveTolerance'],
      arrays:Object.fromEntries(['objects','connections','groups','assets'].map(k=>[k,{path:`$.${k}`,ids:(Array.isArray(spec?.[k])?spec[k]:[]).filter(object).map(x=>x.id)}]))},
    coverage:{nodes:nodeCoverage,relations:relationCoverage,claims:claimCoverage},reviewedArtifacts,nativeChecks,
    limitations:['Checks declared references and bindings, not the truth or evidential adequacy of cited content.','No network requests, source-document reading, automatic layout, visual rendering, or native application testing is performed.','Live-label existence does not establish that the wording semantically matches the planned node.','Digit-bearing text produces review warnings; digits alone cannot establish an empirical claim.']};
}

async function cli(){
  const args=process.argv.slice(2),planPath=args.shift(),specPath=args.shift(),opts={stage:'draft'};
  if(!planPath||!specPath)throw new Error('Usage: node design_audit.mjs plan.json spec.json [--review review.json] [--stage draft|final] [--out NEW.json]');
  for(let i=0;i<args.length;i++){
    const key={'--review':'reviewPath','--stage':'stage','--out':'out'}[args[i]];
    if(!key||!args[i+1])throw new Error(`Unknown or incomplete option ${args[i]}`);opts[key]=args[++i];
  }
  if(opts.out){try{await fs.lstat(opts.out);throw new Error(`Refusing to overwrite existing report: ${opts.out}`);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const plan=JSON.parse(await fs.readFile(planPath,'utf8')),spec=JSON.parse(await fs.readFile(specPath,'utf8'));
  const review=opts.reviewPath?JSON.parse(await fs.readFile(opts.reviewPath,'utf8')):undefined;
  const report=await auditDesign(plan,spec,path.resolve(specPath),{review,stage:opts.stage}),serialized=JSON.stringify(report,null,2)+'\n';
  if(opts.out)await fs.writeFile(opts.out,serialized,{flag:'wx'});else process.stdout.write(serialized);
  if(!report.passed)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(e=>{console.error(e.message);process.exitCode=2;});
