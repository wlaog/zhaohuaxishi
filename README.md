# 朝花夕拾

一个个人日记网页应用。支持按日期浏览、搜索、标签、自动保存和历史版本，也能记录每日心情与天气、翻看往年回忆。

## 使用

Windows 双击 **朝花夕拾.cmd** 打开控制台。首次点击「一键安装」，之后点击「启动并打开日记」即可。缺少 Node.js 时会自动下载到本项目，无需管理员权限；首次安装需要联网。

控制台可启动、停止服务，设置本地端口和手机 HTTPS 端口。关闭控制台不会停止后台服务。

首次启动会在根目录生成带花朵图标的「朝花夕拾」快捷方式，以后也可用它打开控制台。移动或复制项目后，先运行一次 `.cmd` 更新快捷方式。

手机和电脑登录同一 Tailscale 账号，在控制台开启手机访问并复制地址到手机浏览器。电脑需在线且不休眠；首次开启可能需要按提示启用 Tailscale HTTPS。

也可在控制台使用 **Sakura Frp · 密码登录**：电脑运行 Sakura 官方启动器，手机直接通过 HTTPS 地址访问，输入日记密码。该选项与 Tailscale 独立保留。首次需要注册账号、配置隧道与证书，见 [Sakura Frp 配置步骤](docs/SAKURA-FRP.md)。

也可使用 Node.js 22 或更新版本手动运行：

```sh
npm ci
npm run diary
```

默认地址为 http://127.0.0.1:8766 。原有启动、停止快捷脚本仍可使用。

## 数据

内容保存在 `exports/LIFE/`，每日心情与天气存于日期目录的 `day.json`，设置保存在 `local-state/`。日记、图片、私人配置和运行日志不会提交到 Git；迁移或备份时请另外复制数据目录。未保存的草稿请勿关闭或刷新页面。

## 致谢

界面参考 [Memos](https://github.com/usememos/memos)，回顾与心情日历交互参考 [Day One](https://dayoneapp.com/features/) 和 [Daylio](https://daylio.net/)。使用 Cheerio、fast-xml-parser、sharp、Playwright，以及可选的 Tailscale。许可说明见 [第三方声明](local-diary/THIRD_PARTY_NOTICES.md)，依赖版本见 [package.json](package.json)。
