// modules/chat_messages.js

import { BSHConfiguration } from './configuration.js';
import { rollDoom } from './doom.js';
import {
  calculateAttributeValues,
  decrementItemQuantity,
  downgradeDie,
  generateDamageRollFormula,
  generateDieRollFormula,
  getObjectField,
  interpolate,
  rollEm,
  setObjectField
} from './shared.js';

/**
 * Log a weapon attack roll for a PC, applying the Threat-Level bonus if the
 * targeted NPC’s level is higher than the PC’s level.
 */
export function logAttackRoll(actorId, weaponId, shiftKey = false, ctrlKey = false, expanded = false) {
  const actor = game.actors.find(a => a.id === actorId);
  if (!actor) {
    return console.error(`Unable to locate an actor with the id '${actorId}'.`);
  }

  const weapon = actor.items.find(i => i.id === weaponId);
  if (!weapon) {
    return console.error(`Unable to locate weapon id '${weaponId}' on actor '${actor.name}'.`);
  }

  // ─── Threat-Level Logic ─────────────────────────────────────────────────────
  let threatBonus = 0;
  // Only apply to PCs (actor.type === "character")
  if (actor.type === "character") {
    // If the user has exactly one target selected on the canvas, use its actor
    const targetToken = Array.from(game.user.targets)[0];
    const targetActor = targetToken?.actor;
    if (targetActor && targetActor.type !== "character") {
      // Compare levels: if NPC's level > PC's level, bonus = difference
      const pcLevel = actor.system.level || 0;
      const npcLevel = targetActor.system.level || 0;
      if (npcLevel > pcLevel) {
        threatBonus = npcLevel - pcLevel;
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  // Calculate the PC’s attribute values (strength or dexterity)
  const attributes = calculateAttributeValues(actor.system, BSHConfiguration);
  const attribute = (weapon.system.type !== "ranged" ? "strength" : "dexterity");
  const critical = { failure: false, success: false };
  const doomed = (actor.system.doom === "exhausted");

  // Build data object for chat template
  const data = {
    actor: actor.name,
    actorId: actorId,
    doomed: doomed,
    weapon: weapon.name,
    weaponId: weapon.id
  };

  // ─── Build the d20 formula, including adv/dis and threatBonus ───────────────
  let formulaDice;
  if (shiftKey) {
    // Advantage (unless doomed)
    formulaDice = !doomed ? "2d20kl" : generateDieRollFormula();
  } else if (ctrlKey) {
    // Disadvantage
    formulaDice = generateDieRollFormula({ kind: "disadvantage" });
  } else {
    // Normal roll (or forced disadvantage if doomed)
    formulaDice = !doomed
      ? generateDieRollFormula()
      : generateDieRollFormula({ kind: "disadvantage" });
  }

  // Append the Threat bonus to the formula if > 0
  const formula = threatBonus > 0
    ? `${formulaDice} + ${threatBonus}`
    : formulaDice;
  // ────────────────────────────────────────────────────────────────────────────

  // Roll the d20 (with threatBonus added)
  rollEm(new Roll(formula)).then(roll => {
    // Determine critical success/failure by looking solely at the first d20 result
    const firstDieResult = roll.terms[0].results[0];
    critical.failure = (firstDieResult === 20);
    critical.success = (firstDieResult === 1);

    // Prepare roll data for chat
    data.roll = {
      expanded: expanded,
      formula: roll.formula,
      labels: { title: interpolate("bsh.messages.titles.attackRoll") },
      result: roll.total,
      tested: true
    };

    // Win if not a critical failure and (attribute > total)
    data.roll.success = (!critical.failure && attributes[attribute] > data.roll.result);

    // Set the result label
    if (!critical.success && !critical.failure) {
      data.roll.labels.result = interpolate(
        data.roll.success
          ? "bsh.messages.labels.hit"
          : "bsh.messages.labels.miss"
      );
    } else {
      if (critical.success) {
        data.roll.labels.result = interpolate("bsh.messages.labels.criticalHit");
      } else {
        data.roll.labels.result = interpolate("bsh.messages.labels.criticalMiss");
        data.roll.additional = {
          message: game.i18n.localize("bsh.blurbs.critical_failure"),
          show: true
        };
      }
    }

    // If hit, queue up the damage roll section
    if (data.roll.success) {
      data.damage = {
        actorId: actor.id,
        critical: critical.success,
        doomed: doomed,
        formula: generateDamageRollFormula(actor, weapon, { critical: critical.success, doomed: doomed }),
        weapon: weapon.name,
        weaponId: weapon.id
      };
    }

    // Send to chat
    showMessage(actor, "systems/black-sword-hack/templates/messages/attack-roll.hbs", data);
  });
}

export function logAttributeTest(actor, attribute, shiftKey = false, ctrlKey = false, expanded = false, adjustment = 0) {
  let attributes = calculateAttributeValues(actor.system, BSHConfiguration);
  let critical = { failure: false, success: true };
  let doomed = (actor.system.doom === "exhausted");
  let message = {
    actor: actor.name,
    actorId: actor.id,
    roll: {
      doomed: doomed,
      expanded: expanded,
      formula: (doomed ? "2d20kh" : "1d20"),
      labels: { result: "", title: "" },
      result: 0,
      success: false,
      tested: true
    }
  };
  let title = game.i18n.localize(`bsh.fields.titles.dieRolls.attributes.${attribute}`);

  message.roll.labels.title = title;

  if (shiftKey) {
    message.roll.formula = (doomed ? `1d20` : `2d20kl`);
  } else if (ctrlKey) {
    if (!doomed) {
      message.roll.formula = "2d20kh";
    }
  }

  if (adjustment < 0) {
    message.roll.formula = `${message.roll.formula}${adjustment}`;
  } else if (adjustment > 0) {
    message.roll.formula = `${message.roll.formula}+${adjustment}`;
  }

  rollEm(new Roll(message.roll.formula)).then(roll => {
    critical.failure = (roll.terms[0].results[0] === 20);
    critical.success = (roll.terms[0].results[0] === 1);
    message.roll.result = roll.total;
    message.roll.success = (critical.success || roll.total < attributes[attribute]);
    if (message.roll.success) {
      if (critical.success) {
        message.roll.labels.result = game.i18n.localize("bsh.fields.titles.criticalSuccess");
      } else {
        message.roll.labels.result = game.i18n.localize("bsh.fields.titles.success");
      }
    } else {
      if (critical.failure) {
        message.roll.labels.result = game.i18n.localize("bsh.fields.titles.criticalFailure");
        message.roll.additional = {
          message: game.i18n.localize("bsh.blurbs.critical_failure"),
          show: true
        };
      } else {
        message.roll.labels.result = game.i18n.localize("bsh.fields.titles.failure");
      }
    }
    showMessage(actor, "systems/black-sword-hack/templates/messages/die-roll.hbs", message);
  });
}

export function logCallSpirit(spirit, result) {
  let actor = spirit.actor;
  let message = {
    actor: actor.name,
    actorId: actor.id,
    spirit: spirit.name,
    doomed: result.doomed,
    roll: {
      expanded: false,
      formula: result.formula,
      labels: {
        result: game.i18n.localize("bsh.fields.titles.success"),
        title: game.i18n.localize("bsh.messages.titles.callSpirit")
      },
      result: result.result,
      success: true,
      tested: true
    }
  };

  showMessage(actor, "systems/black-sword-hack/templates/messages/spirit-success.hbs", message);
}

export function logCallSpiritFailure(spirit, result) {
  let actor = spirit.actor;
  let message = {
    actor: actor.name,
    actorId: actor.id,
    spirit: spirit.name,
    doomed: result.doomed,
    fumble: (result.die.ending === "exhausted"),
    roll: {
      expanded: false,
      formula: result.formula,
      labels: {
        result: game.i18n.localize("bsh.fields.titles.failure"),
        title: game.i18n.localize("bsh.messages.titles.callSpirit")
      },
      result: result.result,
      success: false,
      tested: true
    }
  };

  showMessage(actor, "systems/black-sword-hack/templates/messages/spirit-failure.hbs", message);
}

export function logDamageRoll(event) {
  let element = event.currentTarget;
  let rollData = element.dataset;

  if (rollData.formula && rollData.actor) {
    let actor = game.actors.find(a => a.id === rollData.actor);
    let data = {
      doomed: (rollData.doomed === "true"),
      roll: {
        expanded: true,
        labels: { title: interpolate("bsh.messages.titles.damageRoll") },
        tested: false
      }
    };
    let formula = rollData.formula;

    data.roll.formula = formula;
    rollEm(new Roll(formula)).then(roll => {
      data.roll.result = roll.total;
      showMessage(actor, "systems/black-sword-hack/templates/messages/damage-roll.hbs", data);
    });
  } else {
    console.error("Damage roll requested but requesting element did not have a damage formula attribute.");
  }

  return false;
}

export function logDefendRoll(event) {
  let element = event.currentTarget;

  if (element.dataset.attribute && element.dataset.actor) {
    let actor = game.actors.find(a => a.id === element.dataset.actor);

    if (actor) {
      if (element.dataset.attribute === "strength") {
        logParryRoll(actor, event.shiftKey, event.ctrlKey);
      } else {
        logDodgeRoll(actor, event.shiftKey, event.ctrlKey);
      }
    } else {
      console.error(`Unable to find an actor with the id of '${element.dataset.id}'.`);
    }
  } else {
    console.error("Defend roll request but requesting element is missing an attribute and/or id data attribute.");
  }
}

export function logDemonSummoning(demon, result) {
  let actor = demon.actor;
  let message = {
    actor: actor.name,
    actorId: actor.id,
    demon: demon.name,
    doomed: result.doomed,
    roll: {
      expanded: false,
      formula: result.formula,
      labels: {
        result: game.i18n.localize("bsh.fields.titles.success"),
        title: game.i18n.localize("bsh.messages.titles.summonDemon")
      },
      result: result.result,
      success: true,
      tested: true
    }
  };

  showMessage(actor, "systems/black-sword-hack/templates/messages/demon-success.hbs", message);
}

export function logDemonSummoningFailure(demon, result) {
  let actor = demon.actor;
  let message = {
    actor: actor.name,
    actorId: actor.id,
    demon: demon.name,
    doomed: result.doomed,
    fumble: (result.die.ending === "exhausted"),
    roll: {
      expanded: false,
      formula: result.formula,
      labels: {
        result: game.i18n.localize("bsh.fields.titles.failure"),
        title: game.i18n.localize("bsh.messages.titles.summonDemon")
      },
      result: result.result,
      success: false,
      tested: true
    }
  };

  showMessage(actor, "systems/black-sword-hack/templates/messages/demon-failure.hbs", message);
}

export function logDieRoll(actor, dieType, title, shiftKey = false, ctrlKey = false) {
  let doomed = (actor.system.doom === "exhausted");
  let formula = (doomed ? `2${dieType}kl` : `1${dieType}`);
  let message = {
    actor: actor.name,
    actorId: actor.id,
    doomed: doomed,
    roll: {
      expanded: true,
      formula: formula,
      labels: { title: title },
      result: 0,
      tested: false
    }
  };

  if (shiftKey) {
    formula = (doomed ? `1${dieType}` : `2${dieType}kh`);
  } else if (ctrlKey) {
    if (!doomed) {
      formula = `2${dieType}kl`;
    }
  }
  rollEm(new Roll(formula)).then(roll => {
    message.roll.result = roll.total;
    showMessage(actor, "systems/black-sword-hack/templates/messages/die-roll.hbs", message);
  });
}

export function logDodgeRoll(actor, shiftKey = false, ctrlKey = false) {
  let attributes = calculateAttributeValues(actor.system, BSHConfiguration);
  let critical = { failure: false, success: false };
  let doomed = (actor.system.doom === "exhausted");
  let title = interpolate("bsh.messages.titles.dodgeRoll");
  let message = {
    actor: actor.name,
    actorId: actor.id,
    doomed: doomed,
    roll: {
      expanded: false,
      formula: "",
      labels: { title: title },
      result: 0,
      tested: true
    }
  };
  let shield = (actor.system.armour.shield === "yes");

  if (!doomed) {
    if (shiftKey) {
      message.roll.formula = "2d20kl";
    } else if (ctrlKey) {
      message.roll.formula = "2d20kh";
    } else {
      message.roll.formula = "1d20";
    }
  } else {
    message.roll.formula = (shiftKey || shield ? "1d20" : "2d20kh");
  }
  rollEm(new Roll(message.roll.formula)).then(roll => {
    critical.failure = (roll.total === 20);
    critical.success = (roll.total === 1);
    message.roll.result = roll.total;
    message.roll.success = (critical.success || roll.total < attributes["dexterity"]);

    if (!critical.success && !critical.failure) {
      message.roll.labels.result = interpolate(
        message.roll.success ? "bsh.messages.labels.success" : "bsh.messages.labels.failure"
      );
    } else {
      if (critical.success) {
        message.roll.labels.result = interpolate("bsh.messages.labels.criticalSuccess");
      } else {
        message.roll.labels.result = interpolate("bsh.messages.labels.criticalFailure");
        message.roll.additional = {
          message: game.i18n.localize("bsh.blurbs.defend_fumble"),
          show: true
        };
      }
    }

    showMessage(actor, "systems/black-sword-hack/templates/messages/die-roll.hbs", message);
  });
}

export function logDoomDieRoll(actor, shiftKey = false, ctrlKey = false) {
  if (actor.system.doom !== "exhausted") {
    let message = {
      actor: actor.name,
      actorId: actor.id,
      roll: {
        expanded: false,
        formula: "",
        labels: {
          result: "",
          title: interpolate("bsh.messages.titles.doomRoll")
        },
        result: 0,
        tested: true
      }
    };
    let rollType = "standard";
    let result = null;

    if (shiftKey) {
      rollType = "advantage";
    } else if (ctrlKey) {
      rollType = "disadvantage";
    }
    rollDoom(actor, rollType).then(result => {
      message.roll.formula = result.formula;
      message.roll.result = result.result;
      message.roll.success = !result.downgraded;
      if (!message.roll.success) {
        message.roll.labels.result = interpolate("bsh.fields.titles.failure");
        message.doomed = (result.die.ending === "exhausted");
      } else {
        message.roll.labels.result = interpolate("bsh.fields.titles.success");
      }

      showMessage(actor, "systems/black-sword-hack/templates/messages/doom-roll.hbs", message);
    });
  } else {
    console.error(`Unable to make a doom roll for '${actor.name}' as their doom die is exhausted.`);
    ui.notifications.error(
      interpolate("bsh.messages.doom.exhausted", { name: actor.name })
    );
  }
}

export function logInitiativeRoll(event) {
  let element = event.currentTarget;

  if (element.dataset.actor) {
    let actor = game.actors.find(a => a.id === element.dataset.actor);
    let attributes = calculateAttributeValues(actor.system, BSHConfiguration);
    let critical = { failure: false, success: false };
    let doomed = (actor.system.doom === "exhausted");
    let title = interpolate("bsh.messages.titles.initiativeRoll");
    let message = {
      actor: actor.name,
      actorId: actor.id,
      doomed: doomed,
      roll: {
        expanded: false,
        formula: "",
        labels: { title: title },
        result: 0,
        tested: true
      }
    };

    if (!doomed) {
      if (event.shiftKey) {
        message.roll.formula = "2d20kl";
      } else if (event.ctrlKey) {
        message.roll.formula = "2d20kh";
      } else {
        message.roll.formula = "1d20";
      }
    } else {
      message.roll.formula = (event.shiftKey ? "1d20" : "2d20kh");
    }
    rollEm(new Roll(message.roll.formula)).then(roll => {
      critical.failure = (roll.total === 20);
      critical.success = (roll.total === 1);
      message.roll.result = roll.total;
      message.roll.success = (critical.success || roll.total < attributes["wisdom"]);

      if (!critical.success && !critical.failure) {
        message.roll.labels.result = interpolate(
          message.roll.success ? "bsh.messages.labels.success" : "bsh.messages.labels.failure"
        );
      } else {
        if (critical.success) {
          message.roll.labels.result = interpolate("bsh.messages.labels.criticalSuccess");
        } else {
          message.roll.labels.result = interpolate("bsh.messages.labels.criticalFailure");
          message.roll.additional = {
            message: game.i18n.localize("bsh.blurbs.critical_failure"),
            show: true
          };
        }
      }

      showMessage(actor, "systems/black-sword-hack/templates/messages/die-roll.hbs", message);
    });
  } else {
    console.error("Initiative roll requested but requesting element is missing an actor id data attribute.");
  }
}

export function logItemUsageDieRoll(item, field, shiftKey = false, ctrlKey = false) {
  let usageDie = getObjectField(`${field}.current`, item.system);

  if (!usageDie || usageDie === "^") {
    usageDie = getObjectField(`${field}.maximum`, item.system);
  }

  if (usageDie) {
    if (usageDie !== "exhausted") {
      let message = {
        downgraded: false,
        item: item.name,
        itemId: item.id,
        roll: {
          expanded: false,
          formula: `1${usageDie}`,
          labels: {
            result: "",
            title: interpolate("bsh.messages.titles.usageDieRoll")
          },
          result: 0,
          tested: true
        }
      };

      if (shiftKey) {
        message.roll.formula = `2${usageDie}kh`;
      } else if (ctrlKey) {
        message.roll.formula = `2${usageDie}kl`;
      }
      rollEm(new Roll(message.roll.formula)).then(roll => {
        message.roll.result = roll.total;
        if (roll.total < 3) {
          let newDie = downgradeDie(usageDie);
          let data = setObjectField(`${field}.current`, newDie);

          message.downgraded = true;
          message.roll.success = false;
          message.roll.labels.result = interpolate("bsh.fields.titles.failure");
          item.update({ system: data }, { diff: true });
          if (newDie === "exhausted") {
            decrementItemQuantity(item.id);
            message.feedback = game.i18n.localize("bsh.messages.usageDie.exhausted");
          } else {
            message.feedback = interpolate(
              game.i18n.localize("bsh.messages.usageDie.downgraded"),
              { die: newDie }
            );
          }
        } else {
          message.roll.success = true;
          message.roll.labels.result = interpolate("bsh.fields.titles.success");
        }

        showMessage(item.actor, "systems/black-sword-hack/templates/messages/usage-die-roll.hbs", message);
      });
    } else {
      console.warn(`Unable to roll usage die for item id ${item.id} as the particular usage die request is exhausted.`);
      ui.notifications.error(game.i18n.localize("bsh.errors.usageDie.exhausted"));
    }
  } else {
    console.error(`Unable to locate the ${field} usage die setting for item id ${item.id} (${item.name}).`);
    ui.notifications.error(game.i18n.localize("bsh.errors.usageDie.notFound"));
  }
}

export function logParryRoll(actor, shiftKey = false, ctrlKey = false) {
  let attributes = calculateAttributeValues(actor.system, BSHConfiguration);
  let critical = { failure: false, success: false };
  let doomed = (actor.system.doom === "exhausted");
  let title = interpolate("bsh.messages.titles.parryRoll");
  let message = {
    actor: actor.name,
    actorId: actor.id,
    doomed: doomed,
    roll: {
      expanded: false,
      formula: "",
      labels: { title: title },
      result: 0,
      tested: true
    }
  };
  let shield = (actor.system.armour.shield === "yes");

  if (!doomed) {
    if (ctrlKey && !shield) {
      message.roll.formula = "2d20kh";
    } else if ((shiftKey || shield) && !ctrlKey) {
      message.roll.formula = "2d20kl";
    } else {
      message.roll.formula = "1d20";
    }
  } else {
    message.roll.formula = (shiftKey || shield ? "1d20" : "2d20kh");
  }
  rollEm(new Roll(message.roll.formula)).then(roll => {
    critical.failure = (roll.total === 20);
    critical.success = (roll.total === 1);
    message.roll.result = roll.total;
    message.roll.success = (critical.success || roll.total < attributes["strength"]);

    if (!critical.success && !critical.failure) {
      message.roll.labels.result = interpolate(
        message.roll.success ? "bsh.messages.labels.success" : "bsh.messages.labels.failure"
      );
    } else {
      if (critical.success) {
        message.roll.labels.result = interpolate("bsh.messages.labels.criticalSuccess");
      } else {
        message.roll.labels.result = interpolate("bsh.messages.labels.criticalFailure");
        message.roll.additional = {
          message: game.i18n.localize("bsh.blurbs.defend_fumble"),
          show: true
        };
      }
    }

    showMessage(actor, "systems/black-sword-hack/templates/messages/die-roll.hbs", message);
  });
}

export function logPerceptionRoll(event) {
  let element = event.currentTarget;

  if (element.dataset.actor) {
    let actor = game.actors.find(a => a.id === element.dataset.actor);
    let attributes = calculateAttributeValues(actor.system, BSHConfiguration);
    let critical = { failure: false, success: false };
    let doomed = (actor.system.doom === "exhausted");
    let title = interpolate("bsh.messages.titles.perceptionRoll");
    let message = {
      actor: actor.name,
      actorId: actor.id,
      doomed: doomed,
      roll: {
        expanded: false,
        formula: "",
        labels: { title: title },
        result: 0,
        tested: true
      }
    };

    if (!doomed) {
      if (event.shiftKey) {
        message.roll.formula = "2d20kl";
      } else if (event.ctrlKey) {
        message.roll.formula = "2d20kh";
      } else {
        message.roll.formula = "1d20";
      }
    } else {
      message.roll.formula = (event.shiftKey ? "1d20" : "2d20kh");
    }
    rollEm(new Roll(message.roll.formula)).then(roll => {
      critical.failure = (roll.total === 20);
      critical.success = (roll.total === 1);
      message.roll.result = roll.total;
      message.roll.success = (critical.success || roll.total < attributes["intelligence"]);

      if (!critical.success && !critical.failure) {
        message.roll.labels.result = interpolate(
          message.roll.success ? "bsh.messages.labels.success" : "bsh.messages.labels.failure"
        );
      } else {
        if (critical.success) {
          message.roll.labels.result = interpolate("bsh.messages.labels.criticalSuccess");
        } else {
          message.roll.labels.result = interpolate("bsh.messages.labels.criticalFailure");
          message.roll.additional = {
            message: game.i18n.localize("bsh.blurbs.critical_failure"),
            show: true
          };
        }
      }

      showMessage(actor, "systems/black-sword-hack/templates/messages/die-roll.hbs", message);
    });
  } else {
    console.error("Perception roll requested but requesting element is missing an actor id data attribute.");
  }
}

export function logSpellCast(spell, result) {
  let actor = spell.actor;
  let message = {
    actor: actor.name,
    actorId: actor.id,
    spell: spell.name,
    doomed: result.doomed,
    roll: {
      expanded: false,
      formula: result.formula,
      labels: {
        result: game.i18n.localize("bsh.fields.titles.success"),
        title: game.i18n.localize("bsh.messages.titles.castSpell")
      },
      result: result.result,
      success: true,
      tested: true
    }
  };

  showMessage(actor, "systems/black-sword-hack/templates/messages/spell-success.hbs", message);
}

export function logSpellCastFailure(spell, result) {
  let actor = spell.actor;
  let message = {
    actor: actor.name,
    actorId: actor.id,
    spell: spell.name,
    doomed: result.doomed,
    fumble: (result.total === 20),
    roll: {
      expanded: false,
      formula: result.formula,
      labels: {
        result: game.i18n.localize("bsh.fields.titles.failure"),
        title: game.i18n.localize("bsh.messages.titles.castSpell")
      },
      result: result.result,
      success: false,
      tested: true
    }
  };

  showMessage(actor, "systems/black-sword-hack/templates/messages/spell-failure.hbs", message);
}

export function showMessage(actor, templateKey, data) {
  getTemplate(templateKey).then(template => {
    let message = {
      speaker: ChatMessage.getSpeaker(actor = actor),
      user: game.user
    };
    message.content = template(data);
    ChatMessage.create(message);
  });
}

export function toggleAttributeTestDisplay(event) {
  let element = event.currentTarget;
  let parent = element.parentElement;

  event.preventDefault();
  if (parent) {
    let details = parent.querySelector(".bsh-roll-details");
    if (details) {
      if (details.classList.contains("bsh-hidden")) {
        details.classList.remove("bsh-hidden");
      } else {
        details.classList.add("bsh-hidden");
      }
    }
  }
}
