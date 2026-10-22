"""点歌插件（唱 / 放 双模式）。

  点歌 唱 千万次想象      → 抓歌词，切成 5~7 段，逐段 TTS，发 5~7 条语音
  点歌 千万次想象         → 找原曲，下 mp3，发文件
  唱 千万次想象           → 同「点歌 唱」
  放 千万次想象 / 播放 晴天 → 同「点歌」

全部在 LLM 之前截住，所以不会再出现「你是想让我哼两句还是在问这首歌」这种反问。
"""

import asyncio
import json
import re
import subprocess
import time
import urllib.parse
import uuid
from pathlib import Path

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, MessageChain, filter
from astrbot.api.message_components import File, Plain, Record
from astrbot.api.star import Context, Star, register
from astrbot.core.star.filter.custom_filter import CustomFilter

BASE = Path(__file__).resolve().parent
SONG_DIR = BASE / "songs"
LYRIC_DIR = BASE / "lyrics"
VOICE_DIR = BASE / "voices"
for d in (SONG_DIR, LYRIC_DIR, VOICE_DIR):
    d.mkdir(parents=True, exist_ok=True)

MAX_BYTES = 12 * 1024 * 1024
COOLDOWN = 6
_last: dict[str, float] = {}

HEADERS = {
    "Referer": "https://music.163.com",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
}

# 唱：点歌 唱 X / 点唱 X / 唱 X（不能是「唱歌」这种）
SING_ORDER = re.compile(
    r"^(?:点歌|点唱|来段)\s*[:：,，]?\s*唱\s*[:：,，]?\s*(.{1,40})$")
SING_PLAIN = re.compile(r"^唱\s*[:：,，]?\s*(?!歌|首|一段|两句)(.{2,30})$")
SING_SUFFIX = re.compile(
    r"^(?:点歌|点唱)\s*[:：,，]?\s*(.+?)\s*(?:唱|唱给我听|唱一段)$")

# 「你来唱歌 千万次想象 — 张杰」这类自然说法也要认
SING_ANY = re.compile(r"(?:唱歌|哼唱|哼|唱)\s*[:：,，、—\-]*\s*(.{2,40})$")
NOT_TITLE = {"歌", "首歌", "一首", "一首歌", "一段", "两句", "给我听",
             "听听", "来听", "一下", "吧", "呢"}

# 放：点歌 X / 来首歌 X / 放首歌 X / 放 X / 播放 X / 点播 X
PLAY_ORDER = re.compile(
    r"^(?:点歌|来首歌|来首|放首歌|放首|放|播放|点播)\s*[:：,，]?\s*(.{1,40})$")

LRC_LINE = re.compile(r"^\[[^\]]*\]")

# 歌词抓不到时的兜底词
FALLBACK_LYRICS = [
    "滚一层，月一弯，小鱼睡在礁石边",
    "明天的事明天办，今晚只管睡得甜",
    "浪里翻，风里还，谁把星星撒进湾",
    "我摇尾巴慢慢看，一夜轻得像块棉",
    "海里没有钟，只有潮水来回动",
    "我数着你的影子，一圈两圈三圈重",
    "要是你肯留下来，我就把月亮也捞来",
]


def _clean_kw(kw: str) -> str:
    kw = kw.strip(" 《》—－-,，。:：!！?？~")
    kw = re.sub(r"(吧|呢|啊|嘛|哦|呀)$", "", kw).strip()
    return kw


def looks_like_title(kw: str) -> bool:
    kw = _clean_kw(kw)
    if len(kw) < 2 or kw in NOT_TITLE or kw.startswith("歌"):
        return False
    return bool(re.search(r"[\u4e00-\u9fa5]", kw))


def parse_mode(text: str) -> tuple[str, str]:
    """返回 (mode, keyword)。mode ∈ {'sing','play',''}。"""
    t = text.strip()
    for pat in (SING_ORDER, SING_SUFFIX, SING_PLAIN):
        m = pat.match(t)
        if m:
            kw = _clean_kw(m.group(1))
            if looks_like_title(kw):
                return "sing", kw
    m = SING_ANY.search(t)
    if m:
        kw = _clean_kw(m.group(1))
        if looks_like_title(kw):
            return "sing", kw
    m = PLAY_ORDER.match(t)
    if m:
        kw = _clean_kw(m.group(1))
        if looks_like_title(kw):
            return "play", kw
    return "", ""


class SongFilter(CustomFilter):
    def filter(self, event: AstrMessageEvent, cfg) -> bool:
        mode, _ = parse_mode(event.message_str or "")
        if not mode:
            return False
        try:
            if event.get_group_id() and not getattr(
                event, "is_at_or_wake_command", False
            ):
                return False
        except Exception:
            pass
        return True


