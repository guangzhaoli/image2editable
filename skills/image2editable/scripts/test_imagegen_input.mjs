import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {prepareImagegenInput} from './prepare_imagegen_input.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN8AAAAASUVORK5CYII=','base64');
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'imagegen-input-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const plan={schema:'design-plan/v1',brief:{goal:'Synthetic fixture',audience:'Test readers',language:'English',targetApps:['PowerPoint','Illustrator']},
    sources:[{id:'paper',title:'Synthetic content source',role:'content'},{id:'style',title:'Synthetic layout source',role:'style'}],
    claims:[{id:'flow',text:'A feeds B.',status:'supported',required:true,sourceRefs:[{sourceId:'paper',locator:'Synthetic p.1'}]}],
    structure:{nodes:[{id:'a',label:'A',claimRefs:['flow']},{id:'b',label:'B',claimRefs:['flow']}],relations:[{id:'ab',source:'a',target:'b',type:'data flow',claimRefs:['flow']}]},unknowns:['Fixture only; no paper results.']};
  const packet={schema:'imagegen-input/v1',designPlan:'plan.json',useCase:'scientific-educational',designBrief:{request:'Visualize the supplied synthetic relationship.',exactText:['A','B']},references:[]};
  await fs.writeFile(path.join(dir,'ref.png'),png);
  const save=async()=>{await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(plan));await fs.writeFile(path.join(dir,'input.json'),JSON.stringify(packet));return path.join(dir,'input.json');};
  const ref=(id,role='content',delivery='attach')=>({id,role,delivery,sourceId:role==='style'?'style':'paper',locator:'Synthetic figure',path:'ref.png',sha256:sha(png),inspected:true,inspectionNote:'A synthetic 1-pixel fixture, not useful visual reference.',use:role==='style'?'Typography only':'Synthetic object identity',avoidCopy:'No scientific content',preserve:'Keep the synthetic object',reason:'Intentionally omitted fixture'});
  return {dir,plan,packet,save,ref};
}

