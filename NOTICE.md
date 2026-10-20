# NOTICE

## 本仓库的范围

本仓库只包含 **DSH 插件的代码**（Host + Client 两半）。它通过 HTTP 控制一个**独立部署的**
"鲸鱼娘"机器人（Python 侧车），**不包含**机器人的任何源码、模型权重、曲库、表情包或配置。

## 机器人本体

- 本插件面向的机器人是作者自建项目，上游参考实现为 `linxisama/deepseekgirl`。
- 上游仓库**没有 LICENSE 文件**，按默认规则保留所有权利；因此本仓库**不包含**其任何代码，
  也不对其主张任何许可。
- 使用本插件需要你**自行拥有并部署**机器人本体，并自行确认其授权情况。
- 机器人的能力（微信桌面版 UI 自动化、faster-whisper、edge-tts、SoulX-Singer、ACE-Step）
  属于各自项目与模型的权利人，与本插件无关。

## 第三方组件

本插件**不打包也不 import** 任何第三方运行时依赖：

- 浏览器侧只使用宿主提供的 `react`；
- Host 侧只使用 Node.js 内置模块（`node:http` / `node:fs` / `node:os` / `node:path`）；
- 不引入 `@deepseek-ai/*` 包，也不复制其源码。

`icon.svg` 与 `preview/` 下的界面截图均为作者原创绘制/生成。

## 界面与主题

界面只使用宿主主题 token（`--dsw-alias-*`）与自行编写的 CSS（`ui/theme.css`），
形状参考了宿主自身的设置页排版，未复制任何宿主组件源码。
