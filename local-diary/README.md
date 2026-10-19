# 朝花夕拾 本地编辑版

从项目根目录运行 `npm run diary`，或双击 `打开本地日记.cmd`。操作说明见根目录 README。

界面名称为“朝花夕拾”。右上角“落花”开关控制低透明度、缓慢摆动的花瓣，选择保存在当前浏览器；系统偏好减少动态效果时默认关闭。`public/petals.json` 配置数量、尺寸、透明度与速度，手机减少数量，后台暂停，关闭后移除全部动画节点。效果不接收点击，也不覆盖编辑对话框；无需第三方动画库。测试命令为 `npm run test:petals:browser`。

默认“写今天”继续当天已有记录，快捷输入继续日历选中的日期，没有记录才新建。同日已有多篇时，按创建时间及 ID 稳定选择最早的一篇，不合并或删除其他记录；“新建独立记录”仍可主动新增。回收站和结构页不作为续写目标。`npm run test:daily:browser` 验证这些行为。

## 结构

- `store.mjs`：以短日期目录保存 JSON、原图和历史。独立的持久层不依赖浏览器。
- `server.mjs`：仅监听 IPv4 loopback，提供本地 API、界面和受限的归档文件读取。
- `access.mjs`：校验本机连接或明确配置的 Tailscale Serve HTTPS 代理；所有资料读取及写入均受身份限制。
- `sakura-auth.mjs`：独立 Sakura Frp 入口的密码摘要、登录限速和服务端会话；配置与使用见 [Sakura Frp 配置步骤](../docs/SAKURA-FRP.md)。
- `public/`：无需构建、无外部资源的浏览器界面。
- `THIRD_PARTY_NOTICES.md`：Memos 参考来源、commit、MIT 许可。
- `structure.mjs`：识别日期后缀与仅供分层的空标题页。只有名称符合月份/旬、源哈希一致、无正文/图片/附件/未知对象、无用户新增块时才从应用清理。原文件不受影响。

首次运行读取 OneNote `manifest.json` 与 `assets/catalog.js`，为全部原始页面建立虚拟日记，直到用户保存才写对应的 `entry-*.json`。每次启动重读本地 entry 文件，不需要数据库迁移。服务运行期间请通过界面编辑；手动修改 JSON 后重启服务以重新载入。

原始 OneNote 文件只读；编辑状态是额外的 JSON 覆盖层。原始 `archive` 块只保存 page key，HTML 副本存为 `html` 块并保留 `originPageKey`。以后重新导出不会覆盖 entry JSON，但重新导出同一原始文件会更新引用所显示的内容；如需冻结某个旧视图，可先制作 HTML 副本。图片仍引用该日期目录中的资源。

独立阅读器与资料目录已移除侧栏入口，应用只展示实际日记。空的月份/旬结构页不返回 bootstrap、搜索、收藏和回收站；若某结构页已有内容、用户新增块或源快照不可信，会保守保留。日期识别接受 `12~短后缀` 和 `12-短后缀`，避免把同日多篇的真实日记误作目录。

## 数据安全边界

服务校验 Host、来源和写入 token，无跨源读取授权；目录访问限定在资料根目录，静态文件也检查真实路径。文本块移除活动内容；自定义 HTML 和原始 HTML 使用 sandbox iframe 与 CSP 隔离，禁止脚本、表单提交和外部资源。HTML 区域适用于本地排版，不是可以联网运行 JavaScript 的插件系统。

Tailscale Serve 入口只绑定回环地址。`local-state/remote-access.json` 配置准确的 HTTPS origin 与允许的 Tailscale 登录身份；CLI 启动时加载，默认关闭，配置错误时拒绝启动。仅信任来自本机 Serve 的转发头：匹配 `X-Forwarded-Host`、`X-Forwarded-Proto`、`Tailscale-User-Login`，拒绝 Funnel。依赖 Serve 清理并重新注入身份头；本机进程仍属于可信边界。切勿将免登录的本地日记端口直接暴露到网络。

