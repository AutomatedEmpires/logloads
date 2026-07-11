import { createClient } from "@supabase/supabase-js"

export interface SupabaseServerEnv {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

type EnvSource = Record<string, string | undefined>

function getRuntimeEnv(): EnvSource {
  const candidate = globalThis as { process?: { env?: EnvSource } }

  return candidate.process?.env ?? {}
}

export function getSupabaseServerEnv(source: EnvSource = getRuntimeEnv()): SupabaseServerEnv {
  const { SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } = source

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required to create a Supabase client")
  }

  return {
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL
  }
}

export function createSupabaseAnonClient(env: SupabaseServerEnv) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

export function createSupabaseServiceRoleClient(env: SupabaseServerEnv) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the service role client")
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}