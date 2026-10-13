// Shared native PowerPoint backend for scenes already validated by spec_core.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {sha256} from './spec_core.mjs';

/** Export compiled {scene, assets} entries as one native, grouped PPTX.
 * options.modules / options.python override bundled runtime discovery paths.
 * options.previewPaths, when supplied, must contain one new PNG path per slide.
 * Previews are rendered from the exact grouped PPTX. No output is overwritten.
 * Background may vary by slide; canvas width, height and unit must agree.
 */
export async function exportScenesPptx(entries,outputPath,options={}){
  if(!Array.isArray(entries)||entries.length===0)throw new Error('PPTX export requires at least one compiled scene');
  const canvas=entries[0]?.scene?.canvas;
  if(!canvas||!Number.isFinite(canvas.width)||!Number.isFinite(canvas.height)||canvas.width<=0||canvas.height<=0)throw new Error('Invalid scene canvas');
  for(const [i,item] of entries.entries()){
    const scene=item?.scene;
    if(scene?.schema!=='paper-figure-scene/v1'||!Array.isArray(scene.nodes)||!Array.isArray(scene.roots)||!item.assets)throw new Error(`Entry ${i+1} must be a compiled {scene, assets}`);
    if(scene.canvas.width!==canvas.width||scene.canvas.height!==canvas.height||scene.canvas.unit!==canvas.unit)throw new Error('All PPTX slides must have the same canvas dimensions and unit');
  }
  if(typeof outputPath!=='string'||!outputPath)throw new Error('A new PPTX output path is required');
  const output=path.resolve(outputPath),previewPaths=options.previewPaths??[];
  if(!Array.isArray(previewPaths)||(previewPaths.length!==0&&previewPaths.length!==entries.length)||previewPaths.some(p=>typeof p!=='string'||!p))throw new Error('previewPaths must contain one new PNG path per slide');
  const destinations=[output,...previewPaths.map(p=>path.resolve(p))];
  if(new Set(destinations).size!==destinations.length)throw new Error('Output and preview paths must be distinct');
  for(const dest of destinations){
    try{await fs.lstat(dest);throw new Error(`Refusing to overwrite existing output: ${dest}`);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const require=createRequire(import.meta.url),modules=options.modules||process.env.RUNTIME_NODE_MODULES;
  let entry;
  try{entry=require.resolve('@oai/artifact-tool',modules?{paths:[modules]}:undefined);}
  catch{throw new Error('PPTX backend needs @oai/artifact-tool. Discover bundled workspace dependencies, then pass --runtime-modules. SVG/check mode needs only Node.');}
  const {Presentation,PresentationFile,FileBlob}=await import(pathToFileURL(entry).href);
  const p=Presentation.create({slideSize:{width:canvas.width,height:canvas.height}});
  for(const {scene,assets} of entries){
    const s=p.slides.add();s.background.fill=scene.canvas.background;
    const nodes=new Map(scene.nodes.map(n=>[n.id,n]));
    function draw(id){
      const n=nodes.get(id);
      if(n.type==='group'){n.children.forEach(draw);return;}
      const [x,y,w,h]=n.bbox,position={left:x,top:y,width:w,height:h};
      if(n.type==='image'){
        const a=assets[n.asset];s.images.add({blob:new Uint8Array(a.data),contentType:a.mime,alt:'spec-id:'+id,fit:n.fit,position});return;
      }
      if(n.type==='text'){
        if(n.rotation!==undefined)position.rotation=n.rotation;
        const shape=s.shapes.add({name:id,geometry:'textbox',position,fill:'none',line:{fill:'none',width:0}});
        shape.text=n.text;shape.text.style={typeface:n.font,fontSize:n.size,lineSpacing:n.lineHeight/n.size,color:n.color,bold:n.bold,italic:n.italic,
          alignment:n.align,verticalAlignment:n.valign,wrap:'none',autoFit:'none',insets:{top:0,bottom:0,left:0,right:0}};return;
      }
      const line={fill:n.stroke.color,width:n.stroke.width,style:n.stroke.dash};
      const nativeFill=typeof n.fill==='object'?{type:'gradient',gradientKind:'linear',angleDeg:n.fill.angle,stops:n.fill.stops.map(stop=>({offset:stop.offset*100000,color:stop.color}))}:n.fill;
      const cfg={name:id,position,fill:nativeFill,line,geometry:{rect:'rect',roundrect:'roundRect',ellipse:'ellipse',path:'custom'}[n.type]};
      if(n.type==='roundrect')cfg.borderRadius=n.radius;
      if(n.type==='path')cfg.customPaths=[{width:w,height:h,commands:n.flatCommands.map(c=>c[0]==='M'?{moveTo:{x:c[1],y:c[2]}}:c[0]==='L'?{lineTo:{x:c[1],y:c[2]}}:{close:{}})}];
      s.shapes.add(cfg);
    }
    scene.roots.forEach(draw);
    s.speakerNotes.textFrame.setText(`Source: ${scene.provenance.source}`);
  }
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'paper-figure-pptx-')),published=[];
  try{
    const draft=path.join(tmp,'ungrouped.pptx'),grouped=path.join(tmp,'grouped.pptx'),scenePath=path.join(tmp,'scenes.json');
    await fs.writeFile(scenePath,JSON.stringify(entries.length===1?entries[0].scene:{schema:'paper-figure-scene-deck/v1',scenes:entries.map(e=>e.scene)}));
    await(await PresentationFile.exportPptx(p)).save(draft);
    const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'pptx_scene_groups.py');
    execFileSync(options.python||process.env.RUNTIME_PYTHON||'python3',[script,draft,scenePath,grouped],{stdio:'pipe'});
    const exact=await PresentationFile.importPptx(await FileBlob.load(grouped));
    if(exact.slides.items.length!==entries.length)throw new Error('PPTX import changed slide count');
    const staged=[grouped];
    for(let i=0;i<previewPaths.length;i++){
      const png=await exact.export({slide:exact.slides.items[i],format:'png',scale:1}),pngPath=path.join(tmp,`slide-${i+1}.png`);
      await fs.writeFile(pngPath,new Uint8Array(await png.arrayBuffer()));staged.push(pngPath);
    }
    const bytes=await fs.readFile(grouped);
    const metadata={schema:'paper-figure-pptx-export/v1',output,sha256:sha256(bytes),byteCount:bytes.length,slideCount:entries.length,
      canvas:{width:canvas.width,height:canvas.height,unit:canvas.unit},previewPaths:destinations.slice(1),
      previewRenderer:previewPaths.length?'Artifact Tool exact-PPTX reimport':null,nativeAppValidated:false,
      slides:entries.map(({scene},i)=>({slide:i+1,objects:scene.nodes.filter(n=>n.type!=='group').length,groups:scene.nodes.filter(n=>n.type==='group').length,connections:scene.connections.length}))};
    // Generate and verify everything before publishing; exclusive copies also protect against races.
    for(let i=0;i<destinations.length;i++){
      await fs.mkdir(path.dirname(destinations[i]),{recursive:true});
      await fs.copyFile(staged[i],destinations[i],constants.COPYFILE_EXCL);published.push(destinations[i]);
    }
    return metadata;
  }catch(e){
    for(const dest of published)await fs.rm(dest,{force:true});
    throw e;
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
}
