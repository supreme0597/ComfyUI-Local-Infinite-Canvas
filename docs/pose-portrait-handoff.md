# 动作迁移合照卡 · 对接文档

> 目标读者：接手使用这张卡片的同事。
> 一句话：**给三张图（真人照片、真机照片、背景图），点一次「一键生成」，得到「真人动漫化 + 真机机械角色」的成套图片。**
> 版本：2026-11-10（对应部署入口 `index.html` sha256 `2037f8fa…`，前端脚本 `index-BaQ79qjM.js`）

---

## 1. 你会拿到什么

| 项目 | 位置 |
| --- | --- |
| 前端源码 | `D:\Projects\ComfyUI-Local-Infinite-Canvas\infinite-canvas\web` |
| 线上部署目录（浏览器实际加载的） | `D:\无界工作台\infinite-canvas\web\dist` |
| 画布页面（本机） | `http://127.0.0.1:3000` |
| 画布页面（局域网） | `http://10.42.0.100:3000`（有线）／`http://7.249.251.152:3000`（Wi‑Fi） |
| 生图/反推网关（本机） | `http://127.0.0.1:8190/v1`（ComfyUI 本地网关） |
| 生图/反推网关（局域网） | `http://10.42.0.100:8190/v1` |
| 回滚备份 | `D:\无界工作台\backups\pose-portrait-20261109-1945\dist\index.html` |

## 1.5 从别的电脑用（局域网）

这台机器已经开了局域网监听（`launcher/config.json`：`allowLan=true`、`canvasHost/gatewayHost=0.0.0.0`）：

- **用网页**：浏览器打开 `http://10.42.0.100:3000`，用法与本机完全一样。
- **用命令行 / 脚本**：把网关换成局域网地址，否则 `127.0.0.1` 指向的是你自己的电脑：

  ```bash
  GATEWAY=http://10.42.0.100:8190 bash make-poster.sh 真人.jpg 机器人.png
  # 或长期生效：export GATEWAY=http://10.42.0.100:8190
  ```

- 网关的 `/v1/models`、`/v1/prompts/caption`、`/v1/images/edits` 都已验证可从局域网访问；ComfyUI 的 8188 仍然只绑本机，由网关代理。
- 网段内**没有鉴权**：能打开页面的人都能调用生图、占用这张卡的 GPU。只用于可信内网。
- 换 IP（DHCP）后：命令行只改 `GATEWAY`；网页还要把新地址加进 `launcher/config.json` 的 `corsOrigins`，否则能打开页面但生图会被 403 拒绝，然后重启 `start-local.bat`。

---

卡片在画布里的名字：**动作迁移合照**（右键画布 → 新建节点里也能找到）。

---

## 2. 三张输入图分别是什么

| 面板上的位置 | 你要传的图 | 作用 | 建议 |
| --- | --- | --- | --- |
| **真人照片** | 一张真人全身/半身照 | 提供**动作**（手臂、手指、身体朝向），也是被动漫化的对象 | 人物完整、光线正常、背景越干净越好；≤20MB、能被浏览器解码 |
| **固定机械角色** | 一张**真机照片**（比如智元人形机器人） | 提供**机体设计**：结构、配色、比例、标识；动作会被改成真人的动作 | 机器人在画面里尽量完整、正面或 3/4 侧；背景干净 |
| **海报底图** | 背景图（海报/展板/任意底图） | 只当**背景复用**，原图内容不会被重绘或改写 | 二宫格时它是画布底色；单张模式不需要它 |

三张图都可以从面板上传；真人照片和海报还支持**上游连线**（见第 5 节）。

---

## 3. 五步操作

1. 打开 `http://127.0.0.1:3000`，进入项目（或新建项目）。
2. 画布空白处右键 → 新建 → **动作迁移合照**；双击卡片打开面板。
3. 上传 **真人照片**、**固定机械角色**（真机照片）。若想用海报当背景：把「画布背景」切到“海报背景”，再选海报来源。
4. 选好参数（第 4 节有速查表；默认值已经能跑）。
5. 点 **一键生成**。生成期间**不要关闭这个页面**；面板被宿主回收时，卡片边框的进度条会继续走，点回卡片能看到进度。

