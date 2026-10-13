#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {auditDesign} from './design_audit.mjs';
import {sha256,compileSpec,svgFromScene} from './spec_core.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'design-audit-test-')),passed=[];
const specPath=path.join(tmp,'spec.json'),planPath=path.join(tmp,'plan.json'),reviewPath=path.join(tmp,'review.json');
const base=JSON.parse(await fs.readFile(path.join(here,'../assets/example-spec.json'),'utf8'));
const plan={schema:'design-plan/v1',kind:'framework',brief:{goal:'Explain an explicitly proposed three-stage workflow',audience:'Researchers',targetApps:['PowerPoint','SVG']},
 sources:[{id:'brief',title:'User workflow request',uri:'user:brief',role:'content',kind:'user'},{id:'style-paper',title:'Visual inspiration only',uri:'https://example.invalid/style',role:'style',kind:'paper'}],
 claims:[{id:'workflow',text:'Input flows through an encoder into output',status:'user-provided',sourceRefs:[{sourceId:'brief',locator:'Requested workflow'}],required:true}],
 structure:{nodes:[{id:'in',label:'Input stage',claimRefs:['workflow']},{id:'enc',label:'Encoding stage',claimRefs:['workflow']},{id:'out',label:'Output stage',claimRefs:['workflow']}],relations:[{id:'first',source:'in',target:'enc',type:'data flow',claimRefs:['workflow']},{id:'second',source:'enc',target:'out',type:'data flow',claimRefs:['workflow']}]},
 references:[{sourceId:'style-paper',figure:'Figure 1',inspected:true,lessons:['Use clear arrow routing'],avoidCopy:['Do not reuse scientific claims']}],
 design:{alternatives:[{id:'row',description:'A horizontal workflow'},{id:'column',description:'A vertical workflow'}],chosen:'row',rationale:'Matches reading order'},
 bindings:{nodes:[{nodeId:'in',shapeId:'input',objectIds:['input-label']},{nodeId:'enc',shapeId:'encoder',objectIds:['encoder-label']},{nodeId:'out',shapeId:'output',objectIds:['output-label']}],relations:[{relationId:'first',connectionId:'input-to-encoder'},{relationId:'second',connectionId:'encoder-to-output'}],claims:[{claimId:'workflow',objectIds:['input-label','encoder-label','output-label']}]},unknowns:[]};
