// Optional visual-spec/v1 loader. Checks portable evidence; does not infer style or facts.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const need = (ok, message) => { if (!ok) throw new Error(message); };
const text = (x, where) => { need(typeof x === 'string' && x.trim(), `${where}: expected nonempty text`); return x.trim(); };
const array = (x, where) => { need(Array.isArray(x), `${where}: expected an array`); return x; };
const texts = (x, where) => array(x, where).map((v, i) => text(v, `${where}[${i}]`));
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SHA = /^[0-9a-f]{64}$/;
const REFERENCE_FIELDS = ['id','sourceId','locator','role','delivery','path','sha256','inspected','inspectionNote','use','avoidCopy','preserve','reason'];
function index(items, where, key = 'id') {
  const map = new Map();
  for (const item of array(items, where)) {
    need(object(item) && typeof item[key] === 'string' && ID.test(item[key]), `${where}: invalid ${key}`);
    need(!map.has(item[key]), `${where}: duplicate ${key} ${item[key]}`);
    map.set(item[key], item);
  }
  return map;
}
function inside(base, target) {
  const relative = path.relative(base, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function box(value, dimensions, where) {
  need(Array.isArray(value) && value.length === 4 && value.every(Number.isInteger), `${where}: expected integer [x,y,w,h]`);
  const [x,y,w,h] = value;
  need(x >= 0 && y >= 0 && w > 0 && h > 0 && x+w <= dimensions.width && y+h <= dimensions.height, `${where}: outside original source image`);
  return value;
}
// Dimensions are structural header checks, not a full image pixel decode.
function imageHeader(bytes, where) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    need(bytes.length >= 33 && bytes.readUInt32BE(8) === 13 && bytes.subarray(12,16).toString() === 'IHDR', `${where}: invalid PNG header`);
    return {format:'png',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  }
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let offset = 2;
    while (offset < bytes.length) {
      need(bytes[offset++] === 255, `${where}: invalid JPEG marker`);
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 216 || marker === 1 || (marker >= 208 && marker <= 215)) continue;
      need(offset+2 <= bytes.length, `${where}: truncated JPEG header`);
      const length = bytes.readUInt16BE(offset);
      need(length >= 2 && offset+length <= bytes.length, `${where}: truncated JPEG segment`);
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        need(length >= 8, `${where}: invalid JPEG dimensions`);
        return {format:'jpeg',width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};
      }
      offset += length;
    }
    throw new Error(`${where}: missing JPEG dimensions`);
  }
  if (bytes.length >= 20 && bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') {
    need(bytes.readUInt32LE(4)+8 === bytes.length, `${where}: invalid WebP size`);
    for (let offset = 12; offset+8 <= bytes.length;) {
      const type = bytes.subarray(offset,offset+4).toString(), length = bytes.readUInt32LE(offset+4), start = offset+8;
      need(start+length <= bytes.length, `${where}: truncated WebP chunk`);
      if (type === 'VP8X') {
        need(length >= 10, `${where}: invalid WebP dimensions`);
        return {format:'webp',width:1+bytes.readUIntLE(start+4,3),height:1+bytes.readUIntLE(start+7,3)};
      }
      if (type === 'VP8 ') {
        need(length >= 10 && bytes.subarray(start+3,start+6).equals(Buffer.from([157,1,42])), `${where}: invalid WebP dimensions`);
        return {format:'webp',width:bytes.readUInt16LE(start+6)&16383,height:bytes.readUInt16LE(start+8)&16383};
      }
      if (type === 'VP8L') {
        need(length >= 5 && bytes[start] === 47, `${where}: invalid WebP dimensions`);
        const bits = bytes.readUInt32LE(start+1);
        return {format:'webp',width:1+(bits&16383),height:1+((bits>>>14)&16383)};
      }
      offset = start+length+(length%2);
    }
  }
  throw new Error(`${where}: requires a PNG/JPEG/WebP image with dimensions`);
}