> 勾了「上传真人照片后自动开始（一键生成）」时，传完真人照片就自动开跑，不用再点按钮。

---

## 4. 参数速查

| 面板控件 | 选项 | 建议 / 说明 |
| --- | --- | --- |
| 动作识别引擎 | 本地 Qwen3.5 / 云端反推（经本地网关） | 默认本地；云端会走 `/v1/prompts/caption` 转发到云端配置，凭据只在运行时用，不落库 |
| 动漫画风（人物＋机械角色） | 简约卡通分格 / 日系2D卡通 / 黑白漫画 / 实拍写实 | 默认**简约卡通分格**（白底黑框、星星装饰）。前三种都会把人物和机器人都动漫化并按绿幕抠成透明 PNG；**实拍写实**保留真人照片原样 |
| 提示词来源 | 模型看图各写一段 / 固定模板 | 默认模型写（更贴合本张照片）；固定模板更快更稳 |
| 角色生成模型 | 列表 | 必须选**支持参考图**的模型；当前网关只有 `image-qwen21`（最多 4 张参考图） |
| 最终输出模式 | 二宫格·左右 / 二宫格·上下 / 等比方格两种 / 自然合照 | 决定本地拼接几何；**自然合照**会调模型重绘，人物和角色会融合，不适合“两张独立”的诉求 |
| 输出形态 | 单张动漫图（二张各自独立，不拼图）/ 二宫格（本地拼接） | 默认**单张**：出两张透明 PNG，各自可继续二创 |
| 画布背景 | 透明背景（无海报）/ 海报背景（原图复用＋相框） | 选海报后才会出现「海报来源」 |
| 海报来源 | 内置 OpenEuler 峰会海报 / 自己上传一张底图 / 用上游连线里的第 2 张图 | 只读复用，不改原图 |
| 对白气泡文字（留空不加） | 最多 12 字 | **气泡由生图模型画**（白底黑粗边、云朵/椭圆、尖尾指向头部）。短句成功率最高，长句可能漏画或笔画走形 |
| 让模型按动作自动写气泡台词 | 勾选 | 不填字时，让文字模型按动作自动产一句（失败会退回本地兜底短句） |
| 影像分隔样式 / 显示标签 | 无间距 / 白色间距 / 黑色分隔线；真人／机械角色标签 | 只影响二宫格拼接 |

---

## 5. 产物在哪儿

- **卡片预览**：面板顶部两张预览图（真人动漫化、机械角色）。
- **阶段节点**：勾着「运行后把动作文本、两张动漫画、合照放成独立节点」时，运行中会**逐个**把节点放到画布上——动作识别文本 → 真人动漫化 → 机械角色 → 最终输出。节点之间自动连线，方便继续二创。
- **历史结果**：面板底部「历史结果」下拉，每条 run 都能回看四个阶段、动作文本、生成提示词和错误原因；失败的 run 不会覆盖旧结果。
- **下载**：预览图右键/下载按钮可存 PNG（透明背景）。

**耗时（本机实测，单次完整链路）**：动作识别 15–20s → 真人外观描述 15s → 真人动漫化 14s → 机械角色外观 20s → 角色出图 18–26s，**合计约 90–110 秒**，加本地抠像与拼图 1–2 秒。

---

## 6. 上游连线怎么用

面板支持把上游图片节点接到卡片上：

- 第 **1** 张可当**真人照片**（面板显示“已使用上游连线图片”）；
- 第 **2** 张可当**海报底图**（「海报来源」选“用上游连线里的第 2 张图”）。

连线顺序即上游数组顺序；不连线时全部走面板上传。

---

## 7. 技术实现摘要（改代码前必读）

链路（`src/lib/canvas/pose-portrait.ts` 的 `runPosePortrait`）：

```
caption(动作识别) → [人物外观描述] → 人物动漫化 → 角色外观描述 → 机械角色(动作迁移) → 输出
                                                                    ├─ 单张：直接给两张透明 PNG
                                                                    └─ 二宫格/海报：本地 Canvas 拼接/装裱
```

