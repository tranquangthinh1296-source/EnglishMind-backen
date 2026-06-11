// Template quality signal engine (B3) — PLATFORM_SPEC.md §11.8.
const WEIGHTS = {
  copy: 2,
  save: 3,
  like: 5,
  reuse: 2,
  edit_after_generate: -2,
  report_wrong: -10,
};

const DEDUP_EVENT_TYPES = new Set(["like", "save"]);

function blockThreshold() {
  return Number(process.env.TEMPLATE_BLOCK_THRESHOLD ?? -10);
}

/**
 * @param {import("pg").Pool} pool
 * @param {{ templateId: string, eventType: string, userKey?: string }} params
 * @returns {Promise<{ deduped?: true, notFound?: true, successScore?: number, blocked?: boolean }>}
 */
async function recordSignal(pool, { templateId, eventType, userKey }) {
  const weight = WEIGHTS[eventType];
  if (weight === undefined) {
    throw new Error(`unknown_event_type:${eventType}`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const exists = await client.query(`SELECT id FROM shared_templates WHERE id = $1`, [templateId]);
    if (!exists.rows.length) {
      await client.query("ROLLBACK");
      return { notFound: true };
    }

    if (DEDUP_EVENT_TYPES.has(eventType) && userKey) {
      const dup = await client.query(
        `SELECT 1 FROM template_quality_signals
         WHERE template_id = $1 AND user_key = $2 AND event_type = $3
           AND created_at > NOW() - INTERVAL '1 day'
         LIMIT 1`,
        [templateId, userKey, eventType]
      );
      if (dup.rows.length) {
        await client.query("ROLLBACK");
        return { deduped: true };
      }
    }

    await client.query(
      `INSERT INTO template_quality_signals (template_id, user_key, event_type, weight)
       VALUES ($1, $2, $3, $4)`,
      [templateId, userKey ?? null, eventType, weight]
    );

    const { rows } = await client.query(
      `UPDATE shared_templates SET success_score = success_score + $1 WHERE id = $2
       RETURNING success_score, status`,
      [weight, templateId]
    );
    const successScore = Number(rows[0].success_score);
    let blocked = false;
    if (successScore < blockThreshold()) {
      await client.query(`UPDATE shared_templates SET status = 'blocked' WHERE id = $1`, [templateId]);
      blocked = true;
    }

    await client.query("COMMIT");
    return { successScore, blocked };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recordSignal, WEIGHTS, blockThreshold, DEDUP_EVENT_TYPES };
