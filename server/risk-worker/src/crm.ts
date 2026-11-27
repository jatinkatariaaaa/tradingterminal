// Tells the CRM (thepeopleprop.live) when an account passes or breaches.

import type { CrmNotify } from "./types.js"

const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL || "https://thepeopleprop.live/api/terminal-webhook"

export const postCrmWebhook: CrmNotify = async (payload) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const secret = process.env.TERMINAL_WEBHOOK_SECRET || process.env.CRM_WEBHOOK_SECRET
  if (secret) headers.Authorization = `Bearer ${secret}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(CRM_WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) {
      const details = await response.text().catch(() => "")
      console.error(`[crm-webhook] ${payload.status} notification failed: ${response.status} ${details}`)
    }
  } catch (err) {
    console.error("[crm-webhook] notification error:", (err as Error).message)
  } finally {
    clearTimeout(timeoutId)
  }
}
