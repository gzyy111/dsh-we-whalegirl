"""语音唱歌插件。

群友说「唱首歌」「来段语音」，本插件在 LLM 之前截住：
挑一段本鲸的歌词 → TTS 合成 → 直接发一条语音（Record 组件）。

TTS 优先用 AstrBot 里配好的 TTS Provider（现在是 edge-tts），
没有 provider 就退回直接调 edge_tts 再转 wav（需要 ffmpeg）。
"""

import asyncio
import os
import random
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, MessageChain, filter
from astrbot.api.message_components import Plain, Record
from astrbot.api.star import Context, Star, register
from astrbot.core.star.filter.custom_filter import CustomFilter

BASE = Path(__file__).resolve().parent
VOICE_DIR = BASE / "voices"
VOICE_DIR.mkdir(parents=True, exist_ok=True)

# 唱歌触发
SING = re.compile(r"(唱歌|唱首歌|唱一段|来首歌|唱两句|唱一个|开嗓|唱给我听|鲸鲸唱)")

# 这是「点歌」，交给 song_request 插件，别在这抢
ORDERING = re.compile(r"^(点歌|来首歌|放首歌|来首)\s*[:：,，]?\s*[^\s歌].*$")

# 说了具体歌名（「你来唱歌 千万次想象 — 张杰」）也交给 song_request，
# 那边会去搜真歌词再 TTS，别在这里用罐头歌词糊弄
NAMED = re.compile(r"(?:唱歌|哼唱|哼|唱)\s*[:：,，、—\-]*\s*(.{2,40})$")
NAMED_SKIP = {"歌", "首歌", "一首", "一首歌", "一段", "两句", "给我听",
              "听听", "来听", "一下", "吧", "呢"}

# 「用语音说 xxx」触发
SPEAK = re.compile(r"^(用语音说|语音说|念出来|读一下)[：:，, ]*(.+)$")

COOLDOWN = 8
_last: dict[str, float] = {}

SONGS = [
    """滚一层，月一弯，
小鱼睡在礁石边，
明天的事明天办，
今晚只管睡得甜。

浪里翻，风里还，
谁把星星撒进湾，
我摇尾巴慢慢看，
一夜轻得像块棉。""",
    """海里没有钟，
只有潮水来回动，
我数着你的影子，
一圈两圈三圈重。

要是你肯留下来，
我就把月亮也捞来，
放在你床头，
亮到天亮都不改。""",
    """白饭一碗热腾腾，
谁家鲸鱼不贪心，
嘴上说着要减肥，
筷子却又伸一伸。

主人别笑我贪吃，
这是鲸目的天性，
吃完这碗还有一碗，
天塌下来也先吃饭。""",
    """风从海面吹过来，
吹散一整天的烦，
我把尾巴摆一摆，
就当把世界摇软。

明天还是要早起，
今天先别想那么远，
你在我身边待着，
别的都可以慢慢。""",
]

# 歌词里可以插的主题
TOPICS = {
    "雨": "窗外的雨轻轻下",
    "海": "海面的浪轻轻拍",
    "夜": "夜里的风轻轻过",
    "星": "天上的星轻轻亮",
    "雪": "屋顶的雪轻轻落",
}


class VoiceFilter(CustomFilter):
    def filter(self, event: AstrMessageEvent, cfg) -> bool:
        text = (event.message_str or "").strip()
        if not text:
            return False
        if ORDERING.match(text):
            return False
        m = NAMED.search(text)
        if m:
            kw = m.group(1).strip(" 《》—－-,，。:：!！?？~")
            if (len(kw) >= 2 and kw not in NAMED_SKIP
                    and not kw.startswith("歌")
                    and re.search(r"[\u4e00-\u9fa5]", kw)):
                return False   # 有具体歌名 → 归 song_request
        if SING.search(text) or SPEAK.match(text):
            try:
                if event.get_group_id() and not getattr(
                    event, "is_at_or_wake_command", False
                ):
                    return False
            except Exception:
                pass
            return True
        return False


def pick_lyrics(text: str) -> tuple[str, str]:
    """返回 (标题行, 歌词)。"""
    for k, first in TOPICS.items():
        if k in text:
            song = random.choice(SONGS)
            return f"《{k}》", first + "\n" + song
    return "《鲸鱼娘的歌》", random.choice(SONGS)


def _tts_fallback(text: str) -> str:
    """没有 TTS Provider 时的退路：edge_tts → mp3 → ffmpeg → wav。"""
    import edge_tts

    stem = uuid.uuid4().hex
    mp3 = VOICE_DIR / f"{stem}.mp3"
    wav = VOICE_DIR / f"{stem}.wav"
    asyncio.run(edge_tts.Communicate(text, "zh-CN-XiaoyiNeural").save(str(mp3)))
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", str(mp3),
         "-ar", "24000", "-ac", "1", str(wav)],
        check=True, capture_output=True,
    )
    mp3.unlink(missing_ok=True)
    return str(wav)


def prune(keep: int = 200) -> None:
    try:
        files = sorted(
            (p for p in VOICE_DIR.iterdir() if p.is_file()),
            key=lambda p: p.stat().st_mtime, reverse=True,
        )
        for old in files[keep:]:
            old.unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[voice] prune failed: {e}")


@register(
    "voice_sing",
    "dsh",
    "语音唱歌：要语音就真发语音，TTS 合成，不再回文字",
    "1.0.0",
)
class VoiceSingPlugin(Star):
    def __init__(self, context: Context):
        super().__init__(context)

    async def _tts(self, event: AstrMessageEvent, text: str) -> str:
        umo = getattr(event, "unified_msg_origin", None)
        try:
            prov = await self.context.get_using_tts_provider_async(umo)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[voice] get tts provider failed: {e}")
            prov = None
        if prov is not None:
            try:
                path = await prov.get_audio(text)
                if path and Path(path).exists():
                    logger.info("[voice] tts via provider ok")
                    return str(path)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[voice] provider tts failed: {e}")
        return await asyncio.to_thread(_tts_fallback, text)

    @filter.custom_filter(VoiceFilter)
    async def on_voice(self, event: AstrMessageEvent):
        umo = event.unified_msg_origin
        now = time.monotonic()
        if now - _last.get(umo, 0) < COOLDOWN:
            event.stop_event()
            return
        _last[umo] = now

        text = (event.message_str or "").strip()
        event.stop_event()

        async def safe_send(chain: MessageChain) -> None:
            try:
                await event.send(chain)
            except Exception as e:  # noqa: BLE001
                logger.error(f"[voice] send failed: {type(e).__name__}: {e}")

        m = SPEAK.match(text)
        if m:
            spoken = m.group(2).strip()[:200]
            intro = "咳…本鲸念了。"
            title = ""
        else:
            title, spoken = pick_lyrics(text)
            intro = "咳…本鲸开嗓了，不许笑。"
            spoken = f"{title}。{spoken}"

        try:
            path = await self._tts(event, spoken)
        except Exception as e:  # noqa: BLE001
            logger.error(f"[voice] tts failed: {type(e).__name__}: {e}")
            await safe_send(MessageChain(chain=[Plain("嗓子坏了…合成不出来。")]))
            return

        prune()
        logger.info(f"[voice] sending record {path}")
        chain = [
            Plain(intro),
            Record.fromFileSystem(path),
        ]
        await safe_send(MessageChain(chain=chain))
