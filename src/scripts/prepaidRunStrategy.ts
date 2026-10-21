import { ref } from 'vue'
import { z } from 'zod'

export const selectedPrepaidRunStrategy = ref('rtx4090')

export const prepaidRunStrategiesSchema = z.object({
  default_strategy_id: z.literal('rtx4090').nullable(),
  strategies: z
    .array(
      z.object({
        id: z.literal('rtx4090'),
        name: z.string().min(1),
        memory_gb: z.number().positive(),
        provider_hourly_milliusd_estimate: z.number().int().positive().safe(),
        coverage_ceiling_bps: z.number().int().nonnegative().max(10000),
        rate_basis: z.literal('configured_estimate'),
        settlement_basis: z.literal('actual_provider_usage')
      })
    )
    .max(1),
  execution_started: z.literal(false),
  credits_reserved: z.literal(false)
})
