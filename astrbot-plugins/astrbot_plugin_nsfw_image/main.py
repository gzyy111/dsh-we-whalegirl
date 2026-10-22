"""色图直发插件（带预取池）。

群友说「发两张色图」之类的话时，本插件在**大模型之前**截住消息：
优先从预取池里秒发，池子空了再当场抓 → event.send(text + images) →
stop_event + _has_send_oper，LLM 阶段整段跳过。

后台常驻一个 worker，池子低于阈值就自己补货，所以日常要图基本是秒回。
"""

import asyncio
import os
import random
import re
import subprocess
import sys
import time
from pathlib import Path

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, MessageChain, filter
from astrbot.api.message_components import Image, Plain
from astrbot.api.star import Context, Star, register
from astrbot.core.star.filter.custom_filter import CustomFilter

BASE = Path(__file__).resolve().parent
SCRIPT = BASE / "fetch_nsfw.py"
NSFW_DIR = BASE / "nsfw"          # 当场抓的
POOL_DIR = BASE / "pool"          # 预取池
SERVED_DIR = BASE / "served"      # 发过的

EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
PREFETCH_TAG = "1girl solo"
POOL_TARGET = 20                  # 池子维持多少张
PREFETCH_BATCH = 4                # 每次补几张
PREFETCH_INTERVAL = 10            # 补货间隔（秒）

ASK = re.compile(
    r"(色图|涩图|涩照|色照|黄图|裸照|h图|H图|奶图|"
    r"动漫图|二次元图|动漫涩图|来点动漫|来两张动漫|来点图|发点图|"
    r"来两张|发两张|搞点图|来张图|发张图|整点图|来张|发张|来一张|发一张|"
    r"巨乳|贫乳|大奶|奶子|大胸|白丝|黑丝|裤袜|丝袜|过膝袜|吊带袜|"
    r"翘臀|比基尼|泳装|露点|裸体|全裸|白毛|银发|猫耳|兽耳|狐耳|"
    r"小穴|骚穴|花穴|阴唇|阴部|阴毛|肉穴|自慰|潮吹|内射|"
    r"双马尾|女仆|水手服|护士|旗袍|死库水|兔女郎|眼罩|纹身|项圈|"
    r"金发|粉发|蓝发|红发|紫发|绿发)"
)

# 常见角色的快捷表（省一次模型调用；表里没有的交给出模型转标签）
CHAR_ALIAS = {
    "龙卷": "tatsumaki",
    "布欧": "majin_buu",
    "初音": "hatsune_miku",
    "雷姆": "rem_(re:zero)",
    "拉姆": "ram_(re:zero)",
    "亚丝娜": "yuuki_asuna",
    "明日香": "souryuu_asuka_langley",
    "绫波": "ayanami_rei",
    "娜美": "nami_(one_piece)",
    "女帝": "boa_hancock",
    "蒂法": "tifa_lockhart",
    "艾达": "ada_wong",
    "2B": "2b_(nier:automata)",
    "马卡龙": "macaron_(girls_band_cry)",
}

# 给模型用的标签翻译提示词
TAG_SYSTEM = (
    "你是 danbooru/gelbooru 标签翻译器。把用户的话转成 gelbooru 英文标签。"
    "只输出标签本身，空格分隔，不要解释、不要编号、不要标点。"
    "角色一律用带作品名的全名写法，例如 tatsumaki_(one_punch_man)、"
    "hatsune_miku。"
    "如果用户没指定露点程度，就补一个 nude。"
    "严禁输出 loli、shota、child、underage、toddler、elementary_school 等未成年相关标签；"
    "遇到未成年设定，改成 adult 对应的成年标签。"
)

TAG_OK = re.compile(r"^[a-z0-9_()'\-:]+$")
TAG_BAN = {"loli", "shota", "child", "children", "underage", "toddler",
           "infant", "elementary_school", "kindergarten", "preschool",
           "young_child", "child_on_child"}

