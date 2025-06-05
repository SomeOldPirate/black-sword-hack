// ── modules/combat.js ──

import { calculateAttributeValues } from "./shared.js";
import { BSHConfiguration } from "./configuration.js";

/**
 * A custom Combat subclass that rolls initiative according to Black Sword Hack rules:
 *
 *  • Each PC rolls 1d20 “under” their WIS (roll < WIS → success; 1 → critical success; 20 → critical failure).
 *  • All PCs who succeed occupy bucket 3 (“fast PCs”).
 *  • All monsters/NPCs occupy bucket 2 (“middle”).
 *  • All PCs who fail occupy bucket 1 (“slow PCs”).
 *  • Initiative value = (bucket × 1000) − (raw d20 for PCs, or 0 for monsters),
 *    so fast PCs sort into 2999…2981, monsters into 2000, slow PCs into 999…981.
 *  • A critical success (raw 1) sets `flags.bsh.critInit = "critSuccess"`.
 *  • A critical failure (raw 20) sets `flags.bsh.critInit = "critFailure"`.
 */
export default class BSHCombat extends Combat {
  /** @override */
  async rollInitiative(ids, { prompt = false } = {}) {
    // Ignore Foundry’s built-in prompt; do our own WIS-based rolls.
    return this._rollCombatantInitiatives(ids);
  }

  /**
   * Roll initiative for the given Combatant IDs by:
   *  1) Doing a 1d20 under-WIS check for PCs.
   *  2) Assigning all monsters/NPCs a fixed “middle” initiative.
   */
  async _rollCombatantInitiatives(ids) {
    const updates = [];

    for (const cid of ids) {
      const combatant = this.combatants.get(cid);
      if (!combatant) continue;
      const actor = combatant.actor;
      if (!actor) continue;

      const sys = actor.system;

      // ─── 1) Determine WIS value ─────────────────────────────────────────────────
      let wisValue = 10;
      if (actor.type === "character") {
        // If “calculated” exists, use it; otherwise compute on the fly:
        let attributes = sys.calculated;
        if (!attributes) {
          attributes = calculateAttributeValues(sys, BSHConfiguration);
        }
        wisValue = typeof attributes.wisdom === "number" ? attributes.wisdom : 10;
      } else {
        // For NPCs/Creatures, just read system.attributes.wisdom if present
        wisValue = sys.attributes?.wisdom ?? 10;
      }

      // ─── 2) Initialize defaults ─────────────────────────────────────────────────
      let bucket = 2;          // default bucket 2 = monsters/NPCs
      let critFlag = null;     // “critSuccess” | “critFailure” | null
      let raw = 0;             // raw d20 result for PCs (0 for monsters)
      let initiativeValue = 0;

      // ─── 3) If PC, roll 1d20 under-WIS ──────────────────────────────────────────
      if (actor.type === "character") {
        const roll = new Roll("1d20");
        await roll.evaluate();         // no options needed; new API

        raw = roll.total;

        if (raw === 1) {
          bucket = 3;
          critFlag = "critSuccess";
        }
        else if (raw === 20) {
          bucket = 1;
          critFlag = "critFailure";
        }
        else if (raw < wisValue) {
          bucket = 3;  // ordinary success
        }
        else {
          bucket = 1;  // ordinary failure
        }

        // Compute numeric initiative = (bucket × 1000) − raw
        initiativeValue = (bucket * 1000) - raw;

        // Optionally, post a chat message:
        // const flavor = (bucket === 3)
        //   ? (raw === 1 ? "Critical Success (3 actions)" : "Success (2 actions)")
        //   : (raw === 20 ? "Critical Failure (1 action)" : "Failure");
        // await roll.toMessage({
        //   speaker: ChatMessage.getSpeaker({ actor }),
        //   flavor: `<strong>${actor.name}</strong> rolls <em>${raw}</em> vs WIS <em>${wisValue}</em>: <strong>${flavor}</strong>`
        // });
      }
      // ─── 4) Otherwise, it’s a monster/NPC (no roll needed) ──────────────────────────
      else {
        bucket = 2;
        raw = 0;
        initiativeValue = (bucket * 1000) - raw;  // always 2000 for NPCs
      }

      // ─── 5) Queue the Combatant update ───────────────────────────────────────────
      updates.push({
        _id: combatant.id,
        initiative: initiativeValue,
        "flags.bsh.critInit": critFlag
      });
    }

    // ─── 6) Apply all updates in one batch ───────────────────────────────────────
    if (updates.length) {
      await this.updateEmbeddedDocuments("Combatant", updates, { diff: true });
    }
    return this;
  }
}

// ── Below: hook to replace the numeric initiative display with “Success”/“Failure” ── //

Hooks.on("renderCombatTracker", (trackerApp, html) => {
  // If there's no active Combat, or no combatants, bail out early
  if (!trackerApp.combat || !trackerApp.combat.combatants) return;

  // In FVTT V12, the Combat Tracker is rendered as <ol><li class="combatant">…</li></ol>
  html.find("li.combatant").each((_idx, li) => {
    // li is the <li class="combatant">…</li> element
    const row = li;
    const combatantId = row.dataset.combatantId;
    if (!combatantId) return;

    const combatant = trackerApp.combat.combatants.get(combatantId);
    if (!combatant) return;

    // Locate the <span class="combatant-initiative">…</span> inside that <li>
    const initSpan = row.querySelector("span.combatant-initiative");
    if (!initSpan) return;

    // If it’s a PC, show “Success” or “Failure” based on numeric initiative
    const actor = combatant.actor;
    if (actor?.type === "character") {
      const initValue = combatant.initiative ?? 0;
      initSpan.textContent = (initValue > 2000 ? "Success" : "Failure");
    }
    // If it’s a monster/NPC, blank out the text
    else {
      initSpan.textContent = "";
    }
  });
});
