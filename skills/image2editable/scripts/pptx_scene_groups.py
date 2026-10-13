#!/usr/bin/env python3
"""Arrange newly generated native objects into each scene's spec tree.

Accepts a legacy single scene or a paper-figure-scene-deck/v1 envelope.
No drawing coordinates are authored here. Absolute child coordinates use
identity group transforms. Names, image relationships, and IDs are slide-local.
"""
import json
import sys
import zipfile
import posixpath
import hashlib
from pathlib import Path
import xml.etree.ElementTree as ET

P='http://schemas.openxmlformats.org/presentationml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS={'p':P,'a':A}
for prefix,url in (('p',P),('a',A),('r',R)):ET.register_namespace(prefix,url)

def tag(ns,name):return '{'+ns+'}'+name

def transform(parent,bbox):
    x,y,w,h=[round(v*9525) for v in bbox]
    xfrm=ET.SubElement(parent,tag(A,'xfrm'))
    for name,attrs in [('off',{'x':x,'y':y}),('ext',{'cx':max(1,w),'cy':max(1,h)}),('chOff',{'x':x,'y':y}),('chExt',{'cx':max(1,w),'cy':max(1,h)})]:
        ET.SubElement(xfrm,tag(A,name),{k:str(v) for k,v in attrs.items()})

def relationships(archive,part):
    rel_path=posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')
    rels={}
    if rel_path in archive.namelist():
        for rel in ET.fromstring(archive.read(rel_path)):
            if rel.get('TargetMode')=='External':raise ValueError('Unexpected external relation')
            target=rel.get('Target','')
            rels[rel.get('Id')]=target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join(posixpath.dirname(part),target))
    return rels

def slide_parts(archive):
    part='ppt/presentation.xml'
    rels=relationships(archive,part)
    presentation=ET.fromstring(archive.read(part))
    return [rels[s.get(tag(R,'id'))] for s in presentation.findall('p:sldIdLst/p:sldId',NS)]

def patch_slide(archive,part,scene):
    nodes={n['id']:n for n in scene['nodes']}
    # This ArtifactTool version retains image order but may omit alt/name on export.
    # Bind each slide's order and independently verify the media and placement.
    image_order=[]
    def collect(name):
        n=nodes[name]
        if n['type']=='group':
            for child in n['children']:collect(child)
        elif n['type']=='image':image_order.append(name)
    for name in scene['roots']:collect(name)
    rels=relationships(archive,part)
    xml=ET.fromstring(archive.read(part))
    tree=xml.find('p:cSld/p:spTree',NS)
    if tree is None:raise ValueError('Missing slide shape tree: '+part)
    items={};ids=[int(el.attrib['id']) for el in xml.findall('.//p:cNvPr',NS)]
    next_id=max(ids,default=0)+1
    for child in list(tree):
        if child.tag in (tag(P,'nvGrpSpPr'),tag(P,'grpSpPr'),tag(P,'extLst')):continue
        prop=child.find('.//p:cNvPr',NS)
        if prop is None:raise ValueError('Unnamed generated object: '+part)
        name=prop.attrib['name']
        if child.tag==tag(P,'pic'):
            if not image_order:raise ValueError('Unexpected generated picture: '+part)
            name=image_order.pop(0);n=nodes[name]
            blip=child.find('.//a:blip',NS)
            media=rels[blip.get(tag(R,'embed'))]
            if hashlib.sha256(archive.read(media)).hexdigest()!=scene['assetHashes'][n['asset']]:raise ValueError('Image order/media mismatch: '+part+': '+name)
            xfrm=child.find('p:spPr/a:xfrm',NS);off=xfrm.find('a:off',NS);ext=xfrm.find('a:ext',NS)
            x,y,cx,cy=[int(v) for v in (off.get('x'),off.get('y'),ext.get('cx'),ext.get('cy'))]
            bx,by,bw,bh=[round(v*9525) for v in n['bbox']]
            if abs((x+cx/2)-(bx+bw/2))>2 or abs((y+cy/2)-(by+bh/2))>2 or x<bx-2 or y<by-2 or x+cx>bx+bw+2 or y+cy>by+bh+2:raise ValueError('Image placement mismatch: '+part+': '+name)
            prop.set('name',name);prop.set('descr','spec-id:'+name)
        if prop.attrib.get('descr','').startswith('spec-id:'):
            name=prop.attrib['descr'][8:];prop.set('name',name)
        if name not in nodes or name in items:raise ValueError('Unexpected/duplicate generated object: '+part+': '+name)
        items[name]=child
        # The library's default noGrp lock prevents ordinary editing groups.
        for locks in child.findall('.//a:spLocks',NS):locks.attrib.pop('noGrp',None)
        for locks in child.findall('.//a:picLocks',NS):locks.attrib.pop('noGrp',None)
        for line in child.findall('.//a:ln',NS):
            line.set('cap','rnd')
            for join in list(line):
                if join.tag in (tag(A,'miter'),tag(A,'bevel'),tag(A,'round')):line.remove(join)
            join=ET.Element(tag(A,'round'))
            suffix=next((i for i,item in enumerate(line) if item.tag in (tag(A,'headEnd'),tag(A,'tailEnd'),tag(A,'extLst'))),len(line))
            line.insert(suffix,join)
        tree.remove(child)
    expected={n['id'] for n in nodes.values() if n['type']!='group'}
    if image_order:raise ValueError('Missing generated pictures: '+part)
    if set(items)!=expected:raise ValueError('Missing generated objects: '+part+': '+repr(expected-set(items)))
    def build(name):
        nonlocal next_id
        n=nodes[name]
        if n['type']!='group':return items[name]
        group=ET.Element(tag(P,'grpSp'))
        nv=ET.SubElement(group,tag(P,'nvGrpSpPr'))
        ET.SubElement(nv,tag(P,'cNvPr'),{'id':str(next_id),'name':name});next_id+=1
        ET.SubElement(nv,tag(P,'cNvGrpSpPr'));ET.SubElement(nv,tag(P,'nvPr'))
        transform(ET.SubElement(group,tag(P,'grpSpPr')),n['bbox'])
        for child in n['children']:group.append(build(child))
        return group
    extension=tree.find('p:extLst',NS)
    if extension is not None:tree.remove(extension)
    for name in scene['roots']:tree.append(build(name))
    if extension is not None:tree.append(extension)
    return ET.tostring(xml,encoding='utf-8',xml_declaration=True)

def main():
    source,scene_path,dest=map(Path,sys.argv[1:])
    if source.resolve()==dest.resolve() or dest.exists():raise ValueError('Refusing to overwrite input or existing output')
    document=json.loads(scene_path.read_text())
    scenes=document.get('scenes') if document.get('schema')=='paper-figure-scene-deck/v1' else [document]
    if not isinstance(scenes,list) or not scenes or any(s.get('schema')!='paper-figure-scene/v1' for s in scenes):raise ValueError('Expected a scene or nonempty paper-figure-scene-deck/v1')
    with zipfile.ZipFile(source) as archive:
        parts=slide_parts(archive)
        if len(parts)!=len(scenes):raise ValueError('Scene count must match PPTX slide count')
        if len(set(parts))!=len(parts):raise ValueError('Repeated slide part in presentation')
        updated={part:patch_slide(archive,part,scene) for part,scene in zip(parts,scenes)}
        with zipfile.ZipFile(dest,'x',compression=zipfile.ZIP_DEFLATED) as result:
            for entry in archive.infolist():result.writestr(entry,updated.get(entry.filename,archive.read(entry.filename)))

if __name__=='__main__':main()
