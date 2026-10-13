# Adobe Illustrator: editable paper-figure reconstruction

Use this branch when the requested master is `.ai`. Check the installed edition/version and the actual tools available before choosing a control route. Documentation checked on **2026-09-27**; the bundled inspector has not been run in a live Illustrator session.

## Choose a real control route

1. **Connected native tools:** Illustrator **Beta** has an Adobe-documented MCP server with document inspection, object/layer/group editing, previews, and exports. Use it if connected and its discovered tool schemas cover the task. Availability in Beta does not imply availability in every release or this session. Do not invent tool names or assume a configured connection. [Adobe MCP overview](https://helpx.adobe.com/in/illustrator/desktop/connect-with-other-apps-and-tools/about-using-ai-tools-with-illustrator.html) · [supported actions](https://helpx.adobe.com/in/illustrator/desktop/connect-with-other-apps-and-tools/work-with-illustrator-documents-from-ai-tools.html).
2. **ExtendScript:** Illustrator supports JavaScript/ExtendScript. Run an inspected `.jsx` through **File > Scripts > Other Script** or an already configured execution bridge. Use the Illustrator DOM and ES3-compatible syntax; ordinary Python and Node.js do not expose this DOM. Do not change application startup scripts or suppress external-script warnings. [Adobe execution instructions](https://helpx.adobe.com/in/illustrator/desktop/automate-visualize-data/automate-actions/install-and-run-scripts.html).
3. **Observed UI:** use available native-app automation when a operation is missing from the connected API. Inspect state before selecting commands; target the figure's document explicitly.
4. **No application access:** prepare an editable SVG/PDF and reconstruction assets, mark native saving and reopen verification pending, and deliver the usable intermediate. Renaming an SVG to `.ai` is not a native save.

If connection setup is requested, follow Adobe's [installation-specific MCP instructions](https://helpx.adobe.com/in/illustrator/desktop/connect-with-other-apps-and-tools/connect-illustrator-to-ai-tools.html). Read the actual URL/key from the application; never copy the example credentials or publish a key in artifacts.

## Construct the figure as native objects

For a raster reference, first read [reference preparation](reference-preparation.md). Place the original at calibrated coordinates in a locked template/reference layer; establish document swatches from undimmed source evidence. Use the measured spec and visible underlay together. Use native shapes/text/paths for regular diagram objects, and Image Trace only for regions whose outlines benefit from it. Expanded glyph outlines are not live labels. Test the actual native font family/style on representative text before repeating it across the figure.

- For a new figure, create a task-owned document. For an existing figure, identify the correct document and retain its original before substantial reconstruction. Do not use `app.activeDocument` blindly in a build/export script: verify the document name/path and target object references first.
- Make one artboard per requested figure or output panel, in the final physical dimensions. Record the document color mode/profile and the point-to-reference scale. Do not impose a fixed journal width or CMYK profile without a target requirement.
- Organize objects by panel and role: `A/axes`, `A/data`, `A/labels`, `B/diagram`, `legend`; a separate reference layer may be locked and hidden for output. Name meaningful groups so editing a label or connector does not require ungrouping the entire figure.
- Build rectangles, circles, line segments, and Bézier curves as native paths. Keep reusable nodes grouped; maintain connector endpoints when moving nodes. A native line plus grouped triangle is an acceptable editable arrow when an exposed arrowhead API is unavailable. Do not substitute undocumented menu-command strings for a verified API.
- Use point/area text for labels, panel letters, axis ticks, and legends. Resolve actual PostScript font names from installed fonts. Check Greek letters, minus signs, super/subscripts, and mathematical symbols visually. Preserve editable text wherever practical; record any formulas represented by vector outlines and retain their equation source.
- Rebuild charts from supplied data and the declared axis transform. If only a reference plot is available, document digitization/approximation and its limitations. Imported vector paths do not prove that the data behind them are recovered.
- Open/import editable SVG/PDF geometry when appropriate, then inspect the resulting objects. A placed PDF may remain a single linked object. Dense clipping groups and text fragments often need selective reorganization; do not blindly expand or release every mask.
- Keep photographs, microscopy panels, and other inherently raster content as documented linked/embedded raster assets. A whole-figure screenshot is a reference, not an editable reconstruction of the labels and diagram around it.

### Coordinates and dimensions in JSX

Illustrator DOM dimensions are generally in points. Use the artboard's actual `artboardRect` and verify direction on a small task-owned object; ruler origins and document history can vary. For a reference measured from its top-left, a common mapping is `x = left + u * scale`, `y = top - v * scale`. Confirm the mapping against the document rather than changing the user's global coordinate/ruler settings.

Useful native building blocks are `doc.layers.add()`, `layer.groupItems.add()`, `group.pathItems.add()`, `path.setEntirePath(points)`, and `group.textFrames.add()`. Set fill, stroke, size, and font explicitly. Keep measurement and text data separate from drawing code so comparison fixes change a small parameter set. Adobe's [developer entry point](https://developer.adobe.com/illustrator/) confirms the scripting/extensibility routes; consult the installed release's JavaScript reference for exact object properties. The [Adobe scripting reference transcription](https://ai-scripting.docsforadobe.dev/) is a searchable community-maintained mirror, not a guarantee that every documented property exists in the installed version.

## Inspect editability without modifying artwork

Run `../scripts/illustrator_inspect.jsx` with the figure document active. With its default `OUTPUT_PATH = ""`, it opens a JSON save-location dialog; cancel leaves the document untouched. For a predictable automation run, copy the script into the task workspace and set `OUTPUT_PATH` to a new absolute `.json` path near its top. The parent folder must already exist. Existing reports are not overwritten unless that task-local copy sets `ALLOW_OVERWRITE = true`.

The script reads the active document and writes only the chosen report. It does not create, select, unlock, move, save, or close document objects, and it does not change preferences. No-document and unreadable-property errors go into the report where possible; write failures throw an explicit error. It uses its own JSON encoder, since `JSON.stringify` cannot be assumed in ExtendScript.

Illustrator's runtime text `typename` is `TextFrame`, while reference chapters use `TextFrameItem`; Adobe's [text rotation example, transcribed in the scripting reference](https://ai-scripting.docsforadobe.dev/jsobjref/TextFrameItem/#rotate-a-text-art-item), demonstrates this distinction. The inspector accepts both names and flags a mismatch between inspected text frames and the document's text collection count.

Review the report for:

- Object types, layer hierarchy, declared document collection counts, artboard rectangles, and object bounds.
- Text contents plus distinct font names/sizes scanned across characters, rather than only each frame's first character.
- Placed links (which can be vector or raster), embedded/linked raster items, clip groups, and clipping paths.
- Local and inherited lock/visibility state, property-read errors, and incomplete scans caused by the stated item/character/depth limits.

Treat this as an inventory. A font name returned by the DOM does not prove that no font substitution occurred, and a large path count does not prove useful editability. It cannot expose every plugin/effect internals, prove text has not overflowed, or identify the scientific role of a raster asset. Supplement with a visual render and direct editing checks. The DOM may expose compound-path children differently across collections; do not add collection counts together as a unique-object total.

## Save, export, reopen, compare

1. Save the editable master as `.ai`, then verify the actual path. Keep live text and native layers in this master. Adobe recommends working in AI and producing external formats afterwards. [Adobe save-format guidance](https://helpx.adobe.com/illustrator/using/saving-artwork.html).
2. Produce a separate publication PDF with the required artboard/crop and publisher settings. For script export, `PDFSaveOptions` belongs to `Document.saveAs()`, whereas PNG/SVG export uses `Document.exportFile()` with the corresponding options. PDF `saveAs` can change the active document's file identity; use a controlled task-owned document/copy and retain the `.ai` master. Verify version-specific APIs instead of assuming `ExportType.PDF` exists.
3. Use **Preserve Illustrator Editing Capabilities** when an editable Illustrator PDF is desired. A publication PDF may have different requirements. This option does not make imported raster content vector or restore source data. Keep the separate native master either way.
4. Export a comparison PNG from the same artboard at a recorded scale, background, and color profile. Inspect it at intended print size and enlarged. Hide the reference layer in the task-owned figure before export, then check the exported image actually excludes it.
5. Reopen the saved native file and verify representative label text, one connector/path, a panel group, and an intentional raster asset. Compare the rendered export to the reference; inspect crop, label placement, line weight, math glyphs, overlaps, and axis values.
6. If delivering SVG for Affinity or other tools, inspect the SVG itself and open it in the destination application. Illustrator-specific data embedded in SVG may not be what the other application reads; Adobe also warns that manually edited SVG can disagree with its embedded AI data. Avoid claiming cross-application editability before this check. [Adobe SVG save behavior](https://helpx.adobe.com/illustrator/using/saving-artwork.html).

Report native execution, saving, and reopen checks separately from code syntax checks. When Illustrator was unavailable, say so and list the remaining native checks.
