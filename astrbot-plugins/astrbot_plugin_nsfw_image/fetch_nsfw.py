#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从 gelbooru 搜 18+ 图并下载，输出本地绝对路径。

用法:
    python fetch_nsfw.py "1girl solo"
    python fetch_nsfw.py "big_breasts" 3      # 要 3 张

说明（相对原版为什么重写）:
  2024 之后 gelbooru 的 DAPI 接口对无 key 请求返回 401，
  所以这里改成走 HTML 列表页 + 单帖页解析，不需要任何 API key。
  其余过滤逻辑（未成年/男性/露点）与原版一致。
"""
import os
import random
import re
import subprocess
import sys
import urllib.parse

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.environ.get("NSFW_DIR") or os.path.join(BASE, "nsfw")
REFERER = "https://gelbooru.com/"
# QQ 桥接单张上限 12MB，留余量，超过 8MB 的直接丢，避免上传失败
MAX_BYTES = 5 * 1024 * 1024

BAN_TAGS = {
    "loli", "shota", "child", "children", "underage", "toddler", "infant",
    "elementary_school", "kindergarten", "preschool", "age_regression",
    "child_on_child", "young_child", "萝莉", "幼女", "正太", "小学生",
    "male", "1boy", "2boys", "3boys", "boy", "boys", "man", "men",
    "yaoi", "bara", "futanari", "penis", "male_focus", "male_only",
    "gay", "trap", "otoko",
}
BAN_SUBSTR = ("loli", "shota", "underage", "萝莉", "幼女", "正太", "小学生", "幼齿")
REQUIRE_TAGS = {
    "nude", "nudity", "nipples", "bare_breasts", "topless",
    "pussy", "spread_pussy", "pussy_juice", "uncensored",
}
QUERY_NEGATIVE = ("-male -1boy -yaoi -futanari -penis -futa "
                  "-loli -shota -child -underage")
RATING = "rating:explicit"


def proxy_arg():
    p = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    if not p:
        try:
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
            if winreg.QueryValueEx(key, "ProxyEnable")[0]:
                server = winreg.QueryValueEx(key, "ProxyServer")[0]
                if server:
                    # 形如 127.0.0.1:7890 或 http=1.2.3.4:80;https=...
                    server = server.split(";")[0].split("=")[-1]
                    p = server if "://" in server else "http://" + server
        except Exception:
            p = None
    return ["-x", p] if p else []


PXY = None


def curl_bytes(url, timeout=30, referer=None):
    cmd = ["curl", "-sL", "--max-time", str(timeout), "-A", UA] + PXY
    if referer:
        cmd += ["-e", referer]
    cmd.append(url)
    try:
        return subprocess.run(cmd, capture_output=True).stdout
    except FileNotFoundError:
        raise RuntimeError("找不到 curl")


def get_html(url, tries=2, timeout=30):
    for _ in range(tries):
        raw = curl_bytes(url, timeout, REFERER).decode("utf-8", "ignore")
        if "<html" in raw.lower():
            return raw
    return ""


def _collect(q, pages):
    ids, seen = [], set()
    for pid in pages:
        html = get_html("https://gelbooru.com/index.php?page=post&s=list"
                        "&tags=%s&pid=%d" % (q, pid * 42))
        if not html:
            continue
        for m in re.finditer(r'id="p(\d+)"', html):
            i = m.group(1)
            if i not in seen:
                seen.add(i)
                ids.append(i)
        if ids:
            break
    return ids


def list_ids(tags, pages=(0, 1, 2)):
    """列表页拿 post id。

    标签组合是 AND，写太细经常 0 结果，所以退一步只留第一个标签再试一次
    （例如 tatsumaki_(one_punch_man) 不存在 → 退成 tatsumaki）。
    """
    def build(t):
        return "%s %s %s" % (RATING, t, QUERY_NEGATIVE)

    ids = _collect(urllib.parse.quote(build(tags)), pages)
    if ids or not tags.strip():
        return ids

    parts = tags.split()
    bare = re.sub(r"\(.*$", "", parts[0]).strip("_") if parts else ""
    cuts = [parts[:1], [bare] if bare else [], parts[:2]]
    for cut in cuts:
        alt = " ".join(cut).strip()
        if not alt or alt == tags:
            continue
        ids = _collect(urllib.parse.quote(build(alt)), pages)
        if ids:
            print("RETRY %s" % alt, file=sys.stderr)
            break
    return ids


def post_tags(html):
    return [urllib.parse.unquote(t).replace("_", " ").strip()
            for t in re.findall(r'tag-type-\w+">(?:.*?)s=list&amp;tags=([^"]+)"',
                               html, re.S)]


def post_image(html):
    m = re.search(r"https://img\d*\.gelbooru\.com/images/"
                  r"[A-Za-z0-9/_.%\-]+\.(?:jpg|jpeg|png|gif|webp)", html)
    return m.group(0) if m else None


def safe_tags(tagnames):
    norm = {t.replace(" ", "_").lower() for t in tagnames}
    if norm & BAN_TAGS:
        return False
    blob = " ".join(norm)
    if any(b in blob for b in BAN_SUBSTR):
        return False
    return bool(norm & REQUIRE_TAGS)


def looks_like_image(path):
    try:
        with open(path, "rb") as f:
            head = f.read(16)
    except OSError:
        return False
    return (head.startswith(b"\xff\xd8\xff")
            or head.startswith(b"\x89PNG\r\n\x1a\n")
            or head.startswith(b"GIF8")
            or (head[:4] == b"RIFF" and head[8:12] == b"WEBP"))


def save(url):
    os.makedirs(OUT_DIR, exist_ok=True)
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        ext = ".jpg"
    path = os.path.join(OUT_DIR, "nsfw_%d%s" % (
        random.randint(10 ** 9, 10 ** 10 - 1), ext))
    data = curl_bytes(url, 90, REFERER)
    if len(data) < 15000 or len(data) > MAX_BYTES:
        return None
    with open(path, "wb") as f:
        f.write(data)

    try:
        from PIL import Image
    except ImportError:
        if looks_like_image(path):
            return path
        os.remove(path)
        return None
    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            if min(im.size) < 200:
                raise ValueError("too small")
    except Exception:
        os.remove(path)
        return None
    return path


def main():
    global PXY
    # 输出路径里有中文，强制 utf-8，避免被控制台按 GBK 编出乱码路径
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    PXY = proxy_arg()

    args = sys.argv[1:]
    want = 1
    if args and args[-1].isdigit():
        want = max(1, min(10, int(args.pop())))
    query = " ".join(args) if args else "1girl solo"

    if any(b in query.lower() for b in BAN_SUBSTR):
        print("FAIL 查询含禁止词", file=sys.stderr)
        return 2

    ids = list_ids(query)
    if not ids:
        print("FAIL 列表页没结果（检查代理 / 标签是否写错）", file=sys.stderr)
        return 1

    random.shuffle(ids)
    got = 0
    tried = 0
    for pid in ids[:20]:
        tried += 1
        html = get_html("https://gelbooru.com/index.php?page=post&s=view&id=%s"
                        % pid)
        if not html:
            continue
        tags = post_tags(html)
        if not safe_tags(tags):
            continue
        url = post_image(html)
        if not url:
            continue
        p = save(url)
        if p:
            print(p)
            got += 1
            if got >= want:
                return 0

    if got:
        return 0
    print("FAIL 试了 %d 个帖子都没拿到合格图（代理/图床/过滤）" % tried,
          file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