Sakura Frp 使用另一个回环监听端口（默认 `8767`），无论请求是否来自本机都要求会话认证。`local-state/sakura-access.json` 保存 HTTPS origin、本地入口端口与 scrypt 密码摘要。它与本地/Tailscale 共用同一个存储实例，可分别启停。官方启动器的自动 HTTPS 转发必须保留 Host 并设置 `X-Forwarded-Proto: https`；转发头不作为登录身份。控制台只显示本机入口是否就绪，真实隧道连通性需要手机外网验证。

`GET /api/changes` 提供服务实例与提交序号组成的轻量版本标识，保存及历史恢复时更新。前台浏览器每 15 秒、聚焦或重连时检查；版本变化后才重读列表。当前日记无未保存修改时刷新内容，有草稿时提示冲突并保留草稿；读取新版期间发生输入也不会替换。服务重启后的标识变化会触发重新读取凭据。断网草稿仅留在页面内存，不承诺离线持久化。

PUT 带最后读取的 revision。服务内串行提交，revision 不一致返回 409，界面保留当前草稿并提供导出，不静默覆盖。自动保存只在页面有修改时触发；网络或磁盘失败会阻止保存并关闭。若系统在保存前崩溃，最后尚未写入的少量输入仍可能丢失。历史保存在同一磁盘，不能代替异地或离线独立备份。

每张新增图片以原始字节的 SHA-256 命名并保留原始格式。只引用已有的原图，不把图片 base64 放入 entry JSON。回收站、移除内容块都不会删除原始图片文件，因此历史版本可恢复图片，未引用资源也继续保留。

## 测试

`npm test` 覆盖既有导出与新增持久化/HTTP 边界。`npm run test:diary:browser` 使用本机 Edge、Playwright 和独立的虚构资料夹，覆盖编辑、格式、原图上传、HTML、刷新重读、版本恢复、多窗口冲突、回收站、筛选和响应式界面，并可对指定归档逐页加载、解码图片。通过环境变量 `BROWSER_PATH` 可指定其他 Chromium 可执行文件；`--fixture-only` 跳过真实归档遍历。

服务可由 `createDiaryServer({ root, port: 0 })` 启动隔离实例；测试绝不向真实日记写测试内容。日志、截图和测试资料只写 Git 忽略的路径。

## 文件夹导入

导入实现位于 `scripts/import-diary-folders.mjs`。输入文件与原图均按字节保留，TXT 可编辑，HTML/Word 以可编辑 HTML 内容块接入；同日资料按文件名自然排序，日期区间另存元数据。日记原件与源路径清单均放在被忽略的资料目录中。

有新 DOCX 时先运行 Python 标准库读取器 `scripts/prepare-word-imports.py`，它只读取 OOXML，独立保存原图并核对所有文字节点，不需要 Word。只读转换阶段的中间文件位于 `qa-output/import/word`，最终网页不依赖该目录。转换保留基础字体、段落、图片和表格内容；不承诺 Word 分页或浮动对象版面。

服务关闭后执行 `npm run import:folders`，完成后重新启动服务。已有原件记录与派生资源先核对哈希；重复运行跳过相同源文件，有变化的原件生成新记录和内容块。已有日记在修改前保存历史；重跑不会覆盖用户编辑或重新插入用户主动移除的旧块。写入时另检查磁盘 revision，避免旧服务实例覆盖外部更新。完整原件清单位于 `_imports/manifest.json`，统一可点击资料目录位于 `_imports/sources.html`。

`npm run verify:imports` 独立对照全部原件、资源、正文、Word 原图、日期与内容块；`npm run test:imports:browser` 逐篇检查真实导入内容、解码图片、验证全部资料目录链接并截取 Word 网页预览。测试和核验为导入快照，后续用户主动编辑应与预期差异区分。
