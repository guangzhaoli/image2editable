#target illustrator
/* Read-only Illustrator artwork inventory. ES3 / ExtendScript.
   Only the chosen JSON report is written; no document or preferences are changed.
   Run with File > Scripts > Other Script. Copy before adjusting configuration.
   Native Illustrator execution is not yet verified by the skill's author. */
(function () {
    var OUTPUT_PATH = ""; // New absolute .json path; empty opens a save dialog.
    var ALLOW_OVERWRITE = false;
    var MAX_ITEMS = 20000;
    var MAX_CHARACTERS = 200000; // Global font-character scan budget.
    var MAX_TEXT_LENGTH = 50000; // Per frame, report contents only.
    var MAX_DEPTH = 128;
    var report = {
        schema: "paper-figure-replica.illustrator-inspection.v1",
        inspectionComplete: true,
        errors: [], warnings: [], layers: [], artboards: [], items: [],
        clippingPaths: [], fonts: [], countsByPageItemType: {},
        limits: {itemsPerCollection: MAX_ITEMS, fontCharacters: MAX_CHARACTERS,
                 textLengthPerFrame: MAX_TEXT_LENGTH, ancestryDepth: MAX_DEPTH},
        scope: "document.pageItems inventory; layers and pathItems inspected separately",
        fontCharactersScanned: 0,
        inspectedTextFrameCount: 0
    };
    var fontSeen = {};
    function error(context, e) {
        report.inspectionComplete = false;
        report.errors.push({context: context, message: String(e)});
    }
    function warn(message) {
        report.inspectionComplete = false;
        report.warnings.push(message);
    }
    function read(object, key, context) {
        try {
            var value = object[key];
            if (typeof value === "undefined") {
                error(context + "." + key, "Property unavailable");
                return null;
            }
            return value;
        } catch (e) { error(context + "." + key, e); return null; }
    }
    function rect(value) {
        if (value === null) { return null; }
        return [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])];
    }
    function lengthOf(collection, context) {
        if (!collection) { return 0; }
        var value = read(collection, "length", context);
        return value === null ? 0 : Number(value);
    }
    function boundedLength(collection, context) {
        var n = lengthOf(collection, context);
        if (n > MAX_ITEMS) { warn(context + " truncated at " + MAX_ITEMS + " of " + n); }
        return Math.min(n, MAX_ITEMS);
    }
    function ancestors(item, context) {
        var out = {hidden: false, locked: false, containers: []};
        var parent = read(item, "parent", context);
        var depth = 0;
        while (parent && depth < MAX_DEPTH) {
            var kind = read(parent, "typename", context + ".parent");
            if (kind === "Document" || kind === "Application" || kind === null) { break; }
            var name = read(parent, "name", context + ".parent");
            out.containers.push({type: kind, name: name});
            if (read(parent, "locked", context + ".parent") === true) { out.locked = true; }
            if (kind === "Layer") {
                if (read(parent, "visible", context + ".parent") === false) { out.hidden = true; }
            } else if (read(parent, "hidden", context + ".parent") === true) {
                out.hidden = true;
            }
            parent = read(parent, "parent", context + ".parent");
            depth++;
        }
        if (depth >= MAX_DEPTH) { warn(context + " ancestry truncated"); }
        return out;
    }
    function addUnique(array, value) {
        var i;
        for (i = 0; i < array.length; i++) { if (array[i] === value) { return; } }
        array.push(value);
    }
    function textDetails(item, context) {
        var out = {contents: read(item, "contents", context), fontNames: [],
                   fontSizesPt: [], charactersScanned: 0, fontScanComplete: true};
        if (out.contents !== null && out.contents.length > MAX_TEXT_LENGTH) {
            out.originalContentLength = out.contents.length;
            out.contents = out.contents.substring(0, MAX_TEXT_LENGTH);
            out.contentsTruncated = true;
            warn(context + " text contents truncated");
        }
        var chars = read(item, "characters", context);
        var n = lengthOf(chars, context + ".characters");
        out.characterCount = n;
        var scan = Math.min(n, Math.max(0, MAX_CHARACTERS - report.fontCharactersScanned));
        if (scan < n) {
            out.fontScanComplete = false;
            warn(context + " font scan truncated at " + scan + " of " + n + " characters");
        }
        var i;
        for (i = 0; i < scan; i++) {
            try {
                var attrs = chars[i].characterAttributes;
                var font = attrs.textFont;
                var fontName = String(font.name);
                addUnique(out.fontNames, fontName);
                addUnique(out.fontSizesPt, Number(attrs.size));
                if (!fontSeen["font:" + fontName]) {
                    fontSeen["font:" + fontName] = true;
                    report.fonts.push({name: fontName, family: String(font.family),
                                       style: String(font.style)});
                }
            } catch (e) {
                out.fontScanComplete = false;
                error(context + ".characters[" + i + "]", e);
            }
            out.charactersScanned++;
            report.fontCharactersScanned++;
        }
        return out;
    }
    function linkDetails(item, context) {
        var file = read(item, "file", context);
        if (!file) { return {path: null, exists: null}; }
        return {path: read(file, "fsName", context + ".file"),
                exists: read(file, "exists", context + ".file")};
    }
    function inspectItem(item, index) {
        var context = "pageItems[" + index + "]";
        var kind = read(item, "typename", context);
        var out = {index: index, type: kind, name: read(item, "name", context),
                   locked: read(item, "locked", context), hidden: read(item, "hidden", context),
                   geometricBoundsPt: rect(read(item, "geometricBounds", context)),
                   visibleBoundsPt: rect(read(item, "visibleBounds", context))};
        var parents = ancestors(item, context);
        out.containers = parents.containers;
        out.effectiveLocked = out.locked === true || parents.locked;
        out.effectiveHidden = out.hidden === true || parents.hidden;
        var key = kind === null ? "Unknown" : String(kind);
        report.countsByPageItemType[key] = (report.countsByPageItemType[key] || 0) + 1;
        // Adobe's "Rotate a text art item" example uses runtime typename TextFrame,
        // although the JavaScript reference chapter is titled TextFrameItem.
        if (kind === "TextFrame" || kind === "TextFrameItem") {
            out.text = textDetails(item, context);
            report.inspectedTextFrameCount++;
        }
        if (kind === "GroupItem") { out.clipped = read(item, "clipped", context); }
        if (kind === "PathItem") {
            out.clipping = read(item, "clipping", context);
            out.closed = read(item, "closed", context);
            out.stroked = read(item, "stroked", context);
            out.strokeWidthPt = read(item, "strokeWidth", context);
            out.pathPointCount = lengthOf(read(item, "pathPoints", context), context + ".pathPoints");
        }
        if (kind === "PlacedItem") {
            out.assetKind = "placed link; may contain vector or raster content";
            out.link = linkDetails(item, context);
        }
        if (kind === "RasterItem") {
            out.embedded = read(item, "embedded", context);
            if (out.embedded === false) { out.link = linkDetails(item, context); }
        }
        return out;
    }
    function inspectLayers(collection, parentPath, depth) {
        if (depth >= MAX_DEPTH) { warn("Layer tree depth truncated"); return; }
        var n = boundedLength(collection, "layers " + parentPath);
        var i;
        for (i = 0; i < n; i++) {
            try {
                var layer = collection[i];
                var context = parentPath + "/layers[" + i + "]";
                var parents = ancestors(layer, context);
                var locked = read(layer, "locked", context);
                var visible = read(layer, "visible", context);
                report.layers.push({id: context, name: read(layer, "name", context), depth: depth,
                    locked: locked, visible: visible, effectiveLocked: locked === true || parents.locked,
                    effectiveHidden: visible === false || parents.hidden});
                inspectLayers(read(layer, "layers", context), context, depth + 1);
            } catch (e) { error("layers[" + i + "]", e); }
        }
    }
    function quoted(value) {
        var s = String(value), out = '"', i, code, c, hex;
        for (i = 0; i < s.length; i++) {
            c = s.charAt(i); code = s.charCodeAt(i);
            if (c === '"') { out += '\\"'; }
            else if (c === "\\") { out += "\\\\"; }
            else if (code < 32 || code === 0x2028 || code === 0x2029 ||
                     (code >= 0xD800 && code <= 0xDFFF)) {
                hex = code.toString(16);
                out += "\\u" + ("0000" + hex).slice(-4);
            } else { out += c; }
        }
        return out + '"';
    }
    function json(value) {
        if (value === null || typeof value === "undefined") { return "null"; }
        if (typeof value === "string") { return quoted(value); }
        if (typeof value === "number") { return isFinite(value) ? String(value) : "null"; }
        if (typeof value === "boolean") { return value ? "true" : "false"; }
        var parts = [], i, key;
        if (value instanceof Array) {
            for (i = 0; i < value.length; i++) { parts.push(json(value[i])); }
            return "[" + parts.join(",") + "]";
        }
        for (key in value) {
            if (value.hasOwnProperty(key)) { parts.push(quoted(key) + ":" + json(value[key])); }
        }
        return "{" + parts.join(",") + "}";
    }
    var destination = OUTPUT_PATH ? new File(OUTPUT_PATH) :
        File.saveDialog("Save paper figure inspection as a new JSON file");
    if (!destination) { return; }
    if (!/\.json$/i.test(destination.name)) { throw new Error("Choose a .json report filename."); }
    if (!destination.parent.exists) { throw new Error("Report parent folder does not exist."); }
    if (destination.exists && !ALLOW_OVERWRITE) { throw new Error("Report already exists; choose a new filename."); }
    try {
        report.application = {name: String(app.name), version: String(app.version)};
        report.timestampUTC = new Date().toUTCString();
        if (app.documents.length === 0) { throw new Error("No active Illustrator document."); }
        var doc = app.activeDocument;
        report.document = {name: read(doc, "name", "document"),
            saved: read(doc, "saved", "document"), fullName: null,
            colorSpace: String(read(doc, "documentColorSpace", "document"))};
        // fullName is legitimately unavailable for a document never saved to disk.
        try { report.document.fullName = doc.fullName.fsName; }
        catch (unsaved) { report.document.fullNameUnavailable = true; }
        report.collectionCounts = {};
        var collectionNames = ["pageItems", "pathItems", "textFrames", "placedItems", "rasterItems", "layers", "artboards"];
        var i, n, collection;
        for (i = 0; i < collectionNames.length; i++) {
            collection = read(doc, collectionNames[i], "document");
            report.collectionCounts[collectionNames[i]] = collection ? lengthOf(collection, collectionNames[i]) : null;
        }
        collection = read(doc, "artboards", "document");
        n = boundedLength(collection, "artboards");
        for (i = 0; i < n; i++) {
            try { report.artboards.push({index: i, name: String(collection[i].name),
                    rectPt: rect(collection[i].artboardRect)}); }
            catch (e) { error("artboards[" + i + "]", e); }
        }
        inspectLayers(read(doc, "layers", "document"), "document", 0);
        collection = read(doc, "pageItems", "document");
        n = boundedLength(collection, "pageItems");
        for (i = 0; i < n; i++) {
            try { report.items.push(inspectItem(collection[i], i)); }
            catch (e) { error("pageItems[" + i + "]", e); }
        }
        if (report.collectionCounts.textFrames !== null &&
            report.inspectedTextFrameCount !== report.collectionCounts.textFrames) {
            warn("Text frame inventory incomplete: inspected " + report.inspectedTextFrameCount +
                 " of " + report.collectionCounts.textFrames + ". Check scan limits and runtime object types.");
        }
        collection = read(doc, "pathItems", "document");
        n = boundedLength(collection, "pathItems");
        for (i = 0; i < n; i++) {
            try {
                if (collection[i].clipping) {
                    report.clippingPaths.push({pathCollectionIndex: i,
                        name: String(collection[i].name), boundsPt: rect(collection[i].geometricBounds)});
                }
            } catch (e) { error("pathItems[" + i + "]", e); }
        }
        report.savedStateAfterInspection = read(doc, "saved", "document");
    } catch (e) { error("inspection", e); }
    destination.encoding = "UTF-8";
    if (!destination.open("w")) { throw new Error("Cannot open report: " + destination.error); }
    try {
        if (!destination.write(json(report) + "\n")) { throw new Error("Cannot write report: " + destination.error); }
    } finally { destination.close(); }
    $.writeln("Paper figure inspection: " + destination.fsName);
}());
