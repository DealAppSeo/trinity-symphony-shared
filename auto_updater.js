/**
 * auto_updater.js - Trinity Symphony Self-Update Bootstrap
 * =========================================================
 * THIS IS THE ONLY FILE YOU MANUALLY ADD TO THE REPO.
 * After this, all updates come through the database automatically.
 * 
 * Location: Root of trinity-symphony-shared/
 * 
 * Usage in trinity-worker.js:
 *   const { checkAndApplyUpdates } = require('./auto_updater');
 *   await checkAndApplyUpdates(process.env.AGENT_NAME || 'UNKNOWN');
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://qnnpjhlxljtqyigedwkb.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

let supabase = null;

function getSupabase() {
  if (!supabase && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

/**
 * Check for and apply pending updates
 * @param {string} agentId - Agent name (HDM, APM, etc.)
 * @param {boolean} autoRestart - Whether to restart after updates
 * @returns {Promise<{applied: number, failed: number, pendingRestart: boolean}>}
 */
async function checkAndApplyUpdates(agentId, autoRestart = true) {
  const client = getSupabase();
  if (!client) {
    console.log(`⚠️ [${agentId}] No Supabase key, skipping updates`);
    return { applied: 0, failed: 0, pendingRestart: false };
  }

  console.log(`🔄 [${agentId}] Checking for updates...`);

  try {
    // Get pending updates for this agent
    const { data: updates, error } = await client.rpc('get_pending_updates', {
      p_agent_id: agentId
    });

    if (error) {
      // Table might not exist yet - that's OK
      if (error.message.includes('does not exist')) {
        console.log(`📋 [${agentId}] Update system not initialized yet`);
        return { applied: 0, failed: 0, pendingRestart: false };
      }
      throw error;
    }

    if (!updates || updates.length === 0) {
      console.log(`✅ [${agentId}] No pending updates`);
      return { applied: 0, failed: 0, pendingRestart: false };
    }

    console.log(`📦 [${agentId}] Found ${updates.length} pending update(s)`);

    let applied = 0;
    let failed = 0;
    let needsRestart = false;

    for (const update of updates) {
      const { update_id, version, name, update_type } = update;
      console.log(`   Applying ${version}: ${name}...`);

      // Mark as downloading
      await markUpdateStatus(client, agentId, update_id, 'downloading');

      try {
        // Apply based on type
        switch (update_type) {
          case 'python_file':
          case 'js_file':
            await applyFile(update);
            break;
          case 'python_patch':
          case 'js_patch':
            await applyPatch(update);
            break;
          case 'env_var':
            applyEnvVar(update);
            break;
          case 'restart_only':
            // Just trigger restart
            break;
          default:
            throw new Error(`Unknown update type: ${update_type}`);
        }

        // Mark as completed
        await markUpdateStatus(client, agentId, update_id, 'completed');
        console.log(`   ✅ Applied ${version}`);
        applied++;

        if (update.requires_restart) {
          needsRestart = true;
        }

      } catch (err) {
        // Mark as failed
        await markUpdateStatus(client, agentId, update_id, 'failed', err.message);
        console.log(`   ❌ Failed ${version}: ${err.message}`);
        failed++;
      }
    }

    // Handle restart if needed
    if (needsRestart && autoRestart) {
      console.log(`🔄 [${agentId}] Restarting to apply updates...`);
      // Give time for logs to flush
      await new Promise(resolve => setTimeout(resolve, 1000));
      process.exit(0); // Render/Railway will auto-restart
    }

    return {
      applied,
      failed,
      pendingRestart: needsRestart && !autoRestart
    };

  } catch (err) {
    console.error(`❌ [${agentId}] Update check failed:`, err.message);
    return { applied: 0, failed: 0, pendingRestart: false };
  }
}

/**
 * Mark update status in database
 */
async function markUpdateStatus(client, agentId, updateId, status, error = null) {
  try {
    await client.rpc('mark_update_status', {
      p_agent_id: agentId,
      p_update_id: updateId,
      p_status: status,
      p_error: error
    });
  } catch (err) {
    console.error(`   Warning: Could not mark status: ${err.message}`);
  }
}

/**
 * Write a file to disk
 */
async function applyFile(update) {
  const filePath = path.resolve(process.cwd(), update.file_path);
  const content = update.file_content;

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`      Wrote ${filePath}`);
}

/**
 * Patch an existing file (find and replace)
 */
async function applyPatch(update) {
  const targetPath = path.resolve(process.cwd(), update.patch_target);
  const findText = update.patch_find;
  const replaceText = update.patch_replace;

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Patch target not found: ${targetPath}`);
  }

  let content = fs.readFileSync(targetPath, 'utf8');
  
  if (!content.includes(findText)) {
    throw new Error(`Patch target text not found in ${targetPath}`);
  }

  content = content.replace(findText, replaceText);
  fs.writeFileSync(targetPath, content, 'utf8');
  console.log(`      Patched ${targetPath}`);
}

/**
 * Set environment variable (runtime only)
 */
function applyEnvVar(update) {
  const content = update.file_content;
  if (content.includes('=')) {
    const [key, ...valueParts] = content.split('=');
    const value = valueParts.join('=');
    process.env[key.trim()] = value.trim();
    console.log(`      Set env: ${key.trim()}`);
  }
}

module.exports = {
  checkAndApplyUpdates,
  getSupabase
};
