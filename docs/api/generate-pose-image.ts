// 动作迁移合照 · 纯接口版（不经过画布 UI）。
// 提示词直接 import 卡片源码，保证与画布内一键生成完全一致（改风格不会两边漂移）。
//
// 用法（需要 bun）：
//   bun docs/api/generate-pose-image.ts --person 真人.jpg --robot 机器人.png --out out/ --bubble 点赞！ [--style toon|anime2d|manga] [--gateway http://10.42.0.100:8190]
// 产出：out/pose.json、out/cartoon-person.png、out/cartoon-robot.png（绿幕底，透明需再抠像）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, join, basename } from "node:path";
import { POSE_INSTRUCTION, bubbleSuffix, characterPrompt, personPrompt, type PoseRobotStyle } from "../../infinite-canvas/web/src/lib/canvas/pose-portrait";

const MODEL = process.env.MODEL || "image-qwen21"; // 必须是声明了参考图能力的图像模型

const args = process.argv.slice(2);
const arg = (name: string, fallback = "") => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const person = arg("person");
const robot = arg("robot");
const outDir = arg("out", "out");
const bubble = arg("bubble");
const style = (arg("style", "toon") as PoseRobotStyle);
const only = arg("only", "both");
const GW = arg("gateway", process.env.GW || process.env.GATEWAY || "http://127.0.0.1:8190").replace(/\/+$/, "");
if (!person || !robot) {
    console.error("缺少参数：--person <真人图> --robot <机器人图> [--out 目录] [--bubble 文字] [--style toon|anime2d|manga]");
    process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const TYPES: Record<string, string> = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp" };
const mime = (file: string) => TYPES[extname(file).toLowerCase()] || "image/jpeg";
const fileBlob = (file: string) => new Blob([readFileSync(file)], { type: mime(file) });

/** 1) 动作识别：POST /v1/prompts/caption（multipart，单图，返回纯文本）。 */
async function caption(file: string, instruction: string) {
    const form = new FormData();
    form.set("language", "zh");
    form.set("engine", process.env.CAPTION_ENGINE || "qwen35");
    form.set("instruction", instruction);
    form.append("image", fileBlob(file), basename(file));
    const started = Date.now();
    const response = await fetch(`${GW}/v1/prompts/caption`, { method: "POST", body: form, signal: AbortSignal.timeout(900000) });
    if (!response.ok) throw new Error(`caption ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const data = await response.json() as Record<string, unknown>;
    const text = String(data.prompt ?? data.caption ?? data.text ?? data.result ?? "").trim();
    console.log(`caption ${((Date.now() - started) / 1000).toFixed(1)}s`, text.slice(0, 60).replace(/\n/g, " "));
    return text;
}

/** 2) 出图：POST /v1/images/edits（multipart，顶层 mode=edit 才读参考图）。 */
async function edit(name: string, prompt: string, refs: string[]) {
    const form = new FormData();
    form.set("model", MODEL);
    form.set("prompt", prompt);
    form.set("n", "1");
    form.set("response_format", "b64_json");
    form.set("output_format", "png");
    form.set("mode", "edit"); // 关键：缺省走 t2i，参考图会被忽略
    for (const file of refs) form.append("image[]", fileBlob(file), basename(file));
    const started = Date.now();
    const response = await fetch(`${GW}/v1/images/edits`, { method: "POST", body: form, signal: AbortSignal.timeout(900000) });
    const data = await response.json().catch(async () => ({ raw: await response.text() })) as Record<string, unknown>;
    const images = (data.images ?? data.data) as Array<Record<string, string> | string> | undefined;
    const item = images?.[0];
    const b64 = (typeof item === "string" ? item : item?.b64_json) || "";
    if (!response.ok || !b64) throw new Error(`${name} ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
    const file = join(outDir, `${name}.png`);
    writeFileSync(file, Buffer.from(b64.replace(/^data:[^,]+,/, ""), "base64"));
    console.log(`${name} ${((Date.now() - started) / 1000).toFixed(1)}s -> ${file}`);
    return file;
}

const pose = await caption(person, POSE_INSTRUCTION);
writeFileSync(join(outDir, "pose.json"), JSON.stringify({ pose, model: MODEL, style, at: new Date().toISOString() }, null, 2));

if (only !== "robot") await edit("cartoon-person", personPrompt(pose, style), [person]);
if (only !== "person") await edit("cartoon-robot", `${bubble ? bubbleSuffix(bubble) : ""}${characterPrompt(pose, style)}`, [robot, person]);
console.log("完成：绿幕底，透明请用 compose-poster.py 或画布卡片抠像");
