function createLogQuery(query) {
  return {
    limit: Number.parseInt(query.limit) || 100,
    tag: query.tag || "",
    module: query.module || "",
    event: query.event || "",
    keyword: query.keyword || "",
    isWarn: query.isWarn,
    timeFrom: query.timeFrom || "",
    timeTo: query.timeTo || "",
  };
}

function isAdminUser(user) {
  return user && (user.role === "admin" || user.role === "super_admin");
}

function hasWxRefreshIdentity(account) {
  return !!String((account && account.wxid) || "").trim();
}

const PROTECTED_WX_CREDENTIAL_FIELDS = [
  "loginBuffer",
  "refreshtoken",
  "accesstoken",
  "refreshToken",
  "accessToken",
];

function stripProtectedWxCredentials(source) {
  const result = { ...(source && typeof source === "object" ? source : {}) };
  for (const field of PROTECTED_WX_CREDENTIAL_FIELDS) delete result[field];
  return result;
}

function maskCode(code) {
  const value = String(code || "");
  if (!value) return "";
  if (value.length <= 8) return `${"*".repeat(value.length)}(${value.length})`;
  return `${value.slice(0, 4)}...${value.slice(-4)}(${value.length})`;
}

const CLIENT_VERSION_RE = /^\d+(?:\.\d+){2,4}_\d{8}$/;

function parseOfficialGatewayUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "wss:"
    || url.hostname !== "gate-obt.nqf.qq.com"
    || url.pathname !== "/prod/ws") return null;
  const code = String(url.searchParams.get("code") || "").trim();
  const clientVersion = String(url.searchParams.get("ver") || "").trim();
  if (!code || !CLIENT_VERSION_RE.test(clientVersion)) return null;
  return { code, clientVersion };
}

function syncGatewayClientVersion(gateway, store, updateRuntimeConfig) {
  if (!gateway || !store || typeof store.getSystemConfig !== "function") return false;
  const currentSystemConfig = store.getSystemConfig() || {};
  if (String(currentSystemConfig.clientVersion || "") === gateway.clientVersion) return false;
  const savedSystemConfig = store.setSystemConfig({
    ...currentSystemConfig,
    clientVersion: gateway.clientVersion,
  });
  if (savedSystemConfig && typeof updateRuntimeConfig === "function") {
    updateRuntimeConfig(savedSystemConfig);
  }
  return !!savedSystemConfig;
}

