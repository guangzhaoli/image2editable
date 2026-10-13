// Shared validation and geometry. Backends must consume this scene, never infer layout.
// v4 expressive extensions (all optional, prior defaults unchanged):
// text.rotation: clockwise degrees around the unrotated bbox center.
// Endpoint offset: [0,1] along top/bottom left-to-right or left/right top-to-bottom;
// defaults to .5, unavailable for center. Ports rotate with rotated text.
// Shape fill: palette token/none, or {type:'linear-gradient',angle:0|90|180|270,
// stops:[{offset:0..1,color:paletteToken},...]}. 0=L→R, 90=T→B; stops include 0/1.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const own = (o,k) => Object.hasOwn(o,k);
const fail = message => { throw new Error(message); };
function need(condition,message) { if (!condition) fail(message); }
function keys(value,allowed,where) {
  need(value && typeof value==='object' && !Array.isArray(value),`${where}: expected object`);
  for (const k of Object.keys(value)) need(allowed.includes(k),`${where}: unsupported field ${k}`);
}
function number(v,where,min=-Infinity) {
  need(typeof v==='number' && Number.isFinite(v) && v>=min,`${where}: invalid finite number`); return v;
}
function vector(v,n,where) {
  need(Array.isArray(v)&&v.length===n,`${where}: expected ${n} coordinates`);
  return v.map((x,i)=>number(x,`${where}[${i}]`));
}
function evidence(v,where) { need(typeof v==='string'&&v.trim().length>0,`${where}: missing evidence`); }
const round = v => Number(v.toFixed(6));
const xml = x => String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const union = boxes => {
  const x=Math.min(...boxes.map(b=>b[0])),y=Math.min(...boxes.map(b=>b[1]));
  return [x,y,Math.max(...boxes.map(b=>b[0]+b[2]))-x,Math.max(...boxes.map(b=>b[1]+b[3]))-y];
};
const rotatePoint=(p,b,angle)=>{
  if(!angle)return p;
  const cx=b[0]+b[2]/2,cy=b[1]+b[3]/2,r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  return [round(cx+(p[0]-cx)*c-(p[1]-cy)*s),round(cy+(p[0]-cx)*s+(p[1]-cy)*c)];
};
const rotatedBounds=(b,angle)=>{
  if(!angle)return b;
  return union([[b[0],b[1]],[b[0]+b[2],b[1]],[b[0]+b[2],b[1]+b[3]],[b[0],b[1]+b[3]]].map(p=>[...rotatePoint(p,b,angle),0,0]));
};
const distanceToLine=(p,a,b)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy;
  if(!d)return Math.hypot(p[0]-a[0],p[1]-a[1]);
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
};
const midpoint=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];

// Adaptive de Casteljau subdivision; convex-hull flatness bounds deviation.
function flattenCurve(points,tolerance,out,depth=0) {
  const a=points[0],b=points.at(-1);
  if(points.slice(1,-1).every(p=>distanceToLine(p,a,b)<=tolerance)) {out.push(['L',...b]);return;}
  need(depth<20&&out.length<16384,'Curve subdivision limit exceeded; simplify path or increase tolerance');
  let row=points,left=[a],right=[b];
  while(row.length>1){row=row.slice(1).map((p,i)=>midpoint(row[i],p));left.push(row[0]);right.push(row.at(-1));}
  flattenCurve(left,tolerance,out,depth+1);flattenCurve(right.reverse(),tolerance,out,depth+1);
}
export function flattenCommands(commands,tolerance) {
  const out=[];let p,start;
  for(const c of commands){
    if(c[0]==='M'){p=c.slice(1);start=p;out.push(c);}
    else if(c[0]==='L'){p=c.slice(1);out.push(c);}
    else if(c[0]==='Q'){flattenCurve([p,c.slice(1,3),c.slice(3,5)],tolerance,out);p=c.slice(3,5);}
    else if(c[0]==='C'){flattenCurve([p,c.slice(1,3),c.slice(3,5),c.slice(5,7)],tolerance,out);p=c.slice(5,7);}
    else {out.push(['Z']);p=start;}
  }
  return out.map(c=>[c[0],...c.slice(1).map(round)]);
}