关键点：

1. **动作识别走 `/v1/prompts/caption`**（multipart，单图），只输出姿态文本，不让模型画图。
2. **出图走 `/v1/images/edits`**，multipart 顶层必须带 `mode=edit`——否则网关按 t2i 跑，**参考图会被忽略**（这是本项目最容易踩的坑）。对应代码：`poseImageRequest()` 固定 `mode: "edit"`，宿主 `use-plugin-host.tsx` 把 `options.mode` 透传成 `imageMode`。
3. **透明背景**：提示词要求主体以外必须纯绿 `#00B140`；`src/services/pose-portrait-compositor.ts` 的 `transparentPose()` 逐像素 `chromaAlpha()` 抠绿（greenness ≤40 不透明、≥110 全透明、中间羽化），并去溢色。所以**模型不守绿底时抠不干净**，属于模型能力问题。
4. **气泡不本地画**：气泡文字拼进角色提示词**最前面**（放末尾模型会忽略），并明确“云朵/椭圆、白底、粗黑描边、尖尾、横排粗体、只画一个”。
5. **海报只读复用**：`public/frames/openeuler-summit-2026.webp` 原图当背景 `drawImage` 铺满，不重绘；安全区 `{x:0.205W, y:0.07H, w:0.575W, h:0.86H}` 避开 logo、插画、二维码。
6. **画布几何在 `poseGeometry()`**：整数像素、等比 contain（不裁切）、toon 外留白、分隔线/标签/气泡带都算在这里；测试覆盖了相邻边界与不重叠。

主要文件：

| 文件 | 职责 |
| --- | --- |
| `src/lib/canvas/pose-portrait.ts` | 类型、提示词、四阶段 runner、布局几何 |
| `src/services/pose-portrait-compositor.ts` | 绿幕抠像、二宫格拼接、海报装裱 |
| `src/components/canvas/nodes/pose-portrait-node.tsx` | 卡片面板、上传、运行编排、阶段节点、历史 |
| `src/lib/canvas/pose-portrait-config.ts` | 模型能力校验、网关/云端配置解析 |
| `src/services/api/image.ts` | `requestImageCaption`（动作识别） |

---

## 8. 已知限制（如实告知使用方）

- **必须用支持参考图的模型**：当前网关只有 `image-qwen21` 有参考图能力（`imageInputs: 4`），其它图像模型传参考图会被忽略。
- **生成慢**：一次 90–110s 属正常；失败不自动重试（省 GPU）。
- **模型画字不稳**：气泡短句（2–4 字）成功率高，长句可能漏画或错字；这是模型边界，不是卡片 bug。
- **透明依赖绿幕**：模型偶尔不守绿底，抠像会残留边缘；可重跑，或改用「实拍写实」不抠像。
- **停止 ≠ 取消 GPU**：点“停止后续步骤”只中止前端请求；后台显卡任务可能仍在跑完。
- **缩放是重采样**：二宫格/海报按 contain 缩放，不是原分辨率像素级复制；JPG 有损。
- **海报模式会铺满画布**：此时“透明背景”无意义（透明只对单张图成立）。
- **角色设计会被轻微改写**：球衣字母、机身小字、logo 文字可能被模型重写，无法保证 100% 一致。

---

## 9. 故障排查

| 现象 | 先查什么 |
| --- | --- |
| 一直“生成中”不动 | ①`curl http://127.0.0.1:8190/health`；②`curl http://127.0.0.1:8190/v1/models`；③若浏览器反复卡在 caption，**重启该浏览器进程**（长跑的无头/常开浏览器连接池会坏，本机踩过多次） |
| 只出了真人图，没有机器人 | 角色生成模型选的是不是 `image-qwen21`；网关是否支持参考图；看历史里的错误文案 |
| 机器人画风/设计完全变了 | 检查请求是否真的带 `mode=edit`（改过宿主或 `poseImageRequest` 会退化 t2i） |
| 气泡没出现 | 模型没听懂长句，改成 2–4 字重跑；确认气泡文字填在「对白气泡文字」里 |
| 背景不透明、边缘一圈绿/白 | 模型没守 `#00B140` 绿底；重跑或改用实拍写实 |
| 海报没出现 | 选的是「海报背景」吗；来源是上传（有没有选文件）/ 上游（有没有连第 2 张图） |
| 卡片很糊/发灰 | 面板已是实底；若仍发虚，强刷（Ctrl+F5）拿最新脚本 |

