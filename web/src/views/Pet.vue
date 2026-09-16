<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { usePetStore } from '@/stores/pet'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const petStore = usePetStore()
const toast = useToastStore()
const { currentAccountId } = storeToRefs(accountStore)
const { overview, logs, capitalMode, loading, mutating } = storeToRefs(petStore)
const tab = ref<'pets' | 'logs' | 'capital'>('pets')
const feedCounts = reactive<Record<number, number>>({})
const draft = reactive({ enabled: false, dogId: 0, leadSeconds: 10 })
const saving = ref(false)
const sortedDogs = computed(() => [...overview.value.dogs].sort((a, b) => Number(b.deployed) - Number(a.deployed) || Number(b.owned) - Number(a.owned) || b.rarity - a.rarity))
const ownedCount = computed(() => overview.value.dogs.filter(dog => dog.owned).length)
const tabs = [{ k: 'pets', n: '我的宠物' }, { k: 'logs', n: '守护记录' }, { k: 'capital', n: '资本模式' }] as const
const deployed = computed(() => overview.value.dogs.find(dog => dog.deployed))

function invalidFeedCount(foodId: number, available: number) {
  const count = feedCounts[foodId] ?? 1
  return !Number.isInteger(count) || count < 1 || count > Math.min(available, 99)
}
function duration(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  return days ? `${days}天${hours}小时` : hours ? `${hours}小时${Math.floor((seconds % 3600) / 60)}分钟` : `${Math.floor(seconds / 60)}分钟`
}
async function load() {
  const id = String(currentAccountId.value || '')
  if (!id)
    return
  try {
    await Promise.all([petStore.fetchOverview(id), petStore.fetchCapitalMode(id), tab.value === 'logs' ? petStore.fetchLogs(id) : Promise.resolve()])
    Object.assign(draft, capitalMode.value)
  }
  catch (e: any) { toast.error(e?.response?.data?.error || e?.message || '加载失败') }
}
async function action(run: () => Promise<any>, message: string) {
  try {
    await run()
    toast.success(message)
  }
  catch (e: any) { toast.error(e?.response?.data?.error || e?.message || '操作失败') }
}
async function saveSettings() {
  if (saving.value)
    return
  saving.value = true
  try {
    await action(() => petStore.saveCapitalMode(String(currentAccountId.value), draft), '设置已保存')
  }
  finally {
    saving.value = false
  }
}
watch([currentAccountId, tab], load)
onMounted(load)
</script>

