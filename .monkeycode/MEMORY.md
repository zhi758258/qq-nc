# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-09-05
- Context: Discovered by Agent while 修复 QQ 群验证（NapCat 直连）
- Category: Operations & Deployment
- Instructions:
  - 群验证支持两种验证方式（`core/data/store.json` → `groupVerify.verifyMode`）：`''`/空为通用 GET 校验接口（旧约定，`GET ?qq=&group=`，NapCat 不适用），`'napcat'` 为 bot 直连 NapCat/OneBot11 正向 HTTP（配置 NapCat HTTP 地址 + QQ群号 + NapCat access_token）。
  - NapCat 的关键约束（2026-09-05 实测）：HTTP action 走 **URL 路径式**（如 `POST http://ip:3000/get_group_member_info`，body 直接放 params `{"group_id":..., "user_id":...}`）；根路径式（body `{action, params}`）NapCat 不识别，GET 根路径只回 `NapCat4 Is Running`。HTTP 服务开启鉴权后不带 access_token 所有 action 返回 `token verify failed!`。成员查询返回 `retcode:0 + data`，非成员返回 `Uin2Uid Error: 用户ID xxx 不存在`（应判 not_in_group，其余 NapCat 报错判 service_unavailable）。
  - 改动文件：`core/src/controllers/admin-auth-routes.js`（verifyGenericMembership/verifyNapcatMembership，NapCat 用 get_group_member_info 单查，避免 get_group_member_list 只回 50 条截断）、`core/src/models/store.js`（DEFAULT_GROUP_VERIFY_CONFIG 含 verifyMode）、`core/src/controllers/admin-system-routes.js`（透传 verifyMode）、`web/src/components/admin/AdminGroupVerifyCard.vue`（验证方式下拉）、`core/test/group-verify-napcat.test.js`。
  - 管理后台 admin API 鉴权头是 `x-admin-token`（不是 `Authorization: Bearer`）；curl 调 `/api/admin/*` 需带 `-H "x-admin-token: <登录token>"`。
  - 群验证配置保存在 3007 后台「系统配置 → QQ群验证」卡片；改后端 `store.js` 后须重启 `pnpm -C core dev` 才生效（node 不热加载）。

[Project Knowledge Summary]
- Date: 2026-09-05
- Context: Discovered by Agent while 移植用户/卡密/公告/群验证系统并完成账号私有化与账号改名
- Category: Operations & Deployment
- Instructions:
  - 本仓库对应远端为 GitHub 私有仓库 https://github.com/zhi758258/qq-farm-bot-private（2026-09-05 从公开 fork zhi758258/qq-farm-bot 迁移而来，新仓库不是 fork，无法用网页 Sync fork；跟上游 xxxscarlxrd404/qq-farm-bot 需 `git remote add upstream <url>` 后 fetch/merge）。
  - 默认超级管理员账号为 `283405278` / 密码 `hai232658`，且 `mustChangePassword=false`，登录不弹强制改密；数据存于 `core/data/users.json`，代码常量在 `core/src/models/user-store.js` 的 `DEFAULT_ADMIN`。
  - 注册接口禁止使用 `admin`（不区分大小写）作为用户名（`RESERVED_USERNAMES`，在 `registerUserWithCard` 中校验），并禁止使用默认管理员用户名注册（findUser 重名拦截）。
  - 后台侧边栏底部署名显示 `283405278`（`web/src/components/Sidebar.vue`），不再显示上游作者 xxxscarlxrd404。
  - README 中 git clone 地址保留上游公开仓库（可用于获取源码），爱发电原作者支持段已移除。

[Project Knowledge Summary]
- Date: 2026-09-16
- Context: Discovered by Agent while 移植用户备份导出/导入并本地部署预览验证
- Category: Build Methods / Operations & Deployment
- Instructions:
  - 本机 `pnpm` 符号链接指向缺失的 corepack 12.4.2，直接调 `pnpm` 会失败。可用版本为 10.30.2，须走直连路径：`node /root/.cache/node/corepack/v1/pnpm/10.30.2/bin/pnpm.cjs <args>`。
  - 依赖安装：`node /root/.cache/node/corepack/v1/pnpm/10.30.2/bin/pnpm.cjs install -r`。core 测试：`cd core && node --test test/*.test.js`。前端构建：`cd web && node .../pnpm.cjs build`（等于 `vue-tsc -b && vite build`）。
  - 本地部署预览流程：先 `pnpm -C web build` 生成 `web/dist`，再 `cd core && ADMIN_PORT=<端口> node client.js`。后端只服务已构建的 dist，改前端必须重新构建；改后端须重启进程（node 不热加载）。
  - 端口约定：3007 常被源仓 qq-farm-bot 占用、3008 为 qq-farm-bot-qz 预览，qq-nc 预览用 3009。
  - 隔离测试数据目录：设置 `FARM_DATA_DIR=/tmp/xxx` 可让实例读写独立的 users.json / cards.json / store.json，用于备份导入导出等破坏性验证，不污染 `core/data/`。默认数据目录是 `core/data/`（源码模式下 `getDataDir()` 解析结果），该目录已在 .gitignore 中。
  - 陷阱：`pnpm -C web lint` 脚本带 `--fix`，在 main 基线会顺手改写 19 个无关文件（约 +783/-315，系 main 上的既有格式债），并报 3 个文件共 4 个既有错误（AccountModal.vue、CharityFlowerActivityPanel.vue、StrategyTimingPanel.vue）。跑 lint 后务必 `git restore --worktree <无关文件>` 再提交。