---

## 10. 本地开发与验证

```bash
cd D:\Projects\ComfyUI-Local-Infinite-Canvas\infinite-canvas\web

bun test                                  # 期望 132 pass / 0 fail
npx tsc --noEmit --incremental false      # 期望无输出
npm run build -- --outDir dist-pose-staging

# 部署（只换入口，保护 config/plugins/skins 与旧资源）
cd D:\Projects\ComfyUI-Local-Infinite-Canvas
node .superpowers/sdd/pose-portrait-20261109/verify-deploy.mjs copy
cp infinite-canvas/web/dist-pose-staging/index.html /d/无界工作台/infinite-canvas/web/dist/index.html
node .superpowers/sdd/pose-portrait-20261109/verify-deploy.mjs verify
```

注意：

- **不要**直接复制整个 `dist` 覆盖线上目录，会踩掉 `config.js`、`plugins/`、`skins/`。
- 入口 `index.html` 必须用 `cp` 整文件覆盖（用脚本改写会多出尾随空行，`verify` 会报 `Entry differs from build`）。
- 不要改依赖、不要动 `package-lock`；不要动用户的模型、项目数据、ComfyUI 配置。
- 回滚：把 `D:\无界工作台\backups\pose-portrait-20261109-1945\dist\index.html` 覆盖回线上 `dist/index.html`。

---

## 11. 交接清单（同事照着做一遍即可上手）

- [ ] 打开 `http://127.0.0.1:3000`，确认能加载最新脚本（Ctrl+F5）。
- [ ] 新建一张「动作迁移合照」卡片，双击打开面板。
- [ ] 传一张真人照片、一张真机照片；「画布背景」先留“透明背景”。
- [ ] 点「一键生成」，等 90–110 秒，确认拿到两张透明 PNG（真人动漫化 + 机械角色，动作一致）。
- [ ] 再把「画布背景」切到“海报背景”，来源选“自己上传一张底图”，重跑一次，确认背景复用、图未被改写。
- [ ] 在「对白气泡文字」填「点赞！」重跑，确认气泡由模型画出（不是本地贴上去的）。
- [ ] 打开「历史结果」，确认四个阶段与错误信息都能回看。

---

## 12. 一句话总结

> 三张图进去（真人照 / 真机照 / 背景图），一张卡跑完动作识别、人物动漫化、角色动作迁移、可选拼图与海报装裱；输出透明 PNG 可继续二创，失败不自动重试，停止只停前端。

---

## 13. 接口直接生图（不经过画布卡片）

不想开浏览器、想批量跑、或者要塞进别的脚本时，直接调网关。**全部是 HTTP + multipart，没有任何 SDK**。

### 13.1 网关地址与准备

| 项目 | 值 |
| --- | --- |
| Base URL | `http://127.0.0.1:8190` |
| 鉴权 | 本地网关不需要 key（内网部署） |
| 健康检查 | `GET /health` |
| 模型列表 | `GET /v1/models` |

可用的图像模型中，**只有 `image-qwen21` 支持参考图**（`imageInputs: 4`）。调它必须带 `mode=edit`，否则等价于文生图，参考图会被丢掉。

### 13.2 两个接口

