#!/usr/bin/env python3
"""Read-only PPTX inventory. Does not render, edit, launch Office, or follow links."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile, BadZipFile

NS={'p':'http://schemas.openxmlformats.org/presentationml/2006/main',
    'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
    'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'rel':'http://schemas.openxmlformats.org/package/2006/relationships',
    'c':'http://schemas.openxmlformats.org/drawingml/2006/chart'}
RID='{'+NS['r']+'}'

def local(tag):return tag.rsplit('}',1)[-1]
def relationships(z,part):
    path=PurePosixPath(part);rel=str(path.parent/'_rels'/(path.name+'.rels'))
    if rel not in z.namelist():return {}
    out={}
    for e in ET.fromstring(z.read(rel)):
        target=e.get('Target','');external=e.get('TargetMode')=='External'
        resolved=target if external else posixpath.normpath(posixpath.join(str(path.parent),target)).lstrip('/')
        if target.startswith('/') and not external:resolved=target.lstrip('/')
        out[e.get('Id')]={'type':e.get('Type'),'external':external,'target':resolved}
    return out

def xfrm(node):
    x=node.find('./p:spPr/a:xfrm',NS)
    if x is None:x=node.find('./p:xfrm',NS)
    if x is None:return None
    off=x.find('a:off',NS);ext=x.find('a:ext',NS)
    return {'x':int(off.get('x',0)) if off is not None else None,
            'y':int(off.get('y',0)) if off is not None else None,
            'cx':int(ext.get('cx',0)) if ext is not None else None,
            'cy':int(ext.get('cy',0)) if ext is not None else None,
            'rotation_60000deg':x.get('rot'),'flipH':x.get('flipH'),'flipV':x.get('flipV')}

def inspect(path):
    with ZipFile(path) as z:
        pres=ET.fromstring(z.read('ppt/presentation.xml'));size=pres.find('p:sldSz',NS)
        if size is None:raise ValueError('No slide size found')
        dimensions=[int(size.get('cx')),int(size.get('cy'))]
        links=relationships(z,'ppt/presentation.xml');slides=[]
        for n,sid in enumerate(pres.findall('p:sldIdLst/p:sldId',NS),1):
            rel=links.get(sid.get(RID+'id'))
            if not rel or rel['external']:raise ValueError('Slide relationship missing or external')
            part=rel['target'];slide=ET.fromstring(z.read(part));rels=relationships(z,part)
            tree=slide.find('p:cSld/p:spTree',NS)
            if tree is None:raise ValueError('Slide has no shape tree: '+part)
            items=[];counts={}
            def walk(parent,groups):
                for node in parent:
                    kind=local(node.tag)
                    if kind not in ('sp','pic','cxnSp','grpSp','graphicFrame'):continue
                    props=node.find('.//p:cNvPr',NS)
                    record={'kind':kind,'id':props.get('id') if props is not None else None,
                            'name':props.get('name') if props is not None else None,
                            'hidden':props.get('hidden') in ('1','true') if props is not None else False,
                            'group_path':groups,'bounds_emu_local':xfrm(node)}
                    counts[kind]=counts.get(kind,0)+1
                    if kind=='grpSp':
                        items.append(record);walk(node,groups+[record['name'] or record['id']]);continue
                    paragraphs=node.findall('./p:txBody/a:p',NS)
                    record['text']='\n'.join(''.join(e.text or '' for e in p.iter() if local(e.tag)=='t') for p in paragraphs)
                    record['font_faces']=sorted({e.get('typeface') for e in node.iter() if local(e.tag) in ('latin','ea','cs') and e.get('typeface')})
                    record['font_sizes_pt']=sorted({int(e.get('sz'))/100 for e in node.iter() if local(e.tag) in ('rPr','defRPr','endParaRPr') and e.get('sz')})
                    prst=node.find('./p:spPr/a:prstGeom',NS)
                    record['geometry']=prst.get('prst') if prst is not None else ('custom' if node.find('./p:spPr/a:custGeom',NS) is not None else None)
                    record['reference_named']=bool(record['name'] and any(t in record['name'].upper() for t in ('REFERENCE_DO_NOT_EXPORT','GUIDES_DO_NOT_EXPORT')))
                    if kind=='cxnSp':
                        record['connections']={}
                        for k in ('stCxn','endCxn'):
                            e=node.find('.//a:'+k,NS);record['connections'][k]=dict(e.attrib) if e is not None else None
                    line=node.find('./p:spPr/a:ln',NS)
                    if line is not None:record['line_ends']={local(e.tag):dict(e.attrib) for e in line if local(e.tag) in ('headEnd','tailEnd')}
                    locks=[dict(e.attrib) for e in node.iter() if local(e.tag) in ('spLocks','picLocks','cxnSpLocks','grpSpLocks')]
                    if locks:record['locks']=locks
                    if kind=='pic':
                        media=[]
                        for e in node.iter():
                            if local(e.tag) in ('blip','svgBlip'):
                                for k in ('embed','link'):
                                    rid=e.get(RID+k)
                                    if rid:
                                        m={'rid':rid,'source_node':local(e.tag),**rels.get(rid,{'missing_relationship':True})}
                                        if m.get('target') and not m.get('external'):m['part_present']=m['target'] in z.namelist()
                                        media.append(m)
                        record['media']=media
                        record['svg_picture']=any(m['source_node']=='svgBlip' or m.get('target','').lower().endswith('.svg') for m in media)
                        b=record['bounds_emu_local']
                        record['top_level_canvas_coverage']=round(b['cx']*b['cy']/(dimensions[0]*dimensions[1]),5) if not groups and b and b['cx'] and b['cy'] else None
                    if kind=='graphicFrame':
                        record['table']=node.find('.//a:tbl',NS) is not None
                        record['chart']=node.find('.//c:chart',NS) is not None
                    items.append(record)
            walk(tree,[])
            ids=[e['id'] for e in items if e['id'] is not None];background=slide.find('p:cSld/p:bg',NS)
            slides.append({'slide_number':n,'part':part,'counts':counts,
                           'text_object_count':sum(bool(e.get('text')) for e in items),
                           'duplicate_shape_ids':sorted({i for i in ids if ids.count(i)>1}),
                           'background_has_picture_fill':background is not None and background.find('.//a:blipFill',NS) is not None,
                           'external_relationships':[x for x in rels.values() if x['external']],
                           'items':items})
        return {'schema':'paper-figure-replica.pptx-inventory.v1','file':str(path.resolve()),
                'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'slide_size_emu':dimensions,
                'slide_size_in':[x/914400 for x in dimensions],'slide_count':len(slides),'slides':slides,
                'limitations':['Inventory only; no visual, font availability, text overflow or scientific correctness verification.',
                               'Object coordinates inside groups are local; picture coverage is reported only at top level.',
                               'Theme/master inherited properties and all extension internals are not resolved.',
                               'PowerPoint live editing and reference-layer exclusion must be checked separately.']}

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('pptx',type=Path);ap.add_argument('--out',type=Path);args=ap.parse_args()
    try:
        if args.out and args.out.resolve()==args.pptx.resolve():raise ValueError('Output cannot replace input')
        result=inspect(args.pptx)
        if args.out:
            with args.out.open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
            print(json.dumps({'report':str(args.out.resolve()),'slide_count':result['slide_count']}))
        else:print(json.dumps(result,ensure_ascii=False,indent=2))
        return 0
    except (OSError,ValueError,KeyError,ET.ParseError,BadZipFile) as exc:
        print('error: '+str(exc),file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
