<script setup lang="ts">
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface AutoCodeRefreshConfig {
  enabled: boolean
  intervalMinutes: number
}

const props = withDefaults(defineProps<{
  currentAccountName: string | null
  currentAccountId: string | number | null | undefined
  accountPlatform?: string
  loading: boolean
  saving: boolean
  refreshing: boolean
}>(), {
  accountPlatform: '',
})

const emit = defineEmits<{
  save: []
  refresh: []
}>()

const config = defineModel<AutoCodeRefreshConfig>('config', { required: true })

const platformKind = computed(() => props.accountPlatform || '')
const cardTitle = computed(() => {
  if (platformKind.value === 'qq')
    return 'QQ 断线自动刷新重登'
  if (platformKind.value === 'wx')
    return '微信定时刷新重登'
  return '定时刷新重登'
})
const hintText = computed(() => {
  if (platformKind.value === 'qq') {
    return 'QQ 账号需先配置 NapCat 取码源。启用后按间隔从 NapCat 获取新 Code 并重启账号；账号被踢或重连失败时也会尝试自动重登。关闭不会停用启动时刷新与 Code 失效时的即时恢复。'
  }
  if (platformKind.value === 'wx') {
    return '启用后会按间隔获取新 Code 并重启账号；账号被踢或重连失败时，也会按此间隔尝试自动重登。关闭不会停用启动时刷新、Code 失效时的即时恢复和微信凭证保活。'
  }
  return '启用后会按间隔获取新 Code 并重启账号；账号被踢或重连失败时也会尝试自动重登。'
})
</script>

<template>
  <div class="border border-gray-200 rounded-xl p-4 dark:border-gray-700">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
          {{ cardTitle }}
          <span v-if="currentAccountName" class="ml-2 text-sm text-gray-500 font-normal dark:text-gray-400">
            ({{ currentAccountName }})
          </span>
        </h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          此处按账号保存，并非全局设置。
        </p>
      </div>
      <BaseButton
        size="sm"
        :loading="saving"
        :disabled="!currentAccountId || loading || refreshing"
        @click="emit('save')"
      >
        保存刷新设置
      </BaseButton>
    </div>

    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else-if="!currentAccountId" class="py-6 text-center text-gray-500">
      请先在账号管理中选择账号
    </div>

    <div v-else class="border border-gray-200 rounded bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/20">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div class="min-w-0 space-y-2">
          <BaseSwitch v-model="config.enabled" label="启用定时刷新与自动重登" />
          <p class="max-w-3xl text-xs text-gray-500 dark:text-gray-400">
            <span
              v-if="accountPlatform === 'wx'"
              class="text-amber-700 font-semibold dark:text-amber-300"
            >仅带内置登录凭据的微信扫码账号可用。</span>
            <span v-if="accountPlatform === 'qq'" class="text-amber-700 font-semibold dark:text-amber-300">
              QQ 账号需要在 NapCat 取码源卡片中配置农场号取码地址。
            </span>
            {{ hintText }}
          </p>
        </div>

        <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
          <BaseInput
            v-model.number="config.intervalMinutes"
            class="sm:w-36"
            label="间隔(分钟)"
            type="number"
            min="1"
            max="1440"
            placeholder="60"
          />
          <BaseButton
            variant="secondary"
            size="sm"
            class="h-9 whitespace-nowrap"
            :loading="refreshing"
            :disabled="saving"
            @click="emit('refresh')"
          >
            <span class="i-carbon-renew mr-1" />
            立即刷新
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