test('all three stages produce a text-only request without invented image parameters',async t=>{
  const f=await fixture(t);f.packet.designBrief.composition=['Keep evidence central.'];
  f.packet.references=[f.ref('observed-style','style','text-only')];
  const r=await prepareImagegenInput(await f.save());
  assert.equal(r.report.called,false);assert.equal(r.report.status,'prepared');
  assert.equal('referenced_image_paths' in r.toolArguments,false);
  assert.equal('num_last_images_to_include' in r.toolArguments,false);
  assert.ok(r.prompt.includes('Audience: Test readers'));
  assert.ok(r.prompt.includes('Target applications: PowerPoint, Illustrator'));
  assert.ok(r.prompt.includes('A feeds B.'));assert.ok(r.prompt.includes('a -> b'));
  assert.ok(r.prompt.includes('Typography only'));assert.ok(r.prompt.includes('Keep evidence central.'));
  assert.equal(r.report.nonAttached[0].delivery,'text-only');
});
test('actual attachment order matches generated indices after exclusions and edit-target promotion',async t=>{
  const f=await fixture(t);f.packet.transparentBackground=false;f.packet.references=[f.ref('style-image','style'),f.ref('old-excluded','style','exclude'),f.ref('current-target','edit-target'),f.ref('method-image')];
  const r=await prepareImagegenInput(await f.save());
  assert.deepEqual(r.report.images.map(x=>[x.index,x.id]),[[1,'current-target'],[2,'style-image'],[3,'method-image']]);
  assert.deepEqual(r.toolArguments.referenced_image_paths,r.report.images.map(x=>x.path));
  assert.ok(r.prompt.includes('Image 1 [current-target; edit-target]'));assert.ok(r.prompt.includes('Image 2 [style-image; style]'));
  assert.equal(r.prompt.includes('old-excluded'),false);assert.equal(r.report.images.every(x=>x.sha256===sha(png)),true);
});
test('missing attachments fail rather than silently downgrade',async t=>{
  const f=await fixture(t);f.packet.references=[{...f.ref('missing'),path:'does-not-exist.png'}];
  await assert.rejects(prepareImagegenInput(await f.save()),/ENOENT/);
});
test('changed image and changed plan cannot reuse stale hashes',async t=>{
  const f=await fixture(t);f.packet.references=[{...f.ref('stale'),sha256:'0'.repeat(64)}];
  await assert.rejects(prepareImagegenInput(await f.save()),/stale image/);
  f.packet.references=[];f.packet.designPlanSha256='0'.repeat(64);
  await assert.rejects(prepareImagegenInput(await f.save()),/stale plan/);
});
test('style sources cannot supply science facts or content excerpts',async t=>{
  const f=await fixture(t);f.plan.claims[0].sourceRefs=[{sourceId:'style',locator:'Synthetic poster'}];
  await assert.rejects(prepareImagegenInput(await f.save()),/style reference cannot support a fact/);
  f.plan.claims[0].sourceRefs=[{sourceId:'paper',locator:'Synthetic p.1'}];f.packet.excerpts=[{sourceId:'style',locator:'p.1',text:'A borrowed result'}];
  await assert.rejects(prepareImagegenInput(await f.save()),/content source/);
});
test('reference role conflicts and uninspected attachments are rejected',async t=>{
  const f=await fixture(t);f.packet.references=[{...f.ref('wrong-role'),sourceId:'style'}];
  await assert.rejects(prepareImagegenInput(await f.save()),/content-role source/);
  f.packet.references=[{...f.ref('unseen'),inspected:false}];
  await assert.rejects(prepareImagegenInput(await f.save()),/actual inspection/);
});
test('necessary edit targets cannot be replaced by a text-only observation',async t=>{
  const f=await fixture(t);f.packet.references=[f.ref('target','edit-target','text-only')];
  await assert.rejects(prepareImagegenInput(await f.save()),/edit-target must be attached/);
});
test('editing requires an explicit alpha choice instead of silently removing transparency',async t=>{
  const f=await fixture(t);f.packet.references=[f.ref('target','edit-target')];
  await assert.rejects(prepareImagegenInput(await f.save()),/transparentBackground explicitly/);
  f.packet.transparentBackground=true;
  const r=await prepareImagegenInput(await f.save());assert.equal(r.toolArguments.transparent_background,true);
});
test('required content can only be deferred explicitly and relations keep their endpoints',async t=>{
  const f=await fixture(t);f.packet.selection={claimIds:[],nodeIds:[],relationIds:[]};
  await assert.rejects(prepareImagegenInput(await f.save()),/Required claim flow/);
  f.packet.selection.deferredClaims=[{claimId:'flow',reason:'Add the exact scientific text during native reconstruction.'}];
  const r=await prepareImagegenInput(await f.save());assert.ok(r.prompt.includes('retain by: Add the exact scientific text'));
  f.packet.selection={claimIds:['flow'],nodeIds:['a'],relationIds:['ab']};
  await assert.rejects(prepareImagegenInput(await f.save()),/endpoint not selected/);
});
test('PDF and URLs are not treated as image attachments',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.dir,'ref.pdf'),'%PDF-1.7');
  f.packet.references=[{...f.ref('pdf'),path:'ref.pdf'}];
  await assert.rejects(prepareImagegenInput(await f.save()),/render PDF\/SVG first/);
  f.packet.references=[{...f.ref('url'),path:'https://example.test/ref.png'}];
  await assert.rejects(prepareImagegenInput(await f.save()),/local path/);
});
test('CLI writes one prepared request and preserves an existing output directory',async t=>{
  const f=await fixture(t),input=await f.save(),out=path.join(f.dir,'prepared');
  const cli=fileURLToPath(new URL('./prepare_imagegen_input.mjs',import.meta.url));
  const first=spawnSync(process.execPath,[cli,input,'--out',out],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  const original=await fs.readFile(path.join(out,'imagegen-request.json'));
  const report=JSON.parse(await fs.readFile(path.join(out,'input-report.json')));assert.equal(report.requestSha256,sha(original));
  const second=spawnSync(process.execPath,[cli,input,'--out',out],{encoding:'utf8'});assert.notEqual(second.status,0);
  assert.deepEqual(await fs.readFile(path.join(out,'imagegen-request.json')),original);
});

const specPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWMwTpv5HxkzEBQAAI9ZGk0aK+ktAAAAAElFTkSuQmCC','base64');
const cropPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMwTpv5H4QBESsEYzUFeuMAAAAASUVORK5CYII=','base64');
async function visualFixture(f){
  const directory=path.join(f.dir,'visual-package');await fs.mkdir(path.join(directory,'images'),{recursive:true});
  await fs.writeFile(path.join(directory,'images/original.png'),specPng);await fs.writeFile(path.join(directory,'images/crop.png'),cropPng);
  await fs.writeFile(path.join(directory,'visual-spec.html'),'<html><body>Human evidence only</body></html>');
  await fs.writeFile(path.join(directory,'visual-spec-board.png'),specPng);
  const study=Buffer.from(JSON.stringify({schema:'visual-study/v1',intent:'Synthetic visual observations'}));
  await fs.writeFile(path.join(directory,'visual-study.json'),study);
  const reference={...f.ref('spec-style','style'),path:'images/original.png',sha256:sha(specPng)};
  const card={referenceId:reference.id,original:{file:'images/original.png',sha256:sha(specPng),width:4,height:3,format:'png'},regions:[{id:'top-band',label:'Top band',bbox:[0,0,4,1],note:'Declared original-image annotation'}]};
  const spec={schema:'visual-spec/v1',mode:'generate',intent:'Adapt the spacing and measured accent color.',preserve:[],references:[reference],
    observations:[{id:'spacing-note',referenceId:reference.id,aspect:'spacing',finding:'The synthetic image is a flat color patch.',apply:'Use its color within the supplied scientific diagram; keep labels exact.'}],
    palette:[{id:'sampled-blue',name:'Fixture blue',method:'median',hex:'#336699',rgb:[51,102,153],usage:'Accent only',provenance:{kind:'sampled',referenceId:reference.id,box:[0,0,4,3],sourceSha256:sha(specPng),sampleCount:12,ignoredTransparentCount:0,pixelPolicy:'ignore fully transparent pixels'}},
      {id:'declared-coral',method:'declared',hex:'#F07060',rgb:[240,112,96],usage:'Secondary highlight',provenance:{kind:'declared'}}],
    evidence:{cards:[card],htmlFile:'visual-spec.html',boardFile:'visual-spec-board.png'},sourceStudy:{file:'visual-study.json',sha256:sha(study)},limitations:['Fixture observations are author-declared; measured source pixels are not vector fill evidence.']};
  f.packet.visualSpec='visual-package/visual-spec.json';
  const save=async()=>{await fs.writeFile(path.join(directory,'visual-spec.json'),JSON.stringify(spec));return f.save();};
  return {directory,spec,reference,card,save};
}

test('optional visual spec attaches selected actual source images and adds scoped style adaptation',async t=>{
  const f=await fixture(t),v=await visualFixture(f),r=await prepareImagegenInput(await v.save());
  assert.deepEqual(r.report.images.map(x=>[x.index,x.id]),[[1,'spec-style']]);
  assert.deepEqual(r.toolArguments.referenced_image_paths,[await fs.realpath(path.join(v.directory,'images/original.png'))]);
  assert.equal(r.report.visualSpec.sha256,sha(await fs.readFile(path.join(v.directory,'visual-spec.json'))));
  assert.equal(r.report.visualSpec.mode,'generate');assert.match(r.report.visualSpec.analysisBoundary,/not independently reverified/);
  assert.match(r.prompt,/REFERENCE-STYLE ADAPTATION\nMode: generate/);
  assert.match(r.prompt,/spacing-note; reference spec-style; spacing/);assert.match(r.prompt,/measured median from original reference spec-style/);
  assert.match(r.prompt,/RGB \(51, 102, 153\)/);assert.match(r.prompt,/declared design choice/);
  assert.ok(r.prompt.includes('A feeds B.'));assert.ok(r.prompt.includes('TEXT (VERBATIM)\n"A"\n"B"'));
  assert.ok(r.toolArguments.referenced_image_paths.every(p=>!p.includes('visual-spec-board')&&!p.endsWith('.html')));
});
test('restyle promotes the actual target before explicit and spec style inputs and preserves alpha choice',async t=>{
  const f=await fixture(t),v=await visualFixture(f);f.packet.references=[f.ref('explicit-style','style')];f.packet.transparentBackground=true;
  v.spec.mode='restyle';v.spec.preserve=['Keep all factual relationships and visible labels.'];
  const target={...v.reference,id:'spec-target',role:'edit-target',sourceId:'paper',use:'Restyle the supplied target',preserve:'Keep the exact object identity'};
  v.spec.references.push(target);v.spec.evidence.cards.push({...structuredClone(v.card),referenceId:target.id});
  const r=await prepareImagegenInput(await v.save());
  assert.deepEqual(r.report.images.map(x=>[x.index,x.id]),[[1,'spec-target'],[2,'explicit-style'],[3,'spec-style']]);
  assert.match(r.prompt,/Image 1 \[spec-target; edit-target\]/);assert.match(r.prompt,/Preserve target \[spec-target\]: Keep the exact object identity/);
  assert.equal(r.toolArguments.transparent_background,true);
  delete f.packet.transparentBackground;await assert.rejects(prepareImagegenInput(await v.save()),/transparentBackground explicitly/);
});
test('spec source IDs and content/style roles must match the design plan even for excluded images',async t=>{
  const f=await fixture(t),v=await visualFixture(f);v.reference.sourceId='invented';
  await assert.rejects(prepareImagegenInput(await v.save()),/unknown sourceId/);
  v.reference.sourceId='paper';await assert.rejects(prepareImagegenInput(await v.save()),/style-role source/);
  v.reference.delivery='exclude';await assert.rejects(prepareImagegenInput(await v.save()),/style-role source/);
  v.reference.sourceId='style';v.reference.role='content';await assert.rejects(prepareImagegenInput(await v.save()),/content-role source/);
});
test('spec crop-derived references attach the selected crop while observations and palette use original provenance',async t=>{
  const f=await fixture(t),v=await visualFixture(f);
  v.card.crop={file:'images/crop.png',sha256:sha(cropPng),width:2,height:1,box:[1,1,2,1],sourceSha256:sha(specPng),operation:'pixel-crop'};
  v.reference.path='images/crop.png';v.reference.sha256=sha(cropPng);
  const r=await prepareImagegenInput(await v.save());assert.deepEqual(r.toolArguments.referenced_image_paths,[await fs.realpath(path.join(v.directory,'images/crop.png'))]);
  assert.equal(r.report.images[0].sha256,sha(cropPng));assert.match(r.prompt,/source-pixel box \[0,0,4,3\]/);
  v.card.crop.sourceSha256='0'.repeat(64);await assert.rejects(prepareImagegenInput(await v.save()),/stale crop sourceSha256/);
  v.card.crop.sourceSha256=sha(specPng);v.card.crop.box=[3,0,2,1];await assert.rejects(prepareImagegenInput(await v.save()),/outside original source image/);
  v.card.crop.box=[1,1,2,1];v.reference.path='images/original.png';await assert.rejects(prepareImagegenInput(await v.save()),/selected path\/hash/);
});
test('spec package paths, hashes and declared image dimensions are enforced',async t=>{
  const f=await fixture(t),v=await visualFixture(f),originalPath=v.card.original.file;
  v.card.original.file='../ref.png';await assert.rejects(prepareImagegenInput(await v.save()),/path escapes visualSpec package/);
  v.card.original.file=path.join(f.dir,'ref.png');await assert.rejects(prepareImagegenInput(await v.save()),/relative packaged path/);
  v.card.original.file='https://example.test/ref.png';await assert.rejects(prepareImagegenInput(await v.save()),/relative packaged path/);
  await fs.symlink(path.join(f.dir,'ref.png'),path.join(v.directory,'images/escape.png'));
  v.card.original.file='images/escape.png';await assert.rejects(prepareImagegenInput(await v.save()),/symlink escapes/);
  v.card.original.file=originalPath;v.card.original.sha256='0'.repeat(64);await assert.rejects(prepareImagegenInput(await v.save()),/stale image sha256/);
  v.card.original.sha256=sha(specPng);v.card.original.width=5;await assert.rejects(prepareImagegenInput(await v.save()),/dimensions do not match/);
  v.card.original.width=4;v.reference.sha256='0'.repeat(64);await assert.rejects(prepareImagegenInput(await v.save()),/selected path\/hash/);
});
test('view-only board images cannot be selected as automatic spec attachments',async t=>{
  const f=await fixture(t),v=await visualFixture(f);v.card.original.file='visual-spec-board.png';v.reference.path='visual-spec-board.png';
  await assert.rejects(prepareImagegenInput(await v.save()),/view-only board cannot be a reference image/);
});
test('excluded observations are validated but never leak into the adaptation prompt',async t=>{
  const f=await fixture(t),v=await visualFixture(f);
  const excluded={...f.ref('excluded-style','style','exclude')};delete excluded.path;delete excluded.sha256;
  v.spec.references.push(excluded);v.spec.evidence.cards.push({referenceId:excluded.id,regions:[]});
  v.spec.observations.push({id:'exclude-observation',referenceId:excluded.id,aspect:'typography',finding:'SECRET EXCLUDED FINDING',apply:'SECRET EXCLUDED ADAPTATION'});
  const r=await prepareImagegenInput(await v.save());assert.equal(r.prompt.includes('SECRET EXCLUDED'),false);assert.equal(r.report.images.length,1);
  assert.equal(r.report.nonAttached[0].id,excluded.id);
  v.spec.palette[0].provenance.referenceId=excluded.id;await assert.rejects(prepareImagegenInput(await v.save()),/cannot sample an excluded reference/);
});
test('unknown observations, invalid RGB and stale sampled-source provenance fail',async t=>{
  const f=await fixture(t),v=await visualFixture(f);v.spec.observations[0].referenceId='missing';
  await assert.rejects(prepareImagegenInput(await v.save()),/unknown referenceId/);
  v.spec.observations[0].referenceId=v.reference.id;v.spec.palette[0].rgb=[0,0,0];await assert.rejects(prepareImagegenInput(await v.save()),/RGB differs from HEX/);
  v.spec.palette[0].rgb=[51,102,153];v.spec.palette[0].provenance.sourceSha256='0'.repeat(64);await assert.rejects(prepareImagegenInput(await v.save()),/stale sampled sourceSha256/);
  v.spec.palette[0].provenance.sourceSha256=sha(specPng);v.spec.palette[0].provenance.box=[0,0,5,3];await assert.rejects(prepareImagegenInput(await v.save()),/outside original source image/);
});
test('compatible same-ID packet/spec records dedupe by resolved path and conflicting records fail',async t=>{
  const f=await fixture(t),v=await visualFixture(f);f.packet.references=[{...v.reference,path:'visual-package/images/../images/original.png'}];
  const r=await prepareImagegenInput(await v.save());assert.deepEqual(r.report.images.map(x=>x.id),['spec-style']);
  f.packet.references[0].use='A conflicting visual use';await assert.rejects(prepareImagegenInput(await v.save()),/conflicting duplicate/);
  f.packet.references[0].use=v.reference.use;f.packet.references[0].sha256='0'.repeat(64);await assert.rejects(prepareImagegenInput(await v.save()),/conflicting duplicate/);
  f.packet.references=[];v.spec.references.push({...v.reference});await assert.rejects(prepareImagegenInput(await v.save()),/duplicate id spec-style/);
});
test('stale manifest and source-study hashes fail and orphan visualSpecSha256 is rejected',async t=>{
  const f=await fixture(t),v=await visualFixture(f);await v.save();f.packet.visualSpecSha256=sha(await fs.readFile(path.join(v.directory,'visual-spec.json')));
  const accepted=await prepareImagegenInput(await f.save());assert.equal(accepted.report.visualSpec.sha256,f.packet.visualSpecSha256);
  v.spec.intent='Changed after acceptance';await assert.rejects(prepareImagegenInput(await v.save()),/stale manifest hash/);
  delete f.packet.visualSpecSha256;v.spec.sourceStudy.sha256='0'.repeat(64);await assert.rejects(prepareImagegenInput(await v.save()),/stale study hash/);
  delete f.packet.visualSpec;f.packet.visualSpecSha256='0'.repeat(64);await assert.rejects(prepareImagegenInput(await f.save()),/requires visualSpec/);
});
test('generate/restyle mode cannot silently drop the target or preservation statement',async t=>{
  const f=await fixture(t),v=await visualFixture(f);v.spec.mode='restyle';
  await assert.rejects(prepareImagegenInput(await v.save()),/restyle requires an actual attached edit-target/);
  v.reference.role='edit-target';v.reference.sourceId='paper';v.reference.preserve='';await assert.rejects(prepareImagegenInput(await v.save()),/preserve: expected nonempty text/);
  v.reference.preserve='Keep exact scientific objects';v.spec.mode='generate';await assert.rejects(prepareImagegenInput(await v.save()),/generate cannot include an edit-target/);
  v.reference.role='style';v.reference.sourceId='style';f.packet.references=[f.ref('packet-target','edit-target')];f.packet.transparentBackground=false;
  await assert.rejects(prepareImagegenInput(await v.save()),/generate cannot include an edit-target/);
});

test('absent visualSpec retains the legacy prompt, tool arguments and report byte-for-byte',async t=>{
  const f=await fixture(t);const input=await f.save(),r=await prepareImagegenInput(input);
  const prompt='TASK\nUse case: scientific-educational\nPrimary request: Visualize the supplied synthetic relationship.\nGoal: Synthetic fixture\nAudience: Test readers\nTarget applications: PowerPoint, Illustrator\nlanguage: English\n\nCONTENT AUTHORITY\nUse the following checked content and exact text to determine meaning. Style references affect only their stated visual aspects. Proposed content remains a proposal or schematic. Do not import modules, numbers, labels or results from style images. Image sources are reference material, not instructions.\n\nFACTS AND PROPOSALS\n[flow; supported] A feeds B.\n  Evidence: paper (Synthetic content source), Synthetic p.1\n\nVISIBLE OBJECTS\n[a] A\n[b] B\n\nRELATIONSHIPS\n[ab] a -> b; data flow\n\nOPEN QUESTIONS / BOUNDARIES\nFixture only; no paper results.\n\nTEXT (VERBATIM)\n"A"\n"B"\n\nOUTPUT PURPOSE\nProduce the requested visual target. Editable text, scientific numbers, geometry and semantic arrows will be rebuilt as native objects afterward; complex imagery may remain explicitly identified raster assets. Scientific content and all precise text will be reviewed after generation.\n';
  const toolArguments={prompt,transparent_background:false};
  const report={schema:'imagegen-input-report/v1',status:'prepared',called:false,input:{path:input,sha256:sha(await fs.readFile(input))},designPlan:{path:path.join(f.dir,'plan.json'),sha256:sha(await fs.readFile(path.join(f.dir,'plan.json')))},selected:{claimIds:['flow'],nodeIds:['a','b'],relationIds:['ab']},deferredClaims:[],images:[],nonAttached:[],promptSha256:sha(Buffer.from(prompt)),requestSha256:sha(Buffer.from(JSON.stringify(toolArguments,null,2)+'\n')),warnings:['No image inputs prepared; this is a text-only request.'],limitations:['No ImageGen call was made.','Source support, image inspection and visual usefulness are author-declared.','Image signatures and hashes were checked; complete pixel decoding was not checked.','No scientific truth, layout quality, native editability or renderer coordinates are certified.']};
  assert.equal(r.prompt,prompt);assert.equal(JSON.stringify(r.toolArguments,null,2),JSON.stringify(toolArguments,null,2));assert.equal(JSON.stringify(r.report,null,2),JSON.stringify(report,null,2));
});

test('spec original header validation accepts JPEG and WebP and rejects unsupported bytes',async t=>{
  const f=await fixture(t),v=await visualFixture(f);v.spec.palette=[];
  const samples=[['jpeg','/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJAAnHX/2Q=='],['webp','UklGRjgAAABXRUJQVlA4ICwAAADwAQCdASoEAAMAAUAmJaACdLoB+AAETAAA/u+9V/43bjDfgu/33oDeBgAAAA==']];
  for (const [format,base64] of samples) {
    const bytes=Buffer.from(base64,'base64');await fs.writeFile(path.join(v.directory,'images/original.png'),bytes);
    v.card.original.format=format;v.card.original.sha256=sha(bytes);v.reference.sha256=sha(bytes);
    const r=await prepareImagegenInput(await v.save());assert.equal(r.report.images[0].format,format);
  }
  const bytes=Buffer.from('%PDF-1.7 not an image');await fs.writeFile(path.join(v.directory,'images/original.png'),bytes);
  v.card.original.sha256=sha(bytes);v.reference.sha256=sha(bytes);await assert.rejects(prepareImagegenInput(await v.save()),/requires a PNG\/JPEG\/WebP image/);
});
test('optional text-only reference observations remain useful without becoming attachments',async t=>{
  const f=await fixture(t),v=await visualFixture(f);v.spec.palette=[];
  v.reference.delivery='text-only';delete v.reference.path;delete v.reference.sha256;v.spec.evidence.cards=[];
  const r=await prepareImagegenInput(await v.save());assert.equal('referenced_image_paths' in r.toolArguments,false);
  assert.equal(r.report.nonAttached[0].id,v.reference.id);assert.match(r.prompt,/REFERENCE-STYLE ADAPTATION/);assert.match(r.prompt,/spacing-note/);
  v.reference.inspected=false;await assert.rejects(prepareImagegenInput(await v.save()),/actual inspection/);
});