def _curl(url: str, timeout: int = 20) -> bytes:
    cmd = [
        "curl", "-sL", "--max-time", str(timeout),
        "-H", "Referer: https://music.163.com",
        "-A", HEADERS["User-Agent"],
        url,
    ]
    return subprocess.run(cmd, capture_output=True).stdout


def search(keyword: str, limit: int = 10) -> list[dict]:
    # 注意：httpx 直连这个接口会被返回加密串，curl 才是明文 JSON
    url = ("https://music.163.com/api/search/get/web?s=%s&type=1&limit=%d&offset=0"
           % (urllib.parse.quote(keyword), limit))
    data = json.loads(_curl(url).decode("utf-8", "ignore"))
    songs = (data.get("result") or {}).get("songs") or []
    out = []
    for s in songs:
        try:
            out.append({
                "id": s["id"],
                "name": s["name"],
                "artist": (s.get("artists") or [{}])[0].get("name", "未知"),
                "fee": s.get("fee", 8),
                "dur": s.get("duration", 0),
            })
        except Exception:
            continue
    return out


def parse_kw(kw: str) -> tuple[str, str]:
    """「张杰的千万次想象」「千万次想象 — 张杰」→ (歌名, 歌手)。"""
    kw = _clean_kw(kw)
    for sep in ("—", "－", "–", "-", "|"):
        if sep in kw:
            a, b = kw.split(sep, 1)
            if a.strip() and b.strip():
                return a.strip(), b.strip()
    if "的" in kw:
        a, t = kw.split("的", 1)
        if a.strip() and t.strip():
            return t.strip(), a.strip()
    return kw, ""


def score(song: dict, title: str, artist: str) -> int:
    sc = 0
    if title and song["name"] == title:
        sc += 6
    if title and title in song["name"]:
        sc += 3
    if artist and artist in song["artist"]:
        sc += 4
    if song["fee"] == 0:
        sc += 1
    return sc


def rank(songs: list[dict], kw: str) -> list[dict]:
    title, artist = parse_kw(kw)
    return sorted(songs, key=lambda s: -score(s, title, artist))


def fetch_audio(song: dict) -> Path | None:
    mirrors = [
        f"https://music.163.com/song/media/outer/url?id={song['id']}.mp3",
        f"https://api.injahow.cn/meting/?type=url&id={song['id']}",
    ]
    for url in mirrors:
        path = SONG_DIR / f"{song['id']}_{uuid.uuid4().hex[:6]}.mp3"
        cmd = [
            "curl", "-sL", "--max-time", "60",
            "-H", "Referer: https://music.163.com",
            "-A", HEADERS["User-Agent"],
            "-o", str(path),
            "-w", "%{http_code} %{content_type}",
            url,
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=90)
            meta = r.stdout.decode("utf-8", "ignore").split()
            ctype = meta[1] if len(meta) > 1 else ""
            head = path.read_bytes()[:3] if path.exists() else b""
            ok = ctype.startswith("audio") or head[:3] == b"ID3"
            if not ok or not path.exists():
                path.unlink(missing_ok=True)
                continue
            size = path.stat().st_size
            if size < 10000 or size > MAX_BYTES:
                path.unlink(missing_ok=True)
                continue
            logger.info(f"[song] got {size} bytes from {url.split('/')[2]}")
            return path
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[song] download failed: {e}")
            path.unlink(missing_ok=True)
    return None


def fetch_lyric(song: dict) -> list[str]:
    url = ("https://music.163.com/api/song/lyric?id=%s&lv=1&kv=1&tv=-1"
           % song["id"])
    try:
        lrc = (json.loads(_curl(url).decode("utf-8", "ignore")).get("lrc")
               or {}).get("lyric") or ""
    except Exception:
        return []
    out = []
    for line in lrc.splitlines():
        text = LRC_LINE.sub("", line).strip()
        if not text:
            continue
        # 制作人员名单：带英文/冒号的基本都是
        if re.search(r"[A-Za-z]", text):
            continue
        if re.search(r"(作词|作曲|编曲|制作|混音|和声|监制|发行|出品|录音|设计|推广)",
                     text):
            continue
        if not 4 <= len(text) <= 40:
            continue
        out.append(text)
    return out