export async function compileSpec(spec,specPath) {
  keys(spec,['schema','state','canvas','provenance','palette','fonts','assets','objects','connections','groups','curveTolerance','notes'],'spec');
  need(spec.schema==='paper-figure-spec/v1','Unsupported schema; complete/migrate the v2 measurement record first');
  need(spec.state==='ready','spec.state must be ready; partial measurements cannot be rendered');
  keys(spec.canvas,['width','height','unit','background'],'canvas');
  const width=number(spec.canvas.width,'canvas.width',1),height=number(spec.canvas.height,'canvas.height',1);
  need(spec.canvas.unit==='px96','canvas.unit must be px96');
  keys(spec.provenance,['kind','source','sha256','page','crop','reference_to_canvas','notes'],'provenance');
  need(['synthetic','measured'].includes(spec.provenance.kind),'provenance.kind must be synthetic or measured');
  evidence(spec.provenance.source,'provenance.source');
  if(spec.provenance.kind==='measured')need(/^[a-f0-9]{64}$/.test(spec.provenance.sha256||''),'measured source requires sha256');
  const tolerance=number(spec.curveTolerance??.15,'curveTolerance',.001);
  need(tolerance<=2,'curveTolerance must be <=2 px; larger approximations require a deliberate schema change');
  keys(spec.palette,Object.keys(spec.palette??{}),'palette');
  const palette={};
  for(const [id,p] of Object.entries(spec.palette)){
    need(ID.test(id),`Invalid palette ID ${id}`);keys(p,['hex','evidence'],'palette.'+id);
    need(HEX.test(p.hex),`Invalid color ${id}`);evidence(p.evidence,`palette.${id}`);palette[id]=p.hex.toUpperCase();
  }
  const color=(token,where,allowNone=false)=>{
    if(allowNone&&token==='none')return 'none';
    need(typeof token==='string'&&own(palette,token),`${where}: unknown palette token ${token}`);return palette[token];
  };
  const fill=(value,where)=>{
    if(typeof value==='string')return color(value,where,true);
    keys(value,['type','angle','stops'],where);
    need(value.type==='linear-gradient',`${where}: expected linear-gradient`);
    const angle=number(value.angle??0,where+'.angle');
    need([0,90,180,270].includes(angle),`${where}: gradient angle must be 0, 90, 180, or 270`);
    need(Array.isArray(value.stops)&&value.stops.length>=2,`${where}: gradient requires at least two stops`);
    let previous=-1;
    const stops=value.stops.map((stop,i)=>{
      keys(stop,['offset','color'],`${where}.stops[${i}]`);
      const offset=number(stop.offset,`${where}.stops[${i}].offset`,0);
      need(offset<=1&&offset>previous,`${where}: gradient stops must strictly increase within [0,1]`);previous=offset;
      return {offset,color:color(stop.color,`${where}.stops[${i}].color`)};
    });
    need(stops[0].offset===0&&stops.at(-1).offset===1,`${where}: gradient stops must include offsets 0 and 1`);
    return {type:'linear-gradient',angle,stops};
  };
  const background=color(spec.canvas.background,'canvas.background');
  keys(spec.fonts??{},Object.keys(spec.fonts??{}),'fonts');
  const fonts={};
  for(const [id,f]of Object.entries(spec.fonts??{})){
    need(ID.test(id),`Invalid font ID ${id}`);keys(f,['family','evidence','native_verified'],'fonts.'+id);
    evidence(f.family,`fonts.${id}.family`);evidence(f.evidence,`fonts.${id}`);
    if(f.native_verified!==undefined)need(typeof f.native_verified==='boolean',`fonts.${id}.native_verified must be boolean`);
    fonts[id]=f.family;
  }
  const assets={},base=await fs.realpath(path.dirname(specPath));
  need(Array.isArray(spec.assets??[]),'assets must be array');
  for(const a of spec.assets??[]){
    keys(a,['id','file','sha256','role','source','crop','notes'],'asset');
    need(typeof a.id==='string'&&ID.test(a.id)&&!own(assets,a.id),'Invalid or duplicate asset ID');
    need(['content','reference'].includes(a.role),`asset ${a.id}: invalid role`);evidence(a.source,`asset ${a.id} source`);
    need(typeof a.file==='string'&&!path.isAbsolute(a.file),`asset ${a.id}: use a relative local path`);
    const absolute=await fs.realpath(path.resolve(base,a.file));
    const relative=path.relative(base,absolute);
    need(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),`asset ${a.id}: path leaves spec directory`);
    const ext=path.extname(absolute).toLowerCase();
    need(['.png','.jpg','.jpeg'].includes(ext),`asset ${a.id}: only PNG/JPEG content is supported; trace other formats as paths`);
    const data=await fs.readFile(absolute);need(sha256(data)===a.sha256,`asset ${a.id}: SHA256 mismatch`);
    assets[a.id]={...a,absolute,mime:ext==='.png'?'image/png':'image/jpeg',data};
  }
  const registry=new Map(),raw=new Map(),active=new Set(),objectList=spec.objects;
  need(Array.isArray(objectList)&&objectList.length>0,'objects must be a nonempty array');
  function register(id,type){need(typeof id==='string'&&ID.test(id)&&!registry.has(id),`Invalid or duplicate ID ${id}`);registry.set(id,type);}
  for(const o of objectList){register(o.id,'object');raw.set(o.id,o);}
  const objects=new Map();
  const stroke=(s,where)=>{
    if(s===undefined)return {color:'none',width:0,dash:'solid'};
    keys(s,['color','width','dash'],where);
    const c=color(s.color,where+'.color'),w=number(s.width,where+'.width',.001),d=s.dash??'solid';
    need(['solid','dashed','dotted'].includes(d),`${where}: invalid dash`);return {color:c,width:w,dash:d};
  };
  function resolve(id){
    if(objects.has(id))return objects.get(id);
    need(raw.has(id),`Missing anchor object ${id}`);need(!active.has(id),`Anchor cycle at ${id}`);active.add(id);
    const o=raw.get(id),common=['id','type','bbox','anchor','z','evidence'];
    const fields={rect:['fill','stroke'],roundrect:['fill','stroke','radius'],ellipse:['fill','stroke'],text:['text','font','size','lineHeight','align','valign','bold','italic','color','rotation'],path:['commands','fill','stroke'],image:['asset','fit']};
    need(own(fields,o.type),`object ${id}: unsupported type ${o.type}`);keys(o,[...common,...fields[o.type]],`object ${id}`);
    evidence(o.evidence,`object ${id}`);
    const b=vector(o.bbox,4,`object ${id}.bbox`);need(b[2]>0&&b[3]>0,`object ${id}: dimensions must be positive`);
    if(o.anchor){
      keys(o.anchor,['object'],`object ${id}.anchor`);const parent=resolve(o.anchor.object);b[0]+=parent.bbox[0];b[1]+=parent.bbox[1];
    }
    const rotation=o.type==='text'&&o.rotation!==undefined?((number(o.rotation,`object ${id}.rotation`)%360)+360)%360:0;
    const visual=rotatedBounds(b,rotation);
    need(visual[0]>=0&&visual[1]>=0&&visual[0]+visual[2]<=width+.001&&visual[1]+visual[3]<=height+.001,`object ${id}: bbox outside canvas`);
    const item={id,type:o.type,bbox:b,z:number(o.z??0,`object ${id}.z`),evidence:o.evidence};
    if(o.type==='text'&&o.rotation!==undefined)item.rotation=rotation;
    if(rotation)item.visualBbox=visual;
    if(['rect','roundrect','ellipse','path'].includes(o.type)){item.fill=fill(o.fill??'none',`object ${id}.fill`);item.stroke=stroke(o.stroke,`object ${id}.stroke`);}
    if(o.type==='roundrect'){item.radius=number(o.radius,`object ${id}.radius`,0);need(item.radius<=Math.min(b[2],b[3])/2,`object ${id}: radius exceeds half size`);}
    if(o.type==='text'){
      need(typeof o.text==='string'&&o.text.length>0&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(o.text),`object ${id}: missing text or invalid XML control character`);need(own(fonts,o.font),`object ${id}: unknown font ${o.font}`);
      item.text=o.text;item.font=fonts[o.font];item.size=number(o.size,`object ${id}.size`,.1);
      item.lineHeight=number(o.lineHeight??item.size*1.2,`object ${id}.lineHeight`,.1);
      item.align=o.align??'left';item.valign=o.valign??'top';
      need(['left','center','right'].includes(item.align)&&['top','middle','bottom'].includes(item.valign),`object ${id}: invalid alignment`);
      for(const k of ['bold','italic']){need(o[k]===undefined||typeof o[k]==='boolean',`object ${id}.${k}: expected boolean`);item[k]=o[k]??false;}
      item.color=color(o.color,`object ${id}.color`);
      need(item.text.split('\n').length*item.lineHeight<=b[3]+.001,`object ${id}: declared lines exceed text bbox height`);
    }
    if(o.type==='path'){
      need(Array.isArray(o.commands)&&o.commands.length>1&&o.commands[0][0]==='M',`object ${id}: path must start with M`);
      const counts={M:2,L:2,Q:4,C:6,Z:0};let open=false;
      item.commands=o.commands.map((c,i)=>{
        need(Array.isArray(c)&&own(counts,c[0])&&c.length===counts[c[0]]+1,`object ${id}: invalid path command ${i}`);
        need(c[0]==='M'||open,`object ${id}: missing move after closed path`);
        if(c[0]==='M')open=true;if(c[0]==='Z')open=false;
        for(let j=1;j<c.length;j++){number(c[j],`object ${id} command ${i}`);need(c[j]>=0&&c[j]<=(j%2?b[2]:b[3]),`object ${id}: path control point outside local bbox`);}
        return [...c];
      });
      item.flatCommands=flattenCommands(item.commands,tolerance);
    }
    if(o.type==='image'){
      need(own(assets,o.asset),`object ${id}: unknown asset ${o.asset}`);need(assets[o.asset].role==='content',`object ${id}: reference asset cannot appear in final figure`);
      item.asset=o.asset;item.fit=o.fit??'contain';need(['contain','cover'].includes(item.fit),`object ${id}: invalid image fit`);
    }
    objects.set(id,item);active.delete(id);return item;
  }
  objectList.forEach(o=>resolve(o.id));
  const nodes=new Map(objects),connections=[];
  function endpoint(e,where){
    keys(e,['object','port','offset'],where);need(objects.has(e.object),`${where}: unresolved object ${e.object}`);
    need(['left','right','top','bottom','center'].includes(e.port),`${where}: invalid port ${e.port}`);
    const offset=number(e.offset??.5,where+'.offset',0);need(offset<=1,`${where}: offset must be within [0,1]`);
    need(e.port!=='center'||e.offset===undefined,`${where}: center port does not accept offset`);
    const object=objects.get(e.object),[x,y,w,h]=object.bbox;
    const point={left:[x,y+h*offset],right:[x+w,y+h*offset],top:[x+w*offset,y],bottom:[x+w*offset,y+h],center:[x+w/2,y+h/2]}[e.port];
    return rotatePoint(point,object.bbox,object.rotation??0);
  }
  need(Array.isArray(spec.connections??[]),'connections must be array');
  for(const c of spec.connections??[]){
    register(c.id,'connection');keys(c,['id','source','target','waypoints','arrow','arrowLength','arrowWidth','stroke','z','evidence'],`connection ${c.id}`);evidence(c.evidence,`connection ${c.id}`);
    const start=endpoint(c.source,`${c.id}.source`),end=endpoint(c.target,`${c.id}.target`);
    need(Array.isArray(c.waypoints??[]),`${c.id}.waypoints must be array`);
    const points=[start,...(c.waypoints??[]).map(p=>vector(p,2,`${c.id}.waypoint`)),end].filter((p,i,a)=>i===0||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);
    need(points.length>=2,`connection ${c.id}: zero-length route`);
    for(const [x,y]of points)need(x>=0&&y>=0&&x<=width&&y<=height,`connection ${c.id}: route outside canvas`);
    const arrow=c.arrow??'end';need(['none','start','end','both'].includes(arrow),`${c.id}: invalid arrow`);
    const s=stroke(c.stroke,`${c.id}.stroke`);need(s.width>0,`${c.id}: visible stroke required`);
    const len=number(c.arrowLength??8,`${c.id}.arrowLength`,.1),aw=number(c.arrowWidth??6,`${c.id}.arrowWidth`,.1);
    const makePath=(id,pts,fill,st,closed=false)=>{
      const b=union(pts.map(p=>[...p,0,0]));b[2]=Math.max(b[2],.001);b[3]=Math.max(b[3],.001);
      const cmds=pts.map((p,i)=>[i?'L':'M',round(p[0]-b[0]),round(p[1]-b[1])]);if(closed)cmds.push(['Z']);
      return {id,type:'path',bbox:b,commands:cmds,flatCommands:cmds,fill,stroke:st,z:0};
    };
    const line=makePath(c.id+'__line',points,'none',s),parts=[line];
    function head(tip,previous,suffix){
      const d=Math.hypot(tip[0]-previous[0],tip[1]-previous[1]);need(d>0,`${c.id}: invalid arrow direction`);
      const dx=(tip[0]-previous[0])/d,dy=(tip[1]-previous[1])/d;
      return makePath(c.id+suffix,[tip,[tip[0]-len*dx-aw/2*dy,tip[1]-len*dy+aw/2*dx],[tip[0]-len*dx+aw/2*dy,tip[1]-len*dy-aw/2*dx]],s.color,{color:'none',width:0,dash:'solid'},true);
    }
    if(['start','both'].includes(arrow))parts.push(head(points[0],points[1],'__start'));
    if(['end','both'].includes(arrow))parts.push(head(points.at(-1),points.at(-2),'__end'));
    for(const p of parts){
      const [x,y,w,h]=p.bbox;need(x>=0&&y>=0&&x+w<=width+.001&&y+h<=height+.001,`connection ${c.id}: arrow geometry outside canvas`);
      register(p.id,'derived');nodes.set(p.id,p);
    }
    const node={id:c.id,type:'group',children:parts.map(p=>p.id),bbox:union(parts.map(p=>p.bbox)),z:number(c.z??0,`${c.id}.z`)};
    nodes.set(c.id,node);connections.push({...c,resolvedPoints:points});
  }
  need(Array.isArray(spec.groups??[]),'groups must be array');
  for(const g of spec.groups??[]){register(g.id,'group');keys(g,['id','children','z'],`group ${g.id}`);need(Array.isArray(g.children)&&g.children.length>0,`group ${g.id}: empty children`);nodes.set(g.id,{id:g.id,type:'group',children:g.children,z:number(g.z??0,`group ${g.id}.z`)});}
  const owned=new Map();
  for(const n of nodes.values())if(n.type==='group')for(const id of n.children){need(nodes.has(id),`group ${n.id}: missing child ${id}`);need(!owned.has(id),`group child ${id}: multiple parents`);owned.set(id,n.id);}
  const visiting=new Set(),done=new Set();
  const sort=ids=>[...ids].sort((a,b)=>nodes.get(a).z-nodes.get(b).z||(a<b?-1:a>b?1:0));
  function tree(id){
    need(!visiting.has(id),`Group cycle at ${id}`);if(done.has(id))return;
    visiting.add(id);const n=nodes.get(id);
    if(n.type==='group'){n.children.forEach(tree);n.children=sort(n.children);n.bbox=union(n.children.map(x=>nodes.get(x).visualBbox??nodes.get(x).bbox));}
    visiting.delete(id);done.add(id);
  }
  for(const id of nodes.keys())tree(id);
  const roots=sort([...nodes.keys()].filter(id=>!owned.has(id)));
  const scene={schema:'paper-figure-scene/v1',canvas:{width,height,unit:'px96',background},roots,nodes:[...nodes.values()],connections,assetHashes:Object.fromEntries(Object.entries(assets).map(([id,a])=>[id,a.sha256])),curveTolerance:tolerance,provenance:spec.provenance,
    limitations:['SVG and PowerPoint font metrics can differ; inspect target-app export.','Connections are grouped editable paths; endpoints update on spec re-render, not by live native routing.','Bezier curves remain exact in SVG and use bounded polygonal approximation in PPTX.','Generated files do not import native-editor changes back into spec.']};
  return {scene,assets};
}

