// Editable catalog pages derived from component specs, never bitmap thumbnails.
const clone=x=>structuredClone(x);
const W=1280,H=900;
function truncate(s,n){s=String(s).replace(/\s+/g,' ');return s.length>n?s.slice(0,n-1)+'…':s;}
function addText(s,id,text,bbox,size=20,options={}){
 s.objects.push({id,type:'text',text:String(text),bbox,font:'catalog-font',size,lineHeight:size*1.25,color:'catalog-ink',z:100,evidence:'Catalog annotation',...options});
}
function page(source,title,subtitle,index){
 const s={schema:'paper-figure-spec/v1',state:'ready',canvas:{width:W,height:H,unit:'px96',background:'catalog-paper'},
 provenance:{kind:'synthetic',source:'Component catalog derived from '+source.provenance.source,notes:'Catalog layout; original component geometry/style evidence retained'},
 palette:{...clone(source.palette),'catalog-paper':{hex:'#FFFFFF',evidence:'Catalog page background'},'catalog-ink':{hex:'#18283D',evidence:'Catalog labels'},'catalog-muted':{hex:'#5C6878',evidence:'Catalog secondary labels'},'catalog-rule':{hex:'#E3E8EE',evidence:'Catalog divider'}},
 fonts:{...clone(source.fonts),'catalog-font':{family:'Arial',evidence:'Catalog annotations',native_verified:false}},assets:[],objects:[],connections:[],groups:[]};
 addText(s,'catalog-title',title,[48,28,1184,50],32,{bold:true});
 addText(s,'catalog-subtitle',truncate(subtitle,120),[48,86,1184,32],17,{color:'catalog-muted'});
 addText(s,'catalog-page',String(index).padStart(2,'0'),[1150,854,82,28],15,{align:'right',color:'catalog-muted'});
 return s;
}
function rule(s,id,y){s.objects.push({id,type:'rect',bbox:[48,y,1184,1],fill:'catalog-rule',evidence:'Catalog row separator',z:90});}
export function placeComponent(target,component,{id,x,y,scale=1}){
 if(!(scale>0&&Number.isFinite(scale)))throw new Error('Invalid component scale');
 const map=new Map([...component.objects,...component.groups].map(o=>[o.id,id+'-'+o.id]));
 const paletteMap={};
 for(const [token,value]of Object.entries(component.palette)){const next=id+'-p-'+token;target.palette[next]=clone(value);paletteMap[token]=next;}
 const fontMap={};
 for(const [token,value]of Object.entries(component.fonts)){const next=id+'-f-'+token;target.fonts[next]=clone(value);fontMap[token]=next;}
 const assetMap={};
 for(const a of component.assets??[]){const next=id+'-a-'+a.id;target.assets.push({...clone(a),id:next});assetMap[a.id]=next;}
 for(const original of component.objects){
  const o=clone(original);if(o.anchor)throw new Error('Component must have resolved anchors before placement');
  o.id=map.get(o.id);const [bx,by,bw,bh]=o.bbox;o.bbox=[x+bx*scale,y+by*scale,bw*scale,bh*scale];
  if(o.fill&&typeof o.fill==='object')o.fill.stops=o.fill.stops.map(stop=>({...stop,color:paletteMap[stop.color]}));
  else if(o.fill&&o.fill!=='none')o.fill=paletteMap[o.fill];
  if(o.stroke){o.stroke.color=paletteMap[o.stroke.color];o.stroke.width*=scale;}
  if(o.radius!==undefined)o.radius*=scale;
  if(o.type==='text'){o.font=fontMap[o.font];o.color=paletteMap[o.color];o.size*=scale;if(o.lineHeight!==undefined)o.lineHeight*=scale;}
  if(o.type==='path')o.commands=o.commands.map(c=>[c[0],...c.slice(1).map(v=>v*scale)]);
  if(o.asset)o.asset=assetMap[o.asset];target.objects.push(o);
 }
 for(const g of component.groups)target.groups.push({...clone(g),id:map.get(g.id),children:g.children.map(c=>map.get(c))});
 const owned=new Set(component.groups.flatMap(g=>g.children));
 const roots=[...component.objects,...component.groups].filter(n=>!owned.has(n.id)).map(n=>map.get(n.id));
 target.groups.push({id,children:roots,z:20});
 return id;
}
export function makeLibraryBoards(source,library){
 const result=[],{manifest,components}=library;
 const add=(kind,s)=>result.push({id:`${String(result.length+1).padStart(2,'0')}-${kind}`,kind,spec:s});
 const get=id=>components.find(c=>c.id===id).spec;
 for(let start=0;start<manifest.components.length;start+=5){
  const rows=manifest.components.slice(start,start+5),s=page(source,'Component library',`${manifest.components.length} distinct components · editable samples with original styles`,result.length+1);
  addText(s,'col-component','COMPONENT',[48,138,430,28],14,{bold:true,color:'catalog-muted'});
  addText(s,'col-sample','EDITABLE SAMPLE',[600,138,632,28],14,{bold:true,color:'catalog-muted'});
  for(let i=0;i<rows.length;i++){
   const m=rows[i],c=get(m.id),y=182+i*130;
   addText(s,'name-'+i,truncate(m.name||m.id,43),[48,y+3,518,34],21,{bold:true});
   addText(s,'id-'+i,truncate(m.id,65),[48,y+44,518,26],14,{color:'catalog-muted'});
   const count=m.sourceInstanceCount??m.sourceInstances?.length??1;
   addText(s,'details-'+i,`${m.category||'component'}  ·  ${count} instance${count===1?'':'s'}  ·  ${c.canvas.width.toFixed(1)} × ${c.canvas.height.toFixed(1)} px`,[48,y+77,540,30],15,{color:'catalog-muted'});
   const scale=Math.min(1.6,600/c.canvas.width,104/c.canvas.height);
   placeComponent(s,c,{id:'sample-'+i,x:600+(600-c.canvas.width*scale)/2,y:y+(104-c.canvas.height*scale)/2,scale});
   rule(s,'rule-'+i,y+119);
  }
  add('components',s);
 }
 for(let start=0;start<manifest.palette.length;start+=7){
  const rows=manifest.palette.slice(start,start+7),s=page(source,'Color palette',`${manifest.palette.length} named tokens · source values and usage`,result.length+1);
  for(let i=0;i<rows.length;i++){
   const p=rows[i],y=144+i*98,token='swatch-'+i;
   s.palette[token]={hex:p.hex,evidence:p.evidence};
   s.objects.push({id:token,type:'rect',bbox:[48,y+5,100,66],fill:token,stroke:{color:'catalog-rule',width:1},z:20,evidence:p.evidence});
   addText(s,'token-'+i,truncate(p.token??p.id,34),[172,y,470,30],20,{bold:true});
   const rgb=p.rgb??[1,3,5].map(n=>parseInt(p.hex.slice(n,n+2),16));
   addText(s,'values-'+i,`${p.hex}   RGB ${rgb.join(', ')}`,[172,y+38,470,28],17);
   const uses=Array.isArray(p.usage)?p.usage.length:(p.usageCount??p.usage?.length??0);
   addText(s,'uses-'+i,`${uses} uses in source`,[684,y,548,29],18,{bold:true});
   addText(s,'evidence-'+i,truncate(p.evidence,77),[684,y+35,548,38],13,{color:'catalog-muted'});
   rule(s,'rule-'+i,y+85);
  }
  add('palette',s);
 }
 for(let start=0;start<manifest.textStyles.length;start+=5){
  const rows=manifest.textStyles.slice(start,start+5),s=page(source,'Text styles',`${manifest.textStyles.length} distinct styles · live text samples`,result.length+1);
  for(let i=0;i<rows.length;i++){
   const t=rows[i],y=160+i*130,font='sample-font-'+i,color='sample-color-'+i;
   s.fonts[font]={family:t.family,evidence:'Font candidate retained from source spec',native_verified:false};s.palette[color]={hex:t.color,evidence:'Text color from source spec'};
   addText(s,'typeface-'+i,truncate(t.family,44),[48,y,520,34],22,{bold:true});
   addText(s,'style-'+i,`${t.size} px · ${t.lineHeight} px line · ${t.bold?'bold':'regular'}${t.italic?' italic':''} · ${t.usageCount} uses`,[48,y+44,540,30],16,{color:'catalog-muted'});
   addText(s,'align-'+i,`${t.align} / ${t.valign} · ${t.color}${t.rotation!==undefined?' · '+t.rotation+'°':''}`,[48,y+80,540,28],14,{color:'catalog-muted'});
   // Match measured style; larger than a row is represented by its documented size.
   const size=Math.min(t.size,58),lineHeight=Math.min(t.lineHeight,76);
   addText(s,'sample-'+i,'Aa Bb 0123',[650,y+28,530,82],size,{font,color,lineHeight,bold:t.bold,italic:t.italic,align:'left',valign:'middle'});
   rule(s,'rule-'+i,y+114);
  }
  add('typography',s);
 }
 return result;
}

// Adobe Swatch Exchange 1.0. RGB normal swatches; no global-color binding claim.
export function paletteToAse(palette){
 const str=s=>{const text=Buffer.from(String(s)+'\0','utf16le');text.swap16();const n=Buffer.alloc(2);n.writeUInt16BE(text.length/2);return Buffer.concat([n,text]);};
 const blocks=palette.map(p=>{
  const rgb=p.rgb??[1,3,5].map(n=>parseInt(p.hex.slice(n,n+2),16));
  const values=Buffer.alloc(14);rgb.forEach((v,i)=>values.writeFloatBE(v/255,i*4));values.writeUInt16BE(2,12);
  const body=Buffer.concat([str(p.token??p.id),Buffer.from('RGB '),values]),head=Buffer.alloc(6);head.writeUInt16BE(1);head.writeUInt32BE(body.length,2);return Buffer.concat([head,body]);
 });
 const header=Buffer.alloc(12);header.write('ASEF');header.writeUInt16BE(1,4);header.writeUInt16BE(0,6);header.writeUInt32BE(blocks.length,8);return Buffer.concat([header,...blocks]);
}