def split_lines(lines: list[str], want: int = 6) -> list[str]:
    """把歌词均匀切成 5~7 段。"""
    lines = [ln for ln in lines if len(ln.strip()) >= 4][:24]
    if len(lines) < 5:
        lines = FALLBACK_LYRICS
    want = max(5, min(7, want))
    if len(lines) <= want:
        return lines
    size = -(-len(lines) // want)
    chunks = ["，".join(lines[i:i + size]) for i in range(0, len(lines), size)]
    return chunks[:7]


def prune(folder: Path, keep: int = 200) -> None:
    try:
        files = sorted((p for p in folder.iterdir() if p.is_file()),
                       key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files[keep:]:
            old.unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[song] prune failed: {e}")


@register(
    "song_request",
    "dsh",
    "点歌：点歌 X 放原曲；点歌 唱 X 分 5~7 条语音唱",
    "1.1.0",
)
class SongRequestPlugin(Star):
    def __init__(self, context: Context):
        super().__init__(context)

    # ---------- TTS ----------
    async def _tts(self, umo: str | None, text: str) -> str:
        try:
            prov = await self.context.get_using_tts_provider_async(umo)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[song] tts provider err: {e}")
            prov = None
        if prov is not None:
            try:
                path = await prov.get_audio(text)
                if path and Path(path).exists():
                    return str(path)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[song] tts failed: {e}")
        import edge_tts
        stem = uuid.uuid4().hex
        mp3 = VOICE_DIR / f"{stem}.mp3"
        await edge_tts.Communicate(text, "zh-CN-XiaoyiNeural").save(str(mp3))
        return str(mp3)

    @filter.custom_filter(SongFilter)
    async def on_order(self, event: AstrMessageEvent):
        umo = event.unified_msg_origin
        now = time.monotonic()
        if now - _last.get(umo, 0) < COOLDOWN:
            event.stop_event()
            return
        _last[umo] = now

        text = (event.message_str or "").strip()
        mode, kw = parse_mode(text)
        event.stop_event()

        async def safe_send(chain: MessageChain) -> None:
            try:
                await event.send(chain)
                return
            except Exception as e:  # noqa: BLE001
                logger.error(f"[song] send failed: {type(e).__name__}: {e}")

        title, artist = parse_kw(kw)
        # 只用歌名去搜（「千万次想象 张杰」这种拼一起反而会命中别的歌），
        # 歌手交给 rank() 打分
        q = title if title else kw
        try:
            songs = search(q)
            if not songs:
                songs = search(kw)
        except Exception as e:  # noqa: BLE001
            logger.error(f"[song] search failed: {e}")
            await safe_send(MessageChain(chain=[Plain("网不通，搜不到歌。")]))
            return
        if not songs:
            await safe_send(MessageChain(chain=[Plain(f"没搜到「{kw}」，换个说法？")]))
            return

        songs = rank(songs, kw)
        top = songs[0]

        # ---------- 唱：切 5~7 段，逐段语音 ----------
        if mode == "sing":
            lines = fetch_lyric(top)
            chunks = split_lines(lines)
            await safe_send(MessageChain(chain=[
                Plain(f"《{top['name']}》— {top['artist']}，本鲸哼 {len(chunks)} 段，走音别笑：")
            ]))
            for i, chunk in enumerate(chunks, 1):
                try:
                    path = await self._tts(umo, chunk)
                except Exception as e:  # noqa: BLE001
                    logger.error(f"[song] tts chunk {i} failed: {e}")
                    continue
                logger.info(f"[song] sing chunk {i}/{len(chunks)}")
                await safe_send(MessageChain(chain=[
                    Plain(f"第 {i}/{len(chunks)} 段"),
                    Record.fromFileSystem(path),
                ]))
                await asyncio.sleep(0.8)
            prune(VOICE_DIR)
            return

        # ---------- 放：下原曲发文件 ----------
        chosen, audio = None, None
        for s in songs[:6]:
            audio = fetch_audio(s)
            if audio:
                chosen = s
                break
        if not chosen or not audio:
            lines = fetch_lyric(top)
            if lines:
                await safe_send(MessageChain(chain=[
                    Plain(f"「{top['name']}」原曲放不出来（版权锁了），本鲸念几句给你："),
                    Plain("\n".join(lines[:6])),
                ]))
            else:
                await safe_send(MessageChain(chain=[
                    Plain(f"「{kw}」搜到了但放不出来，版权锁了。")
                ]))
            return

        prune(SONG_DIR)
        logger.info(f"[song] sending file {chosen['name']} - {chosen['artist']}")
        await safe_send(MessageChain(chain=[
            Plain(f"《{chosen['name']}》— {chosen['artist']}"),
            File(name=f"{chosen['name']} - {chosen['artist']}.mp3",
                 file=str(audio)),
        ]))
