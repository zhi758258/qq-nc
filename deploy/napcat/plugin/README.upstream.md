# napcat-plugin-qq-farm-code · NapCat 插件

[NapCat](https://github.com/NapNeko/NapCatQQ) 第三方插件:**QQ经典农场登录 扫码code 获取 + 农场网关登录**。

> QQ 经典农场小游戏的登录 code 传统上只能在 QQ 客户端里打开「经典农场」小程序时生成;
> 本插件用 QQNT 内核会话直接签发(`misc.loginWithAppId`),再用 protobuf 直连农场网关,
> 全程无需打开 QQ 界面、无需抓包、无证书、无管理员权限。
> 暴露成 WebUI 上的一个 HTTP 端点,外层网页/脚本可直接取码。

## 结构

```
napcat-plugin-qq-farm-code/
├── index.mjs          # 插件本体(纯 Node + QQ 内核会话)
├── package.json
└── data/config.json   # 运行时配置(appid/serverUrl/ver/key)
```

## 安装

插件已提交收录至 **NapCat 官方插件索引**([PR #394](https://github.com/NapNeko/napcat-plugin-index/pull/394))。**合入后**可在插件市场搜索 `napcat-plugin-qq-farm-code` 一键安装、开箱即用,无需任何补丁。合入前想先用,或要装进自建镜像/Windows,见下方两种方式:

**方式一:Release zip(商店合入后即免补丁)**
从 [Releases](https://github.com/fubiwangluo/qq-code/releases) 下载 `napcat-plugin-qq-farm-code.zip`,解压得到 `napcat-plugin-qq-farm-code/` 目录,放进 NapCat 的 `plugins/` 下,并在 `config/plugins.json` 启用:

```json
{ "napcat-plugin-qq-farm-code": true }
```

**方式二:被白名单拦截时,临时放开第三方插件校验**
商店索引未合入前,NapCat 会对非官方插件报 `not in official plugin whitelist`。手动放开步骤(Windows / Linux 容器通用):

1. 找到 `napcat.mjs`(与 `loadNapCat.js` 同目录;Linux 容器在 `/app/napcat/napcat.mjs`),先复制一份 `napcat.mjs.bak` 备份。
2. 用编辑器打开,整段查找:

   ```js
   return this.isOfficialPlugin(e) ? null : r ? `sensitive keyword "${r}"` : "not in official plugin whitelist";
   ```

   替换为(去掉 `isOfficialPlugin` 的"非官方即拒",只保留敏感词拦截):

   ```js
   return r ? `sensitive keyword "${r}"` : null
   ```

3. 保存(UTF-8),重启 NapCat(Windows 需完全退出、含托盘)。
4. 若搜不到整段,说明 NapCat 版本不同:搜 `not in official plugin whitelist` 定位到该行,去掉其中的 `this.isOfficialPlugin(e) ? null :` 判定即可。

> 商店 PR #394 合入后,插件进入官方白名单,**方式二不再需要**,仅方式一即可直接运行。

无论哪种方式,都需**重启 NapCat**。注意:NapCat 插件在登录成功后才加载——先让该 QQ 登录(QQ 客户端或 WebUI 扫码),
登录后插件即加载、可取码。

## 接口(前缀 `<webui端口>/plugin/napcat-plugin-qq-farm-code/api/`)

| 方法/路径 | 作用 |
|---|---|
| `GET /proto/code` | 取农场登录 code(当前会话直接签发) |
| `GET /proto/login` | 取 code 并直连农场网关完成登录,返回农场身份(GID/昵称/open_id) |

`data/config.json` 可配置 `appid`/`serverUrl`/`ver`/`key`;缺省用内置默认值,改完重启生效。
可选 `?appid=`(换小程序)、`?ver=`(覆盖版本号,用于探测新版本)。

示例:

```bash
curl "http://127.0.0.1:6099/plugin/napcat-plugin-qq-farm-code/api/proto/code"
curl "http://127.0.0.1:6099/plugin/napcat-plugin-qq-farm-code/api/proto/login"
```

## 配置(`data/config.json`)

```json
{ "appid": "1112386029", "serverUrl": "...", "ver": "...", "key": "" }
```

- `key` 留空 = 接口不鉴权(仅建议内网/本机用);配置了则需带 `?key=` 或 header
  `x-napcat-farm-key` 才能访问。
- 运行时会把取到的 code 缓存进 `data/codes.json`(已加入 `.gitignore`,勿提交)。

## 安全

- 取到的 code 是账号身份凭证,勿写入公开日志。
- 容器 WebUI 端口别暴露公网:能直连者即可代取该号 code。

## 联系 / 交流

- 作者 QQ:`2682281633`
- QQ 群:`1082900520`(取码插件交流群)

问题、建议或使用反馈欢迎加群。使用时请先阅读下方免责声明。

## 免责声明

仅用于**自己名下/已获授权**的 QQ 号。自动化访问腾讯小游戏并改写设备标识可能违反 QQ 服务条款,
后果与账号风险自负;请勿用于批量、他人账号或任何对抗性用途。
