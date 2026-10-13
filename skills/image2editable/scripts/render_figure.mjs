#!/usr/bin/env node
// The JSON spec is the only source of diagram coordinates, text and styles.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {compileSpec,svgFromScene,sha256} from './spec_core.mjs';
import {exportScenesPptx} from './pptx_backend.mjs';

const args=process.argv.slice(2),input=args.shift();
const opts={format:'svg',python:process.env.RUNTIME_PYTHON||'python3'};
for(let i=0;i<args.length;i++){
  const k=args[i];
  if(k==='--check'){opts.check=true;continue;}
  if(k==='--transparent-svg'){opts.transparentSvg=true;continue;}
  const map={'--out':'out','--format':'format','--runtime-modules':'modules','--python':'python'};
  if(!map[k]||!args[i+1])throw new Error(`Unknown or incomplete option ${k}`);
  opts[map[k]]=args[++i];
}
if(!input||(!opts.check&&!opts.out)||!['svg','pptx','both'].includes(opts.format)){
  console.error('Usage: node render_figure.mjs figure-spec.json --check\n       node render_figure.mjs figure-spec.json --out NEW_DIRECTORY --format svg|pptx|both [--runtime-modules NODE_MODULES] [--python PYTHON]');process.exit(2);
}
const specPath=path.resolve(input),bytes=await fs.readFile(specPath),spec=JSON.parse(bytes);
const {scene,assets}=await compileSpec(spec,specPath);
scene.specSha256=sha256(bytes);
if(opts.check){console.log(JSON.stringify({valid:true,objects:spec.objects.length,connections:scene.connections.length,specSha256:scene.specSha256}));process.exit(0);}
const out=path.resolve(opts.out);
try{await fs.access(out);throw new Error(`Output directory already exists: ${out}. Use a new directory to preserve native edits.`);}catch(e){if(e.code!=='ENOENT')throw e;}
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'paper-figure-render-'));
let promoted=false;
try{
  await fs.writeFile(path.join(tmp,'resolved-scene.json'),JSON.stringify(scene,null,2)+'\n');
  if(opts.format!=='pptx')await fs.writeFile(path.join(tmp,'figure.svg'),svgFromScene(scene,assets,{background:!opts.transparentSvg}));
  if(opts.format!=='svg'){
    await exportScenesPptx([{scene,assets}],path.join(tmp,'figure.pptx'),{
      modules:opts.modules,python:opts.python,previewPaths:[path.join(tmp,'figure.pptx.png')],
    });
  }
  const files={};for(const file of (await fs.readdir(tmp)).sort())files[file]=sha256(await fs.readFile(path.join(tmp,file)));
  await fs.writeFile(path.join(tmp,'render-manifest.json'),JSON.stringify({schema:'paper-figure-render/v1',specSha256:scene.specSha256,format:opts.format,files,
    transparentSvg:!!opts.transparentSvg,nativeAppValidated:false,previewRenderer:opts.format==='svg'?null:'Artifact Tool exact-PPTX reimport',limitations:scene.limitations},null,2)+'\n');
  await fs.mkdir(path.dirname(out),{recursive:true});
  // Copy only after every requested backend completed. Failed runs expose no partial output.
  await fs.cp(tmp,out,{recursive:true,errorOnExist:true,force:false});promoted=true;
  console.log(JSON.stringify({output:out,specSha256:scene.specSha256,files:Object.keys(files),nativeAppValidated:false}));
}finally{
  await fs.rm(tmp,{recursive:true,force:true});
  if(!promoted)console.error('No completed output was published. Correct the spec/runtime and retry in a new directory.');
}