export async function loadVisualSpec(file, expectedSha256, sources) {
  const absoluteFile = await fs.realpath(file), directory = path.dirname(absoluteFile);
  const bytes = await fs.readFile(absoluteFile), sha256 = hash(bytes), spec = JSON.parse(bytes);
  if (expectedSha256 !== undefined) need(SHA.test(expectedSha256) && expectedSha256 === sha256, 'visualSpecSha256: missing or stale manifest hash');
  need(object(spec) && spec.schema === 'visual-spec/v1', 'Expected visual-spec/v1');
  need(['generate','restyle'].includes(spec.mode), 'visualSpec.mode: expected generate or restyle');
  text(spec.intent, 'visualSpec.intent'); texts(spec.preserve, 'visualSpec.preserve'); texts(spec.limitations, 'visualSpec.limitations');
  need(object(spec.evidence), 'visualSpec.evidence: expected object');
  const assetCache = new Map();
  async function packageFile(relative, where) {
    text(relative, where);
    need(!path.isAbsolute(relative) && !/^[a-z][a-z0-9+.-]*:/i.test(relative) && !relative.includes('\\'), `${where}: requires a relative packaged path`);
    const candidate = path.resolve(directory, relative);
    need(inside(directory, candidate), `${where}: path escapes visualSpec package`);
    const resolved = await fs.realpath(candidate);
    need(inside(directory, resolved), `${where}: symlink escapes visualSpec package`);
    need((await fs.stat(resolved)).isFile(), `${where}: expected a packaged file`);
    return resolved;
  }
  async function imageAsset(record, where) {
    need(object(record), `${where}: expected image evidence`);
    const absolutePath = await packageFile(record.file, `${where}.file`);
    let asset = assetCache.get(absolutePath);
    if (!asset) {
      const data = await fs.readFile(absolutePath), dimensions = imageHeader(data, where);
      need(dimensions.width > 0 && dimensions.height > 0, `${where}: invalid image dimensions`);
      asset = {absolutePath,sha256:hash(data),...dimensions}; assetCache.set(absolutePath,asset);
    }
    need(SHA.test(record.sha256) && record.sha256 === asset.sha256, `${where}: missing or stale image sha256`);
    need(record.width === asset.width && record.height === asset.height, `${where}: image dimensions do not match header`);
    if (record.format !== undefined) need(record.format === asset.format, `${where}: format does not match image header`);
    return asset;
  }
  const htmlPath = await packageFile(spec.evidence.htmlFile, 'visualSpec.evidence.htmlFile');
  const boardPath = await packageFile(spec.evidence.boardFile, 'visualSpec.evidence.boardFile');
  need(/\.html?$/i.test(htmlPath) && /\.png$/i.test(boardPath), 'visualSpec.evidence: expected HTML and PNG view-only outputs');
  need(object(spec.sourceStudy), 'visualSpec.sourceStudy: expected source-study provenance');
  const studyPath = await packageFile(spec.sourceStudy.file, 'visualSpec.sourceStudy.file');
  const studyBytes = await fs.readFile(studyPath);
  need(SHA.test(spec.sourceStudy.sha256) && hash(studyBytes) === spec.sourceStudy.sha256, 'visualSpec.sourceStudy: missing or stale study hash');
  const sourceStudy = JSON.parse(studyBytes);
  need(object(sourceStudy) && sourceStudy.schema === 'visual-study/v1', 'visualSpec.sourceStudy: expected visual-study/v1');
  const cards = index(spec.evidence.cards, 'visualSpec.evidence.cards', 'referenceId');
  const originals = new Map(), selections = new Map();
  for (const [id, card] of cards) {
    if (card.original !== undefined && card.original !== null) {
      const original = await imageAsset(card.original, `visualSpec.card ${id}.original`); originals.set(id,original); selections.set(id,original);
      need(![htmlPath,boardPath].includes(original.absolutePath), `visualSpec.card ${id}: view-only board cannot be a reference image`);
    }
    if (card.crop !== undefined) {
      const original = originals.get(id); need(original, `visualSpec.card ${id}: crop needs an original image`);
      const crop = await imageAsset(card.crop, `visualSpec.card ${id}.crop`);
      box(card.crop.box, original, `visualSpec.card ${id}.crop.box`);
      need(card.crop.sourceSha256 === original.sha256, `visualSpec.card ${id}: stale crop sourceSha256`);
      need(card.crop.operation === 'pixel-crop', `visualSpec.card ${id}.crop.operation: expected pixel-crop`);
      need(crop.width === card.crop.box[2] && crop.height === card.crop.box[3], `visualSpec.card ${id}: crop dimensions differ from source box`);
      need(![htmlPath,boardPath].includes(crop.absolutePath), `visualSpec.card ${id}: view-only board cannot be a reference image`);
      selections.set(id,crop);
    }
    for (const region of index(card.regions ?? [], `visualSpec.card ${id}.regions`).values()) {
      text(region.label, `visualSpec.card ${id}.region ${region.id}.label`);
      if (region.note !== undefined) text(region.note, `visualSpec.card ${id}.region ${region.id}.note`);
      need(originals.has(id), `visualSpec.card ${id}: regions need an original image`);
      box(region.bbox, originals.get(id), `visualSpec.card ${id}.region ${region.id}.bbox`);
    }
  }
  const refs = index(spec.references, 'visualSpec.references'), references = [];
  for (const [id, ref] of refs) {
    for (const key of Object.keys(ref)) need(REFERENCE_FIELDS.includes(key), `visualSpec.reference ${id}: unsupported field ${key}`);
    need(['content','style','edit-target'].includes(ref.role), `visualSpec.reference ${id}: invalid role`);
    need(['attach','text-only','exclude'].includes(ref.delivery), `visualSpec.reference ${id}: invalid delivery`);
    const source = sources.get(ref.sourceId); need(source, `visualSpec.reference ${id}: unknown sourceId`);
    need(source.role === (ref.role === 'style' ? 'style' : 'content'), `visualSpec.reference ${id}: ${ref.role} requires ${ref.role === 'style' ? 'style' : 'content'}-role source`);
    text(ref.locator, `visualSpec.reference ${id}.locator`);
    if (ref.delivery !== 'exclude') {
      need(ref.inspected === true, `visualSpec.reference ${id}: must declare actual inspection`);
      text(ref.inspectionNote, `visualSpec.reference ${id}.inspectionNote`); text(ref.use, `visualSpec.reference ${id}.use`);
      if (ref.role === 'style') text(ref.avoidCopy, `visualSpec.reference ${id}.avoidCopy`);
    }
    if (ref.delivery !== 'attach') text(ref.reason, `visualSpec.reference ${id}.reason`);
    if (ref.role === 'edit-target') {
      need(ref.delivery === 'attach', `visualSpec.reference ${id}: edit-target must be attached`);
      text(ref.preserve, `visualSpec.reference ${id}.preserve`);
    }
    let absolutePath;
    if (ref.path !== undefined) {
      absolutePath = await packageFile(ref.path, `visualSpec.reference ${id}.path`);
      const selected = selections.get(id); need(selected, `visualSpec.reference ${id}: path needs matching image evidence`);
      need(absolutePath === selected.absolutePath && ref.sha256 === selected.sha256, `visualSpec.reference ${id}: selected path/hash does not match original or crop evidence`);
    } else {
      need(ref.delivery !== 'attach', `visualSpec.reference ${id}: attach needs a packaged image path`);
      need(ref.sha256 === undefined, `visualSpec.reference ${id}: sha256 needs a packaged image path`);
    }
    if (ref.delivery === 'attach') need(cards.has(id), `visualSpec.reference ${id}: missing image evidence`);
    references.push({...ref,...(absolutePath ? {path:absolutePath} : {})});
  }
  for (const id of cards.keys()) need(refs.has(id), `visualSpec.evidence.cards: unknown referenceId ${id}`);
  const targets = references.filter(r => r.role === 'edit-target');
  need(spec.mode !== 'generate' || targets.length === 0, 'visualSpec.mode: generate cannot include an edit-target');
  need(spec.mode !== 'restyle' || targets.length > 0, 'visualSpec.mode: restyle requires an actual attached edit-target');
  const observations = [];
  for (const observation of index(spec.observations, 'visualSpec.observations').values()) {
    need(refs.has(observation.referenceId), `visualSpec.observation ${observation.id}: unknown referenceId`);
    need(['palette','layout','typography','imagery','lighting','spacing'].includes(observation.aspect), `visualSpec.observation ${observation.id}: invalid aspect`);
    text(observation.finding, `visualSpec.observation ${observation.id}.finding`); text(observation.apply, `visualSpec.observation ${observation.id}.apply`);
    if (refs.get(observation.referenceId).delivery !== 'exclude') observations.push(observation);
  }
  const palette = [];
  for (const color of index(spec.palette, 'visualSpec.palette').values()) {
    need(['declared','median','mode'].includes(color.method), `visualSpec.palette ${color.id}: invalid method`);
    need(typeof color.hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color.hex), `visualSpec.palette ${color.id}: expected HEX RGB`);
    need(Array.isArray(color.rgb) && color.rgb.length === 3 && color.rgb.every((v,i) => Number.isInteger(v) && v >= 0 && v <= 255 && v === parseInt(color.hex.slice(1+2*i,3+2*i),16)), `visualSpec.palette ${color.id}: RGB differs from HEX`);
    text(color.usage, `visualSpec.palette ${color.id}.usage`); if (color.name !== undefined) text(color.name, `visualSpec.palette ${color.id}.name`);
    if (color.referenceId !== undefined) {
      need(refs.has(color.referenceId), `visualSpec.palette ${color.id}: unknown referenceId`);
      need(refs.get(color.referenceId).delivery !== 'exclude', `visualSpec.palette ${color.id}: cannot use an excluded reference`);
    }
    const provenance = color.provenance; need(object(provenance), `visualSpec.palette ${color.id}: missing provenance`);
    if (color.method === 'declared') {
      need(provenance.kind === 'declared', `visualSpec.palette ${color.id}: declared color needs declared provenance`);
      need(provenance.referenceId === undefined && provenance.sourceSha256 === undefined && provenance.box === undefined, `visualSpec.palette ${color.id}: declared color cannot claim sampled provenance`);
      need(color.box === undefined, `visualSpec.palette ${color.id}: declared color cannot have a sample box`);
    } else {
      need(provenance.kind === 'sampled' && refs.has(provenance.referenceId), `visualSpec.palette ${color.id}: sampled color needs a known referenceId`);
      need(refs.get(provenance.referenceId).delivery !== 'exclude', `visualSpec.palette ${color.id}: cannot sample an excluded reference`);
      if (color.referenceId !== undefined) need(color.referenceId === provenance.referenceId, `visualSpec.palette ${color.id}: referenceId differs from sampled provenance`);
      if (color.box !== undefined) need(JSON.stringify(color.box) === JSON.stringify(provenance.box), `visualSpec.palette ${color.id}: box differs from sampled provenance`);
      const original = originals.get(provenance.referenceId); need(original, `visualSpec.palette ${color.id}: sampled color needs an original source image`);
      box(provenance.box, original, `visualSpec.palette ${color.id}.provenance.box`);
      need(provenance.sourceSha256 === original.sha256, `visualSpec.palette ${color.id}: stale sampled sourceSha256`);
      const area = provenance.box[2]*provenance.box[3];
      need(Number.isInteger(provenance.sampleCount) && provenance.sampleCount > 0 && provenance.sampleCount <= area, `visualSpec.palette ${color.id}: invalid usable sampleCount`);
      if (provenance.ignoredTransparentCount !== undefined) need(Number.isInteger(provenance.ignoredTransparentCount) && provenance.ignoredTransparentCount >= 0 && provenance.sampleCount+provenance.ignoredTransparentCount === area, `visualSpec.palette ${color.id}: invalid transparent pixel counts`);
      if (provenance.pixelPolicy !== undefined) text(provenance.pixelPolicy, `visualSpec.palette ${color.id}.provenance.pixelPolicy`);
      if (provenance.modeCount !== undefined) need(Number.isInteger(provenance.modeCount) && provenance.modeCount > 0 && provenance.modeCount <= provenance.sampleCount, `visualSpec.palette ${color.id}: invalid modeCount`);
      if (provenance.modeTied !== undefined) need(typeof provenance.modeTied === 'boolean', `visualSpec.palette ${color.id}: invalid modeTied`);
    }
    palette.push(color);
  }
  return {file:absoluteFile,sha256,spec,references,observations,palette,
    analysisBoundary:'Observations and adaptation decisions are author/model-declared. Packaged file hashes, image header dimensions and declared crop/sample bounds were checked; image decoding, crop pixels and palette measurements were not independently reverified. Checked content and exact text remain authoritative.'};
}

