# 朝花夕拾

一个个人日记网页应用。支持按日期浏览、搜索、标签、自动保存和历史版本。

## 使用

需要 Node.js 22 或更新版本。首次运行：

```sh
npm ci
npm run diary
```

打开 http://127.0.0.1:8766 。Windows 也可双击 **打开本地日记.cmd**，用 **关闭本地日记.cmd** 停止服务。

手机访问：电脑和手机登录同一 Tailscale 账号，双击 **开启手机访问.cmd**，在手机浏览器打开显示的地址。电脑需在线且不休眠；用 **关闭手机访问.cmd** 撤销远程访问。

## 数据

内容保存在 `exports/LIFE/`，按日期整理。日记、图片和私人配置不会提交到 Git；迁移或备份时请另外复制数据目录。未保存的草稿请勿关闭或刷新页面。

## 致谢

界面参考 [Memos](https://github.com/usememos/memos)。使用 Cheerio、fast-xml-parser、sharp、Playwright，以及可选的 Tailscale。许可说明见 [第三方声明](local-diary/THIRD_PARTY_NOTICES.md)，依赖版本见 [package.json](package.json)。
