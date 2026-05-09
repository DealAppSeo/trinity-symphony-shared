/**
 * ARTIFACT GUARD — content-quality validation for trinity_artifacts.
 *
 * Pure helper: no DB, no I/O. Given a saved artifact row and the task it
 * belongs to, returns { valid: true } or { valid: false, reason }.
 *
 * Reason codes (stable; logged into escalation_log):
 *   empty_content   — content is null/undefined/whitespace-only
 *   echo_identical  — content trims to exactly task.description (rows 95602/95603)
 *   too_short       — content < 100 chars after trim
 *   echo_overlap    — content shares a >=50-char prefix or suffix with task.description
 */

const SHORT_CONTENT_FLOOR = 100;
const OVERLAP_THRESHOLD = 50;

function validateArtifactQuality(artifact, task) {
    if (!artifact || artifact.content == null || String(artifact.content).trim() === '') {
        return { valid: false, reason: 'empty_content' };
    }

    const trimmedContent = String(artifact.content).trim();
    const trimmedDesc = (task && typeof task.description === 'string') ? task.description.trim() : '';

    if (trimmedDesc.length > 0 && trimmedContent === trimmedDesc) {
        return { valid: false, reason: 'echo_identical' };
    }

    if (trimmedContent.length < SHORT_CONTENT_FLOOR) {
        return { valid: false, reason: 'too_short' };
    }

    if (trimmedDesc.length >= OVERLAP_THRESHOLD) {
        const prefix = trimmedDesc.slice(0, OVERLAP_THRESHOLD);
        const suffix = trimmedDesc.slice(-OVERLAP_THRESHOLD);
        if (trimmedContent.startsWith(prefix) || trimmedContent.endsWith(suffix)) {
            return { valid: false, reason: 'echo_overlap' };
        }
    }

    return { valid: true };
}

module.exports = { validateArtifactQuality, SHORT_CONTENT_FLOOR, OVERLAP_THRESHOLD };
