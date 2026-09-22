<script setup lang="ts">
import type { Account } from '@/stores/account'
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAccountStore } from '@/stores/account'

const props = defineProps<{
  currentAccount: Account | null | undefined
  currentAccountId: string | number | null | undefined
  loading: boolean
}>()

interface NapcatTestResult {
  ok: boolean
  message: string
}

const accountStore = useAccountStore()

const form = reactive({
  napcatApi: '',
  napcatKey: '',
  ver: '',
})

function resetFormFromAccount() {
  form.napcatApi = props.currentAccount?.napcatApi || ''
  form.napcatKey = ''
  form.ver = ''
}

watch(() => props.currentAccount?.id, resetFormFromAccount, { immediate: true })

const testing = ref(false)
const loggingIn = ref(false)
const result = ref<NapcatTestResult | null>(null)

const isQqAccount = computed(() => props.currentAccount?.platform === 'qq')
const boundSource = computed(() => props.currentAccount?.napcatApi || '')
const canRun = computed(() => !!String(form.napcatApi || '').trim() && !testing.value && !loggingIn.value)

function payload() {
  const ver = String(form.ver || '').trim()
  return {
    napcatApi: String(form.napcatApi || '').trim(),
    napcatKey: form.napcatKey,
    ver: ver || undefined,
  }
}

function errorMessage(e: any, fallback: string) {
  return e?.response?.data?.error || e?.message || fallback
}

async function testSource() {
  result.value = null
  testing.value = true
  try {
    const res = await api.post('/api/accounts/napcat/test', payload())
    const data = res.data
    if (!data?.ok)
      throw new Error(data?.error || '取码失败')
    const info = data.data || {}
    result.value = {
      ok: true,
      message: `取码成功：QQ ${info.uin || '?'}，code ${info.codeMasked || ''}，已可写入账号并自动刷新。`,
    }
  }
  catch (e: any) {
    result.value = { ok: false, message: errorMessage(e, '测试取码失败') }
  }
  finally {
    testing.value = false
  }
}

async function loginAndBind() {
  result.value = null
  loggingIn.value = true
  try {
    const body: Record<string, unknown> = { ...payload() }
    if (isQqAccount.value && props.currentAccountId) {
      body.matchAccountId = String(props.currentAccountId)
      if (props.currentAccount?.name)
        body.name = props.currentAccount.name
    }
    const res = await api.post('/api/accounts/napcat/login', body)
    const data = res.data
    if (!data?.ok)
      throw new Error(data?.error || '登录失败')
    const acc = data.data || {}
    await accountStore.fetchAccounts()
    if (acc.mode === 'created' && acc.id)
      accountStore.selectAccount(String(acc.id))
    result.value = {
      ok: true,
      message: acc.mode === 'created'
        ? `已新建 QQ 农场账号「${acc.name || acc.id}」（QQ ${acc.uin || '?'}），NapCat 取码源已保存，后台启动中。`
        : `已更新账号「${acc.name || acc.id}」（QQ ${acc.uin || '?'}），NapCat 取码源已保存并重启。`,
    }
  }
  catch (e: any) {
    result.value = { ok: false, message: errorMessage(e, 'NapCat 登录失败') }
  }
  finally {
    loggingIn.value = false
  }
}
</script>

<template>
  <div class="border border-gray-200 rounded-xl p-4 dark:border-gray-700">
    <div class="mb-3 flex flex-col gap-1">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        NapCat 农场取码源
        <span v-if="isQqAccount && boundSource" class="ml-2 text-sm text-green-600 font-normal dark:text-green-400">
          已绑定
        </span>
      </h3>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        QQ 官方扫码已被腾讯封禁。让农场 QQ 号登录 NapCat 并安装 qq-code 插件后，
        bot 可从该插件自动取农场登录 code，用于断线/被踢后的无人值守刷新重登。
      </p>
      <p v-if="isQqAccount" class="text-xs text-gray-500 dark:text-gray-400">
        当前账号：{{ currentAccount?.name || '未选择' }}
        <span v-if="currentAccount?.uin">（QQ {{ currentAccount.uin }}）</span>。
        {{ boundSource ? `已绑定取码地址 ${boundSource}` : '尚未绑定取码地址。' }}
      </p>
    </div>

    <div v-if="!isQqAccount" class="border border-amber-200 rounded bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
      NapCat 取码源仅适用于 QQ 平台账号。当前账号不是 QQ 账号，请先到「账号管理」选择或新建一个 QQ 农场账号。
    </div>

    <div v-else class="grid gap-3 md:grid-cols-2">
      <div class="md:col-span-2">
        <BaseInput
          v-model="form.napcatApi"
          label="取码地址（NapCat 插件 HTTP 前缀）"
          placeholder="http://127.0.0.1:6099/plugin/napcat-plugin-qq-farm-code/api"
          type="text"
          autocomplete="off"
        />
      </div>
      <BaseInput
        v-model="form.napcatKey"
        label="插件 key（可选）"
        placeholder="与插件 config 的 key 一致，留空=不鉴权"
        type="password"
        autocomplete="new-password"
      />
      <BaseInput
        v-model="form.ver"
        label="网关版本号 ver（可选）"
        placeholder="缺省用插件默认版本"
        type="text"
        autocomplete="off"
      />
    </div>

    <div v-if="isQqAccount" class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
      <BaseButton variant="secondary" size="sm" :loading="testing" :disabled="!canRun" @click="testSource">
        测试取码
      </BaseButton>
      <BaseButton size="sm" :loading="loggingIn" :disabled="!canRun" @click="loginAndBind">
        {{ boundSource ? '重新取码并重启账号' : '登录农场并绑定此账号' }}
      </BaseButton>
      <p class="text-xs text-gray-400 dark:text-gray-500">
        农场号需先在对应 NapCat 实例完成 QQ 登录，插件登录成功后才加载。
      </p>
    </div>

    <div
      v-if="result"
      class="mt-3 border rounded p-3 text-xs"
      :class="result.ok
        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-700/50 dark:bg-green-900/20 dark:text-green-300'
        : 'border-red-200 bg-red-50 text-red-700 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-300'"
    >
      {{ result.message }}
    </div>
  </div>
</template>
