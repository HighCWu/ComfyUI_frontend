import { z } from 'zod'

export const nativeSkillCapabilitiesSchema = z.object({
  skillPacksEnabled: z.boolean()
})