<template>
  <div class="pet-page">
    <div class="pet-content">
      <header class="page-header">
        <div class="heading-group">
          <span class="page-icon"><span class="i-fa-solid-paw" /></span>
          <div><h1>宠物犬</h1><p>陪伴农场的每一天，守护每一份收获</p></div>
        </div>
        <button class="pet-button secondary refresh-button" :disabled="loading || mutating || !currentAccountId" @click="load">
          <span class="i-carbon-renew" :class="{ 'animate-spin': loading }" />{{ loading ? '刷新中' : '刷新' }}
        </button>
      </header>

      <nav class="pet-tabs" aria-label="宠物功能">
        <button v-for="item in tabs" :key="item.k" :class="{ active: tab === item.k }" :aria-current="tab === item.k ? 'page' : undefined" @click="tab = item.k">
          {{ item.n }}
        </button>
      </nav>

      <div v-if="!currentAccountId" class="empty-state panel">
        <span class="empty-icon i-carbon-user-avatar" /><h2>选择一个农场账号</h2><p>查看宠物伙伴与守护状态</p>
      </div>
      <div v-else-if="loading && !overview.dogs.length" class="empty-state panel" role="status">
        <span class="empty-icon i-carbon-renew animate-spin" /><p>正在加载宠物信息…</p>
      </div>
      <template v-else-if="tab === 'pets'">
        <section class="guardian-panel panel">
          <div class="guardian-portrait">
            <img v-if="deployed?.image" :src="deployed.image" :alt="deployed.name">
            <span v-else class="i-fa-solid-paw" />
          </div>
          <div class="guardian-copy">
            <span class="eyebrow">当前守护</span>
            <h2>{{ deployed?.name || '等待伙伴上岗' }}</h2>
            <span class="status-badge" :class="{ guarding: deployed }">{{ deployed ? '守护中' : '暂无派出宠物' }}</span>
          </div>
          <div class="guardian-food">
            <span class="eyebrow">狗粮剩余时长</span>
            <strong>{{ duration(overview.foodSeconds) }}</strong>
            <span class="muted">{{ overview.foodSeconds > 0 ? '吃饱的伙伴才能安心看家' : '补充狗粮，为守护续航' }}</span>
          </div>
          <button v-if="deployed" class="pet-button secondary" :disabled="mutating" @click="action(() => petStore.withdraw(String(currentAccountId)), '宠物已召回')">
            召回休息
          </button>
        </section>

        <div class="section-heading">
          <h2>宠物伙伴 <span>{{ ownedCount }} / {{ overview.dogs.length }}</span></h2><p>已拥有的伙伴优先展示</p>
        </div>
        <div v-if="!overview.dogs.length" class="empty-state panel">
          <p>暂无宠物数据，请刷新重试</p>
        </div>
        <div class="pet-grid">
          <article v-for="dog in sortedDogs" :key="dog.id" class="pet-card panel" :class="{ 'is-deployed': dog.deployed, 'is-locked': !dog.owned }">
            <div class="card-topline">
              <span class="status-badge" :class="{ guarding: dog.deployed }">{{ dog.deployed ? '守护中' : dog.owned ? '已拥有' : '未获得' }}</span>
              <span v-if="dog.owned" class="pet-level">Lv.{{ dog.level || 1 }}</span>
            </div>
            <div class="pet-portrait">
              <img v-if="dog.image" :src="dog.image" :alt="dog.name" loading="lazy">
              <span v-else class="i-fa-solid-paw" />
            </div>
            <h3>{{ dog.name }}</h3>
            <p class="pet-description">
              {{ dog.desc || '宠物伙伴，陪你一起守护农场。' }}
            </p>
            <button class="pet-button deploy-button" :class="{ secondary: dog.deployed || !dog.owned }" :disabled="!dog.owned || dog.deployed || mutating" @click="action(() => petStore.deploy(String(currentAccountId), dog.id), `${dog.name}已派出`)">
              <span v-if="dog.deployed" class="i-carbon-checkmark-filled" />{{ dog.deployed ? '正在守护农场' : dog.owned ? '派出守护' : '尚未获得' }}
            </button>
          </article>
        </div>

        <div class="section-heading">
          <h2>喂食补给</h2><p>使用狗粮延长守护时间</p>
        </div>
        <div class="food-grid">
          <article v-for="food in overview.foods" :key="food.id" class="food-card panel">
            <div class="food-heading">
              <div class="food-image">
                <img v-if="food.image" :src="food.image" :alt="food.name" loading="lazy"><span v-else class="i-carbon-restaurant" />
              </div>
              <div><h3>{{ food.name }}</h3><p>每份增加 {{ food.days }} 天</p></div>
              <span class="food-count">库存 <b>{{ food.count }}</b></span>
            </div>
            <div class="feed-controls">
              <label :for="`food-${food.id}`">数量</label>
              <input :id="`food-${food.id}`" v-model.number="feedCounts[food.id]" type="number" placeholder="1" min="1" :max="Math.min(food.count, 99)" :disabled="!food.count || mutating">
              <button class="pet-button" :disabled="!food.count || mutating || invalidFeedCount(food.id, food.count)" @click="action(() => petStore.feed(String(currentAccountId), food.id, feedCounts[food.id] || 1), '喂食成功')">
                喂食
              </button>
            </div>
          </article>
        </div>
      </template>

      <section v-else-if="tab === 'logs'" class="panel logs-panel">
        <div class="section-heading">
          <h2>守护足迹</h2><span class="muted">{{ logs.length }} 条记录</span>
        </div>
        <div v-if="!logs.length" class="empty-state">
          <span class="empty-icon i-carbon-security" /><h3>暂无守护记录</h3><p>伙伴的守护成果会留在这里</p>
        </div>
        <article v-for="item in logs" :key="item.id" class="log-row">
          <span class="log-icon i-carbon-security" />
          <div class="log-copy">
            <h3>{{ item.friendName || `好友 ${item.friendGid}` }}</h3><p>{{ item.dogName || '宠物守护' }} · {{ new Date(item.timestamp * 1000).toLocaleString() }}</p>
          </div>
          <div class="log-gold">
            <strong>{{ item.protectedGold }}</strong><span>守护金币</span>
          </div>
        </article>
      </section>
      <section v-else class="capital-panel panel">
        <div class="capital-heading">
          <span class="page-icon"><span class="i-carbon-security" /></span><div><h2>让守护准时到岗</h2><p>在作物成熟前，自动派出你的伙伴</p></div>
        </div>
        <label class="toggle-row"><span><strong>启用资本模式</strong><small>按作物成熟时间自动安排守护</small></span><input v-model="draft.enabled" type="checkbox" class="mode-toggle"></label>
        <div class="capital-fields">
          <label>守护宠物<select v-model.number="draft.dogId"><option :value="0">请选择宠物</option><option v-for="dog in overview.dogs.filter(d => d.owned)" :key="dog.id" :value="dog.id">{{ dog.name }}</option></select></label>
          <label>提前派出（秒）<input v-model.number="draft.leadSeconds" type="number" min="5" max="300"><small>可设置 5–300 秒</small></label>
        </div>
        <p class="capital-note">
          <span class="i-carbon-information" />收获完成 5 秒后自动召回，已有手动派出的宠物不会被替换。
        </p>
        <div class="capital-footer">
          <button class="pet-button" :disabled="saving || loading || (draft.enabled && !draft.dogId) || !Number.isInteger(draft.leadSeconds) || draft.leadSeconds < 5 || draft.leadSeconds > 300" @click="saveSettings">
            {{ saving ? '保存中…' : '保存设置' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pet-page {
  --pet-bg: #fff;
  --pet-soft: #f5f7f4;
  --pet-text: #27372c;
  --pet-muted: #788279;
  --pet-line: #e5ebe3;
  --pet-accent: #397751;
  --pet-tint: #eaf3e9;
  height: 100%;
  overflow-y: auto;
  padding: 28px;
  color: var(--pet-text);
}
:global(.dark) .pet-page {
  --pet-bg: #1f2925;
  --pet-soft: #26332c;
  --pet-text: #e5eee7;
  --pet-muted: #a1b0a6;
  --pet-line: #35473b;
  --pet-accent: #83c69a;
  --pet-tint: #2b4032;
}
.pet-content {
  max-width: 1200px;
  margin: 0 auto;
  padding-bottom: 24px;
}
.page-header,
.heading-group,
.section-heading,
.food-heading,
.card-topline,
.capital-heading,
.toggle-row,
.log-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.page-header,
.section-heading,
.card-topline,
.toggle-row {
  justify-content: space-between;
}
h1,
h2,
h3,
p {
  margin: 0;
}
h1 {
  font-size: 25px;
  font-weight: 750;
  letter-spacing: -0.5px;
}
h2 {
  font-size: 18px;
  font-weight: 700;
}
h3 {
  font-size: 16px;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.page-header p,
.capital-heading p {
  color: var(--pet-muted);
  font-size: 13px;
  margin-top: 5px;
}
.page-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 16px;
  background: var(--pet-tint);
  color: var(--pet-accent);
  flex-shrink: 0;
  font-size: 26px;
}
.pet-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: var(--pet-accent);
  color: var(--pet-bg);
  font-size: 13px;
  font-weight: 650;
  padding: 10px 18px;
  cursor: pointer;
  transition:
    background 0.15s,
    opacity 0.15s;
  white-space: nowrap;
}
.pet-button:hover:not(:disabled) {
  filter: brightness(0.94);
}
.pet-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pet-button.secondary {
  color: var(--pet-accent);
  background: var(--pet-tint);
  border-color: var(--pet-line);
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--pet-accent);
  outline-offset: 3px;
}
.pet-tabs {
  display: flex;
  gap: 5px;
  padding: 5px;
  margin: 25px 0;
  background: var(--pet-soft);
  border: 1px solid var(--pet-line);
  border-radius: 14px;
  width: fit-content;
}
.pet-tabs button {
  padding: 10px 24px;
  border-radius: 10px;
  font-size: 14px;
  color: var(--pet-muted);
  transition: background 0.15s;
}
.pet-tabs button.active {
  color: var(--pet-accent);
  background: var(--pet-bg);
  box-shadow: 0 2px 5px #14261b08;
  font-weight: 700;
}
.panel {
  background: var(--pet-bg);
  border: 1px solid var(--pet-line);
  border-radius: 20px;
}
.guardian-panel {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 24px 28px;
  border-color: var(--pet-accent);
}
.guardian-portrait {
  width: 90px;
  height: 90px;
  display: grid;
  place-items: center;
  background: var(--pet-tint);
  border-radius: 50%;
  flex-shrink: 0;
  color: var(--pet-accent);
  font-size: 38px;
}
.guardian-portrait img {
  width: 78px;
  height: 78px;
  object-fit: contain;
}
.eyebrow {
  font-size: 12px;
  color: var(--pet-muted);
  display: block;
  margin-bottom: 6px;
}
.guardian-copy {
  min-width: 0;
}
.guardian-copy h2 {
  font-size: 24px;
  margin-bottom: 10px;
  overflow-wrap: anywhere;
}
.status-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 7px;
  padding: 4px 9px;
  color: var(--pet-muted);
  background: var(--pet-soft);
  font-size: 11px;
  font-weight: 600;
}
.status-badge.guarding {
  background: var(--pet-tint);
  color: var(--pet-accent);
}
.guardian-food {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.guardian-food strong {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--pet-muted);
  font-size: 12px;
}
.section-heading {
  margin: 26px 0 14px;
}
.section-heading h2 span {
  margin-left: 9px;
  font-size: 13px;
  color: var(--pet-muted);
  font-weight: 400;
}
.section-heading p {
  color: var(--pet-muted);
  font-size: 12px;
}
.pet-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.pet-card {
  padding: 18px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.pet-card.is-deployed {
  border-color: var(--pet-accent);
  box-shadow: inset 0 3px 0 var(--pet-accent);
}
.pet-level {
  color: var(--pet-muted);
  font-size: 12px;
  font-weight: 600;
}
.pet-portrait {
  display: grid;
  place-items: center;
  width: 116px;
  height: 116px;
  margin: 12px auto 16px;
  border-radius: 50%;
  background: var(--pet-soft);
  color: var(--pet-muted);
  font-size: 42px;
}
.pet-portrait img {
  width: 100px;
  height: 100px;
  object-fit: contain;
}
.is-locked .pet-portrait img {
  opacity: 0.65;
}
.pet-card h3 {
  text-align: center;
  font-size: 18px;
}
.pet-description {
  margin: 10px 0 20px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--pet-muted);
  overflow-wrap: anywhere;
}
.deploy-button {
  width: 100%;
  margin-top: auto;
}
.food-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.food-card {
  padding: 18px;
  min-width: 0;
}
.food-heading {
  gap: 10px;
  flex-wrap: wrap;
}
.food-image {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  background: var(--pet-soft);
  border-radius: 12px;
  flex-shrink: 0;
}
.food-image img {
  width: 38px;
  height: 38px;
  object-fit: contain;
}
.food-heading h3 {
  font-size: 14px;
}
.food-heading p,
.food-count {
  font-size: 11px;
  color: var(--pet-muted);
  margin-top: 4px;
}
.food-count {
  margin-left: auto;
  white-space: nowrap;
}
.food-count b {
  color: var(--pet-text);
  font-size: 14px;
}
.feed-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
}
.feed-controls label {
  font-size: 12px;
  color: var(--pet-muted);
}
input[type='number'],
select {
  min-width: 0;
  border: 1px solid var(--pet-line);
  border-radius: 10px;
  background: var(--pet-soft);
  color: var(--pet-text);
  padding: 10px;
  font-size: 13px;
}
.feed-controls input {
  flex: 1;
  width: 50px;
}
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--pet-muted);
}
.empty-state p {
  margin-top: 10px;
  font-size: 13px;
}
.empty-icon {
  display: inline-block;
  font-size: 36px;
  margin-bottom: 15px;
  color: var(--pet-accent);
}
.logs-panel {
  padding: 8px 24px 20px;
}
.log-row {
  padding: 18px 0;
  border-top: 1px solid var(--pet-line);
}
.log-icon {
  color: var(--pet-accent);
  font-size: 23px;
  flex-shrink: 0;
}
.log-copy {
  min-width: 0;
  flex: 1;
}
.log-copy p {
  color: var(--pet-muted);
  font-size: 12px;
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.log-gold {
  text-align: right;
  flex-shrink: 0;
}
.log-gold strong {
  color: var(--pet-accent);
  font-size: 20px;
  display: block;
}
.log-gold span {
  font-size: 11px;
  color: var(--pet-muted);
}
.capital-panel {
  max-width: 760px;
  padding: 28px;
}
.toggle-row {
  background: var(--pet-soft);
  padding: 18px;
  border-radius: 12px;
  margin: 25px 0;
  cursor: pointer;
}
.toggle-row strong {
  font-size: 14px;
}
.toggle-row small,
.capital-fields small {
  display: block;
  font-size: 12px;
  color: var(--pet-muted);
  margin-top: 5px;
}
.mode-toggle {
  appearance: none;
  width: 40px;
  height: 24px;
  border-radius: 20px;
  background: var(--pet-muted);
  padding: 3px;
  flex-shrink: 0;
  cursor: pointer;
}
.mode-toggle::before {
  content: '';
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--pet-bg);
  transition: transform 0.15s;
}
.mode-toggle:checked {
  background: var(--pet-accent);
}
.mode-toggle:checked::before {
  transform: translateX(16px);
}
.capital-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.capital-fields label {
  font-size: 13px;
  min-width: 0;
}
.capital-fields input,
.capital-fields select {
  display: block;
  width: 100%;
  margin-top: 9px;
}
.capital-note {
  margin-top: 24px;
  color: var(--pet-muted);
  font-size: 12px;
  line-height: 1.8;
}
.capital-note span {
  vertical-align: middle;
  display: inline-block;
  margin-right: 4px;
}
.capital-footer {
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px solid var(--pet-line);
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 1000px) {
  .pet-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .food-grid {
    grid-template-columns: 1fr;
  }
  .guardian-panel {
    gap: 16px;
    padding: 20px;
    flex-wrap: wrap;
  }
  .guardian-food {
    flex: 1;
    min-width: 150px;
  }
}
@media (max-width: 600px) {
  .pet-page {
    padding: 16px;
  }
  .heading-group {
    gap: 10px;
  }
  .page-header .page-icon {
    display: none;
  }
  h1 {
    font-size: 22px;
  }
  .page-header p {
    font-size: 11px;
  }
  .refresh-button {
    padding: 9px 12px;
  }
  .pet-tabs {
    width: 100%;
    margin: 20px 0;
  }
  .pet-tabs button {
    flex: 1;
    padding: 9px 4px;
    font-size: 13px;
  }
  .guardian-panel {
    gap: 14px;
    padding: 18px;
  }
  .guardian-portrait {
    width: 66px;
    height: 66px;
  }
  .guardian-portrait img {
    width: 60px;
    height: 60px;
  }
  .guardian-copy {
    flex: 1;
  }
  .guardian-copy h2 {
    font-size: 20px;
  }
  .guardian-food {
    border-top: 1px solid var(--pet-line);
    padding-top: 14px;
  }
  .guardian-food strong {
    font-size: 18px;
  }
  .guardian-food .muted {
    display: none;
  }
  .pet-grid {
    gap: 10px;
  }
  .pet-card {
    padding: 12px;
    border-radius: 16px;
  }
  .pet-portrait {
    width: 90px;
    height: 90px;
  }
  .pet-portrait img {
    width: 80px;
    height: 80px;
  }
  .pet-card h3 {
    font-size: 16px;
  }
  .pet-description {
    font-size: 11px;
    margin-bottom: 14px;
  }
  .deploy-button {
    padding: 9px 3px;
    font-size: 12px;
  }
  .section-heading p {
    display: none;
  }
  .capital-panel {
    padding: 18px;
  }
  .capital-fields {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .logs-panel {
    padding: 4px 16px 16px;
  }
  .log-row {
    gap: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before {
    transition: none !important;
    animation: none !important;
  }
}
</style>
