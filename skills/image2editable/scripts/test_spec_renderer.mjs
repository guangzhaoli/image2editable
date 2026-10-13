#!/usr/bin/env node
// Behavioral regressions for the single-input contract. Optional native-package tests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {compileSpec,svgFromScene,sha256} from './spec_core.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const original=JSON.parse(await fs.readFile(path.join(here,'../assets/example-spec.json'),'utf8'));
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'spec-regression-'));
const specPath=path.join(tmp,'figure-spec.json'),passed=[];
const clone=x=>structuredClone(x);
async function rejects(name,mutate,regex){const s=clone(original);mutate(s);await assert.rejects(()=>compileSpec(s,specPath),regex);passed.push(name);}
try{
  const a=await compileSpec(original,specPath),b=await compileSpec(clone(original),specPath);
  assert.deepEqual(a.scene,b.scene);assert.equal(svgFromScene(a.scene,a.assets),svgFromScene(b.scene,b.assets));passed.push('deterministic scene and SVG replay');
  const changed=clone(original);changed.objects.find(x=>x.id==='encoder').bbox[0]+=20;changed.objects.find(x=>x.id==='encoder').bbox[1]+=12;
  changed.objects.find(x=>x.id==='encoder-label').text='Backbone';changed.palette.blue.hex='#C7E7D9';
  const c=await compileSpec(changed,specPath),map=x=>Object.fromEntries(x.scene.nodes.map(n=>[n.id,n]));
  const old=map(a),now=map(c);
  assert.deepEqual(now['encoder-label'].bbox,[old['encoder-label'].bbox[0]+20,old['encoder-label'].bbox[1]+12,...old['encoder-label'].bbox.slice(2)]);
  assert.equal(now['encoder-label'].text,'Backbone');assert.equal(now.encoder.fill,'#C7E7D9');
  assert.deepEqual(c.scene.connections.find(x=>x.id==='input-to-encoder').resolvedPoints.at(-1),[250,120]);
  assert.deepEqual(c.scene.connections.find(x=>x.id==='encoder-to-output').resolvedPoints[0],[410,120]);
  for(const id of ['input','input-label','output','output-label','curve','caption','caption-bottom'])assert.deepEqual(now[id],old[id]);
  const svg=svgFromScene(c.scene,c.assets);assert(svg.includes('Backbone')&&svg.includes('#C7E7D9')&&svg.includes('x="250"'));
  passed.push('one spec edit updates position, anchored text, color and both endpoint routes; unrelated objects unchanged');
  await rejects('partial spec rejected',s=>s.state='draft',/ready/);
  await rejects('legacy measurement schema rejected',s=>s.schema='paper-figure-replica.spec.v2',/Unsupported schema/);
  await rejects('missing object ID rejected',s=>delete s.objects[0].id,/Invalid or duplicate ID/);
  await rejects('duplicate object ID rejected',s=>s.objects[1].id=s.objects[0].id,/duplicate ID/);
  await rejects('unknown style field rejected',s=>s.objects[0].fiil='blue',/unsupported field/);
  await rejects('unknown palette token rejected',s=>s.objects[0].fill='typo',/unknown palette/);
  await rejects('nonfinite geometry rejected',s=>s.objects[0].bbox[0]=NaN,/finite number/);
  await rejects('out-of-canvas geometry rejected',s=>s.objects[0].bbox[0]=-2,/outside canvas/);
  await rejects('unresolved endpoint rejected',s=>s.connections[0].target.object='missing',/unresolved/);
  await rejects('unknown port rejected',s=>s.connections[0].source.port='top-center',/invalid port/);
  await rejects('anchor cycle rejected',s=>s.objects[0].anchor={object:'input-label'},/Anchor cycle/);
  await rejects('group cycle rejected',s=>{s.groups=[{id:'g1',children:['g2']},{id:'g2',children:['g1']}];},/Group cycle/);
  await rejects('multiple group ownership rejected',s=>s.groups.push({id:'another',children:['input']}),/multiple parents/);
  await rejects('text overflow declared height rejected',s=>s.objects.find(x=>x.id==='input-label').text='a\nb\nc',/exceed text bbox/);
  await rejects('unsupported path rejected',s=>s.objects.find(x=>x.id==='curve').commands=[['M',0,0],['A',1,2,3]],/invalid path/);
  await rejects('XML text injection escaped or rejected',s=>s.objects.find(x=>x.id==='caption').text='bad\u0001',/invalid XML/);
  const escaped=clone(original);escaped.objects.find(x=>x.id==='caption').text='<tag>&';
  const es=await compileSpec(escaped,specPath);assert(svgFromScene(es.scene,es.assets).includes('&lt;tag&gt;&amp;'));passed.push('XML metacharacters escaped');
  // Hash checks and directory confinement use an inert two-color test PNG, not any user file.
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAIAAAAiZtkUAAAAGklEQVR4nGO8bJHEAAae5g4QBhOEQgbECQEAnDgCNTAjgsEAAAAASUVORK5CYII=','base64');
  await fs.writeFile(path.join(tmp,'tile.png'),png);
  const assetSpec=clone(original);assetSpec.assets=[{id:'tile',file:'tile.png',sha256:sha256(png),role:'content',source:'Synthetic two-color regression fixture'}];
  assetSpec.objects.push({id:'image',type:'image',bbox:[10,190,30,30],asset:'tile',fit:'contain',evidence:'Synthetic asset test',z:20});
  await compileSpec(assetSpec,specPath);passed.push('content asset SHA256 accepted');
  const wrong=clone(assetSpec);wrong.assets[0].sha256='0'.repeat(64);await assert.rejects(()=>compileSpec(wrong,specPath),/SHA256 mismatch/);passed.push('tampered asset rejected');
  const ref=clone(assetSpec);ref.assets[0].role='reference';await assert.rejects(()=>compileSpec(ref,specPath),/reference asset cannot/);passed.push('reference underlay excluded from final');
  const outside=path.join(os.tmpdir(),'outside-'+path.basename(tmp)+'.png');await fs.writeFile(outside,png);
  try{const escape=clone(assetSpec);escape.assets[0].file=path.relative(tmp,outside);await assert.rejects(()=>compileSpec(escape,specPath),/leaves spec directory/);passed.push('asset path escape rejected');}finally{await fs.unlink(outside);}
  const curve=old.curve;assert(curve.commands.some(x=>x[0]==='C')&&curve.flatCommands.every(x=>['M','L','Z'].includes(x[0])));assert(curve.flatCommands.length>curve.commands.length);passed.push('curves preserved in SVG and tessellated for native paths');
  const poly=curve.flatCommands.filter(x=>x[0]!=='Z').map(x=>x.slice(1));
  function segmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy;const t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
  let deviation=0;
  for(let i=0;i<=1000;i++){
    const t=i/1000,u=1-t;
    const points=[[u**3*0+3*u*u*t*20+3*u*t*t*40+t**3*60,u**3*25+3*u*u*t*0+3*u*t*t*45+t**3*20],[u*u*60+2*u*t*80+t*t*100,u*u*20+2*u*t*0+t*t*25]];
    for(const p of points)deviation=Math.max(deviation,Math.min(...poly.slice(1).map((v,j)=>segmentDistance(p,poly[j],v))));
  }
  assert(deviation<=original.curveTolerance+.00001);passed.push('sampled quadratic/cubic deviation remains within declared tolerance');
  if(process.argv.includes('--pptx')){
    const run=(source,out)=>execFileSync(process.execPath,[path.join(here,'render_figure.mjs'),source,'--out',out,'--format','both'],{env:process.env,stdio:'pipe'});
    const baseFile=path.join(tmp,'base.json'),changedFile=path.join(tmp,'changed.json');
    await fs.writeFile(baseFile,JSON.stringify(original));await fs.writeFile(changedFile,JSON.stringify(changed));
    const p1=path.join(tmp,'base'),p2=path.join(tmp,'changed');run(baseFile,p1);run(changedFile,p2);
    const code=`import sys,zipfile,xml.etree.ElementTree as E\nns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}\ndef inspect(f):\n with zipfile.ZipFile(f) as z:\n  e=E.fromstring(z.read('ppt/slides/slide1.xml'))\n  assert len(e.findall('.//p:grpSp',ns))==5\n  assert len(e.findall('.//p:pic',ns))==0\n  assert len(e.findall('.//p:sp',ns))==13\n  items={}\n  for s in e.findall('.//p:sp',ns):\n   name=s.find('p:nvSpPr/p:cNvPr',ns).get('name')\n   items[name]=s\n   for volatile in s.iter():\n    if volatile.tag=='{http://schemas.microsoft.com/office/drawing/2014/main}creationId': volatile.set('id','VOLATILE_CREATION_GUID')\n  return items\na,b=inspect(sys.argv[1]),inspect(sys.argv[2])\nassert ''.join(b['encoder-label'].itertext()).find('Backbone')>=0\nassert b['encoder'].find('.//a:xfrm/a:off',ns).get('x')==str(250*9525)\nassert b['encoder'].find('.//a:xfrm/a:off',ns).get('y')==str(92*9525)\nassert b['encoder'].find('p:spPr/a:solidFill/a:srgbClr',ns).get('val')=='C7E7D9'\nfor id in ['input','input-label','output','output-label','curve','caption','caption-bottom']: assert E.tostring(a[id])==E.tostring(b[id]),id\nprint('Native objects, group counts, units, intended edits and unchanged objects verified')`;
    execFileSync(process.env.RUNTIME_PYTHON||'python3',['-c',code,path.join(p1,'figure.pptx'),path.join(p2,'figure.pptx')],{stdio:'pipe'});
    passed.push('PPTX live text/shapes/groups, px→EMU, exact intended edits and unrelated OOXML stable excluding creation GUIDs');
    assert.throws(()=>run(baseFile,p1));passed.push('existing output directory protected');
    // Exercise the image backend and naming/grouping path with real image bytes.
    await fs.writeFile(specPath,JSON.stringify(assetSpec));run(specPath,path.join(tmp,'asset'));
    passed.push('local raster asset embedded in native PPTX and SVG');
  }
  console.log(JSON.stringify({passed:passed.length,checks:passed,nativeApplicationTested:false},null,2));
}finally{await fs.rm(tmp,{recursive:true,force:true});}
