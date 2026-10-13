#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {extractLibrary} from './library_core.mjs';
import {makeLibraryBoards,paletteToAse} from './library_boards.mjs';
import {compileSpec,svgFromScene,sha256} from './spec_core.mjs';
import {exportScenesPptx} from './pptx_backend.mjs';

const args=process.argv.slice(2),input=args.shift(),options={format:'svg'};
for(let i=0;i<args.length;i++){
 const map={'--out':'out','--recipe':'recipe','--format':'format','--runtime-modules':'modules','--python':'python'};
 if(!map[args[i]]||!args[i+1])throw new Error('Unknown/incomplete option: '+args[i]);options[map[args[i]]]=args[++i];
}
if(!input||!options.out||!['svg','both'].includes(options.format))throw new Error('Usage: node build_library.mjs figure-spec.json --out NEW_DIRECTORY [--recipe selections.json] [--format svg|both] [--runtime-modules PATH] [--python PATH]');
const specPath=path.resolve(input),bytes=await fs.readFile(specPath),source=JSON.parse(bytes);
const recipe=options.recipe?JSON.parse(await fs.readFile(options.recipe,'utf8')):{};
const library=await extractLibrary(source,specPath,recipe),out=path.resolve(options.out);
try{await fs.access(out);throw new Error('Output already exists; use a new directory to preserve edits: '+out);}catch(e){if(e.code!=='ENOENT')throw e;}
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'component-library-'));
async function write(file,data){const dest=path.join(tmp,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,data);}
const json=x=>JSON.stringify(x,null,2)+'\n';
try{
 for(const a of library.assets)await write(path.join('specs',a.file),a.data);
 for(const c of library.components){
  const rel='specs/'+c.id+'.json';await write(rel,json(c.spec));
  const compiled=await compileSpec(c.spec,path.join(tmp,rel));
  await write('components/'+c.id+'.svg',svgFromScene(compiled.scene,compiled.assets,{background:false}));
 }
 const boards=makeLibraryBoards(source,library),entries=[];
 for(const b of boards){
  const rel='specs/catalog-'+b.id+'.json';await write(rel,json(b.spec));
  const compiled=await compileSpec(b.spec,path.join(tmp,rel));entries.push(compiled);
  await write('boards/'+b.id+'.svg',svgFromScene(compiled.scene,compiled.assets));
 }
 await write('library.json',json({...library.manifest,sourceSpecSha256:sha256(bytes),boards:boards.map(b=>({id:b.id,kind:b.kind,svg:'boards/'+b.id+'.svg'})),
  delivery:{nativeAssetPanelRegistered:false,nativeSymbolsRegistered:false,nativeGlobalColorBindings:false,ase:'Normal RGB swatches; application import requires verification'}}));
 await write('palette.json',json(library.manifest.palette));await write('text-styles.json',json(library.manifest.textStyles));
 await write('palette.ase',paletteToAse(library.manifest.palette));
 if(options.format==='both'){
  await exportScenesPptx(entries,path.join(tmp,'library.pptx'),options);
  const req=createRequire(import.meta.url),modules=options.modules||process.env.RUNTIME_NODE_MODULES;
  const api=await import(pathToFileURL(req.resolve('@oai/artifact-tool',modules?{paths:[modules]}:undefined)).href);
  const p=await api.PresentationFile.importPptx(await api.FileBlob.load(path.join(tmp,'library.pptx')));
  if(p.slides.items.length!==boards.length)throw new Error('Reimport changed slide count');
  for(let i=0;i<boards.length;i++){
   const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});await write('previews/'+boards[i].id+'.png',new Uint8Array(await blob.arrayBuffer()));
  }
 }
 await write('verification.json',json({sourceSpecSha256:sha256(bytes),components:library.components.length,paletteTokens:library.manifest.palette.length,boardPages:boards.length,
  nativeApplicationTested:false,previewRenderer:options.format==='both'?'Artifact Tool exact-PPTX reimport':null,sourceUnchanged:sha256(await fs.readFile(specPath))===sha256(bytes)}));
 await fs.mkdir(path.dirname(out),{recursive:true});await fs.cp(tmp,out,{recursive:true,errorOnExist:true,force:false});
 console.log(JSON.stringify({out,components:library.components.length,paletteTokens:library.manifest.palette.length,boardPages:boards.length}));
}finally{await fs.rm(tmp,{recursive:true,force:true});}
