import { z } from 'zod'

export const prepaidSessionSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean()
  }),
  socket_scope: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional()
})
