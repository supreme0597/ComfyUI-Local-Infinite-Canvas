export type PoseMedia = { storageKey: string; width: number; height: number; mimeType: string };
export type PoseLayout = "natural" | "horizontal" | "vertical" | "grid-horizontal" | "grid-vertical";
export type PoseOptions = { layout: PoseLayout; separator: "none" | "white" | "black"; labels: boolean; bubble?: string; bubbleAuto?: boolean; promptMode?: "model" | "template"; style?: PoseRobotStyle;
    /** 输出画布：none=普通画布；openeuler=铺一张海报当背景（原图只读取、不重绘、不修改）。 */
    frame?: "none" | "openeuler";
    /** 海报上人物/机器人的高度占比：small≈62%、medium≈78%、large≈90%。 */
    frameSize?: "small" | "medium" | "large";
    /** 海报底图来源：内置峰会海报 / 用户上传 / 上游连线第 2 张。 */
    frameSource?: PoseFrameSource;
    /** 输出形态：single=只出单张动漫图（不拼二宫格）；grid=本地拼二宫格。 */
    output?: "single" | "grid" };
export type PoseFrameSource = "builtin" | "upload" | "upstream";
export type PoseRobotStyle = "anime2d" | "realistic" | "manga" | "toon";
export type PoseSettings = PoseOptions & { robotStyle?: PoseRobotStyle; autoRun?: boolean; useUpstream?: boolean; bubbleAuto?: boolean; exportStages?: boolean; person?: PoseMedia; character?: PoseMedia; frameMedia?: PoseMedia; engine?: "qwen35" | "cloud"; cloudApiId?: string; characterModel?: string; portraitModel?: string; history?: PoseRun[] };
export type PoseRun = { id: string; time: string; options: PoseOptions; robotStyle?: PoseRobotStyle; person: PoseMedia; character: PoseMedia; characterModel: string; characterInputs?: number; portraitModel?: string; engine: "qwen35" | "cloud"; cloudApiId?: string; cloudModel?: string; pose?: string; prompt?: string; personPrompt?: string; actionPrompt?: string; personArt?: PoseMedia; action?: PoseMedia; output?: PoseMedia; status: "running" | "done" | "error" | "stopped"; stage: "caption" | "prompt" | "person" | "character" | "output"; error?: string };
export type PoseDependencies = { caption: (signal: AbortSignal) => Promise<string>; describe: (signal: AbortSignal) => Promise<string>;
    // 人物/角色各写一段提示词；缺省时退回固定模板（旧调用方不需要实现）。
    describeArt?: (kind: "person" | "character", signal: AbortSignal) => Promise<string>; generate: (prompt: string, model: string, refs: PoseMedia[], signal: AbortSignal) => Promise<PoseMedia>;
    // 动漫画风生成的是绿幕图：抠成透明 PNG 并补画速度线；没实现时保留原图。
    alpha?: (media: PoseMedia, style: PoseRobotStyle, signal: AbortSignal) => Promise<PoseMedia>; composeSingle?: (media: PoseMedia, options: PoseOptions, signal: AbortSignal) => Promise<PoseMedia>; compose: (person: PoseMedia, action: PoseMedia, options: PoseOptions, signal: AbortSignal) => Promise<PoseMedia>; bubble?: (pose: string, signal: AbortSignal) => Promise<string>; save: (run: PoseRun) => void; progress?: (run: PoseRun) => void | Promise<void>; isActive: () => boolean };
