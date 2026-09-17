/**
 * Validation for the Send Money wizard, one schema per step (ADR-0009).
 *
 * Built from the shared contract's own rules (SendMoneyRequestSchema), so the form, the mock server and the request
 * all refuse the same inputs. The form adds only what the contract cannot know: that the bank is one we list, that
 * the amount text parses, and that it fits the balance the merchant can see.
 */
import { z } from 'zod'
import { bankByCode } from '../../api/banks'
import { SendMoneyRequestSchema, type SendMoneyRequest } from '../../api/contracts'
import { formatNaira, parseNairaInput, type Kobo } from '../../lib/money'
import type { Recipient, TransferDraftState } from '../../store/transferDraftSlice'

const contractRecipient = SendMoneyRequestSchema.shape.recipient

/** What the merchant enters. The account name is never typed: it comes from the account lookup (ADR-0018). */
export const recipientSchema = z.object({
  accountNumber: z.string().trim().pipe(contractRecipient.shape.accountNumber),
  bankCode: z.string().refine((code) => bankByCode(code) !== undefined, 'Select a bank'),
})

export type RecipientFormValues = z.input<typeof recipientSchema>

/**
 * The amount step. `availableKobo` is the balance on screen; undefined while it is unknown, in which case the server's
 * own check is the only one (it always runs anyway).
 */
export function amountSchema(availableKobo: Kobo | undefined) {
  return z.object({
    amount: z
      .string()
      .trim()
      .min(1, 'Enter an amount')
      .transform((text, ctx) => {
        const kobo = parseNairaInput(text)
        if (kobo === null) {
          ctx.addIssue({ code: 'custom', message: 'Enter an amount in naira, like 5,000 or 5,000.50' })
          return z.NEVER
        }
        // Widened back to a plain number: the contract's rule below takes wire input and brands it itself.
        const wire: number = kobo
        return wire
      })
      // The contract's rules, in its order: greater than zero first, then the minimum.
      .pipe(SendMoneyRequestSchema.shape.amountKobo)
      .refine((kobo) => availableKobo === undefined || kobo <= availableKobo, {
        message: availableKobo === undefined ? '' : `This is more than your available balance of ${formatNaira(availableKobo)}`,
      }),
    narration: z.string().pipe(SendMoneyRequestSchema.shape.narration.unwrap()),
  })
}

export type AmountFormValues = z.input<ReturnType<typeof amountSchema>>

type Step = 'recipient' | 'amount'

/**
 * The whole draft, checked again at the moment of confirming (ADR-0009). An amount valid at step 2 can be invalid by
 * now — the balance may have dropped — so this runs every rule again and says which step to fix.
 */
export function buildRequest(
  draft: Pick<TransferDraftState, 'recipient' | 'amountInput' | 'narration'>,
  availableKobo: Kobo | undefined,
): { ok: true; request: SendMoneyRequest } | { ok: false; step: Step; message: string } {
  const recipient = recipientSchema.safeParse(draft.recipient)
  if (!recipient.success) return { ok: false, step: 'recipient', message: firstMessage(recipient.error) }
  if (!draft.recipient.accountName.trim()) return { ok: false, step: 'recipient', message: 'Verify the recipient’s account' }

  const amount = amountSchema(availableKobo).safeParse({ amount: draft.amountInput, narration: draft.narration })
  if (!amount.success) return { ok: false, step: 'amount', message: firstMessage(amount.error) }

  const request = SendMoneyRequestSchema.safeParse({
    recipient: { ...recipient.data, accountName: draft.recipient.accountName } satisfies Recipient,
    amountKobo: amount.data.amount,
    ...(amount.data.narration ? { narration: amount.data.narration } : {}),
  })
  if (!request.success) return { ok: false, step: 'amount', message: firstMessage(request.error) }
  return { ok: true, request: request.data }
}

function firstMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the details and try again'
}