function registerAdminAccountRoutes({
  app,
  provider,
  getIo,
  addOrUpdateAccount,
  deleteAccount,
  findAccountByRef,
  getAccountsForUser,
  getAccountIdFromRequest,
  resolveAccountReference,
  canAccessAccount,
  getAccessibleAccountIdsFromRequest,
  userStore,
  sendProviderError,
  store,
  updateRuntimeConfig,
}) {
  app.get("/api/accounts", (req, res) => {
    try {
      const currentUser = req.currentUser;
      let data;
      if (currentUser) {
        const accounts = provider.getAccounts();
        data =
          currentUser.role === "admin" || currentUser.role === "super_admin"
            ? accounts
            : {
                ...accounts,
                accounts: accounts.accounts.filter(
                  (account) => account.username === currentUser.username,
                ),
              };
      } else {
        data = { accounts: [], nextId: 1 };
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/accounts/refresh-wx-codes", async (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      if (!provider || typeof provider.refreshAccountCode !== "function") {
        return res.status(500).json({ ok: false, error: "自动刷新服务不可用" });
      }

      const allAccounts = getAccountsForUser();
      const accessibleAccounts = isAdminUser(currentUser)
        ? allAccounts
        : allAccounts.filter(
            (account) => account && account.username === currentUser.username,
          );
      const targetAccounts = accessibleAccounts.filter(hasWxRefreshIdentity);

      if (targetAccounts.length === 0) {
        return res.json({
          ok: false,
          error: "没有可刷新的微信账号",
          data: { total: 0, success: 0, failed: 0, skipped: accessibleAccounts.length },
        });
      }

      const results = [];
      for (const account of targetAccounts) {
        try {
          const result = await provider.refreshAccountCode(account.id);
          const success = result && result.ok !== false;
          results.push({
            accountId: account.id,
            name: account.name || account.nick || account.id,
            ok: success,
            error: success ? "" : "刷新失败",
          });
        } catch (error) {
          results.push({
            accountId: account.id,
            name: account.name || account.nick || account.id,
            ok: false,
            error: error.message || "刷新失败",
          });
        }
      }

      const success = results.filter((item) => item.ok).length;
      const failed = results.length - success;
      res.json({
        ok: failed === 0,
        data: {
          total: results.length,
          success,
          failed,
          skipped: accessibleAccounts.length - targetAccounts.length,
          results,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/account/remark", (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const accountRef =
        body.id || body.accountId || body.uin || req.headers["x-account-id"];
      const account = findAccountByRef(getAccountsForUser(), accountRef);
      if (!account || !account.id) {
        return res.status(404).json({ ok: false, error: "Account not found" });
      }

      const remark = String(
        body.remark !== undefined ? body.remark : body.name || "",
      ).trim();
      if (!remark) {
        return res.status(400).json({ ok: false, error: "Missing remark" });
      }

      const accountId = String(account.id);
      const data = addOrUpdateAccount({ id: accountId, name: remark });
      if (provider && typeof provider.setRuntimeAccountName === "function") {
        provider.setRuntimeAccountName(accountId, remark);
      }
      if (provider && provider.addAccountLog) {
        provider.addAccountLog("update", `更新账号备注: ${  remark}`, accountId, remark);
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/accounts", async (req, res) => {
    try {
      const rawBody = req.body && typeof req.body === "object" ? req.body : {};
      const body = stripProtectedWxCredentials(rawBody);
      const gateway = parseOfficialGatewayUrl(body.gatewayUrl);
      if (body.gatewayUrl && !gateway) {
        return res.status(400).json({ ok: false, error: "WebSocket URL 无效或缺少有效的 code/ver" });
      }
      if (gateway) body.code = gateway.code;
      delete body.gatewayUrl;
      const currentUser = req.currentUser;
      const isUpdate = !!body.id;
      const isAdmin =
        currentUser &&
        (currentUser.role === "admin" || currentUser.role === "super_admin");

      if (isUpdate && currentUser && !isAdmin) {
        if (!canAccessAccount(req, resolveAccountReference(body.id))) {
          return res.status(403).json({ ok: false, error: "无权访问此账号" });
        }
      }

      if (!isUpdate && currentUser && !isAdmin) {
        const accountCount = getAccountsForUser(currentUser.username).length;
        const accountLimit =
          currentUser.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2;
        if (accountCount >= accountLimit) {
          return res.status(403).json({
            ok: false,
            error: `账号数量已达上限（${  accountLimit  }个），请购买额度卡密增加额度`,
          });
        }
      }

      const resolvedId = isUpdate ? resolveAccountReference(body.id) : "";
      const nextAccount = isUpdate
        ? { ...body, id: resolvedId || String(body.id) }
        : body;

      // 扫码凭证只允许由同一登录用户持有的短期会话写入账号。
      if (body.wxSessionId && body.wxid && currentUser) {
        const wxLoginAdapter = require("../services/wx-login-adapter");
        const pending = wxLoginAdapter.peekPendingWxInfo(
          body.wxSessionId,
          body.wxid,
          currentUser.username,
        );
        if (!pending) {
          return res.status(400).json({ ok: false, error: "微信扫码会话无效或已过期，请重新扫码" });
        }
        Object.assign(nextAccount, {
          loginBuffer: pending.loginBuffer,
          refreshtoken: pending.refreshtoken,
          accesstoken: pending.accesstoken,
          avatar: pending.avatar || nextAccount.avatar || "",
          wxDefaultsApplied: true,
        });
      }

      // wxid 换绑后旧账号凭据绝不能继续使用；只有新的扫码会话可以重新写入。
      if (isUpdate) {
        const existing = getAccountsForUser().find(
          (account) => String(account.id) === String(nextAccount.id),
        );
        const wxidChanged = existing
          && Object.hasOwn(body, "wxid")
          && String(existing.wxid || "") !== String(body.wxid || "");
        if (wxidChanged && !body.wxSessionId) {
          Object.assign(nextAccount, {
            loginBuffer: "",
            refreshtoken: "",
            accesstoken: "",
          });
        }
      }

      let wasRunning = false;
      if (isUpdate && provider.isAccountRunning) {
        wasRunning = provider.isAccountRunning(nextAccount.id);
      }

      let onlyRenaming = false;
      if (isUpdate) {
        const accounts = provider.getAccounts();
        const existing = accounts.accounts.find(
          (account) => account.id === nextAccount.id,
        );
        if (existing) {
          const keys = Object.keys(nextAccount);
          onlyRenaming =
            keys.length === 2 && keys.includes("id") && keys.includes("name");
        }
      }

      if (!isUpdate && currentUser) nextAccount.username = currentUser.username;
      const data = addOrUpdateAccount(nextAccount);
      const clientVersionUpdated = syncGatewayClientVersion(gateway, store, updateRuntimeConfig);
      if (body.wxSessionId && body.wxid && currentUser) {
        const wxLoginAdapter = require("../services/wx-login-adapter");
        wxLoginAdapter.consumePendingWxInfo(body.wxSessionId, body.wxid, currentUser.username);
      }
      if (provider.addAccountLog) {
        const accountId = isUpdate
          ? String(nextAccount.id)
          : String((data.accounts.at(-1) || {}).id || "");
        const name = nextAccount.name || "";
        provider.addAccountLog(
          isUpdate ? "update" : "add",
          (isUpdate ? "更新账号: " : "添加账号: ") + (name || accountId),
          accountId,
          name,
        );
      }

      let autoRefreshEnabled = false;
      let startQueued = false;
      if (!isUpdate) {
        const created = data.accounts.at(-1);
        if (created) {
          const isNativeWxScan = created.platform === "wx"
            && created.loginType === "wx_qr"
            && !!body.wxSessionId;
          if (isNativeWxScan && typeof provider.saveAutoCodeRefresh === "function") {
            await provider.saveAutoCodeRefresh(created.id, {
              enabled: true,
              intervalMinutes: 60,
            });
            autoRefreshEnabled = true;
          }
          // 启动微信账号会包含凭证续期和 MMTLS 换 Code，不能阻塞新增账号响应。
          // 账号与刷新策略落盘后立即返回，启动任务在后台继续执行。
          startQueued = true;
          Promise.resolve(provider.startAccount(created.id)).catch((error) => {
            if (provider.addAccountLog) {
              provider.addAccountLog(
                "start_failed",
                `账号 ${created.name || created.id} 后台启动失败: ${error.message || error}`,
                created.id,
                created.name || "",
              );
            }
          });
        }
      } else if (wasRunning && !onlyRenaming) {
        provider.restartAccount(nextAccount.id);
      }

      // 使用 provider 的脱敏结果，避免把微信滚动凭证返回浏览器。
      res.json({
        ok: true,
        data: provider.getAccounts(),
        startup: { queued: startQueued, autoRefreshEnabled },
        clientVersion: gateway ? gateway.clientVersion : "",
        clientVersionUpdated,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/accounts/:id", (req, res) => {
    try {
      const accountId =
        resolveAccountReference(req.params.id) || String(req.params.id || "");
      if (!canAccessAccount(req, accountId)) {
        return res.status(403).json({ ok: false, error: "无权访问此账号" });
      }

      const accounts = provider.getAccounts();
      const account = findAccountByRef(accounts.accounts || [], req.params.id);
      provider.stopAccount(accountId);
      const data = deleteAccount(accountId);
      if (provider.addAccountLog) {
        provider.addAccountLog(
          "delete",
          `删除账号: ${  (account && account.name) || req.params.id}`,
          accountId,
          account ? account.name : "",
        );
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // ===== NapCat 农场取码源 =====
  // QQ 农场号经 NapCat + qq-code 插件(napcat-plugin-qq-farm-code)签发农场登录 code。
  // QQ 扫码(devtoolAuth)已被腾讯封禁，NapCat 源是 QQ 端无人值守刷新/断线恢复 code 的
  // 替代路径。账号持久化字段: napcatApi(插件 HTTP 前缀) / napcatKey(插件 key，可空)。
  // 仅在服务端访问 NapCat 端点，避免把农场 code 与插件 key 暴露到浏览器。

  app.post("/api/accounts/napcat/test", async (req, res) => {
    try {
      if (!req.currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const body = (req.body && typeof req.body === "object" ? req.body : {}) || {};
      const napcatApi = String(body.napcatApi || "").trim();
      if (!napcatApi) {
        return res.status(400).json({ ok: false, error: "缺少 NapCat 取码地址" });
      }
      const napcatSource = require("../services/napcat-source");
      const { code, uin } = await napcatSource.requestCode({
        napcatApi,
        napcatKey: body.napcatKey,
        timeoutMs: body.timeoutMs,
      });
      res.json({
        ok: true,
        data: {
          uin: uin || "",
          codeMasked: maskCode(code),
          length: String(code).length,
          napcatApi,
        },
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || String(error) });
    }
  });

  app.post("/api/accounts/napcat/login", async (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const body = (req.body && typeof req.body === "object" ? req.body : {}) || {};
      const napcatApi = String(body.napcatApi || "").trim();
      if (!napcatApi) {
        return res.status(400).json({ ok: false, error: "缺少 NapCat 取码地址" });
      }
      const napcatSource = require("../services/napcat-source");
      const result = await napcatSource.requestLogin({
        napcatApi,
        napcatKey: body.napcatKey,
        ver: body.ver,
        timeoutMs: body.timeoutMs,
      });
      const isAdmin =
        currentUser.role === "admin" || currentUser.role === "super_admin";
      const accounts = provider.getAccounts();
      const list = Array.isArray(accounts.accounts) ? accounts.accounts : [];

      let existing = null;
      if (body.matchAccountId) {
        existing = findAccountByRef(list, body.matchAccountId) || null;
      }
      if (!existing) {
        const uin = result.uin;
        const gid = (result.farm && result.farm.gid) || "";
        existing =
          list.find((acc) => {
            if (String(acc.platform || "") !== "qq") return false;
            if (uin && String(acc.uin || "") === uin) return true;
            return !!gid && String(acc.gid || "") === gid;
          }) || null;
      }

      const accountPatch = {
        code: result.code,
        napcatApi,
        // 表单不回显旧 key：留空表示保留账号已有 key（新建时为空）。
        // 显式填写新 key 时才会覆盖。
        napcatKey: String(body.napcatKey || "").trim() ? String(body.napcatKey).trim() : (existing ? String(existing.napcatKey || "") : ""),
        uin: result.uin,
        qq: result.uin,
        gid: (result.farm && result.farm.gid) || "",
        openId: (result.farm && result.farm.open_id) || "",
        platform: "qq",
      };
      if (body.name && String(body.name).trim()) {
        accountPatch.name = String(body.name).trim();
      }

      if (!existing && !isAdmin) {
        const myCount = getAccountsForUser(currentUser.username).length;
        const accountLimit =
          currentUser.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2;
        if (myCount >= accountLimit) {
          return res.status(403).json({
            ok: false,
            error: `账号数量已达上限（${accountLimit}个），请购买额度卡密增加额度`,
          });
        }
      }

      let createdAccount = null;
      if (existing) {
        addOrUpdateAccount({ ...accountPatch, id: existing.id });
        createdAccount = findAccountByRef(
          provider.getAccounts().accounts || [],
          existing.id,
        );
      } else {
        const farmName = (result.farm && result.farm.name) || "";
        const patch = {
          ...accountPatch,
          loginType: "napcat",
          name:
            accountPatch.name
            || farmName
            || (result.uin ? `QQ ${result.uin}` : "QQ NapCat 账号"),
          username: currentUser.username,
        };
        const data = addOrUpdateAccount(patch);
        createdAccount = (data.accounts || []).at(-1);
      }

      if (!createdAccount) {
        return res.status(500).json({ ok: false, error: "账号写入失败" });
      }

      // 有 NapCat 源的 QQ 账号具备无人值守刷新能力，默认开启自动刷新；
      // 周期刷新主要用于被踢/重连失败后的补偿重登。
      if (typeof provider.saveAutoCodeRefresh === "function") {
        const prevCfg =
          store.getAutoCodeRefresh
            ? store.getAutoCodeRefresh(createdAccount.id)
            : { enabled: false, intervalMinutes: 60 };
        await provider.saveAutoCodeRefresh(createdAccount.id, {
          enabled: body.autoRefresh !== false,
          intervalMinutes: Number(body.intervalMinutes) || prevCfg.intervalMinutes || 60,
        });
      }

      const wasRunning = existing && provider.isAccountRunning
        ? provider.isAccountRunning(createdAccount.id)
        : false;
      if (wasRunning) {
        provider.restartAccount(createdAccount.id);
      } else if (typeof provider.startAccount === "function") {
        Promise.resolve(provider.startAccount(createdAccount.id)).catch(() => {
          if (provider.addAccountLog) {
            provider.addAccountLog(
              "start_failed",
              `账号 ${createdAccount.name || createdAccount.id} 后台启动失败`,
              createdAccount.id,
              createdAccount.name || "",
            );
          }
        });
      }

      res.json({
        ok: true,
        data: {
          ...createdAccount,
          napcatKey: "",
          codeMasked: maskCode(String(createdAccount.code || "")),
          farm: result.farm,
          mode: existing ? "updated" : "created",
        },
        startup: { queued: true },
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || String(error) });
    }
  });

  app.get("/api/account-logs", (req, res) => {
    try {
      const limit = Number.parseInt(req.query.limit) || 100;
      const currentUser = req.currentUser;
      const requestedAccountId = getAccountIdFromRequest(req);
      let logs = provider.getAccountLogs ? provider.getAccountLogs(limit) : [];
      if (!Array.isArray(logs)) logs = [];
      if (requestedAccountId) {
        if (!canAccessAccount(req, requestedAccountId)) {
          return res.status(403).json({ ok: false, error: "无权访问此账号" });
        }
        logs = logs.filter((log) => {
          const accountId = String(log.accountId || log.id || "");
          return accountId === requestedAccountId;
        });
      }
      if (currentUser) {
        const accessibleIds = getAccessibleAccountIdsFromRequest(req);
        logs = logs.filter((log) => {
          const accountId = log.accountId || log.id;
          return accessibleIds.includes(accountId);
        });
      }
      res.json(logs);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/logs", (req, res) => {
    const requestedAccountId = (req.query.accountId || "").toString().trim();
    const accountId = requestedAccountId
      ? requestedAccountId === "all"
        ? ""
        : resolveAccountReference(requestedAccountId)
      : getAccountIdFromRequest(req);
    const currentUser = req.currentUser;
    if (!currentUser) {
      return res.status(401).json({ ok: false, error: "未登录" });
    }
    if (accountId && !canAccessAccount(req, accountId)) {
      return res.status(403).json({ ok: false, error: "无权访问此账号" });
    }

    if (!accountId) {
      const accessibleIds = getAccessibleAccountIdsFromRequest(req);
      const mergedLogs = [];
      const query = createLogQuery(req.query);
      for (const accessibleId of accessibleIds) {
        const logs = provider.getLogs(accessibleId, query);
        if (Array.isArray(logs)) mergedLogs.push(...logs);
      }
      mergedLogs.sort((a, b) => (b.time || 0) - (a.time || 0));
      return res.json({ ok: true, data: mergedLogs.slice(0, query.limit) });
    }

    const query = createLogQuery(req.query);
    const logs = provider.getLogs(accountId, query);
    res.json({ ok: true, data: logs });
  });

  app.delete("/api/logs", (req, res) => {
    const accountId = getAccountIdFromRequest(req);
    if (!accountId) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing x-account-id" });
    }
    if (!canAccessAccount(req, accountId)) {
      return res.status(403).json({ ok: false, error: "无权访问此账号" });
    }

    try {
      const data = provider.clearLogs(accountId);
      const io = getIo();
      if (io && provider && typeof provider.getLogs === "function") {
        const accountLogs = provider.getLogs(accountId, { limit: 100 });
        io.to(`account:${  accountId}`).emit("logs:snapshot", {
          accountId,
          logs: Array.isArray(accountLogs) ? accountLogs : [],
        });
        const historicalAccountLogs =
          typeof provider.getAccountLogs === "function"
            ? provider
                .getAccountLogs(300)
                .filter(
                  (log) =>
                    String(log.accountId || log.id || "") === String(accountId),
                )
            : [];
        io.to(`account:${  accountId}`).emit("account-logs:snapshot", {
          accountId,
          logs: historicalAccountLogs,
        });
        const allLogs = provider.getLogs("", { limit: 100 });
        io.to("account:all").emit("logs:snapshot", {
          accountId: "all",
          logs: Array.isArray(allLogs) ? allLogs : [],
        });
        const allHistoricalAccountLogs =
          typeof provider.getAccountLogs === "function"
            ? provider.getAccountLogs(300)
            : [];
        io.to("account:all").emit("account-logs:snapshot", {
          accountId: "all",
          logs: Array.isArray(allHistoricalAccountLogs)
            ? allHistoricalAccountLogs
            : [],
        });
      }
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = {
  parseOfficialGatewayUrl,
  registerAdminAccountRoutes,
  stripProtectedWxCredentials,
  syncGatewayClientVersion,
};