# 中文 → gelbooru 标签。第一项会被当「主标签」用来降级。
TAG_RULES = [
    # 身材 / 露点 / 性器
    (("巨乳", "大奶", "奶子", "大胸", "大波"), ("big_breasts",)),
    (("贫乳", "平胸", "小奶"), ("flat_chest",)),
    (("裸体", "全裸", "脱光", "裸照", "裸"), ("nude",)),
    (("露点", "奶头", "乳头"), ("nipples",)),
    (("翘臀", "屁股", "臀部"), ("ass",)),
    (("小穴", "骚穴", "花穴", "肉穴", "阴唇", "阴部"), ("pussy",)),
    (("阴毛",), ("pubic_hair",)),
    (("自慰",), ("masturbation",)),
    (("潮吹",), ("squirting",)),
    (("内射",), ("cum_in_pussy",)),
    # 袜子 / 服装
    (("白丝", "白裤袜"), ("white_pantyhose",)),
    (("黑丝", "裤袜", "丝袜"), ("pantyhose",)),
    (("过膝袜",), ("thighhighs",)),
    (("吊带袜",), ("garter_belt",)),
    (("泳装",), ("swimsuit",)),
    (("比基尼",), ("bikini",)),
    (("死库水",), ("school_swimsuit",)),
    (("女仆",), ("maid",)),
    (("水手服", "校服"), ("serafuku",)),
    (("护士",), ("nurse",)),
    (("旗袍",), ("china_dress",)),
    (("兔女郎",), ("bunny_girl",)),
    (("婚纱",), ("wedding_dress",)),
    (("内衣",), ("lingerie",)),
    (("短裙",), ("skirt",)),
    # 头发 / 眼睛
    (("白毛", "银发", "白发"), ("white_hair",)),
    (("金发",), ("blonde_hair",)),
    (("黑发",), ("black_hair",)),
    (("粉发", "粉毛"), ("pink_hair",)),
    (("蓝发", "蓝毛"), ("blue_hair",)),
    (("红发", "红毛"), ("red_hair",)),
    (("紫发", "紫毛"), ("purple_hair",)),
    (("绿发",), ("green_hair",)),
    (("双马尾",), ("twintails",)),
    (("单马尾",), ("ponytail",)),
    (("眼镜",), ("glasses",)),
    # 兽耳 / 种族 / 配件
    (("猫耳",), ("cat_ears",)),
    (("狐耳",), ("fox_ears",)),
    (("兽耳",), ("animal_ears",)),
    (("精灵",), ("elf",)),
    (("恶魔",), ("demon",)),
    (("天使",), ("angel",)),
    (("眼罩",), ("eyepatch",)),
    (("纹身",), ("tattoo",)),
    (("项圈",), ("collar",)),
    (("束缚", "捆绑"), ("bondage",)),
    (("湿身", "湿透"), ("wet",)),
]

