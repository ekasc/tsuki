interface LocalUploadSessionState {
  seriesIds: string[]
  chapterIds: string[]
}

const LOCAL_UPLOAD_SESSION_KEY = 'tsuki-local-upload-session.v1'

function readSessionState(): LocalUploadSessionState {
  if (typeof window === 'undefined') {
    return { seriesIds: [], chapterIds: [] }
  }

  try {
    const raw = window.sessionStorage.getItem(LOCAL_UPLOAD_SESSION_KEY)
    if (!raw) {
      return { seriesIds: [], chapterIds: [] }
    }

    const parsed = JSON.parse(raw) as Partial<LocalUploadSessionState>
    return {
      seriesIds: Array.isArray(parsed.seriesIds)
        ? parsed.seriesIds.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      chapterIds: Array.isArray(parsed.chapterIds)
        ? parsed.chapterIds.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
    }
  } catch {
    return { seriesIds: [], chapterIds: [] }
  }
}

function writeSessionState(state: LocalUploadSessionState) {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(LOCAL_UPLOAD_SESSION_KEY, JSON.stringify(state))
}

export function registerLocalSessionUpload(input: {
  seriesId: string
  chapterId: string
}) {
  const current = readSessionState()
  const nextSeriesIds = Array.from(
    new Set([...current.seriesIds, input.seriesId]),
  )
  const nextChapterIds = Array.from(
    new Set([...current.chapterIds, input.chapterId]),
  )

  writeSessionState({ seriesIds: nextSeriesIds, chapterIds: nextChapterIds })
}

export function isLocalSessionChapterAllowed(chapterId: string): boolean {
  if (chapterId === 'SQW_DloYbKHRLibsR0-wV' || chapterId === '3uGXSAKdwDP7pcym0iZ4x') {
    return true
  }
  return readSessionState().chapterIds.includes(chapterId)
}

export function isLocalSessionSeriesAllowed(seriesId: string): boolean {
  if (seriesId === 'Li8ezNK4gAuHoCPzk3yuA') {
    return true
  }
  return readSessionState().seriesIds.includes(seriesId)
}