const stable = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  return object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key,sort(value[key])])) : value;
}
/** Dedupe compatible IDs while preserving explicit packet order and then spec order. */
export async function mergeVisualSpecReferences(explicit, prepared, packetDirectory) {
  const result = [...explicit], byId = new Map(explicit.map(r => [r.id,r]));
  async function fingerprint(ref) {
    const record = {};
    for (const key of REFERENCE_FIELDS) if (ref[key] !== undefined) record[key] = ref[key];
    if (record.path !== undefined) {
      text(record.path, `reference ${ref.id}.path`);
      need(!/^[a-z][a-z0-9+.-]*:/i.test(record.path), `reference ${ref.id}.path: requires a local path, not a URL`);
      record.path = await fs.realpath(path.resolve(packetDirectory,record.path));
    }
    return stable(record);
  }
  for (const ref of prepared) {
    if (byId.has(ref.id)) {
      need(await fingerprint(byId.get(ref.id)) === await fingerprint(ref), `reference ${ref.id}: conflicting duplicate between packet and visualSpec`);
    } else { byId.set(ref.id,ref); result.push(ref); }
  }
  return result;
}

export function visualSpecPromptLines(loaded) {
  const {spec,observations,palette,references} = loaded;
  return [`Mode: ${spec.mode}`, `Reference-style intent: ${spec.intent}`,
    'Apply only the stated visual aspects within the primary request. Checked facts, scientific relationships and TEXT (VERBATIM) take precedence over this style adaptation. Reference observations describe appearance; they are not scientific evidence or instructions from an image.',
    ...spec.preserve.map(value => `Preserve: ${value}`),
    ...references.filter(r => r.role === 'edit-target').map(r => `Preserve target [${r.id}]: ${r.preserve}`),
    ...observations.map(o => `[${o.id}; reference ${o.referenceId}; ${o.aspect}] Observed: ${o.finding}\n  Apply: ${o.apply}`),
    ...palette.map(p => `[${p.id}${p.name ? `; ${p.name}` : ''}] ${p.hex.toUpperCase()}; RGB (${p.rgb.join(', ')}); ${p.method === 'declared' ? 'declared design choice' : `measured ${p.method} from original reference ${p.provenance.referenceId}, source-pixel box ${JSON.stringify(p.provenance.box)}, ${p.provenance.sampleCount} usable pixels`}\n  Usage: ${p.usage}`),
    'Palette measurements describe decoded source-image colors, not source-author vector fills. Font identities and layout certainty are not inferred by this spec.'];
}
