
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import * as dotenv from 'dotenv';
import path from 'path';

// Load ENV
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qnnpjhlxljtqyigedwkb.supabase.co';

/**
 * Fail-closed resolution of the Supabase SERVICE (admin / writer) key.
 * Precedence: SUPABASE_SECRET_KEY (new sb_secret_ name) > SUPABASE_SERVICE_ROLE_KEY
 * > SUPABASE_SERVICE_KEY > SUPABASE_KEY. The ANON key is deliberately NOT a
 * fallback — an anon client is silently RLS-rejected on every write. If no
 * service key resolves we THROW loudly instead of degrading to anon.
 */
export function resolveSupabaseServiceKey(env: NodeJS.ProcessEnv = process.env): string {
    const candidates: Array<[string, string | undefined]> = [
        ['SUPABASE_SECRET_KEY', env.SUPABASE_SECRET_KEY],
        ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY],
        ['SUPABASE_SERVICE_KEY', env.SUPABASE_SERVICE_KEY],
        ['SUPABASE_KEY', env.SUPABASE_KEY],
    ];
    for (const [, value] of candidates) {
        if (typeof value === 'string' && value.trim().length > 0) return value;
    }
    throw new Error(
        '[SUPABASE][FAIL-CLOSED] No Supabase service key found. Looked for (in order): ' +
        candidates.map(([n]) => n).join(', ') + '. Refusing to fall back to an anon key — ' +
        'an anon client is silently RLS-rejected on every write. Set SUPABASE_SECRET_KEY ' +
        '(new sb_secret_ name) or legacy SUPABASE_SERVICE_ROLE_KEY.'
    );
}

const supabaseKey = resolveSupabaseServiceKey(); // throws (loud) if no service key resolves

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, { realtime: { transport: ws } });
export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseKey, { realtime: { transport: ws } }); // Same for now in shared

console.log('[SUPABASE] ? Client initialized with ws transport (Node ' + process.version + ')');
