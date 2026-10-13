# 用原图与 spec 共同驱动描绘

spec 必须能回答“在哪里、是什么、用什么样式、连到哪里、依据是什么”。段落描述可以帮助理解，但不替代有坐标的对象表。

本页描述测量证据与旧版准备计划。真正交给绘图程序的格式见 [统一 spec 渲染](spec-renderer.md)：`paper-figure-spec/v1`、`state: ready`。不要把下面这个局部测量示例直接传入渲染器。

## 基础约定

- 单位默认为归一方向后的参考像素，左上原点；bbox 为 `[x,y,width,height]`，不能混用右下坐标。
- 记录参考来源和哈希、页码/原裁剪变换、画布宽高。另存 `reference_to_canvas` 仿射映射 `[a,b,c,d,tx,ty]`；在简单同比例情况下是 `[s,0,0,s,tx,ty]`。
- 源图像素值 → 矢量用户单位 → 应用物理单位三者分开；每次跨应用先用画板边界和锚点验证转换，特别注意 Illustrator 脚本坐标的 y 方向。
- 几何、字体和颜色都有 `evidence` 或测量说明。可以写估计值，不能把一位小数的估计值声称为源文件精确坐标。
- ID 在更新中保持稳定，连线引用对象 ID 和端口；未确定项明确留空/标注，不能凭空补齐。
- PowerPoint 另记录幻灯片实际尺寸与参考像素的统一缩放。OOXML 使用 EMU；1 inch = 914400 EMU，1 pt = 12700 EMU。采用 96 DPI 像素坐标的工具时，1 px = 9525 EMU，字体 px/pt 也需转换。以所用工具的单位约定和实际导出尺寸为准，不将上述比例套到使用英寸或点的其他库。

## 预处理计划示例

此示例的坐标基于 Transformer Figure 1 的 465×660 截图，仅展示格式。其他图必须重新测量，不能直接套用。

```json
{
  "samples": [
    {"id":"feed_forward_fill","role":"Feed Forward background","rect_px":[105,290,15,12]},
    {"id":"attention_fill","role":"Attention background","rect_px":[105,398,15,8]}
  ],
  "assets": [
    {"id":"position_symbol_ref","rect_px":[94,487,40,40],"use":"trace-reference","purpose":"Local contour reference, rebuild as vector"}
  ],
  "anchors": [
    {"id":"encoder-axis","xy_px":[154.2,506.5]},
    {"id":"decoder-axis","xy_px":[309.7,509.0]}
  ],
  "objects": [
    {"id":"encoder-ff","kind":"rounded-rectangle","bbox_px":[102.3,287.4,103.8,41.5],"radius_px":2.8,"fill_token":"feed_forward_fill","stroke":{"color":"#010101","width_px":2.6},"z":20,"evidence":"Geometry estimated from reference edges; verify against underlay"}
  ],
  "texts": [
    {"id":"encoder-ff-label","parent":"encoder-ff","content":"Feed\nForward","baselines_px":[303.4,321.6],"center_x_px":154.2,"font_requested":"Helvetica Light","font_native_verified":null,"size_px":15.3,"evidence":"Font candidate only; test actual native rendering before duplicating"}
  ],
  "connections": [
    {"id":"encoder-ff-to-norm","source":"encoder-ff","target":"encoder-ff-norm","source_port":"top-center","target_port":"bottom-center","route_px":[[154.2,287.4],[154.2,281.4]],"arrow":"none","evidence":"Example is partial; target object must be resolved in the full spec"}
  ]
}
```

`prepare_reference.py` 只测量 `samples`、裁出 `assets`、标记 `anchors`，并原样带入 `objects/texts/connections`；它不替代模型对图的分析，也不验证示例中的完整拓扑。采样和素材 ID 限英文标识符以便跨平台文件命名，角色和内容可用中文。

## 绘制前补全为可执行 spec

1. 每个对象具有实际类型、位置、尺寸和样式；不规则轮廓记录路径/控制点或指定需要描摹的资产。
2. 每项文字有内容、基线或定位方式，区分字体候选与应用中验证的实际字体和样式。需要旋转时记录顺时针 `rotation`；可执行 spec 的文字 `bbox` 是旋转前文本框，旋转中心为框中心，画布/组边界按旋转后的可见外接框判断。公式保留文本/LaTeX 源（若有）。
3. 每条连接的源与目标 ID 能解析；说明端口、拐点/控制点、箭头方向、层级和交叉是否相连。边端口可记录 `[0,1]` 的 `offset`：上下边从左到右，左右边从上到下，默认 `0.5`；中心端口不接受 offset。多个流进入同一模块时分别测量接入位置，不能全部归到边中点。不能只写“连接 Encoder 和 Decoder”。
4. 每项样式通过色板 token 复用；色板 token 能追溯到原图的采样框或原生对象属性，不能只有一个孤立 HEX。需要渐变时记录方向及各色标，不以单一平均色替代。当前可执行契约只接受 `linear-gradient` 的 `0/90/180/270` 四方向（左→右、上→下、右→左、下→上），每个色标引用 palette token，offset 严格递增且覆盖 `0` 到 `1`；准确 JSON 见 [线性渐变与旋转文字](spec-renderer.md#线性渐变与旋转文字)。
5. 每个资产具有角色、原位 bbox、比例和透明度状态；文件存在且与清单哈希一致。

## 在应用中描绘

将 reference 和 spec 置于同一工作目录。把原图放入锁定底图层；使用几何字段建立原生形状或可导入的矢量草稿，沿原图边缘调整，随后更新 spec 的实测坐标。参数化部分可以由脚本批量建立；复杂不规则轮廓先局部描摹，再用节点工具整理。

spec 是可维护的绘图参数与证据记录。每轮修正应定位到某个 ID、坐标、字体或 token，使后续重绘不依赖重新猜测。程序化重建只从完成的 spec 生成两个后端；不要在绘图程序中另写一份几何。最后在隐藏底图的状态下独立导出并验证。
