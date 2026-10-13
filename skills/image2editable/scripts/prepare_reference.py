#!/usr/bin/env python3
"""Prepare measured color samples, asset crops and a 1:1 tracing board.

Requires Pillow. Takes a raster and a JSON plan; performs no scene recognition,
automatic vectorization, image enhancement, or background removal.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sys
from xml.sax.saxutils import escape

from PIL import Image, ImageCms, ImageDraw, ImageOps


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, data):
    with path.open('x', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write('\n')


def save_png(path, image, icc_profile=None):
    with path.open('xb') as f:
        kwargs = {'icc_profile':icc_profile} if icc_profile else {}
        image.save(f, format='PNG', **kwargs)


def rect(value, size):
    if not isinstance(value, list) or len(value) != 4 or any(type(n) is not int for n in value):
        raise ValueError('rect_px must be [x, y, width, height] with integer values')
    x, y, w, h = value
    if min(x, y) < 0 or min(w, h) < 1 or x+w > size[0] or y+h > size[1]:
        raise ValueError(f'rect_px {value} is outside image size {size}')
    return (x, y, x+w, y+h)


def load_reference(path, color_policy):
    with Image.open(path) as im:
        if getattr(im, 'n_frames', 1) != 1:
            raise ValueError('Select one raster frame before preparing the reference')
        mode = im.mode
        orientation = im.getexif().get(274)
        profile = im.info.get('icc_profile')
        im = ImageOps.exif_transpose(im)
        im.load()
        alpha = im.convert('RGBA').getchannel('A')
        had_alpha = 'A' in im.getbands() or 'transparency' in im.info
        transform = False
        profile_name = None
        if profile and color_policy == 'srgb':
            source = ImageCms.ImageCmsProfile(io.BytesIO(profile))
            profile_name = ImageCms.getProfileName(source).strip()
            # Keep source mode where CMS needs it, e.g. CMYK/LAB.
            base = im if im.mode in ('RGB', 'CMYK', 'LAB', 'L') else im.convert('RGB')
            rgb = ImageCms.profileToProfile(base, source, ImageCms.createProfile('sRGB'), outputMode='RGB')
            transform = True
        elif color_policy == 'srgb' and mode not in ('RGB', 'RGBA', 'L', 'LA', 'P', '1'):
            raise ValueError('Unprofiled non-RGB source needs a verified conversion; use raw mode only if intentional')
        else:
            rgb = im.convert('RGB')
        rgba = rgb.convert('RGBA')
        if had_alpha:
            rgba.putalpha(alpha)
        sampled = Image.alpha_composite(Image.new('RGBA', rgba.size, 'white'), rgba).convert('RGB')
        record = {
            'original_mode': mode, 'exif_orientation': orientation,
            'exif_orientation_applied': orientation in (2, 3, 4, 5, 6, 7, 8),
            'embedded_icc_sha256': hashlib.sha256(profile).hexdigest() if profile else None,
            'embedded_profile_name': profile_name, 'icc_transform_applied': transform,
            'policy': color_policy,
            'working_space': 'sRGB' if color_policy == 'srgb' else 'raw decoded channel values; not color managed',
            'untagged_rgb_assumed_srgb': not profile and color_policy == 'srgb',
            'sample_background': '#FFFFFF', 'source_has_alpha': had_alpha,
            'crop_pixel_policy': 'EXIF-normalized and profile-converted when recorded; original alpha retained; no resampling',
            'warning': 'Raster color samples are evidence about this raster, not proof of original vector fill values.'
        }
        return sampled, rgba, record


def sample(image, entry):
    crop = image.crop(rect(entry['rect_px'], image.size))
    raw = crop.tobytes()
    counts = Counter(tuple(raw[i:i+3]) for i in range(0, len(raw), 3))
    ranked = sorted(counts.items(), key=lambda v: (-v[1], v[0]))
    color, n = ranked[0]
    total = crop.width * crop.height
    return {
        'id': entry['id'], 'role': entry.get('role', entry['id']),
        'rect_px': entry['rect_px'], 'method': 'exact_rgb_mode',
        'hex': '#%02X%02X%02X' % color, 'rgb': list(color),
        'sample_count': total, 'mode_count': n, 'mode_fraction': n/total,
        'channel_min': [min(c[i] for c in counts) for i in range(3)],
        'channel_max': [max(c[i] for c in counts) for i in range(3)],
        'top_colors': [{'hex':'#%02X%02X%02X'%c,'count':v} for c,v in ranked[:5]],
        'mode_tied': len(ranked)>1 and ranked[0][1]==ranked[1][1],
        'interpretation': 'Observed dominant RGB in the declared patch; inspect patch for borders, text, gradients and compression.'
    }


def svg_header(w, h):
    return f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}px" height="{h}px" viewBox="0 0 {w} {h}">'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--out-dir', required=True, type=Path)
    parser.add_argument('--color-policy', choices=('srgb','raw'), default='srgb')
    parser.add_argument('--underlay-opacity', type=float, default=.35)
    args = parser.parse_args()
    try:
        image_path = args.image.expanduser().resolve()
        plan_path = args.plan.expanduser().resolve()
        out = args.out_dir.expanduser().resolve()
        if not math.isfinite(args.underlay_opacity) or not 0 <= args.underlay_opacity <= 1:
            raise ValueError('underlay opacity must be between 0 and 1')
        for p in (image_path, plan_path):
            if not p.is_file(): raise ValueError(f'Input missing: {p}')
            if out == p or out in p.parents: raise ValueError('Keep inputs outside the output directory')
        if out.exists() and (not out.is_dir() or any(out.iterdir())):
            raise ValueError('Output directory must be new or empty; existing files are not overwritten')
        plan = json.loads(plan_path.read_text())
        if not isinstance(plan, dict): raise ValueError('Plan must be a JSON object')
        image, rgba, color_record = load_reference(image_path, args.color_policy)
        ids=set()
        for field in ('samples','assets'):
            if not isinstance(plan.get(field,[]),list):raise ValueError(field+' must be a list')
            for item in plan.get(field,[]):
                if not isinstance(item,dict) or not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_-]{0,63}',item.get('id','')):
                    raise ValueError('Each sample/asset requires a safe, stable id')
                if item['id'] in ids:raise ValueError('Duplicate sample/asset id: '+item['id'])
                ids.add(item['id']);rect(item.get('rect_px'),image.size)
        colors=[sample(image,e) for e in plan.get('samples',[])]
        anchors=plan.get('anchors',[])
        if not isinstance(anchors,list):raise ValueError('anchors must be a list')
        for a in anchors:
            xy=a.get('xy_px',[]) if isinstance(a,dict) else []
            if len(xy)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in xy):
                raise ValueError('Anchor xy_px must be two finite numbers')
            if not (0<=xy[0]<=image.width and 0<=xy[1]<=image.height):raise ValueError('Anchor outside reference')
        out.mkdir(parents=True,exist_ok=True)
        output_profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes() if args.color_policy == 'srgb' else None
        save_png(out/'reference.png',image,output_profile)
        assets=[]
        if plan.get('assets'): (out/'assets').mkdir()
        for entry in plan.get('assets',[]):
            filename='assets/'+entry['id']+'.png'
            save_png(out/filename,rgba.crop(rect(entry['rect_px'],rgba.size)),output_profile)
            assets.append({**entry,'file':filename,'sha256':digest(out/filename),
                           'transform':'explicit rectangular crop only; no segmentation, matting, enhancement or resize',
                           'alpha_note':'Retains existing source alpha; an opaque white crop is not made transparent.'})
        overview=image.copy();draw=ImageDraw.Draw(overview)
        for item in plan.get('samples',[]):
            x,y,r,b=rect(item['rect_px'],image.size)
            draw.rectangle((x,y,r-1,b-1),outline='#D000AA',width=1)
            draw.text((min(x,image.width-40),max(0,y-12)),item['id'],fill='#D000AA')
        for item in plan.get('assets',[]):
            x,y,r,b=rect(item['rect_px'],image.size)
            draw.rectangle((x,y,r-1,b-1),outline='#006CDB',width=1)
        save_png(out/'sample-locations.png',overview,output_profile)
        palette=Image.new('RGB',(640,max(60,52*len(colors)+20)),'white');d=ImageDraw.Draw(palette)
        swatch_svg=[svg_header(640,max(60,52*len(colors)+20))]
        for i,c in enumerate(colors):
            y=10+i*52
            d.rectangle((10,y,86,y+38),fill=c['hex'],outline='#777777')
            d.text((100,y+2),f"{c['id']}   {c['hex']}   RGB {tuple(c['rgb'])}",fill='#111111')
            d.text((100,y+20),f"patch={c['rect_px']}  mode={c['mode_count']}/{c['sample_count']}",fill='#555555')
            swatch_svg.append(f'<g id="{c["id"]}"><rect x="10" y="{y}" width="76" height="38" fill="{c["hex"]}" stroke="#777"/><text x="100" y="{y+25}" font-family="Arial" font-size="16">{escape(c["id"]+" "+c["hex"])}</text></g>')
        save_png(out/'palette.png',palette,output_profile)
        with (out/'palette.svg').open('x') as f:f.write('\n'.join(swatch_svg+['</svg>']))
        write_json(out/'palette.json',colors)
        write_json(out/'assets.json',assets)
        source={'input_path':str(image_path),'input_sha256':digest(image_path),'plan_sha256':digest(plan_path),
                'normalized_reference_sha256':digest(out/'reference.png'),'color':color_record}
        spec={
            'schema':'paper-figure-replica.spec.v2','status':'prepared evidence; semantic objects still require verification',
            'source':source,'canvas':{'width':image.width,'height':image.height,'unit':'reference_px','origin':'top-left','reference_to_canvas':[1,0,0,1,0,0],
                                    'native_physical_size':'not calibrated; verify in target application'},
            'reference_layer':{'file':'reference.png','board_opacity':args.underlay_opacity,'lock_in_app_required':True,'hide_before_final_export':True},
            'palette':colors,'assets':assets,'anchors':anchors,
            'objects':plan.get('objects',[]),'texts':plan.get('texts',[]),'connections':plan.get('connections',[]),
            'geometry_note':'Object geometry/text/relationships supplied in plan are copied, not inferred or verified by this script.'
        }
        write_json(out/'reference-measurements.json',spec)
        data=base64.b64encode((out/'reference.png').read_bytes()).decode('ascii')
        board=[svg_header(image.width,image.height),'<title>Tracing preparation — reference must be hidden in final export</title>',
               f'<g id="REFERENCE_DO_NOT_EXPORT" opacity="{args.underlay_opacity}"><image x="0" y="0" width="{image.width}" height="{image.height}" xlink:href="data:image/png;base64,{data}"/></g>',
               '<g id="GUIDES_DO_NOT_EXPORT" fill="none" stroke="#007DBD" stroke-width=".6">']
        for a in anchors:
            x,y=a['xy_px'];board.append(f'<path d="M{x-3} {y} H{x+3} M{x} {y-3} V{y+3}"/>')
        board += ['</g>','<g id="RECONSTRUCTION"></g>','</svg>']
        with (out/'trace-board.svg').open('x') as f:f.write('\n'.join(board))
        print(json.dumps({'out_dir':str(out),'colors':len(colors),'asset_crops':len(assets),
                          'status':'preparation only; no figure reconstruction or native locking performed'}))
        return 0
    except (OSError,ValueError,TypeError,KeyError,ImageCms.PyCMSError) as exc:
        print('error: '+str(exc),file=sys.stderr)
        return 2


if __name__=='__main__':
    raise SystemExit(main())
