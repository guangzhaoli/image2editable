import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileSpec,sha256} from './spec_core.mjs';
import {extractLibrary} from './library_core.mjs';

const dir=await fs.mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)),'.library-core-test-'));
let checks=0;
function ok(condition,message){assert.ok(condition,message);checks++;}
function equal(a,b,message){assert.deepEqual(a,b,message);checks++;}
async function rejects(fn,re){await assert.rejects(fn,re);checks++;}
function fixture(){
 const s={schema:'paper-figure-spec/v1',state:'ready',canvas:{width:1000,height:400,unit:'px96',background:'paper'},provenance:{kind:'synthetic',source:'Independent library extraction fixture'},palette:{paper:{hex:'#FFFFFF',evidence:'Synthetic canvas'},ink:{hex:'#123456',evidence:'Synthetic outlines'},blue:{hex:'#DDEEFF',evidence:'Synthetic module'},blueAlias:{hex:'#ddeeff',evidence:'Equal HEX, distinct source token'},orange:{hex:'#FFCCAA',evidence:'Distinct fill'},unused:{hex:'#AABBCC',evidence:'Intentionally unused token'}},fonts:{body:{family:'Arial',evidence:'Synthetic font',native_verified:false},alias:{family:'Arial',evidence:'Equivalent font token'}},assets:[],objects:[],connections:[],groups:[],curveTolerance:0.1};
 for(const [id,x,label,fill,font]of [['a',30,'Encoder','blue','body'],['b',230,'Encoder','blueAlias','alias'],['c',430,'Decoder','blue','body'],['d',630,'Encoder','orange','body']]){
  s.objects.push({id:id+'-box',type:'roundrect',bbox:[x,50,100,80],radius:8,fill,stroke:{color:'ink',width:2},evidence:'Synthetic box'});
  s.objects.push({id:id+'-label',type:'text',bbox:[5,10,90,24],anchor:{object:id+'-box'},text:label,font,size:16,lineHeight:20,align:'center',valign:'middle',color:'ink',z:1,evidence:'Anchored label'});
  s.objects.push({id:id+'-curve',type:'path',bbox:[20,46,60,20],anchor:{object:id+'-box'},commands:[['M',0,10],['C',15,0,40,20,60,10]],fill:'none',stroke:{color:'ink',width:1.5},z:2,evidence:'Anchored cubic detail'});
  s.groups.push({id:id+'-module',children:[id+'-box',id+'-label',id+'-curve'],z:10});
 }
 s.objects.push({id:'note',type:'text',bbox:[30,270,300,40],text:'Live label',font:'body',size:18,lineHeight:22,color:'ink',evidence:'Ungrouped text'});
 s.connections.push({id:'a-to-b',source:{object:'a-box',port:'right'},target:{object:'b-box',port:'left'},stroke:{color:'ink',width:2},arrow:'end',evidence:'Source-bound connection',z:0});
 return s;
}
async function writeCanonical(result,prefix){
 const dest=path.join(dir,prefix);await fs.mkdir(dest);
 for(const a of result.assets){await fs.mkdir(path.dirname(path.join(dest,a.file)),{recursive:true});await fs.writeFile(path.join(dest,a.file),a.data);}
 for(const c of result.components){const file=path.join(dest,c.id+'.json');await fs.writeFile(file,JSON.stringify(c.spec));const {scene}=await compileSpec(c.spec,file);ok(scene.nodes.length>0,'Canonical component compiles independently');ok(c.spec.objects.every(o=>!o.anchor),'All external/local anchors are detached');equal(c.spec.connections,[],'Compiled paths carry no external object relations');}
}
try{
 const spec=fixture(),file=path.join(dir,'source.json');await fs.writeFile(file,JSON.stringify(spec));const before=JSON.stringify(spec),sourceBytes=await fs.readFile(file);
 const library=await extractLibrary(spec,file);
 equal(JSON.stringify(spec),before,'Caller spec stays unchanged');equal(await fs.readFile(file),sourceBytes,'Source file stays unchanged');
 equal(library.manifest.sourceInstanceCount,6);equal(library.manifest.componentCount,5);equal(library.manifest.duplicateInstanceCount,1);
 const repeated=library.manifest.components.find(c=>c.sourceInstanceCount===2);equal(repeated.sourceInstanceIds,['a-module','b-module']);equal(repeated.sourceRoots,[['a-module'],['b-module']]);
 const connection=library.manifest.components.find(c=>c.category==='connection');ok(connection&&connection.fixedConnectionPaths,'Root connection is distinctly classified');
 const canonical=library.components.find(c=>c.id==='a-module').spec;
 equal(canonical.canvas.width,102);equal(canonical.canvas.height,82);equal(canonical.objects.find(o=>o.type==='text').bbox,[6,11,90,24]);
 equal(canonical.objects.find(o=>o.type==='path').commands,[['M',0,10],['C',15,0,40,20,60,10]],'Bezier detail survives extraction');
 ok(canonical.groups.length===1&&canonical.groups[0].children.length===3,'Native group membership preserved');
 const blue=library.manifest.palette.find(p=>p.token==='blue');equal(blue.hex,'#DDEEFF');equal(blue.rgb,[221,238,255]);equal(blue.duplicateHexTokens,['blueAlias']);equal(blue.usage.map(u=>u.id),['a-box','c-box']);
 equal(library.manifest.palette.find(p=>p.token==='unused').usage,[],'Unused palette tokens retained');
 const ink=library.manifest.palette.find(p=>p.token==='ink');equal(ink.usage.length,14,'All object fills/strokes/text and connection uses counted');ok(ink.usage.find(u=>u.id==='a-to-b').derivedNodeIds.includes('a-to-b__end'));
 const style=library.manifest.textStyles.find(x=>x.size===16);equal(style.usageCount,4);equal(style.fontTokens,['body','alias']);
 await writeCanonical(library,'canonical');
 // Invariance to source translation, source ID changes, palette aliases, and font aliases.
 const translated=structuredClone(spec);for(const o of translated.objects)if(!o.anchor){o.bbox[0]+=11;o.bbox[1]+=13;}
 const shifted=await extractLibrary(translated,file);equal(shifted.manifest.components.map(c=>c.fingerprint),library.manifest.components.map(c=>c.fingerprint),'Translation does not alter fingerprints');
 const fractional=structuredClone(spec);for(const o of fractional.objects)if(!o.anchor){o.bbox[0]+=0.123456789123;o.bbox[1]+=0.333333333333;}
 equal((await extractLibrary(fractional,file)).manifest.components.map(c=>c.fingerprint),library.manifest.components.map(c=>c.fingerprint),'Fractional translation noise does not alter fingerprint');
 const tinyChange=structuredClone(spec);tinyChange.objects.find(o=>o.id==='b-curve').bbox[0]+=0.001;equal((await extractLibrary(tinyChange,file)).manifest.componentCount,6,'A 0.001 px local geometry variant remains distinct');
 const precision=structuredClone(spec);precision.objects.find(o=>o.id==='a-box').bbox[2]=100.123456789;const precisionResult=await extractLibrary(precision,file,{components:[{id:'precision',name:'Precision',category:'module',roots:['a-box']}]});equal(precisionResult.components[0].spec.objects[0].bbox[2],100.123456789,'Emitted object dimensions are not fingerprint-quantized');
 const diagonal=structuredClone(spec);diagonal.objects.find(o=>o.id==='b-box').bbox[1]+=17;await writeCanonical(await extractLibrary(diagonal,file),'diagonal');
 const noneToken=structuredClone(spec);noneToken.palette.none={hex:'#EEEEEE',evidence:'Valid palette token named none'};noneToken.canvas.background='none';noneToken.objects.find(o=>o.id==='note').color='none';const noneResult=await extractLibrary(noneToken,file);equal(noneResult.manifest.palette.find(p=>p.token==='none').usage.length,2,'Token named none is tracked in non-transparent color positions');
 const renamed=structuredClone(spec),rename=id=>'renamed-'+id;
 for(const o of renamed.objects){o.id=rename(o.id);if(o.anchor)o.anchor.object=rename(o.anchor.object);}
 for(const g of renamed.groups){g.id=rename(g.id);g.children=g.children.map(rename);}
 for(const c of renamed.connections){c.id=rename(c.id);c.source.object=rename(c.source.object);c.target.object=rename(c.target.object);}
 const relabeledIds=await extractLibrary(renamed,file);equal(relabeledIds.manifest.components.map(c=>c.fingerprint),library.manifest.components.map(c=>c.fingerprint),'Source IDs excluded from visual fingerprints');
 const affine=structuredClone(spec);affine.provenance.reference_to_canvas=[2,0,0,2,30,40];const affineOut=await extractLibrary(affine,file,{components:[{id:'affine',name:'Affine',category:'module',roots:['a-module']}]});equal(affineOut.components[0].spec.provenance.reference_to_canvas,[2,0,0,2,1,-9],'Reference mapping follows normalized extraction origin');
 const nested=structuredClone(spec);nested.groups.push({id:'pair-group',children:['a-module','b-module'],z:20});const nestedOut=await extractLibrary(nested,file,{components:[{id:'nested',name:'Nested',category:'group',roots:['pair-group']}]});equal(nestedOut.components[0].spec.groups.length,3);await writeCanonical(nestedOut,'nested');
 const changed=structuredClone(spec);changed.objects.find(o=>o.id==='b-label').text='Changed';
 const changedLibrary=await extractLibrary(changed,file);equal(changedLibrary.manifest.componentCount,6,'Changed label must not deduplicate');
 const recolored=structuredClone(spec);recolored.palette.blueAlias.hex='#DDDEFF';equal((await extractLibrary(recolored,file)).manifest.componentCount,6,'Changed color must not deduplicate');
 // Explicit selection detaches a child anchor even when its source module is absent.
 const explicit=await extractLibrary(spec,file,{components:[{id:'detached-label',name:'Detached live text',roots:['a-label'],category:'label'},{id:'external-route',name:'Standalone route',roots:['a-to-b'],category:'connection'}]});
 equal(explicit.components[0].spec.objects[0].bbox,[0,0,90,24]);await writeCanonical(explicit,'explicit');
 const multi=await extractLibrary(spec,file,{components:[{id:'pair',name:'Two modules',roots:['a-module','b-module'],category:'module-pair'}]});equal(multi.components[0].spec.groups.length,2);equal(multi.components[0].spec.objects.length,6);await writeCanonical(multi,'pair');
 const reused=await extractLibrary(spec,file,{components:[{id:'whole',name:'Whole',roots:['a-module'],category:'module'},{id:'label-only',name:'Text',roots:['a-label'],category:'label'}]});equal(reused.manifest.sourceInstanceCount,2,'Cross-component reuse is intentional and supported');
 for(const options of [null,[],{extra:true}])await rejects(()=>extractLibrary(spec,file,options),/options/);
 await rejects(()=>extractLibrary(spec,file,{components:[]}),/nonempty/);
 await rejects(()=>extractLibrary(spec,file,{components:[{id:'x',name:'X',category:'module',roots:[]}]}),/nonempty/);
 await rejects(()=>extractLibrary(spec,file,{components:[{id:'x',name:'X',category:'module',roots:['missing']}]}),/missing root/);
 await rejects(()=>extractLibrary(spec,file,{components:[{id:'x',name:'X',category:'module',roots:['a-module','a-label']}]}),/overlapping/);
 await rejects(()=>extractLibrary(spec,file,{components:[{id:'x',name:'X',category:'module',roots:['a-label','a-module']}]}),/overlapping/);
 await rejects(()=>extractLibrary(spec,file,{components:[{id:'x',name:'X',category:'module',roots:['a-label','a-label']}]}),/overlapping/);
 await rejects(()=>extractLibrary(spec,file,{components:[{id:'x',name:'X',category:'module',roots:['a-label']},{id:'x',name:'Y',category:'module',roots:['b-label']}]}),/duplicate selection/);
 await rejects(()=>extractLibrary(spec,file,{components:[{id:'x',name:'',category:'module',roots:['a-label']}]}),/nonempty/);
 await rejects(()=>extractLibrary(spec,file,{components:[{id:'x',name:'X',category:'module',roots:['a-label'],typo:1}]}),/unsupported field/);
 // Verified local asset bytes are preserved and copied once under a canonical shared path.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64'),assetSpec=fixture();await fs.writeFile(path.join(dir,'pixel.png'),png);
 assetSpec.assets=[{id:'pixel',file:'pixel.png',sha256:sha256(png),role:'content',source:'Synthetic single pixel, not a photograph'}];
 assetSpec.objects.push({id:'img-a',type:'image',bbox:[810,50,20,20],asset:'pixel',fit:'contain',evidence:'Synthetic asset fixture'},{id:'img-b',type:'image',bbox:[850,50,20,20],asset:'pixel',fit:'contain',evidence:'Translated asset fixture'});
 const withAssets=await extractLibrary(assetSpec,file);equal(withAssets.assets.length,1);equal(Buffer.from(withAssets.assets[0].data),png);ok(withAssets.assets[0].file.startsWith('assets/'));equal(withAssets.manifest.components.find(c=>c.containsImages).sourceInstanceCount,2);await writeCanonical(withAssets,'with-assets');
 const corrupt=structuredClone(assetSpec);corrupt.assets[0].sha256='0'.repeat(64);await rejects(()=>extractLibrary(corrupt,file),/SHA256 mismatch/);
 equal(JSON.stringify(spec),before,'All operations leave original input untouched');
 console.log(JSON.stringify({status:'pass',checks,coverage:['canonical independent compilation','source immutability','translation and ID invariance','text and color sensitivity','palette aliases and all usages','text styles','anchor detachment','fixed paths','group preservation','explicit disjoint roots','invalid selections','verified asset preservation']}));
}finally{await fs.rm(dir,{recursive:true,force:true});}
