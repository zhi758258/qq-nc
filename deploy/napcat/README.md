# NapCat 部署与 QQ 农场取码源接入

本目录集中 NapCat 相关部署资产与接入说明，供 bot 服务器与 NapCat 实例联调使用。

## 目录

```
deploy/napcat/
├── README.md                        # 本文件：bot 接入说明
├── plugin/                          # qq-code 插件（来自 github.com/fubiwangluo/qq-code，MIT）
│   ├── README.upstream.md           # 上游原版 README（安装/白名单/接口）
│   ├── LICENSE
│   └── napcat-plugin-qq-farm-code/  # 安装时整个目录拷入 NapCat plugins/
│       ├── package.json
│       ├── index.mjs
│       └── data/config.example.json # 复制为 data/config.json 后按需改
└── <实例脚本>                        # NapCat 服务器实际使用的 compose/启动脚本（整理后补充）
```

## 概念

- 农场登录 code 只能在 QQNT 内核会话内用 `misc.loginWithAppId` 签发。
- `qq-code` 插件把该能力暴露成 NapCat WebUI 上的 HTTP 端点：bot 定时/断线时去取新 code，
  换掉旧 code 重启 worker，实现 NapCat 农场号的自动刷新。
- 插件在 NapCat 账号**登录成功后**才加载；农场号必须先在对应 NapCat 实例完成 QQ 登录。

## NapCat 实例部署要点

1. 安装 NapCat（建议独立容器/独立 QQ 目录跑农场号），确认 WebUI 端口可访问且**不对公网开放**。
2. 把 `plugin/napcat-plugin-qq-farm-code/` 整个目录放进 NapCat `plugins/`，并在 `config/plugins.json`
   写入 `{ "napcat-plugin-qq-farm-code": true }`。
3. 商店索引 PR #394 合入前，NapCat 会拦截非官方插件。需对 `napcat.mjs` 打白名单补丁
   （去掉 `this.isOfficialPlugin(e) ? null :` 判定）——完整步骤见 `plugin/README.upstream.md`
   「方式二」。打完重启 NapCat。
4. 插件配置：把 `data/config.example.json` 复制为 `data/config.json`。`key` 留空 = 不鉴权；
   填了 key 则访问需带 `?key=` 或 header `x-napcat-farm-key`。改配置需重启 NapCat。
5. 自检：农场号登录后执行
   `curl "http://127.0.0.1:<WebUI端口>/plugin/napcat-plugin-qq-farm-code/api/proto/code"`
   应返回含 `code` 的 JSON。

## bot 接入（NapCat 取码源）

bot 后台 账号设置 → NapCat 取码源 卡片（仅 QQ 平台账号显示）填写：

| 字段 | 值 | 说明 |
|---|---|---|
| NapCat 取码源地址 | `http://<napcat-host>:<WebUI端口>/plugin/napcat-plugin-qq-farm-code/api` | bot 会拼 `/proto/code`、`/proto/login` |
| key | 与插件 `data/config.json` 的 `key` 一致 | 留空则 bot 不带 key；填入后随 header `x-napcat-farm-key` 发送，不回显 |
| 客户端版本 ver | 与 bot `systemConfig.clientVersion` 一致 | 留空用插件内置值；插件默认 `1.13.3.14_20260826` |

填入后先用「测试取码」，再「登录农场并绑定」。绑定成功：

- 无匹配 QQ 账号时新建 `loginType: 'napcat'` 账号（默认 `autoRefresh: true`、interval 60s）；
- 已有账号则更新 code/napcatApi/napcatKey 并立即重启 worker；
- 取码返回的 `code` 在 UI 仅显示掩码，不落日志。

自动刷新触发点（NapCat 源 QQ 账号，不受定时开关限制）：
- 进程启动时刷新一次；
- 农场 WS 断线被踢（ws_400 / 重连失败）时即时取新 code 并重启对应 worker；
- 定时任务按 `autoRefresh` 开关周期刷新。

实现参考：`core/src/services/napcat-source.js`、`core/src/runtime/auto-code-refresh.js`、
`core/src/controllers/admin-account-routes.js`（`/api/accounts/napcat/login|test`）。

## 安全注意

- `code` 是农场账号身份凭证，取码 URL 与响应不得写公开日志、不得进数据文件版本库。
- WebUI/插件端口只应监听内网，能直连者即可代取该号 code。
- 实例中的 QQ 登录态、QQ 号、key、`codes.json` 一律不入本仓库。
