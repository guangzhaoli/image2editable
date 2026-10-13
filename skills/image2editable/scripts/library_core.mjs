// Reusable extraction from the validated scene. No drawing inference or source writes.
import {compileSpec, sha256} from './spec_core.mjs';

const ID=/^[A-Za-z][A-Za-z0-9_-]*$/;
const clone=x=>structuredClone(x);
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const stable=x=>JSON.stringify(sortKeys(x));
function sortKeys(x){if(Array.isArray(x))return x.map(sortKeys);if(plain(x))return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sortKeys(x[k])]));return Object.is(x,-0)?0:x;}
function fields(x,allowed,where){need(plain(x),`${where}: expected object`);for(const k of Object.keys(x))need(allowed.includes(k),`${where}: unsupported field ${k}`);}
const union=boxes=>{const x=Math.min(...boxes.map(b=>b[0])),y=Math.min(...boxes.map(b=>b[1]));return [x,y,Math.max(...boxes.map(b=>b[0]+b[2]))-x,Math.max(...boxes.map(b=>b[1]+b[3]))-y];};
// Fingerprints alone normalize geometry noise to 1e-6 px; emitted geometry stays unquantized.
const q=n=>Number(n.toFixed(6));
function fingerprintGeometry(v){
  if(v.type==='group')return {...v,children:v.children.map(fingerprintGeometry)};
  const out={...v,bbox:v.bbox.map(q)};
  if(out.commands)out.commands=out.commands.map(c=>[c[0],...c.slice(1).map(q)]);
  if(out.radius!==undefined)out.radius=q(out.radius);
  if(out.rotation!==undefined)out.rotation=q(out.rotation);
  if(out.stroke)out.stroke={...out.stroke,width:q(out.stroke.width)};
  return out;
}
// Compiled arrow coordinates are rounded to 6 decimals, while their bbox is not.
// Enlarge only the path viewport when needed, preserving every path coordinate.
function drawableBox(n){const b=[...n.bbox];if(n.commands)for(const c of n.commands)for(let i=1;i<c.length;i++)b[i%2?2:3]=Math.max(b[i%2?2:3],c[i]);return b;}
const textValue=(x,where)=>need(typeof x==='string'&&x.trim().length>0,`${where}: expected nonempty string`);
const LIMITATIONS=[
  'Extracted connections are fixed native path components, not live auto-routing connectors.',
  'No native application component library, symbol registry, or synchronization is registered.',
  'Native-editor changes are not synchronized back to source specs or extracted components.',
  'Extraction preserves supplied geometry and styles; it does not infer new design or scientific relationships.',
  'Duplicate fingerprints normalize geometry to 1e-6 px; emitted coordinates are not quantized.',
  'Native application editing and rendering require separate verification.'
];

/** Return {manifest, components:[{id,spec}], assets:[{file,sha256,mime,data}]}.
 * Write component specs together in one directory, and assets at their relative file paths.
 * Deliberate reuse across distinct recipe components is allowed. Roots within one
 * component must be disjoint, with no ancestor/descendant overlap.
 */