| 用途 | 接口 | 请求体 |
| --- | --- | --- |
| 动作识别（图 → 文字） | `POST /v1/prompts/caption` | multipart：`image` 一张、`language`、`engine`、`instruction` |
| 出图 / 动作迁移（图 + 文字 → 图） | `POST /v1/images/edits` | multipart：`model`、`prompt`、`mode=edit`、`image[]`（可多张）、`n`、`response_format`、`output_format` |
| 纯文生图（无参考） | `POST /v1/images/generations` | JSON：`{model, prompt, n, response_format:"b64_json"}` |
| 别的对话/视觉模型 | `POST /v1/chat/completions` | OpenAI 兼容 JSON |

### 13.3 第一步：动作识别

```bash
curl -s -X POST http://127.0.0.1:8190/v1/prompts/caption \
  -F "language=zh" -F "engine=qwen35" \
  -F "instruction=只描述人物的姿态与构图，不要描述长相、服装、背景。按顺序写：构图裁切、躯干与头部朝向、左右上臂与前臂位置、左右手腕与手指逐项姿势、重心与腿部站姿。" \
  -F "image=@person.jpg"
```

返回：

```json
{ "prompt": "构图裁切：全身正面中景……右手食指竖起……" }
```

> 这个接口**只吃一张图**。想同时喂两张参考图给文字模型（比如“角色设定 + 动作参考 → 一段生图提示词”），要先用 Pillow / Canvas 拼成左右一张图再传。

### 13.4 第二步：动作迁移出图

```bash
curl -s -X POST http://127.0.0.1:8190/v1/images/edits \
  -F "model=image-qwen21" \
  -F "mode=edit" \
  -F "n=1" -F "response_format=b64_json" -F "output_format=png" \
  -F "prompt=图片1是机械角色设计（保留机体结构、配色、比例与标识），图片2是真人动作参考（只照抄手臂、手腕、手指姿态，不要把真人画进画面）。让图片1的机械角色摆出图片2的姿势。主体以外背景必须是纯绿色 #00B140。" \
  -F "image[]=@robot.png" \
  -F "image[]=@person.jpg" \
  -o out.json -w "HTTP %{http_code} %{time_total}s\n"
```

返回 JSON，图片是 base64：

```json
{ "images": [ { "b64_json": "iVBORw0KGgoAAA..." } ] }
```

解出来存盘（Windows PowerShell / Python 都行）：

```bash
python -c "import json,base64;d=json.load(open('out.json'));b=d['images'][0]['b64_json'];open('out.png','wb').write(base64.b64decode(b.split(',')[-1]))"
```

### 13.5 现成脚本（推荐给同事用）

仓库里已经有一个脚本，提示词直接 import 卡片源码（不会和画布里的效果漂移）：

```bash
cd D:\Projects\ComfyUI-Local-Infinite-Canvas
bun docs/api/generate-pose-image.ts ^
  --person 真人.jpg ^
  --robot  真机.png ^
  --out    out ^
  --bubble 点赞！
```

它做三件事：动作识别 → 真人动漫化 → 机械角色做动作（可选加气泡），产出：

- `out/pose.json`：动作文本（可留档/复用）
- `out/cartoon-person.png`
- `out/cartoon-robot.png`

**实测耗时**（本机，2026-11-10）：caption 18.4s、真人 14.2s、机器人 14.8s，合计约 48 秒；单独一次 edits 约 10–15 秒。

环境变量可调：`GW`（网关地址）、`MODEL`（默认 `image-qwen21`）、`CAPTION_ENGINE`。

### 13.6 必踩的坑

1. **`mode=edit` 必须放 multipart 顶层字段**。放进 `params` JSON 无效（实测会退化成 t2i，人物/机器人设计直接漂移）。
2. **多张参考图用重复字段 `image[]`**，不要写成 `images` 或 JSON 数组。
3. **`response_format` 用 `b64_json`**，否则返回的是 URL 而不是图；拿不到图时先看 `response.status` 和 body 前 300 字符。
4. **超时要给足**：单张 10–30 秒，串完四步 90–110 秒，脚本里 `AbortSignal.timeout(900000)`。
5. **透明背景接口不返回**：模型给的是绿幕图（为了抠像），要透明得本地跑 `chromaAlpha`（画布卡片里已内建；纯接口场景参考 `src/services/pose-portrait-compositor.ts` 的 `transparentPose`）。
6. **风格全靠 prompt**：不给“日系卡通/黑白漫画/白底黑框”这些词，模型就按照片写实出图（这是实测差异，不是接口问题）。
7. **接口不吃“文字气泡排版”**：气泡必须在 prompt 里明确写形状、描边、尾巴、字数，否则模型多半不画；短句（2–4 字）成功率最高。

