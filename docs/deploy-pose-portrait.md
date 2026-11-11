# 在同事电脑上部署「动作迁移合照」卡片

适用版本：`v0.24.13`，基线提交 `5b2d8cb`（上游 `1314521gjy/ComfyUI-Local-Infinite-Canvas`）。
功能分支：`feat/pose-portrait`（`89f3dac` 功能、`28744e8` 反推修复）。

这次改动**只在前端**（`infinite-canvas/web`），网关 `comfyui-gateway` 与 ComfyUI 都没动。所以有两种部署方式，二选一。

---

## 方式 A：只拷产物，不重新构建（推荐，2 分钟）

前提：对方装的是同一版本基线（`v0.24.13`）。产物包：`handoff/pose-portrait-dist.zip`（1.9 MB，10 个文件）。

**1. 备份**

```bat
cd /d <安装目录>\infinite-canvas\web
xcopy dist\index.html dist\index.html.bak /y
```

**2. 解压覆盖**

把 zip 里的 `index.html`、`assets\`、`frames\` 解压到 `<安装目录>\infinite-canvas\web\dist\`，覆盖同名文件。

**不要动这三个目录**：`config.js`（本机网关地址，每台机器不同）、`plugins\`、`skins\`（用户自己加的）。

**3. 刷新页面**

浏览器强制刷新（`Ctrl+F5`）。新卡片在节点菜单里叫「动作迁移合照」。

**4. 验收 4 项**

- 页脚/设置里能看到新包加载（入口脚本名是 `assets/index-CobglvKt.js`）
- 画布加「动作迁移合照」卡片，能选到「角色生成模型（至少一张参考图）」
- 浏览器访问 `http://127.0.0.1:3000/frames/openeuler-summit-2026.webp` 返回 200（海报底图在）
- 面板样式正常（有换 css，必须和 js 一起覆盖）

**回滚**：把 `index.html.bak` 改回 `index.html` 即可；`assets` 里的新文件留着不影响。

---

## 方式 B：从源码构建（改过源码 / 版本不一致时用）

要求：Node.js 24+、npm、能连 GitHub。

```bat
git clone git@github.com:supreme0597/ComfyUI-Local-Infinite-Canvas.git
cd ComfyUI-Local-Infinite-Canvas
git checkout feat/pose-portrait

cd infinite-canvas\web
npm install --legacy-peer-deps
npm run build

:: 产物在 infinite-canvas\web\dist，把 index.html / assets / frames 覆盖到安装目录
```

构建约 15–40 秒，产物 `assets/index-*.js` 约 4.8 MB（gzip 1.5 MB），只有 chunk 体积警告，属正常。

---

## 两种方式都必须满足的运行条件

| 项 | 要求 |
|---|---|
| 网关 | `http://127.0.0.1:8190`，与画布同源可达；`config.js` 里的 `LOCAL_GATEWAY_URL` 指向它 |
| 模型 | 网关里至少有一个**支持参考图**的图像模型（如 `image-qwen21`，`imageInputs=4`），否则卡片模型下拉是空的 |
| 图像编辑 | 网关 `POST /v1/images/edits` 必须支持 multipart 顶层 `mode=edit`，缺这个字段参考图会被忽略（这是最容易踩的坑） |
| 抠像 | 画风选「简约卡通分格」时会按纯绿 `#00B140` 抠背景，模型不守绿底就会留白底 |
| 海报 | 需要 `dist/frames/openeuler-summit-2026.webp`（方式 A 的 zip 已带） |

---

## 校验指纹

- 线上入口 `index.html` sha256：`84dd6dfef94de7493396a16e999c3f50155343989710cbbcba60cd57b4bab452`
- 入口脚本：`assets/index-CobglvKt.js`，样式 `assets/index-Cv7MaeSq.css`
- 产物里搜「七头身」应有 2 处（角色比例提示词）
- 本机自测：`bun test` 134 pass / 0 fail；`npx tsc --noEmit` 无报错

---

## 常见问题

**卡片里选不到模型** → 网关没有带参考图能力的模型，或 `config.js` 指向了别的网关。

**生成的图不是卡通** → 画风下拉选了「实拍写实」，这个模式按设计**不**动漫化真人。

**海报是空的/白底** → 少了 `dist/frames/` 目录。

**界面样式错乱** → 只覆盖了 js 没覆盖 css。

**报告 `mode` 相关 400** → 网关版本旧，`/v1/images/edits` 不支持 `mode=edit`。