CN_NUM = {"一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5,
          "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}

COOLDOWN_SECONDS = 5
_last: dict[str, float] = {}
pool_lock = asyncio.Lock()


class NsfwAskFilter(CustomFilter):
    """只认「要图」这类话，别的消息完全不管。"""

    def filter(self, event: AstrMessageEvent, cfg) -> bool:
        text = (event.message_str or "").strip()
        if not text:
            return False
        if not ASK.search(text):
            return False
        try:
            if event.get_group_id() and not getattr(
                event, "is_at_or_wake_command", False
            ):
                return False
        except Exception:
            pass
        return True


def _match_rules(text: str) -> tuple[list[str], str | None]:
    words: list[str] = []
    primary = None
    for keys, tags in TAG_RULES:
        if any(k in text for k in keys):
            if primary is None:
                primary = tags[0]
            for w in tags:
                if w not in words:
                    words.append(w)
    return words, primary


def alias_tags(text: str) -> list[str]:
    return [v for k, v in CHAR_ALIAS.items() if k.lower() in text.lower()]


def candidate_tags(text: str) -> list[str]:
    """gelbooru 标签是 AND，组合太细会零结果 → 逐级放宽。

    返回的候选按优先级排列；第一项等于 PREFETCH_TAG 表示「没指定题材」。
    """
    words, primary = _match_rules(text)
    out: list[str] = []
    alias = alias_tags(text)

    if alias:
        out.append(" ".join(alias + ["solo"]))
        if len(alias) > 1:
            out.append(f"{alias[0]} solo")

    if words:
        out.append(" ".join(words) + " solo")
    else:
        # 没命中中文，看看有没有直接给英文标签
        toks = re.findall(r"[a-z][a-z0-9_]{2,}", text.lower())
        if toks:
            out.append(" ".join(dict.fromkeys(toks)))

    if primary:
        out.append(f"{primary} solo")
        out.append(primary)
    if alias and len(alias) > 1:
        out.append(alias[0])
    out.append(PREFETCH_TAG)

    seen: set[str] = set()
    uniq: list[str] = []
    for t in out:
        if t and t not in seen:
            seen.add(t)
            uniq.append(t)
    return uniq


def pick_count(text: str) -> int:
    m = re.search(r"([0-9]+)\s*张", text)
    if m:
        return max(1, min(5, int(m.group(1))))
    m = re.search(r"([一二两三四五六七八九十])\s*张", text)
    if m:
        return max(1, min(5, CN_NUM.get(m.group(1), 2)))
    return 2


def _images(folder: Path) -> list[Path]:
    if not folder.exists():
        return []
    return [p for p in folder.iterdir()
            if p.is_file() and p.suffix.lower() in EXTS]


def prune(folder: Path, keep: int = 300) -> None:
    try:
        files = sorted(_images(folder),
                       key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files[keep:]:
            old.unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[nsfw] prune failed: {e}")


def take_from_pool(count: int) -> list[str]:
    """从池里取图，取到的挪进 served，避免重复发同一张。"""
    files = _images(POOL_DIR)
    random.shuffle(files)
    SERVED_DIR.mkdir(parents=True, exist_ok=True)
    out: list[str] = []
    for p in files[:count]:
        try:
            dst = SERVED_DIR / p.name
            p.replace(dst)
            out.append(str(dst))
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[nsfw] move failed: {e}")
    if out:
        prune(SERVED_DIR, keep=400)
    return out


def run_script(tags: str, count: int, timeout: int = 150,
               out_dir: Path | None = None) -> list[str]:
    target = Path(out_dir) if out_dir else NSFW_DIR
    target.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["NSFW_DIR"] = str(target)
    cmd = [sys.executable, str(SCRIPT), tags, str(count)]
    logger.info(f"[nsfw] run: {tags!r} x{count} -> {target.name}")
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout, env=env)
    out = proc.stdout.decode("utf-8", "ignore")
    err = proc.stderr.decode("utf-8", "ignore").strip()
    paths = []
    for line in out.splitlines():
        line = line.strip()
        if line and Path(line).suffix.lower() in EXTS and Path(line).exists():
            paths.append(line)
    if not paths:
        logger.warning(f"[nsfw] no image. rc={proc.returncode} err={err[:160]}")
    else:
        prune(target)
    return paths[:count]


async def prefetch_worker() -> None:
    """池子低于阈值就补货；空闲时慢慢囤。"""
    while True:
        try:
            if not pool_lock.locked() and len(_images(POOL_DIR)) < POOL_TARGET:
                async with pool_lock:
                    need = POOL_TARGET - len(_images(POOL_DIR))
                    await asyncio.to_thread(
                        run_script, PREFETCH_TAG,
                        min(PREFETCH_BATCH, max(1, need)), 90, POOL_DIR,
                    )
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[nsfw] prefetch failed: {type(e).__name__}: {e}")
        await asyncio.sleep(PREFETCH_INTERVAL)


@register(
    "nsfw_image",
    "dsh",
    "色图直发：预取池秒发 + 现场抓图，绕开大模型，杜绝拒绝",
    "1.7.0",
)
class NsfwImagePlugin(Star):
    def __init__(self, context: Context):
        super().__init__(context)
        self._worker: asyncio.Task | None = None

    @filter.on_astrbot_loaded()
    async def on_loaded(self):
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(prefetch_worker())
            logger.info(
                f"[nsfw] prefetch worker started (target={POOL_TARGET}, "
                f"tag={PREFETCH_TAG!r})"
            )

    async def terminate(self):
        if self._worker and not self._worker.done():
            self._worker.cancel()

    async def llm_tags(self, umo: str | None, text: str) -> str:
        """把「超人里的龙卷」这类自由说法交给模型翻成 gelbooru 标签。"""
        try:
            prov = await self.context.get_using_provider_async(umo)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[nsfw] llm provider err: {e}")
            return ""
        if prov is None:
            return ""
        try:
            resp = await prov.text_chat(prompt=text, system_prompt=TAG_SYSTEM)
            raw = resp.completion_text or ""
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[nsfw] llm tags failed: {e}")
            return ""
        tags: list[str] = []
        for tok in re.findall(r"[a-z0-9_':()\-]+", raw.lower()):
            tok = tok.strip("'")
            if not tok or tok in TAG_BAN or not TAG_OK.match(tok):
                continue
            if tok not in tags:
                tags.append(tok)
        tag_str = " ".join(tags[:6])
        logger.info(f"[nsfw] llm tags {text!r} -> {tag_str!r}")
        return tag_str

    @filter.custom_filter(NsfwAskFilter)
    async def on_ask(self, event: AstrMessageEvent):
        umo = event.unified_msg_origin
        now = time.monotonic()
        if now - _last.get(umo, 0) < COOLDOWN_SECONDS:
            event.stop_event()
            return
        _last[umo] = now

        text = event.message_str or ""
        tag_list = candidate_tags(text)
        count = pick_count(text)

        # 没命中任何关键词/别名 → 让模型把自由说法翻成标签（角色名靠这招）
        if tag_list and tag_list[0] == PREFETCH_TAG:
            try:
                extra = await asyncio.wait_for(self.llm_tags(umo, text), timeout=20)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[nsfw] llm tags timeout/err: {e}")
                extra = ""
            if extra:
                tag_list = [extra] + tag_list

        specific = tag_list[0] != PREFETCH_TAG

        # 先掐掉 LLM，成功失败都不会再走模型
        event.stop_event()

        async def safe_send(chain: MessageChain) -> None:
            try:
                await event.send(chain)
            except Exception as e:  # noqa: BLE001
                logger.error(f"[nsfw] send failed: {type(e).__name__}: {e}")

        paths: list[str] = []
        source = "live"

        # ① 没指定题材 → 先吃池子，秒发
        if not specific:
            paths = take_from_pool(count)
            if paths:
                source = "pool"
            if len(paths) < count:
                try:
                    extra = await asyncio.to_thread(
                        run_script, PREFETCH_TAG, count - len(paths), 70
                    )
                    paths += extra
                    if extra and source == "pool":
                        source = "pool+live"
                except Exception as e:  # noqa: BLE001
                    logger.error(f"[nsfw] live fill failed: {e}")

        # ② 指定了题材 → 按降级链现场抓
        if not paths:
            for tags in tag_list:
                try:
                    paths = await asyncio.to_thread(run_script, tags, count, 70)
                except Exception as e:  # noqa: BLE001
                    logger.error(f"[nsfw] script failed on {tags!r}: {e}")
                    continue
                if paths:
                    logger.info(f"[nsfw] hit with tags {tags!r}")
                    break

        if not paths:
            await safe_send(
                MessageChain(chain=[Plain("唔…网不通，本鲸没捞到图。")])
            )
            return

        logger.info(f"[nsfw] sending {len(paths)} via {source}")
        chain = [Plain(random.choice([
            "给你放这儿了，自己挑。",
            "喏，就这些，别贪。",
            "拿去吧…本鲸去看海了。",
            "挑吧挑吧，就这两张。",
            "慢吞吞的，拿去。",
        ]))]
        for p in paths:
            chain.append(Image.fromFileSystem(p))
        await safe_send(MessageChain(chain=chain))
