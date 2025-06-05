import { BSHConfiguration } from './configuration.js';
import AttributeTestDialog from './attribute_test_dialog.js';
import {
  logAttackRoll,
  logAttributeTest,
  logDieRoll,
  logItemUsageDieRoll
} from './chat_messages.js';

/**
 * Retrieves an actor from the game list of actors based on its unique identifier.
 */
export function getActorById(actorId) {
  return game.actors.find(a => a.id === actorId);
}

/**
 * Fetches an unowned item by its id. Returns undefined if the item cannot be found.
 */
export function getItemById(itemId) {
  return game.items.find(a => a.id === itemId);
}

/**
 * Fetches the owned item by its identifier. Returns undefined if the item cannot be found.
 */
export function getOwnedItemById(itemId) {
  let item;
  game.actors.find(actor => {
    item = actor.items.find(i => i.id === itemId);
    return !!item;
  });
  return item;
}

/**
 * Deletes an item owned by a system actor based on the item id.
 */
export function deleteOwnedItem(itemId) {
  const item = getOwnedItemById(itemId);
  if (item && item.actor) {
    item.actor.deleteEmbeddedDocuments('Item', [itemId]);
  } else {
    console.error(
      `Delete of item id ${itemId} requested but unable to locate the actual item or its owner.`
    );
    ui.notifications.error(game.i18n.localize('bsh.errors.items.owned.notFound'));
  }
}

/**
 * Calculates a set of dynamic data values related to a character.
 * (But skips anything that does not have a `stories` field.)
 */
export function calculateCharacterData(context, configuration) {
  // First, pull out the “system” object. If context.actor exists, use actor.system;
  // otherwise use context.system. If neither is defined, sys will be undefined.
  const sys = context.actor?.system ?? context.system;

  // If sys is missing entirely, or sys.stories is undefined, bail out immediately.
  if (!sys || !sys.stories) return;

  // Now we know sys.stories exists, so it’s safe to recalculate level & attributes:
  sys.level            = calculateLevel(sys, configuration);
  sys.calculated       = calculateAttributeValues(sys, configuration);
  sys.maximumHitPoints = calculateMaximumHitPoints(sys, sys.level);
}

/**
 * This function calculates the final values for the character’s attribute values.
 */
export function calculateAttributeValues(data, configuration) {
  const calculated = {
    constitution: data.attributes.constitution,
    charisma:     data.attributes.charisma,
    dexterity:    data.attributes.dexterity,
    intelligence: data.attributes.intelligence,
    wisdom:       data.attributes.wisdom,
    strength:     data.attributes.strength
  };

  const backgroundNames = [
    data.backgrounds.first,
    data.backgrounds.second,
    data.backgrounds.third
  ].map(name => {
    if (name.includes('#')) {
      const parts = name.split('#');
      return parts[parts.length - 1];
    } else {
      return name;
    }
  });

  const backgrounds = [];
  backgroundNames.forEach(name => backgrounds.push(configuration.backgroundList[name]));

  backgrounds.forEach(e => {
    if (e && e.attributes) {
      for (const attribute in e.attributes) {
        calculated[attribute] += e.attributes[attribute];
      }
    }
  });

  Object.keys(data.stories).forEach(key => {
    const story = data.stories[key];
    if (
      story.improvements &&
      story.improvements.attributes &&
      story.improvements.attributes.granted
    ) {
      let attribute = story.improvements.attributes.first.choice;
      if (attribute in calculated) {
        calculated[attribute] += 1;
      }
      if (story.improvements.attributes.second) {
        attribute = story.improvements.attributes.second.choice;
        if (attribute in calculated) {
          calculated[attribute] += 1;
        }
      }
    }
  });

  Object.keys(calculated).forEach(key => {
    if (calculated[key] > 18) {
      calculated[key] = 18;
    }
  });

  return calculated;
}

/**
 * Calculates a character’s maximum hit points based on their constitution value and level.
 */
export function calculateMaximumHitPoints(context, level) {
  let total = context.calculated.constitution;
  if (level < 10) {
    total += level - 1;
  } else {
    total += 9;
  }
  return total;
}

/**
 * Calculates a character’s level based on the number of stories they have recorded against them.
 */
export function calculateLevel(data, configuration) {
  let totalStories = 0;
  const stories = data.stories;
  Object.keys(stories)
    .sort()
    .forEach(index => {
      if (stories[index].title && stories[index].title.trim() !== '') {
        totalStories++;
      }
    });
  return totalStories + 1;
}

