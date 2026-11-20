import type { UploadImageResponse } from '@comfyorg/ingest-types'
import { zUploadImageResponse } from '@comfyorg/ingest-types/zod'

import { useToast } from '@/components/ui/toast/toastStore'
import { t } from '@/i18n'
import { api } from '@/scripts/api'

type TempFileUpload =
  | {
      ok: true
      file: UploadImageResponse & Required<Pick<UploadImageResponse, 'name'>>
    }
  | { ok: false; reason: string }

function rejectTempUpload(reason: string): TempFileUpload {
  useToast().warning(t('g.uploadFailed', { reason }))
  return { ok: false, reason }
}

export async function uploadTempFile(
  file: File,
  subfolder: string
): Promise<TempFileUpload> {
  const body = new FormData()
  body.append('image', file)
  body.append('subfolder', subfolder)
  body.append('type', 'temp')

  const resp = await api.fetchApi('/upload/image', { method: 'POST', body })
  if (resp.status !== 200) {
    const reason = `${resp.status} - ${resp.statusText}`
    return rejectTempUpload(reason)
  }
  const json: unknown = await resp.json().catch(() => undefined)
  const parsed = zUploadImageResponse.safeParse(json)
  if (!parsed.success || !parsed.data.name)
    return rejectTempUpload('Invalid upload response')
  return { file: { ...parsed.data, name: parsed.data.name }, ok: true }
}
