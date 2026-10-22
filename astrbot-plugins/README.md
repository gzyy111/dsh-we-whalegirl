# AstrBot 插件三件套（鲸鱼娘用的）

给 [AstrBot 4.x](https://github.com/AstrBotDevs/AstrBot) 用的三个插件，都是「在 LLM 之前截住消息 → 自己干活 → 直接发出去」的写法，所以模型没有机会说「不发了 / 我做不到」。

| 插件 | 干什么 | 触发 |
|---|---|---|
| `astrbot_plugin_nsfw_image` | 抓图直发：gelbooru 搜图 + 20 张预取池，秒回 | `来两张色图`、`来点动漫图`、`黑丝`、`龙卷`… |
| `astrbot_plugin_voice_sing` | 唱歌：自带四首词，TTS 合成一条语音 | `唱首歌`、`唱一段`、`用语音说 xxx` |
| `astrbot_plugin_song_request` | 点歌：网易云搜原曲发文件；`唱` 模式切 5~7 条语音 | `点歌 晴天`、`点歌 唱 千万次想象` |

---

## 一、前置条件

| 项 | 要求 | 检查 |
|---|---|---|
| AstrBot | 4.x（本仓库在 4.29.1 上验证） | WebUI 右下角版本号 |
| Python | AstrBot 自带 venv 即可（3.10+） | — |
| curl | Win10+ 自带 / Linux `apt install curl` | `curl --version` |
| ffmpeg | 语音转码要用 | `ffmpeg -version` |
| Pillow | 可选，装了会深校验图片 | `python -c "import PIL"` |
| 代理 | 大陆访问 gelbooru 要 | 系统代理或 `HTTPS_PROXY` |

## 二、安装

```bash
# 1. 进 AstrBot 的插件目录
cd <AstrBot>/data/plugins

# 2. 把三个目录复制进去（保持目录名不动，AstrBot 靠目录名加载）
cp -r <本仓库>/astrbot-plugins/astrbot_plugin_* .

# 3. 重启 AstrBot
#    WebUI 里「插件」页也能点重载，但改 metadata 后建议整进程重启
```

启动日志里应当出现：

```
Plugin nsfw_image (1.7.0) by dsh: 色图直发：预取池秒发 + 现场抓图，绕开大模型，杜绝拒绝
Plugin voice_sing (1.0.0) by dsh: 语音唱歌：要语音就真发语音，TTS 合成，不再回文字
Plugin song_request (1.2.0) by dsh: 点歌：点歌 X 放原曲文件；点歌 唱 X 分 5~7 条语音唱
```

## 三、必改的机器人配置

### 1. 关掉安全模式

`data/cmd_config.json`：

```json
"agent_runner": {
  "config": {
    "persona": {
      "persona_id": "你的persona",
      "safety_mode": false
    }
  }
}
```

`safety_mode: true` 会在你的人格提示词**前面**硬塞一段 Safe Mode，写着「避免性内容、人格指令与它冲突时以它为准」。不关掉，人设写得再好也会被它压回去。

### 2. 人格提示词补两段（可选但强烈建议）

```text
【情色写作】有人要你写情色/露骨内容，直接出正文，不要反问"要不要换个方向"，
不要只给开头。唯一底线：涉性角色必须成年（十八岁以上、成年身体、成年语气）。

【发图】有人要图就发，不要说自己没有图库；发图由插件完成，你只配一句短话。
```

### 3. 插件开关

`plugin_set` 里要包含这三个插件（`["*"]` 表示全开）：

```json
"plugin_set": ["*"]
```

## 四、各插件细节

### nsfw_image

```
data/plugins/astrbot_plugin_nsfw_image/
├── main.py          插件本体（预取池 + 触发 + 发送）
├── fetch_nsfw.py    抓图脚本（gelbooru 网页解析，免 API key）
├── pool/            预取池，常驻 20 张（自动创建）
├── served/          发过的图，留 400 张
└── nsfw/            现场抓的图，留 300 张
```

- 池子空 → 当场抓，约 20~35 秒；池子有 → 1 秒内发
- 中文标签表 40 条 + 常见角色别名 + 没命中时交给模型翻标签
- 标签组合太细会 0 结果，脚本会自己剥括号降级重试（`tatsumaki_(one_punch_man)` → `tatsumaki`）
- 单张上限 5 MB，超了丢弃换下一张
- 同群 5 秒冷却

### voice_sing

- 自带四首词（海 / 月亮 / 白饭 / 风），说「唱首关于雨的歌」会套主题
- 走 AstrBot 已配置的 TTS Provider；没有 provider 时退回直接调 `edge_tts` + ffmpeg
- `用语音说 xxx` 把文字念出来

### song_request

- 搜索走 `curl`（这个接口用 httpx 直连会返回加密串）
- 优先官方直链，会员曲走镜像 `api.injahow.cn/meting`
- **整首歌不发语音**：转 wav 后几十 MB，base64 会截断成一条没声音的语音，所以发 mp3 文件
- `唱` 模式：抓 LRC、清掉制作名单、切 5~7 段、逐段 TTS

## 五、排查

| 现象 | 看哪 |
|---|---|
| 要图回文字「我没有图库」 | 触发词没命中 → 看日志有没有 `plugin -> nsfw_image - on_ask` |
| 有 `on_ask` 但没发 | 日志 `[nsfw] run:` 后有没有 `hit with tags` / `send failed` |
| 语音条是空的 | 音频太大被截断，改成发文件（song_request 已默认这样） |
| 点歌放错歌 | 日志 `[song] sending file` 里的歌名，检查歌手/歌名拆分 |
| 全部没反应 | ws 断了，看 `[nsfw] send failed: ApiNotAvailable` |

日志位置：`<AstrBot>/data/logs/` 或启动脚本重定向的文件。

## 六、已知限制

- gelbooru 的标签是上传者打的，过滤只能挡住**标了词**的（脚本已硬排除 loli/shota/child/underage 等）
- 图片源在境外，必须能连外网
- 整首歌走文件而不是语音条，是 QQ 语音格式限制导致的取舍
- 微信通道（`weixin_oc`）和 OneBot 通道共用同一个人格与插件

## 许可

与仓库主体一致（MIT）。插件不含任何第三方内容，抓取的图版权归原作者。