const clone=structuredClone;
async function writeSpec(spec=base){await fs.writeFile(specPath,JSON.stringify(spec,null,2)+'\n');}
async function check(name,fn){await fn();passed.push(name);}
async function failure(name,mutate,code,{spec=base,review,stage='draft'}={}){
 await check(name,async()=>{const p=clone(plan),s=clone(spec),r=review?clone(review):undefined;mutate(p,s,r);await writeSpec(s);const result=await auditDesign(p,s,specPath,{review:r,stage});assert.equal(result.passed,false,JSON.stringify(result));assert(result.errors.some(e=>e.code===code),JSON.stringify(result.errors));});
}
try{
 await writeSpec();
 await check('positive framework validates abbreviations and associated live labels without mutations',async()=>{
  const p=clone(plan),s=clone(base),pBefore=JSON.stringify(p),sBefore=JSON.stringify(s),bytes=await fs.readFile(specPath);
  const r=await auditDesign(p,s,specPath);assert.equal(r.passed,true,JSON.stringify(r.errors));assert.equal(r.specSha256,sha256(bytes));assert.equal(r.nativeChecks.status,'not-checked');
  assert.equal(JSON.stringify(p),pBefore);assert.equal(JSON.stringify(s),sBefore);assert.deepEqual(await fs.readFile(specPath),bytes);
 });
 await check('positive poster allows no relations and text as primary shape',async()=>{
  const p=clone(plan);p.kind='poster';p.structure.nodes=[{id:'title',label:'Workflow overview',claimRefs:['workflow']}];p.structure.relations=[];
  p.bindings.nodes=[{nodeId:'title',shapeId:'caption',objectIds:[]}];p.bindings.relations=[];p.bindings.claims=[{claimId:'workflow',objectIds:['caption']}];
  assert((await auditDesign(p,base,specPath)).passed);
 });
 await check('proposed claims can omit citations',async()=>{const p=clone(plan);p.claims[0].status='proposed';p.claims[0].sourceRefs=[];assert((await auditDesign(p,base,specPath)).passed);});
 await failure('required claim must bind visible authored objects',p=>p.bindings.claims=[],'missing_required_claim_coverage');
 await failure('required claim cannot bind unknown objects',p=>p.bindings.claims[0].objectIds=['missing'],'missing_required_claim_coverage');
 await failure('style-only sources cannot support factual claims',p=>p.claims[0].sourceRefs=[{sourceId:'style-paper',locator:'Figure 1'}],'missing_content_support');
 await failure('unsupported numeric fact fails for absent citation, not its digits',p=>{p.claims[0].text='Accuracy is 99.9%';p.claims[0].status='supported';p.claims[0].sourceRefs=[];},'missing_content_support');
 await failure('source references need locators',p=>p.claims[0].sourceRefs[0].locator='','missing_content_support');
 await failure('unknown source ID fails',p=>p.claims[0].sourceRefs[0].sourceId='missing','unresolved_source');
 await failure('duplicate semantic node IDs fail',p=>p.structure.nodes[1].id='in','duplicate_id');
 await failure('all nodes must be mapped',p=>p.bindings.nodes.pop(),'missing_node_binding');
 await failure('all relations must be mapped',p=>p.bindings.relations.pop(),'missing_relation_binding');
 await failure('reversed connection endpoints fail',(_,s)=>{const c=s.connections[0];[c.source,c.target]=[c.target,c.source];},'relation_direction_mismatch');
 await failure('backward-only arrow fails',(_,s)=>s.connections[0].arrow='start','relation_arrow_mismatch');
 await failure('undeclared reverse arrow fails',(_,s)=>s.connections[0].arrow='both','relation_arrow_mismatch');
 await check('explicit bidirectional relation accepts both arrowheads',async()=>{const p=clone(plan),s=clone(base);p.structure.relations[0].bidirectional=true;s.connections[0].arrow='both';await writeSpec(s);const r=await auditDesign(p,s,specPath);assert(r.passed,JSON.stringify(r.errors));});
 await failure('declared bidirectional relation requires both arrowheads',p=>p.structure.relations[0].bidirectional=true,'relation_arrow_mismatch');
 await failure('bidirectional declaration must be boolean',p=>p.structure.relations[0].bidirectional='true','invalid_bidirectional');
 await check('extra canonical connection warns without failing semantic audit',async()=>{const p=clone(plan);p.structure.relations.pop();p.bindings.relations.pop();await writeSpec();const r=await auditDesign(p,base,specPath);assert(r.passed,JSON.stringify(r.errors));assert(r.warnings.some(e=>e.code==='unbound_spec_connection'&&e.path==='spec.connections.encoder-to-output'));});

 await failure('node must have an associated live label',p=>p.bindings.nodes[0].objectIds=[],'missing_live_label');
 await check('text-free proposed graphic passes with explicit live-label opt-out and warning',async()=>{
  const p=clone(plan),s=clone(base);p.kind='graphic';p.claims[0]={id:'workflow',text:'A proposed abstract curve motif',status:'proposed',sourceRefs:[],required:true};
  p.structure={nodes:[{id:'motif',label:'Abstract curve motif',claimRefs:['workflow'],requiresLiveLabel:false}],relations:[]};
  p.bindings={nodes:[{nodeId:'motif',shapeId:'curve',objectIds:[]}],relations:[],claims:[{claimId:'workflow',objectIds:['curve']}]};
  s.objects=s.objects.filter(o=>o.id==='curve');s.connections=[];s.groups=[];await writeSpec(s);
  const r=await auditDesign(p,s,specPath);assert(r.passed,JSON.stringify(r.errors));assert(r.warnings.some(e=>e.code==='live_label_opt_out'));
  assert.equal(r.coverage.nodes[0].requiresLiveLabel,false);assert.equal(r.coverage.nodes[0].hasLiveLabel,false);
 });
 await failure('default unlabeled framework remains invalid',p=>{delete p.structure.nodes[0].requiresLiveLabel;p.bindings.nodes[0].objectIds=[];},'missing_live_label');
 await failure('live-label opt-out requires a boolean',p=>p.structure.nodes[0].requiresLiveLabel='false','invalid_live_label_requirement');

 await failure('unknown claim in structure fails',p=>p.structure.nodes[0].claimRefs=['missing'],'unresolved_reference');
 await failure('invalid canonical spec cannot pass audit',(_,s)=>s.objects[0].bbox[0]=-100,'invalid_spec');
 await check('unbound numeric labels warn without inventing a factual failure',async()=>{const s=clone(base);s.objects.find(o=>o.id==='caption').text='Panel 1 · 2026';await writeSpec(s);const r=await auditDesign(plan,s,specPath);assert(r.passed);assert(r.warnings.some(e=>e.code==='unbound_numeric_text'));});
 await check('in-memory spec cannot borrow a different file hash',async()=>{await writeSpec();const s=clone(base);s.objects.find(o=>o.id==='caption').text='Changed';const r=await auditDesign(plan,s,specPath);assert(r.errors.some(e=>e.code==='spec_input_mismatch'));});
 await writeSpec();const {scene,assets}=await compileSpec(base,specPath);const svg=svgFromScene(scene,assets);await fs.writeFile(path.join(tmp,'figure.svg'),svg);
 const review={schema:'design-review/v1',specSha256:sha256(await fs.readFile(specPath)),findings:[],checks:Object.fromEntries(['semantic','visual','editability'].map(k=>[k,{status:'pass',evidence:`Reviewer inspected ${k} against the brief and rendered output.`}])),artifacts:[{path:'figure.svg',kind:'svg',sha256:sha256(Buffer.from(svg))}]};
 await check('final review passes with exact spec/output hashes and disclosed untested native app',async()=>{const r=await auditDesign(plan,base,specPath,{review,stage:'final'});assert(r.passed,JSON.stringify(r.errors));assert.equal(r.nativeChecks.status,'not-checked');assert.equal(r.reviewedArtifacts.length,1);});
 await failure('final stage requires review',()=>{},'missing_final_review',{stage:'final'});
 await failure('stale spec review hash fails',(_,__,r)=>r.specSha256='0'.repeat(64),'stale_review',{review,stage:'final'});
 await check('raw-byte formatting change invalidates previous review',async()=>{await fs.writeFile(specPath,JSON.stringify(base));const r=await auditDesign(plan,base,specPath,{review,stage:'final'});assert(r.errors.some(e=>e.code==='stale_review'));});
 await failure('unresolved major finding blocks final',(_,__,r)=>r.findings=[{severity:'major',resolved:false,message:'Wrong interpretation'}],'unresolved_review_finding',{review,stage:'final'});
 await failure('unresolved blocking finding blocks final',(_,__,r)=>r.findings=[{severity:'blocking',resolved:false}],'unresolved_review_finding',{review,stage:'final'});
 await failure('review pass needs evidence',(_,__,r)=>r.checks.visual.evidence='','missing_text',{review,stage:'final'});
 await failure('visual review cannot be pending at final',(_,__,r)=>r.checks.visual.status='not-checked','review_check_not_passed',{review,stage:'final'});
 await failure('final review requires reviewed output',(_,__,r)=>r.artifacts=[],'missing_review_artifacts',{review,stage:'final'});
 await failure('stale reviewed artifact hash fails',(_,__,r)=>r.artifacts[0].sha256='0'.repeat(64),'stale_review_artifact',{review,stage:'final'});
 await failure('missing reviewed artifact fails',(_,__,r)=>r.artifacts[0].path='missing.svg','missing_review_artifact',{review,stage:'final'});
 await failure('artifact kind mismatch fails',(_,__,r)=>r.artifacts[0].kind='pptx','invalid_artifact_kind',{review,stage:'final'});
 await check('artifact traversal and symlink escapes are rejected',async()=>{
  await writeSpec();const external=path.join(path.dirname(tmp),path.basename(tmp)+'-outside.svg');await fs.writeFile(external,svg);
  try{
   const r=clone(review);r.artifacts[0].path=path.relative(tmp,external);
   let a=await auditDesign(plan,base,specPath,{review:r,stage:'final'});assert(a.errors.some(e=>e.code==='artifact_path_escape'));
   await fs.symlink(external,path.join(tmp,'outside-link.svg'));r.artifacts[0].path='outside-link.svg';
   a=await auditDesign(plan,base,specPath,{review:r,stage:'final'});assert(a.errors.some(e=>e.code==='artifact_path_escape'));
  }finally{await fs.rm(external,{force:true});}
 });
 await check('malformed canonical object arrays return a failing report',async()=>{
  const s=clone(base);s.objects=[null];await writeSpec(s);const a=await auditDesign(plan,s,specPath);assert.equal(a.passed,false);assert(a.errors.some(e=>e.code==='invalid_spec'));await writeSpec();
 });
 await check('resolved major findings and open minor notes allow final',async()=>{await writeSpec();const r=clone(review);r.findings=[{severity:'major',resolved:true},{severity:'minor',resolved:false}];const a=await auditDesign(plan,base,specPath,{review:r,stage:'final'});assert(a.passed);assert(a.warnings.some(e=>e.code==='open_review_finding'));});
 await check('native status remains separate and reviewer-declared',async()=>{const r=clone(review);r.nativeChecks={status:'fail',evidence:'Font substitution observed in target app.'};const a=await auditDesign(plan,base,specPath,{review:r,stage:'final'});assert(a.passed);assert.equal(a.nativeChecks.status,'fail');assert(a.warnings.some(e=>e.code==='native_not_passed'));});
 await check('CLI writes new report and refuses overwriting report or any input',async()=>{
  await writeSpec();await fs.writeFile(planPath,JSON.stringify(plan));await fs.writeFile(reviewPath,JSON.stringify(review));
  const out=path.join(tmp,'audit.json'),cmd=[path.join(here,'design_audit.mjs'),planPath,specPath,'--review',reviewPath,'--stage','final'];
  let p=spawnSync(process.execPath,[...cmd,'--out',out],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert(JSON.parse(await fs.readFile(out,'utf8')).passed);
  for(const f of [out,planPath,specPath,reviewPath]){const bytes=await fs.readFile(f);p=spawnSync(process.execPath,[...cmd,'--out',f],{encoding:'utf8'});assert.equal(p.status,2);assert.match(p.stderr,/overwrite/);assert.deepEqual(await fs.readFile(f),bytes);}
 });
 console.log(JSON.stringify({passed:passed.length,checks:passed,networkUsed:false,nativeApplicationTested:false},null,2));
}finally{await fs.rm(tmp,{recursive:true,force:true});}