### 13.7 最小可跑示例（Node 18+）

```js
const form = new FormData();
form.set("model", "image-qwen21");
form.set("prompt", "把图片1的人物改画成日系卡通风格，主体以外背景纯绿 #00B140。");
form.set("mode", "edit");            // 少了这行就会忽略参考图
form.set("n", "1");
form.set("response_format", "b64_json");
form.append("image[]", new Blob([readFileSync("person.jpg")], { type: "image/jpeg" }), "person.jpg");
const res = await fetch("http://127.0.0.1:8190/v1/images/edits", { method: "POST", body: form });
const { images } = await res.json();
writeFileSync("out.png", Buffer.from(images[0].b64_json, "base64"));
```

## 14. 用接口直接出「最终效果图」（海报＋两个角色）

接口本身只负责**画**，不负责**排版**：

- `POST /v1/images/edits` 只返回一张图（绿幕背景的动漫角色），没有海报底图、不会摆位置、不会抠像、不会加投影。
- 卡片里的「海报 + 左右摆放」是前端 Canvas 本地合成（`pose-portrait-compositor.ts`），不是模型能力。

所以要“只用接口”拿到最终效果图，需要两步：**接口出两张绿幕图 → 本地按同一套几何合成**。

### 第一步：出两张绿幕图

```bash
export GATEWAY=http://127.0.0.1:8190
bun docs/api/generate-pose-image.ts \
  --person 你的真人照.jpg \
  --robot  固定机械角色.png \
  --out    ./out \
  --bubble 点赞！
```

产出 `out/cartoon-person.png`、`out/cartoon-robot.png`（均为绿幕底 `#00B140`，机器人那张带气泡）。

### 第二步：合成海报

```bash
python docs/api/compose-poster.py \
  --person ./out/cartoon-person.png \
  --robot  ./out/cartoon-robot.png \
  --poster infinite-canvas/web/public/frames/openeuler-summit-2026.webp \
  --out    ./out/final-poster.png
```

默认参数与卡片「画面大小＝中」完全一致：真人质心在 38% 宽、机器人在 67% 宽、身体高度 78% 海报高、脚底线 94%、投影 55%。
可调：`--person-anchor`、`--robot-anchor`、`--body 0.62|0.78|0.90`、`--baseline`、`--shadow`。

依赖：Python 3 + Pillow（走 `python -m pip install pillow`，或本机打包的 python 运行时）。

### 实测

用上面两张图跑 `compose-poster.py`，输出与卡片截图 **sha256 完全一致**（`5f2aad00…`，2080×1088）：真人 x=628、机器人 x=1142、身体各 849px。

### 14.1 一条命令：三张图进，一张成品出

```bash
bash docs/api/make-poster.sh 真人.jpg 机器人.png 背景图.png 点赞！ ./out
```

- 第 1 个：真人照片（任意尺寸，会自动做动作识别）
- 第 2 个：机器人照片（真机照或设定图都行，作为角色参考）
- 第 3 个：背景图（海报/任意底图，尺寸任意，合成按宽高比例自适应）
- 第 4 个（可选）：气泡文字，留空则不加
- 第 5 个（可选）：输出目录，默认 `./out`，成品 `final-poster.png`

环境变量：`GATEWAY`（默认 `http://127.0.0.1:8190`）、`PY`（带 Pillow 的 Python，默认自动探测）、`KEEP=1`（保留两张绿幕图，便于单独用 `compose-poster.py` 调位置）。

实测（真人 385×605 + 智元真机照 1440×1641 + 2080×1088 海报，气泡「点赞！」）：整条约 60 秒，成品 `2080×1088`，真人 x=587、机器人 x=1174、身体各 849px。