export const POSE_INSTRUCTION = "观察照片，只输出人物可见的目标姿态：构图裁切、躯干和头部朝向、自身左右上臂及前臂的位置、左右手的位置、掌心朝向和各手指状态。左右以主体自身为准，不以画面左右替代。遮挡或不清楚的部位写无法判断，不猜测。不要描述身份、服装、背景，不要输出开场白。";
export const PERSON_ART_INSTRUCTION = "观察照片里的真人与动作，输出一段用于“把这位真人改画成卡通插画并保持同一动作”的中文生图提示词。写清构图裁切、头部与躯干朝向、左右手臂与手的位置和手指状态，以及发型、服装款式与颜色等外观要点；只写人物和动作，不描述背景。只输出这一段提示词，不要开场白、标题或解释。";
export const ROBOT_ART_INSTRUCTION = "观察机械角色参考图，输出一段用于“保持该角色设计、改成目标动作”的中文生图提示词。写清头部造型、装甲分区、配色、标识和比例，再写清目标动作下的躯干朝向、手臂与手部姿态；只写机械角色与动作，不描述背景，不出现真人。只输出这一段提示词，不要开场白、标题或解释。";
export const BUBBLE_INSTRUCTION = "根据人物的动作与状态，写一句适合放在漫画画面旁边的中文台词。只输出这一句台词，2 到 10 个字，语气活泼，不加引号、不加解释、不加冒号前缀。";
export const CHARACTER_PROMPT = `以参考图机械角色为唯一主体，根据以下目标动作生成新图。
保留头部设计、机械零件、装甲、比例、配色和标识。肩、肘、腕和手指姿态以目标动作为准，不保留与目标动作冲突的原有手势。
机械关节合理，不出现真人皮肤或服装；无法判断的部位保持自然，不虚构特定手势。完整容纳参与动作的手部，背景简洁，不添加文字或气泡。
`;
// 本地网关只有带顶层 mode="edit" 时才真正读取参考图；缺失会退化为文生图，丢掉角色设计。
export const POSE_IMAGE_MODE = "edit";
export const ROBOT_STYLE_MANGA = "画面为黑白漫画线稿风格：纯黑线条、网点纹理、大面积留白，完全无彩色；主体占画面高度约 85%，居中，头顶与脚下各留少量空白；主体以外的背景必须是纯绿色 #00B140 纯色平涂，不含渐变、纹理、阴影或任何场景元素——这块绿色是抠像用的，主体内部不要使用绿色；不出现文字、水印、边框或对白气泡；主体为纯机械结构，不出现人类身体部位、皮肤或衣物；带放射状集中线、速度线与网点等日漫演出元素，但只用黑白表现。";
export const ROBOT_STYLE_ANIME2D = "画面为日系2D卡通动画风格：平涂加一层硬阴影、粗描边、明亮饱和配色；加入明显的日漫演出元素——主体后方放射状集中线、手臂运动方向的速度线、局部网点纸纹理、漫画式高光与能量光效，构图有动感与冲击力；背景必须是纯绿色 #00B140 纯色平涂，不含渐变、纹理、阴影或任何场景元素——这块绿色是抠像用的，主体内部不要使用绿色；放射线、速度线、网点直接画在绿色背景上；不得保留参考图里的任何文字、Logo、水印或场景元素，无边框、无对白气泡。完全机械结构，不出现人类身体部位、皮肤或衣物。";
export const PERSON_ANIME2D = "把参考图中的真人改画为日系2D卡通动画风格：保留其面部特征、发型、肤色、服装款式与颜色、体型与当前手势；平涂加一层硬阴影、粗描边、明亮饱和配色；加入日漫演出元素——身后放射状集中线、动作方向速度线、局部网点纸纹理与漫画高光；背景必须是纯绿色 #00B140 纯色平涂，不含渐变、纹理、阴影或任何场景元素——这块绿色是抠像用的，主体内部不要使用绿色；放射线、速度线、网点直接画在绿色背景上；不得保留参考照片里的任何文字、招牌、Logo、水印或场景元素；不出现文字、水印、边框或对白气泡；只画一个人，不出现机械或卡通吉祥物。";
export const PERSON_MANGA = "把参考图中的真人改画为黑白漫画线稿风格：保留其面部特征、发型、服装轮廓与当前手势；纯黑线条、网点、大面积留白，完全无彩色；主体以外的背景必须是纯绿色 #00B140 纯色平涂，不含渐变、纹理、阴影或场景元素——这块绿色是抠像用的，主体内部不要使用绿色；带放射状集中线与速度线，只用黑白表现；不出现文字、水印、边框或对白气泡；只画一个人。";
const personLook = (style: PoseRobotStyle) => style === "manga" ? PERSON_MANGA : style === "toon" ? PERSON_TOON : PERSON_ANIME2D;
const robotLook = (style: PoseRobotStyle) => style === "manga" ? `${ROBOT_STYLE_MANGA}\n` : style === "anime2d" ? `${ROBOT_STYLE_ANIME2D}\n` : style === "toon" ? `${ROBOT_STYLE_TOON}\n` : "";
// 画风要求必须由代码兜住：模型写的只是“画面要点”，不能让它把“改画成卡通”这件事整段替换掉，否则编辑模型会直接照抄原图。
export function personStyleHead(style: PoseRobotStyle = "anime2d") {
    if (style === "realistic") throw new Error("写实风格不改画真人照片");
    return `以参考图中的真人为唯一主体，改画为目标动漫画风，并保持目标动作。\n${personLook(style)}\n画面要点（照这段描述理解人物与动作）：\n`;
}
export function characterStyleHead(style: PoseRobotStyle = "anime2d") {
    return CHARACTER_PROMPT + robotLook(style) + "画面要点（照这段描述理解角色与动作）：\n";
}
export function personPrompt(pose: string, style: PoseRobotStyle = "anime2d") {
    return `${personStyleHead(style)}目标动作：\n${pose}`;
}
export const ROBOT_STYLE_TOON = "画面为简约日系卡通插画：黑色粗描边、平涂上色（白、浅灰与少量黑色细节）、一层浅灰硬阴影，角色比例修长挺拔（约七头身）、腿长、站姿舒展，不要大头、矮胖或幼态萌化，主体占画面高度约 85% 并居中，头顶与脚下留少量空白；主体以外的背景必须是纯绿色 #00B140 纯色平涂，不含渐变、纹理、阴影或任何场景元素——这块绿色是抠像用的，主体内部不要使用绿色；放射线、速度弧线、白相位星光直接画在绿色背景上；不出现文字、水印、对话框或边框（气泡与分格由画布后期添加）；纯机械结构，不出现人类皮肤与衣物。";
export const PERSON_TOON = "把参考图中的真人改画为简约日系卡通插画：保留面部特征、发型、服装款式与颜色、体型与当前手势；主体占画面高度约 85%、居中、头顶与脚下留少量空白；黑色粗描边、平涂加一层浅灰硬阴影，配色干净明亮；主体以外的背景必须是纯绿色 #00B140 纯色平涂，不含渐变、纹理、阴影或任何场景元素——这块绿色是抠像用的，主体内部不要使用绿色；速度弧线与星光直接画在绿色背景上；不出现文字、水印、对话框或边框；只画一个人，不出现机械。";
export function promptSheetInstruction(style: PoseRobotStyle = "anime2d") {
    const anime = style === "anime2d";
    const toon = style === "toon";
    const manga = style === "manga";
    const look = manga
        ? "右侧机械角色改画为黑白漫画线稿风格：纯黑线条、网点、纯白背景、完全无彩色；带放射状集中线、速度线等日漫演出元素，但只用黑白表现；纯机械结构、无人类皮肤、无文字与对白气泡。"
        : toon
        ? "右侧机械角色改画为简约日系卡通插画：黑色粗描边、平涂加一层浅灰硬阴影、比例修长（约七头身）、腿长挺拔、不要大头矮胖，主体以外的背景必须是纯绿色 #00B140 平涂（抠像用，主体内部不要绿色），周围点缀少量速度弧线与星星闪光；纯机械结构、无人类皮肤、无文字与对白气泡。"
        : anime
        ? "右侧机械角色改画为日系2D卡通动画风格：平涂、一层硬阴影、粗描边、明亮饱和配色，并带明显的日漫演出元素——放射状集中线、运动方向速度线、网点纸纹理、漫画式高光与能量光效，动感构图；纯机械结构、无人类皮肤、无文字与对白气泡。"
        : "右侧机械角色保持参考图中的实拍质感、材质细节与光照，不改画风、不卡通化。";
    const subject = manga ? "黑白漫画风真人与黑白漫画机械角色" : toon ? "简约卡通真人与简约卡通机械角色" : anime ? "日系2D卡通真人与日系2D卡通机械角色" : "真人照片与机械角色";
    return `你是图像提示词生成器。输入是一张拼接图：左半是机械角色的参考图（可能是照片或插画），右半是动作参考图（真人）。
规则：角色图只用于确定机械角色的机身结构、头部与眼部显示、装甲分件、比例、材质、配色与标识，不约束其原有手臂姿态；动作图只用于确定上肢姿态与手势，不迁移真人外貌、发型、服装、肤色、场景或水印。姿态以上肢动作图为准：肩、肘、腕、机械手指按目标动作重新摆放，角色图手臂下垂或握拢时不得沿用；叉腰须写明肘部外展、前臂收向同侧腰部、手与腰侧接触及肘与躯干之间的空隙。左右以主体自身为准；可辨认的手指逐项写明，不可见细节不编造。
最终图：真人参考图中的人物与机械角色并肩，真人居左、机械角色居右，各自独立，不融合、不交叉肢体；两者都复刻动作图的上肢姿态与手势，头部与躯干正对镜头。
画风：左侧真人也按同一套动漫画风重绘（保留其外貌特征、发型、服装款式与颜色、神情与手势），不再是照片；${look}
构图：居中平视，${toon ? "纯绿色 #00B140 纯色背景（抠像用，主体内部不要绿色）" : "浅灰渐变纯色背景"}，以上半身为画面主体并完整容纳参与动作的双手；不出现重复手臂、多余手掌或残留的原始下垂手臂。${anime ? "画面要有日漫演出感：主体身后放射状集中线、动作方向的速度线、局部网点纹理与漫画高光，右侧角色尤其明显。" : ""}
禁止：画面中不得出现任何文字、水印、气泡、边框或拟声词。
输出：只输出一段完整中文提示词，第一句写“图片1为真人原图，图片2为已完成目标动作的机械角色”，开头写“生成一张以${subject}并肩为主体的图片”，随后依次写目标姿态与手势、外观与画风保留、构图与背景、禁止项。不要标题、解释、分析、JSON 或步骤。`;
}
export function bubbleSuffix(text: string) { return `画面必须画出这个对白气泡（漏画视为不合格）：画面右上方留白处画一个漫画对白气泡：手绘感椭圆或云朵形，纯白填充、纯黑粗描边（约 8px），不加投影、发光或渐变；气泡下方用两段折线画出尖角尾巴，尾巴指向机器人头部；气泡内横排加粗黑体中文「${text}」，字号占气泡高度约 60%，四周留足内边距，只出现这一个气泡，不要方框、色块或多余文字；气泡是成品的一部分，任何情况下都不能省略。\n`; }
export function poseSettingsDefaults(): Required<Pick<PoseSettings, "robotStyle" | "engine">> & PoseOptions {
    return { layout: "grid-horizontal", separator: "white", labels: false, frame: "none", frameSource: "builtin", frameSize: "medium", output: "single", robotStyle: "toon", engine: "qwen35", bubbleAuto: true };
}
// 本地备用台词：没有配置文本模型时按动作关键词挑一句，保证气泡不会因为缺少模型而消失。
const BUBBLE_RULES: Array<[RegExp, string]> = [
    [/比心|爱心|心形/, "比心！"],
    [/点赞|大拇指|竖拇/, "点赞！"],
    [/握拳|拳头|加油/, "加油！"],
    [/剪刀手|手指比出.{0,2}V|胜利/, "耶！"],
    [/挥手|打招呼|招手/, "你好！"],
    [/拥抱|张开双臂|展开双臂/, "来吧！"],
    [/合十|拜托|祈求/, "拜托啦！"],
    [/指(向|着)|食指/, "看这里！"],
    [/叉腰|抱胸/, "厉害吧！"],
];
export function fallbackBubble(pose: string) {
    const text = String(pose || "");
    return (BUBBLE_RULES.find(([rule]) => rule.test(text)) || [/./, "冲！"])[1];
}
export function characterPrompt(pose: string, style: PoseRobotStyle = "anime2d") {
    return `${characterStyleHead(style)}目标动作：\n${pose}\n手部要求：指尖朝向、掌心朝向与手指数目严格按上面描述，手指不要交叉互握、不要握拳、不要合十。`;
}
// 双图拼合表：左角色、右动作，各占一半，等比 contain。拼合后一次 caption 就能同时看到两张参考图。
export function promptSheetGeometry(character: Size, action: Size) {
    const cell: Size = { width: 768, height: 1024 };
    const fit = (s: Size) => {
        const scale = Math.min(cell.width / s.width, cell.height / s.height);
        const width = Math.max(1, Math.floor(s.width * scale)), height = Math.max(1, Math.floor(s.height * scale));
        return { width, height };
    };
    return {
        width: cell.width * 2, height: cell.height,
        cells: [{ x: 0, y: 0, ...cell }, { x: cell.width, y: 0, ...cell }],
        fits: [fit(character), fit(action)],
    };
}
export function poseImageRequest(model: string, references: string[], signal: AbortSignal) {
    return { model, count: 1, references, mode: POSE_IMAGE_MODE, signal };
}
export function assertPoseActive(signal: AbortSignal, active = true) {
    if (signal.aborted || !active) throw new DOMException("已停止后续步骤", "AbortError");
}
class PoseStageError extends Error {}
function toMedia(media: PoseMedia, hint = "图片未持久化或尺寸无效，请重新上传图片"): PoseMedia {
    if (!media?.storageKey?.startsWith("image:") || !Number.isFinite(media.width) || !Number.isFinite(media.height) || media.width <= 0 || media.height <= 0) throw new PoseStageError(hint);
    return { storageKey: media.storageKey, width: media.width, height: media.height, mimeType: media.mimeType };
}
export async function runPosePortrait(input: PoseRun, deps: PoseDependencies, signal: AbortSignal): Promise<void> {
    const run: PoseRun = structuredClone({ ...input, pose: undefined, prompt: undefined, personArt: undefined, action: undefined, output: undefined, error: undefined, status: "running", stage: "caption" });
    run.person = toMedia(run.person); run.character = toMedia(run.character);
    // Mirror each stage back into the caller's object: the panel publishes those results as separate nodes afterwards.
    const save = () => { const snapshot = structuredClone(run); Object.assign(input, snapshot); deps.save(structuredClone(run)); };
    // 每个阶段一完成就放出对应节点，不必等整轮结束；发布失败只影响画布展示，不影响生成结果。
    const emit = async () => { save(); try { await deps.progress?.(structuredClone(run)); } catch { /* publish is cosmetic */ } };
    const check = () => assertPoseActive(signal, deps.isActive());
    try {
        check();
        if (!run.characterModel || (run.options.layout === "natural" && !run.portraitModel)) throw new PoseStageError("缺少本轮生图模型，请重新选择后运行");
        save();
        const pose = await deps.caption(signal); check();
        if (!pose.trim()) throw new PoseStageError("动作识别返回空文本，请检查照片是否能清晰看见人物姿态");
        run.pose = pose.trim();
        await emit();
        // 只有自然合照需要整段提示词；本地拼接不调用反推，省一次模型请求和一张存储图。
        if (run.options.layout === "natural") {
            run.stage = "prompt"; save();
            const prompt = await deps.describe(signal); check();
            if (!prompt.trim()) throw new PoseStageError("提示词生成返回空文本，请重试；不会退回到固定模板");
            run.prompt = prompt.trim();
        }
        const style = run.robotStyle ?? "toon";
        // 动漫画风拿到的是绿幕图：先抠成透明 PNG 并补画速度线，导出的阶段节点因此也能直接叠到任意背景上。
        const flat = async (media: PoseMedia): Promise<PoseMedia> => style === "realistic" || !deps.alpha ? media : toMedia(await deps.alpha(media, style, signal), "透明背景处理失败，请重试");
        // 提示词来源：默认让模型看图各写一段（更贴合具体动作）；失败或没实现时退回固定模板，绝不因此中断整轮。
        const art = async (kind: "person" | "character", fallback: string, head: string) => {
            if ((run.options.promptMode ?? "model") === "template" || !deps.describeArt) return fallback;
            try {
                const text = (await deps.describeArt(kind, signal)).trim();
                // 模型写的描述常常只聊造型、漏掉手势；把动作放到最前面做主约束，描述降为细节补充。
                const pose = (run.pose ?? "").trim();
                if (text) return pose ? `${head}目标动作（必须照此摆出姿势）：\n${pose}\n外观与画面要点（只用于造型细节，不得改变上面的姿势与手势）：\n${text}` : head + text;
            } catch (error) { if (signal.aborted) throw error; }
            return fallback;
        };
        if (run.options.bubbleAuto && deps.bubble) {
            // 气泡只是装饰：反推失败或空文本时宁可不出气泡，也不应该让整次运行失败。
            try { const text = (await deps.bubble(run.pose ?? "", signal))?.trim(); if (text) run.options.bubble = text.slice(0, 40); } catch (error) { if (signal.aborted) throw error; }
            // 没有文本模型（或调用失败）时用动作关键词兜底，气泡不能静默消失。
            if (!run.options.bubble?.trim()) run.options.bubble = fallbackBubble(run.pose ?? "");
            check();
        }
        // 模型直接画气泡时，文字要在出图前就定下来；本地画则合成阶段再加。
        const bubbleText = run.options.bubble?.trim();
        if (style !== "realistic") {
            run.stage = "person"; save();
            // 气泡只画在机械角色那张（二宫格右侧/单张的主角图），避免两张各冒一个气泡。
            const prompt = await art("person", personPrompt(run.pose, style), personStyleHead(style)); check();
            run.personPrompt = prompt;
            run.personArt = await flat(toMedia(await deps.generate(prompt, run.characterModel, [structuredClone(run.person)], signal), "未获得本轮动漫化人物图，请检查模型是否支持图像编辑并返回图片")); check();
            await emit();
        }
        const personImage = run.personArt ?? run.person;
        run.stage = "character"; save();
        run.actionPrompt = await art("character", (bubbleText ? bubbleSuffix(bubbleText) : "") + characterPrompt(run.pose, style), characterStyleHead(style)); check();
        // 只靠文字描述手势，模型很容易画出“双手握在一起”这类似是而非的动作；
        // 模型支持多张参考图时，把真人照片一并给它照抄手型（图片1=角色设定，图片2=真人）。
        const twoRefs = (run.characterInputs ?? 1) >= 2;
        if (twoRefs) run.actionPrompt += "\n图片1是角色设定（只保留机体设计），图片2是真人动作参考（只照抄手臂、手腕与手指的姿态，绝对不要把人画进画面）。";
        const refs = [structuredClone(run.character), ...(twoRefs ? [structuredClone(personImage)] : [])];
        const action = await flat(toMedia(await deps.generate(run.actionPrompt, run.characterModel, refs, signal), "未获得本轮动作角色图，请检查模型是否支持图像编辑并返回图片")); check();
        run.action = action; run.stage = "output"; save();
        await emit();
        // 单张输出：不再拼图、不再调模型重绘，直接把这张动漫图当成品（两张图另外作为独立节点导出）。
        // 选了海报背景时，把这张图装裱到海报上；透明背景只在没有海报时才有意义。
        // 选了海报时仍然把两张并排贴到海报上（海报就是成品画布）；没有海报时单张模式只出独立图片。
        if ((run.options.output ?? "single") === "single" && run.options.frame !== "openeuler") {
            check();
            run.output = structuredClone(action); run.status = "done"; await emit(); return;
        }
        const bubble = run.options.bubble?.trim();
        const finalPrompt = run.prompt && bubble && run.options.layout === "natural" ? bubbleSuffix(bubble) + run.prompt : run.prompt;
        const output = toMedia(run.options.layout === "natural"
            ? await deps.generate(finalPrompt!, run.portraitModel!, [structuredClone(personImage), structuredClone(action)], signal)
            : await deps.compose(structuredClone(personImage), structuredClone(action), run.options, signal), "未获得本轮最终输出，请检查输出模型或本地图片存储");
        check();
        run.output = output; run.status = "done"; await emit();
    } catch (error) {
        run.status = signal.aborted || !deps.isActive() || (error instanceof Error && error.name === "AbortError") ? "stopped" : "error";
        // Never persist arbitrary transport errors: they can contain keys, request bodies or image URLs.
        run.error = run.status === "stopped" ? "已停止后续步骤；后台 GPU 任务可能仍在运行" : error instanceof PoseStageError ? error.message : `${{ caption: "动作识别", prompt: "提示词生成", person: "人物动漫化", character: "角色生成", output: "最终输出" }[run.stage]}失败，请检查模型、配置及连接后重新运行（不会自动重试）`;
        save();
    }
}
type Size = { width: number; height: number };
type Rect = Size & { x: number; y: number };
export function poseGeometry(person: Size, action: Size, options: PoseOptions): { width: number; height: number; images: Rect[]; frames?: Rect[]; labels: Array<{ x: number; y: number; width: number; height: number; text: string }>; separator?: Rect; fontSize: number } {
    for (const s of [person, action]) if (!Number.isFinite(s.width) || !Number.isFinite(s.height) || s.width <= 0 || s.height <= 0) throw new Error("图片尺寸无效");
    if (options.layout === "natural") throw new Error("自然合照不使用本地布局");
    const horizontal = options.layout.endsWith("horizontal"), grid = options.layout.startsWith("grid-");
    const gapDesign = options.separator === "white" ? 24 : options.separator === "black" ? 2 : 0;
    const labelDesign = options.labels ? 48 : 0;
    // 气泡单独占一条顶部留白，绝不覆盖手势与面部。
    // 气泡一律由生图模型画进图里，本地不再画气泡，也不再留气泡带。
    const bandDesign = 0;
    const cells = grid ? [{ width: 1024, height: 1024 }, { width: 1024, height: 1024 }] : horizontal
        ? [person, action].map(s => ({ width: 1024 * s.width / s.height, height: 1024 }))
        : [person, action].map(s => ({ width: 1024, height: 1024 * s.height / s.width }));
    const rawWidth = horizontal ? cells[0].width + cells[1].width + gapDesign : Math.max(...cells.map(c => c.width));
    const rawHeight = horizontal ? Math.max(...cells.map(c => c.height)) + labelDesign + bandDesign : cells[0].height + cells[1].height + labelDesign * 2 + gapDesign + bandDesign;
    // 卡通分格在画布外留一圈白边，避免黑框贴死边缘。
    const marginDesign = options.style === "toon" ? 56 : 0;
    const scale = Math.min(1, 4096 / Math.max(rawWidth + marginDesign * 2, rawHeight + marginDesign * 2));
    // Round every boundary once, in output pixels, so adjacent regions share an edge and no seam appears.
    const trim = (value: number) => value > 0 ? Math.max(1, Math.floor(value * scale)) : 0;
    const cellWidth = cells.map(c => Math.max(1, Math.floor(c.width * scale)));
    const cellHeight = cells.map(c => Math.max(1, Math.floor(c.height * scale)));
    const gap = trim(gapDesign), label = trim(labelDesign), band = trim(bandDesign), margin = trim(marginDesign);
    const width = (horizontal ? cellWidth[0] + gap + cellWidth[1] : Math.max(...cellWidth)) + margin * 2;
    const height = (horizontal ? band + Math.max(...cellHeight) + label : band + cellHeight[0] + label + gap + cellHeight[1] + label) + margin * 2;
    const origins = horizontal
        ? [{ x: margin, y: margin }, { x: margin + cellWidth[0] + gap, y: margin + band }]
        : [{ x: margin, y: margin + band }, { x: margin, y: margin + band + cellHeight[0] + label + gap }];
    const images: Rect[] = [], labels: Array<Rect & { text: string }> = [];
    cells.forEach((_, i) => {
        const source = [person, action][i];
        const fit = Math.min(cellWidth[i] / source.width, cellHeight[i] / source.height);
        const w = Math.max(1, Math.floor(source.width * fit)), h = Math.max(1, Math.floor(source.height * fit));
        images.push({ x: origins[i].x + Math.floor((cellWidth[i] - w) / 2), y: origins[i].y + Math.floor((cellHeight[i] - h) / 2), width: w, height: h });
        if (label) labels.push({ x: origins[i].x, y: origins[i].y + cellHeight[i], width: cellWidth[i], height: label, text: i ? "机械角色" : "真人" });
    });
    const separator = gap ? horizontal
        ? { x: margin + cellWidth[0], y: margin, width: gap, height: height - margin * 2 }
        : { x: margin, y: margin + band + cellHeight[0] + label, width: width - margin * 2, height: gap } : undefined;
    const frames = options.style === "toon" ? cells.map((_, i) => ({ x: origins[i].x, y: origins[i].y, width: cellWidth[i], height: cellHeight[i] })) : undefined;
    return { width, height, images, frames, labels, separator, fontSize: Math.max(10, Math.round(24 * scale)) };
}