/**
 * A convenience function for moving a die down along the usage die path.
 */
export function downgradeDie(die) {
  let newDie = null;
  switch (die) {
    case 'd4':
      newDie = 'exhausted';
      break;
    case 'd6':
      newDie = 'd4';
      break;
    case 'd8':
      newDie = 'd6';
      break;
    case 'd10':
      newDie = 'd8';
      break;
    case 'd12':
      newDie = 'd10';
      break;
    case 'd20':
      newDie = 'd12';
      break;
  }
  return newDie;
}

/**
 * Generates a string containing the formula for a single die based on the set of options passed in.
 * Recognized options include dieType (defaults to d20) and kind ('standard', 'advantage', 'disadvantage').
 */
export function generateDieRollFormula(options = {}) {
  let formula = null;
  const dieType = options.dieType ? options.dieType : 'd20';
  const kind    = options.kind ? options.kind : 'standard';

  switch (dieType) {
    case 'one':
      formula = '1';
      break;
    case 'd4':
    case 'd6':
    case 'd8':
    case 'd10':
    case 'd12':
    case 'd20':
      formula = `${dieType}`;
      break;
  }

  if (kind === 'advantage') {
    if (formula !== '1') {
      formula = `2${formula}kl`;
    } else {
      formula = '2';
    }
  } else if (kind === 'disadvantage') {
    if (formula !== '1') {
      formula = `2${formula}kh`;
    }
  } else {
    if (formula !== '1') {
      formula = `1${formula}`;
    }
  }

  return formula;
}

/**
 * Generates a string containing a formula for a damage dice roll.
 * Recognized options include critical (true/false) and doomed (true/false).
 */
export function generateDamageRollFormula(actor, weapon, options = {}) {
  let formula = null;
  let dieType = null;

  if (weapon.system.type !== 'unarmed') {
    dieType = actor.system.damageDice.armed;
  } else {
    dieType = actor.system.damageDice.unarmed;
  }

  formula = options.doomed ? `2${dieType}kl` : `1${dieType}`;
  if (weapon.system.hands > 1) {
    if (options.doomed) {
      formula = `1${dieType}`;
    } else {
      formula = `2${dieType}kh`;
    }
  }
  if (options.critical) {
    formula = `${formula}+${dieType.replace('d', '')}`;
  }
  return formula;
}

/**
 * This function provides functionality for rolling attribute tests (including advantage/disadvantage).
 */
export async function handleRollAttributeDieEvent(event) {
  const element = event.currentTarget;
  event.preventDefault();
  if (element.dataset.actor) {
    const actor = getActorById(element.dataset.actor);
    if (actor) {
      if (event.altKey) {
        const attribute = element.dataset.attribute;
        let rollType = 'standard';
        const title = game.i18n.localize(`bsh.rolls.tests.${attribute}.title`);
        if (event.shiftKey) {
          rollType = 'advantage';
        } else if (event.ctrlKey) {
          rollType = 'disadvantage';
        }
        showAttributeRollModal(actor, attribute, title, { rollType });
      } else {
        logAttributeTest(actor, element.dataset.attribute, event.shiftKey, event.ctrlKey);
      }
    } else {
      console.error(
        `Unable to locate an actor with the id ${element.dataset.actor} for attribute die roll.`
      );
      ui.notifications.error(game.i18n.localize('bsh.errors.actors.notFound'));
    }
  } else {
    console.error('Attribute die roll requested but requesting element has no actor id value.');
    ui.notifications.error(game.i18n.localize('bsh.errors.attributes.missing'));
  }
  return false;
}

/**
 * This function provides functionality for rolling a single die (including advantage/disadvantage).
 */
export async function handleRollDieEvent(event) {
  const element = event.currentTarget;
  const actor = game.actors.find(a => a.id === element.dataset.id);
  const title = game.i18n.localize(`bsh.fields.titles.dieRolls.${element.dataset.type}`);
  event.preventDefault();
  logDieRoll(actor, element.dataset.die, title, event.shiftKey, event.ctrlKey);
  return false;
}

/**
 * Routes a “usage die” roll either to an actor’s die or to an item’s die.
 */
export async function handleRollUsageDieEvent(event) {
  const element = event.currentTarget;
  if (element.dataset.actor) {
    return handleActorUsageDieRollEvent(event);
  } else if (element.dataset.item) {
    return handleItemUsageDieRollEvent(event);
  } else {
    console.error(
      'Roll usage die event occurred but source element does not have an actor or item reference id.'
    );
    ui.notifications.error(game.i18n.localize('bsh.errors.attributes.missing'));
  }
}