export async function extractLibrary(spec,specPath,options={}){
  fields(options,['components'],'options');
  need(typeof specPath==='string'&&specPath.length>0,'specPath: expected source spec path');
  const input=clone(spec); // Compiler changes and consumer mutations cannot alter the caller's spec.
  const {scene,assets}=await compileSpec(input,specPath);
  const nodes=new Map(scene.nodes.map(n=>[n.id,n]));
  const connectionIds=new Set(scene.connections.map(c=>c.id));
  const rank=new Map();let sequence=0;
  function mark(id){rank.set(id,sequence++);const n=nodes.get(id);if(n.type==='group')n.children.forEach(mark);}
  scene.roots.forEach(mark);
  function descendants(id,set=new Set()){set.add(id);const n=nodes.get(id);if(n.type==='group')n.children.forEach(c=>descendants(c,set));return set;}
  let selections;
  if(Object.hasOwn(options,'components')){
    need(Array.isArray(options.components)&&options.components.length>0,'options.components: expected nonempty selection array');
    const seen=new Set();
    selections=options.components.map((c,i)=>{
      fields(c,['id','name','roots','category'],`components[${i}]`);
      need(typeof c.id==='string'&&ID.test(c.id)&&!seen.has(c.id),`components[${i}]: invalid or duplicate selection id`);seen.add(c.id);
      textValue(c.name,`components[${i}].name`);textValue(c.category,`components[${i}].category`);
      need(Array.isArray(c.roots)&&c.roots.length>0,`component ${c.id}: roots must be nonempty`);
      const used=new Set();
      for(const id of c.roots){
        need(typeof id==='string'&&nodes.has(id),`component ${c.id}: missing root ${id}`);
        for(const child of descendants(id)){need(!used.has(child),`component ${c.id}: overlapping roots at ${child}`);used.add(child);}
      }
      return {...clone(c),roots:[...c.roots].sort((a,b)=>rank.get(a)-rank.get(b))};
    });
  }else selections=scene.roots.map(id=>({id,name:id,roots:[id],category:connectionIds.has(id)?'connection':nodes.get(id).type==='group'?'group':nodes.get(id).type}));
  need(selections.length>0,'No extractable components');

  // Palette inventory keeps every original token, even unused tokens and matching HEX aliases.
  const usages=new Map(Object.keys(input.palette).map(k=>[k,[]]));
  const use=(token,entry,transparentAllowed=false)=>{if(token!==undefined&&!(transparentAllowed&&token==='none'))usages.get(token).push(entry);};
  use(input.canvas.background,{kind:'canvas',id:'canvas',property:'background'});
  for(const o of input.objects){
    if(plain(o.fill))o.fill.stops.forEach((stop,i)=>use(stop.color,{kind:'object',id:o.id,property:`fill.stops[${i}].color`}));
    else use(o.fill,{kind:'object',id:o.id,property:'fill'},true);if(o.stroke)use(o.stroke.color,{kind:'object',id:o.id,property:'stroke.color'});if(o.type==='text')use(o.color,{kind:'object',id:o.id,property:'color'});}
  for(const c of input.connections??[])use(c.stroke.color,{kind:'connection',id:c.id,property:'stroke.color',derivedNodeIds:[c.id+'__line',...(['start','both'].includes(c.arrow??'end')?[c.id+'__start']:[]),...(['end','both'].includes(c.arrow??'end')?[c.id+'__end']:[])]});
  const palette=Object.entries(input.palette).map(([token,p])=>{
    const hex=p.hex.toUpperCase(),same=Object.keys(input.palette).filter(k=>input.palette[k].hex.toUpperCase()===hex).sort();
    return {token,hex,rgb:[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),evidence:p.evidence,usage:usages.get(token),usageCount:usages.get(token).length,duplicateHexTokens:same.filter(k=>k!==token)};
  });
  const styleMap=new Map();
  for(const o of input.objects.filter(o=>o.type==='text')){
    const n=nodes.get(o.id),style={family:n.font,size:n.size,lineHeight:n.lineHeight,align:n.align,valign:n.valign,bold:n.bold,italic:n.italic,color:n.color,...(n.rotation!==undefined?{rotation:n.rotation}:{})};
    const fingerprint=sha256(stable(style));
    if(!styleMap.has(fingerprint))styleMap.set(fingerprint,{id:'text-style-'+fingerprint.slice(0,12),fingerprint,...style,fontTokens:[],colorTokens:[],fontEvidence:[],usage:[]});
    const item=styleMap.get(fingerprint);if(!item.fontTokens.includes(o.font)){item.fontTokens.push(o.font);item.fontEvidence.push({token:o.font,...clone(input.fonts[o.font])});}if(!item.colorTokens.includes(o.color))item.colorTokens.push(o.color);item.usage.push({kind:'object',id:o.id,property:'text'});
  }
  const textStyles=[...styleMap.values()].map(x=>({...x,usageCount:x.usage.length}));
  const componentEntries=[],components=[],fingerprints=new Map(),outputAssets=new Map();
  const aliasesByHex=new Map();for(const p of palette){if(!aliasesByHex.has(p.hex))aliasesByHex.set(p.hex,[]);aliasesByHex.get(p.hex).push(p);}
  for(const selection of selections){
    const included=new Set();selection.roots.forEach(id=>descendants(id,included));
    const leaves=[...included].map(id=>nodes.get(id)).filter(n=>n.type!=='group');
    need(leaves.length>0,`component ${selection.id}: no drawable objects`);
    const sourceBounds=union(leaves.map(n=>n.visualBbox??n.bbox));
    const paintBounds=union(leaves.map(n=>{const [x,y,w,h]=n.visualBbox??drawableBox(n),pad=(n.stroke?.width??0)/2;return [x-pad,y-pad,w+2*pad,h+2*pad];}));
    const [originX,originY,pw,ph]=paintBounds,width=Math.max(1,pw),height=Math.max(1,ph);
    function visual(id){
      const n=nodes.get(id);
      if(n.type==='group')return {type:'group',children:n.children.map(visual)};
      const db=drawableBox(n),v={type:n.type,bbox:[db[0]-originX,db[1]-originY,db[2],db[3]]};
      for(const k of ['fill','stroke','radius','text','font','size','lineHeight','align','valign','bold','italic','color','commands','fit','rotation'])if(n[k]!==undefined)v[k]=clone(n[k]);
      if(n.type==='image')v.asset={sha256:assets[n.asset].sha256,mime:assets[n.asset].mime};
      return v;
    }
    const fingerprint=sha256(stable({canvas:{width:q(width),height:q(height),background:scene.canvas.background},forest:selection.roots.map(visual).map(fingerprintGeometry),curveTolerance:scene.curveTolerance}));
    const instance={id:selection.id,name:selection.name,category:selection.category,roots:[...selection.roots],sourceBounds,paintBounds};
    if(fingerprints.has(fingerprint)){
      const existing=componentEntries[fingerprints.get(fingerprint)];existing.sourceInstances.push(instance);existing.sourceInstanceIds.push(selection.id);existing.sourceRoots.push([...selection.roots]);existing.sourceInstanceCount++;continue;
    }
    const usedColors=new Set([scene.canvas.background]),usedFonts=new Set(),usedAssets=new Set();
    for(const n of leaves){for(const c of [...(plain(n.fill)?n.fill.stops.map(stop=>stop.color):[n.fill]),n.stroke?.color,n.color])if(c&&c!=='none')usedColors.add(c);if(n.font)usedFonts.add(n.font);if(n.asset)usedAssets.add(n.asset);}
    const colorToken=hex=>'c'+hex.slice(1).toLowerCase();
    const cp=Object.fromEntries([...usedColors].sort().map(hex=>[colorToken(hex),{hex,evidence:aliasesByHex.get(hex).map(p=>`${p.token}: ${p.evidence}`).join('; ')}]));
    const fontIds=new Map([...usedFonts].sort().map((family,i)=>[family,'font'+(i+1)]));
    const cf=Object.fromEntries([...fontIds].map(([family,id])=>[id,{family,evidence:Object.entries(input.fonts).filter(([,f])=>f.family===family).map(([token,f])=>`${token}: ${f.evidence}`).join('; '),native_verified:false}]));
    const ca=[],assetIds=new Map();
    for(const sourceId of usedAssets){
      const a=assets[sourceId],id='asset'+a.sha256,file=`assets/${a.sha256}${a.mime==='image/png'?'.png':'.jpg'}`;assetIds.set(sourceId,id);
      if(!ca.some(x=>x.id===id))ca.push({id,file,sha256:a.sha256,role:'content',source:a.source,...(a.crop?{crop:clone(a.crop)}:{}),...(a.notes?{notes:a.notes}:{})});
      if(!outputAssets.has(file))outputAssets.set(file,{file,sha256:a.sha256,mime:a.mime,data:new Uint8Array(a.data)});
    }
    const objects=[],groups=[];let canonicalId=0;
    function convert(id,z){
      const n=nodes.get(id),cid='node'+String(++canonicalId).padStart(4,'0');
      if(n.type==='group'){const children=n.children.map((child,i)=>convert(child,i));groups.push({id:cid,children,z});return cid;}
      const db=drawableBox(n),o={id:cid,type:n.type,bbox:[db[0]-originX,db[1]-originY,db[2],db[3]],z,evidence:n.evidence??`Fixed path compiled from source connection in ${selection.id}`};
      if(n.fill!==undefined)o.fill=plain(n.fill)?{...clone(n.fill),stops:n.fill.stops.map(stop=>({...stop,color:colorToken(stop.color)}))}:n.fill==='none'?'none':colorToken(n.fill);
      if(n.stroke?.width>0)o.stroke={color:colorToken(n.stroke.color),width:n.stroke.width,dash:n.stroke.dash};
      if(n.radius!==undefined)o.radius=n.radius;
      if(n.commands)o.commands=clone(n.commands);
      if(n.type==='text'){for(const k of ['text','size','lineHeight','align','valign','bold','italic'])o[k]=n[k];if(n.rotation!==undefined)o.rotation=n.rotation;o.font=fontIds.get(n.font);o.color=colorToken(n.color);}
      if(n.type==='image'){o.asset=assetIds.get(n.asset);o.fit=n.fit;}
      objects.push(o);return cid;
    }
    selection.roots.forEach((id,i)=>convert(id,i));
    const provenance={...clone(input.provenance),source:`Extracted component ${selection.name} from: ${input.provenance.source}`};
    if(provenance.reference_to_canvas!==undefined){
      const m=provenance.reference_to_canvas;need(Array.isArray(m)&&m.length===6&&m.every(Number.isFinite),'provenance.reference_to_canvas: expected six finite affine coefficients');
      provenance.reference_to_canvas=[...m.slice(0,4),m[4]-originX,m[5]-originY];
    }
    const canonical={schema:'paper-figure-spec/v1',state:'ready',canvas:{width,height,unit:'px96',background:colorToken(scene.canvas.background)},provenance,palette:cp,fonts:cf,assets:ca,objects,connections:[],groups,curveTolerance:scene.curveTolerance,notes:LIMITATIONS.join(' ')};
    const fixedConnectionPaths=[...included].some(id=>connectionIds.has(id)||scene.connections.some(c=>id===c.id+'__line'||id===c.id+'__start'||id===c.id+'__end'));
    const entry={id:selection.id,name:selection.name,category:selection.category,fingerprint,bbox:[0,0,width,height],width,height,sourceInstances:[instance],sourceInstanceIds:[selection.id],sourceRoots:[[...selection.roots]],sourceInstanceCount:1,objectCount:objects.length,groupCount:groups.length,containsText:leaves.some(n=>n.type==='text'),containsImages:usedAssets.size>0,fixedConnectionPaths};
    fingerprints.set(fingerprint,componentEntries.length);componentEntries.push(entry);components.push({id:entry.id,spec:canonical});
  }
  return {manifest:{schema:'paper-figure-library/v1',source:{specSha256:sha256(stable(input)),hashBasis:'canonical JSON of supplied spec',provenance:clone(input.provenance),canvas:clone(scene.canvas)},fingerprintGeometryPrecisionPx:0.000001,selectionMode:Object.hasOwn(options,'components')?'explicit':'default-top-level',componentCount:componentEntries.length,sourceInstanceCount:selections.length,duplicateInstanceCount:selections.length-componentEntries.length,components:componentEntries,palette,textStyles,nativeLibraryRegistered:false,nativeSyncRegistered:false,limitations:[...LIMITATIONS,...scene.limitations]},components,assets:[...outputAssets.values()]};
}
