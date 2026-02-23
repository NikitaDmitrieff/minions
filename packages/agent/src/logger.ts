import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

export type LogEventType = 'text' | 'tool_use' | 'tool_result' | 'error'

export interface LogPayload {
  tool?: string
  input?: Record<string, unknown>
  output?: string
  is_error?: boolean
  text?: string
  [key: string]: unknown
}

export class DbLogger {
  constructor(
    private supabase: AnySupabaseClient,
    private runId: string,
  ) {}

  async log(message: string, level = 'info') {
    console.log(`[${level}] ${message}`)
    const { error } = await this.supabase.from('run_logs').insert({
      run_id: this.runId,
      level,
      message,
    })
    if (error) console.error(`[logger] Failed to write log: ${error.message}`)
  }

  async event(eventType: LogEventType, message: string, payload?: LogPayload) {
    console.log(`[${eventType}] ${message}`)
    const { error } = await this.supabase.from('run_logs').insert({
      run_id: this.runId,
      level: eventType === 'error' ? 'error' : 'info',
      message,
      event_type: eventType,
      payload: payload ?? null,
    })
    if (error) console.error(`[logger] Failed to write log: ${error.message}`)
  }

  async error(message: string) {
    return this.log(message, 'error')
  }

  async warn(message: string) {
    return this.log(message, 'warn')
  }
}