function handleActorUsageDieRollEvent(event) {
  const element = event.currentTarget;
  const actor = game.actors.find(a => a.id === element.dataset.actor);
  event.preventDefault();
  if (actor) {
    if (element.dataset.die) {
      const usageDie = getObjectField(element.dataset.die, actor.system);
      if (usageDie) {
        if (usageDie !== 'exhausted') {
          let message = '';
          rollEm(new Roll(`1${usageDie}`)).then(async roll => {
            await roll.toMessage({ speaker: ChatMessage.getSpeaker(), user: game.user.id });
            if (roll.total < 3) {
              const newDie = downgradeDie(usageDie);
              const data = setObjectField(element.dataset.die, newDie);
              actor.update(data, { diff: true });
              if (newDie !== 'exhausted') {
                message = interpolate(
                  game.i18n.localize('bsh.messages.usageDie.downgraded'),
                  { die: newDie }
                );
              } else {
                message = game.i18n.localize('bsh.messages.usageDie.exhausted');
              }
            } else {
              message = game.i18n.localize('bsh.messages.usageDie.unchanged');
            }
            ChatMessage.create({
              content: message,
              speaker: ChatMessage.getSpeaker(),
              user: game.user.id
            });
          });
        } else {
          console.warn(
            `Unable to roll usage die for actor id ${actor.id} as the particular usage die request is exhausted.`
          );
          ui.notifications.error(game.i18n.localize('bsh.errors.usageDie.exhausted'));
        }
      } else {
        console.error(
          `Unable to locate the ${element.dataset.die} usage die setting for actor id ${actor.id}.`
        );
        ui.notifications.error(game.i18n.localize('bsh.errors.attributes.invalid'));
      }
    } else {
      console.error('Usage die roll requested but requesting element has no die path attribute.');
      ui.notifications.error(game.i18n.localize('bsh.errors.attributes.missing'));
    }
  } else {
    console.error(`Unable to locate an actor with the id ${element.dataset.actor}.`);
    ui.notifications.error(game.i18n.localize('bsh.errors.actors.notFound'));
  }
  return false;
}

async function handleItemUsageDieRollEvent(event) {
  const element = event.currentTarget;
  const item = getOwnedItemById(element.dataset.item);
  event.preventDefault();
  if (item) {
    if (element.dataset.die) {
      logItemUsageDieRoll(item, element.dataset.die, event.shiftKey, event.ctrlKey);
    } else {
      console.error(
        'Usage die roll requested but requesting element has no die path attribute.'
      );
      ui.notifications.error(game.i18n.localize('bsh.errors.attributes.missing'));
    }
  } else {
    console.error(`Unable to locate an item with the id ${element.dataset.item}.`);
    ui.notifications.error(game.i18n.localize('bsh.errors.items.notFound'));
  }
  return false;
}

export async function handleWeaponRollEvent(event) {
  const element = event.currentTarget;
  event.preventDefault();
  if (element.dataset.item) {
    const weapon = getOwnedItemById(element.dataset.item);
    if (weapon) {
      if (weapon.actor) {
        logAttackRoll(weapon.actor.id, weapon.id, event.shiftKey, event.ctrlKey);
      } else {
        console.error(
          `Unable to make a weapon attack roll for weapon id '${weapon.id}' as it is not an owned item.`
        );
        ui.notifications.error(game.i18n.localize('bsh.errors.weapons.unowned'));
      }
    } else {
      console.error(`Unable to locate a weapon with an id of '${element.dataset.item}'.`);
      ui.notifications.error(game.i18n.localize('bsh.errors.weapons.notFound'));
    }
  } else {
    console.error(
      'Weapon attack roll requested but requesting element does not have an item id attribute.'
    );
    ui.notifications.error(game.i18n.localize('bsh.errors.attributes.missing'));
  }
  return false;
}

/**
 * This function resets the usage die for an item that has one.
 */
export async function resetItemUsageDie(itemId) {
  const item = getOwnedItemById(itemId);
  if (item) {
    if (item.system.quantity > 0) {
      const data = { system: { usageDie: { current: item.system.usageDie.maximum } } };
      item.update(data, { diff: true });
    } else {
      console.warn(
        `Unable to reset the usage die for owned item id '${itemId}' as it has a quantity of zero.`
      );
    }
  } else {
    console.error(`Unable to locate an owned item with the id '${itemId}'.`);
    ui.notifications.error(game.i18n.localize('bsh.errors.items.notFound'));
  }
}

