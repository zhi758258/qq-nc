export type SaveFileOutcome = 'saved' | 'shared' | 'cancelled' | 'opened-in-tab' | 'failed'

interface SaveTextFileOptions {
  content: string
  filename: string
  mime?: string
  title?: string
}

const DEFAULT_MIME = 'application/json;charset=utf-8'

function isTouchDevice() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches
}

function canShareFile(file: File) {
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean }
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function')
    return false
  try {
    return nav.canShare({ files: [file] })
  }
  catch {
    return false
  }
}

/**
 * 触发浏览器下载。
 * blob URL 必须延后释放：移动端浏览器会异步读取 blob，
 * 立即 revokeObjectURL 会让下载静默失败。
 */
function triggerAnchorDownload(blob: Blob, filename: string): SaveFileOutcome {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  if (typeof link.download === 'undefined') {
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return 'opened-in-tab'
  }
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'saved'
}

/**
 * 保存文本文件。
 * 触屏设备优先唤起系统分享面板（部分内置浏览器会静默拦截 a[download]），
 * 其余情况回退到 a[download] 下载。
 */
export async function saveTextFile({
  content,
  filename,
  mime = DEFAULT_MIME,
  title,
}: SaveTextFileOptions): Promise<SaveFileOutcome> {
  const blob = new Blob([content], { type: mime })
  const file = new File([blob], filename, { type: mime })

  if (isTouchDevice() && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: title || filename })
      return 'shared'
    }
    catch (error) {
      if ((error as DOMException | undefined)?.name === 'AbortError')
        return 'cancelled'
    }
  }

  try {
    return triggerAnchorDownload(blob, filename)
  }
  catch {
    return 'failed'
  }
}