export function svgFromScene(scene,assets,{background=true}={}) {
  const nodes=new Map(scene.nodes.map(n=>[n.id,n]));
  const gradients=scene.nodes.filter(n=>n.fill&&typeof n.fill==='object'&&n.fill.type==='linear-gradient');
  const gradientId=n=>'__gradient_'+n.id;
  const defs=gradients.length?'<defs>'+gradients.map(n=>{
    const [bx,by,w,h]=n.bbox,x=n.type==='path'?0:bx,y=n.type==='path'?0:by,a=n.fill.angle;
    const coords={0:[x,y+h/2,x+w,y+h/2],90:[x+w/2,y,x+w/2,y+h],180:[x+w,y+h/2,x,y+h/2],270:[x+w/2,y+h,x+w/2,y]}[a];
    return `<linearGradient id="${gradientId(n)}" gradientUnits="userSpaceOnUse" x1="${coords[0]}" y1="${coords[1]}" x2="${coords[2]}" y2="${coords[3]}">${n.fill.stops.map(s=>`<stop offset="${s.offset}" stop-color="${s.color}"/>`).join('')}</linearGradient>`;
  }).join('')+'</defs>':'';
  const stroke=s=>`stroke="${s.color}" stroke-width="${s.width}" stroke-linejoin="round" stroke-linecap="round"${s.dash==='solid'?'':` stroke-dasharray="${s.dash==='dotted'?[s.width,s.width*2]:[s.width*4,s.width*3]}"`}`;
  function draw(id){
    const n=nodes.get(id),[x,y,w,h]=n.bbox,attr=`id="${xml(id)}"`;
    if(n.type==='group')return `<g ${attr}>${n.children.map(draw).join('')}</g>`;
    if(n.type==='text'){
      const lines=n.text.split('\n'),total=lines.length*n.lineHeight;
      const top=y+(n.valign==='middle'?(h-total)/2:n.valign==='bottom'?h-total:0);
      const left=x+(n.align==='center'?w/2:n.align==='right'?w:0);
      return `<text ${attr}${n.rotation?` transform="rotate(${n.rotation} ${x+w/2} ${y+h/2})"`:''} font-family="${xml(n.font)}" font-size="${n.size}" font-weight="${n.bold?'bold':'normal'}" font-style="${n.italic?'italic':'normal'}" fill="${n.color}" text-anchor="${{left:'start',center:'middle',right:'end'}[n.align]}">${lines.map((t,i)=>`<tspan x="${left}" y="${round(top+(n.lineHeight-n.size)/2+n.size*.8+i*n.lineHeight)}">${xml(t)}</tspan>`).join('')}</text>`;
    }
    if(n.type==='image'){
      const a=assets[n.asset];return `<image ${attr} x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid ${n.fit==='cover'?'slice':'meet'}" href="data:${a.mime};base64,${a.data.toString('base64')}"/>`;
    }
    const paint=typeof n.fill==='object'?`url(#${gradientId(n)})`:n.fill;
    const style=`fill="${paint}" ${stroke(n.stroke)}`;
    if(n.type==='path')return `<path ${attr} transform="translate(${x} ${y})" d="${n.commands.map(c=>c.join(' ')).join(' ')}" ${style}/>`;
    if(n.type==='ellipse')return `<ellipse ${attr} cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" ${style}/>`;
    return `<rect ${attr} x="${x}" y="${y}" width="${w}" height="${h}"${n.type==='roundrect'?` rx="${n.radius}"`:''} ${style}/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.canvas.width}" height="${scene.canvas.height}" viewBox="0 0 ${scene.canvas.width} ${scene.canvas.height}"><metadata>${xml(JSON.stringify({schema:scene.schema,provenance:scene.provenance}))}</metadata>${defs}${background?`<rect width="100%" height="100%" fill="${scene.canvas.background}"/>`:''}${scene.roots.map(draw).join('')}</svg>\n`;
}