/**
 * Reduces the quantity setting on an item that has one. Won't take an item quantity below zero.
 */
export async function decrementItemQuantity(itemId) {
  const item = getOwnedItemById(itemId);
  if (item) {
    if (item.system.quantity > 0) {
      const data = setObjectField('system.quantity', item.system.quantity - 1);
      item.update(data, { diff: true });
    } else {
      console.error(`Unable to reduce the quantity for owned item id '${itemId}'.`);
      ui.notifications.error(game.i18n.localize('bsh.errors.items.owned.unavailable'));
    }
  } else {
    console.error(`Unable to locate an owned item with the id '${itemId}'.`);
    ui.notifications.error(game.i18n.localize('bsh.errors.items.owned.notFound'));
  }
}

/**
 * Increases the quantity setting on an item that has one.
 */
export async function incrementItemQuantity(itemId) {
  const item = getOwnedItemById(itemId);
  if (item) {
    const data = setObjectField('system.quantity', item.system.quantity + 1);
    item.update(data, { diff: true });
  } else {
    console.error(`Unable to locate an owned item with the id '${itemId}'.`);
    ui.notifications.error(game.i18n.localize('bsh.errors.items.owned.notFound'));
  }
}

/**
 * A function that combines localization of a message with interpolation of context-specific details.
 * The localized string can have placeholders within its content that consist of a name enclosed in
 * '%' characters. The function also accepts a context parameter that is expected to be an object.
 */
export function interpolate(key, context = {}) {
  let text = game.i18n.localize(key);
  for (const name in context) {
    while (text.includes(`%${name.toUpperCase()}%`)) {
      text = text.replace(`%${name.toUpperCase()}%`, `${context[name]}`);
    }
  }
  return text;
}

/**
 * Fetch a value from a JS object using a path. A path is a string containing a dot-separated list
 * of field names. If any part of the path is missing, returns null.
 */
export function getObjectField(path, object) {
  let value = null;
  if (object) {
    let currentObject = object;
    const steps = path.split('.');
    steps.forEach(field => {
      if (currentObject) {
        if (currentObject[field] !== undefined) {
          currentObject = currentObject[field];
        } else {
          currentObject = null;
        }
      }
    });
    value = currentObject;
  }
  return value;
}

/**
 * Event handler that pops up an information dialog when an info icon is clicked.
 */
export function onInfoIconClicked(event) {
  const icon = event.currentTarget;
  let content = icon.dataset.content.trim();
  if (content === '') {
    content = game.i18n.localize('bsh.creatures.actions.info.noDescription');
  }
  content = `<div class="bsh-action-description">${content}<div><br>`;
  Dialog.prompt({
    callback: () => {},
    content: content,
    label: game.i18n.localize('bsh.creatures.actions.info.dismiss'),
    title: game.i18n.localize('bsh.creatures.actions.info.title')
  });
}

/**
 * A function to encapsulate integration with the Dice So Nice module. Takes a Roll instance,
 * evaluates it (asynchronously), shows the dice on screen if available, and returns the Roll.
 */
export async function rollEm(dice) {
  const roll = await dice.evaluate();
  if (game.dice3d) {
    game.dice3d.showForRoll(roll);
  }
  return roll;
}

/**
 * Constructs or sets a nested value on an object given a dot-separated path string.
 */
export function setObjectField(path, value, object = null) {
  const rootObject = object || {};
  let currentObject = rootObject;
  const steps = path.split('.');
  for (let i = 0; i < steps.length; i++) {
    if (i !== steps.length - 1) {
      if (!currentObject[steps[i]]) {
        currentObject[steps[i]] = {};
      }
      currentObject = currentObject[steps[i]];
    } else {
      currentObject[steps[i]] = value;
    }
  }
  return rootObject;
}

/**
 * Converts an input value into a 'key'. Trims whitespace, replaces spaces with underscores,
 * and converts to lowercase.
 */
export function stringToKey(text) {
  return `${text}`.trim().replaceAll(/\s+/g, '_').toLowerCase();
}

/**
 * Capitalizes and returns an input string.
 */
export function capitalize(text) {
  return `${text.substring(0, 1).toUpperCase()}${text.substring(1)}`;
}

/**
 * Displays a dialog that allows for manual control over an attribute test roll.
 */
export async function showAttributeRollModal(actor, attribute, title, options = {}) {
  AttributeTestDialog.build(actor, attribute, options).then(dialog => dialog.render(true));
}
