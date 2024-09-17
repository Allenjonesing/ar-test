const costSavingMode = true;
const genericEnemyBase64 = 'na';
const genericPlayerBase64 = 'na';
const version = 'Alpha v0.1';

let enemyImageBase64 = '';
let npcBase64image = '';
let monsterDescription = '';
let battleEnded = false;

async function loadGameData() {
  try {
    const response = await fetch('./Info.json'); // Fetch the JSON file from the same directory
    if (!response.ok) throw new Error('Failed to load game data.');
    gameData = await response.json();
    console.log("Game data loaded: ", gameData);
    return gameData;
  } catch (error) {
    console.error('Error loading game data:', error);
  }
}

class BattleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BattleScene' });
    this.helpMessages = [];
    this.loadingIndicator = null;
  }

  async create(data) {
    await loadGameData();

    newsData = structureNewsData([
      {
        title: 'Local Hero Saves Cat from Tree',
        description: 'A brave individual scaled a tall oak tree to rescue a cat stuck for hours.',
        url: 'https://mocknews.com/hero-saves-cat'
      },
      {
        title: 'Mysterious Lights Spotted Over City',
        description: 'Residents reported seeing strange, glowing lights hovering over downtown.',
        url: 'https://mocknews.com/mysterious-lights'
      }
    ]);

    // Simulated AI response for the setting and persona
    personas = [
      { name: "Luna", description: "A mysterious warrior with ice powers" },
      { name: "Darius", description: "A fire mage from the mountains" }
    ];
    persona = personas[0]; // Select the first persona

    // Simulated monster description generation
    monsterDescription = "A towering ice golem with the ability to freeze its surroundings.";

    // Assign a generic NPC image
    npcBase64image = `data:image/png;base64,${genericPlayerBase64}`;

    // Randomly select a location
    const randomLocation = gameData.Locations[Math.floor(Math.random() * gameData.Locations.length)];
    this.selectedLocation = randomLocation;

    // Randomly select a hero and multiple enemies from the selected location
    const hero = randomLocation.Heros[Math.floor(Math.random() * randomLocation.Heros.length)];
    console.log('hero: ', hero);
    this.enemyObjects = randomLocation.Enemies.slice(0, 5); // Choose 5 small enemies
    console.log('this.enemyObjects: ', this.enemyObjects);
    this.bossObject = randomLocation.Bosses[Math.floor(Math.random() * randomLocation.Bosses.length)]; // Select 1 boss
    console.log('this.bossObject: ', this.bossObject);

    // Create player and set random hero from JSON data
    this.playerObject = {
      name: 'Player',
      description: `${hero.Name}, ${hero.Description}`,
      health: hero.Stats.health,
      mana: hero.Stats.mana,
      atk: hero.Stats.atk,
      def: hero.Stats.def,
      spd: hero.Stats.spd,
      eva: hero.Stats.eva,
      magAtk: hero.Stats.magAtk,
      magDef: hero.Stats.magDef,
      luk: hero.Stats.luk,
      wis: hero.Stats.wis,
      sprite: null,
      actions: ['Attack', 'Defend', 'Spells', 'Skills'],
      element: hero.Stats.element,
      statusEffects: [],
      immunities: hero.Stats.immunities || [],
      Experience: {
        atkXP: 0,
        defXP: 0,
        spdXP: 0,
        magAtkXP: 0
      },
      KnownSkills: [
        { name: "Slash", requiredLevel: 1, type: "physical", description: "A basic physical attack." }
      ],
      Level: 1
    };

    // Create enemies group and add small enemies
    this.formattedEnemyObjects = [];
    console.log('this.formattedEnemyObjects: ', this.formattedEnemyObjects);
    this.enemyObjects.forEach((enemyData, index) => {
      console.log('enemyData: ', enemyData);
      let enemyObject = {
        name: 'Enemy',
        description: `${enemyData.Name}, ${enemyData.Description}`,
        health: enemyData.Stats.health,
        mana: enemyData.Stats.mana,
        atk: enemyData.Stats.atk,
        def: enemyData.Stats.def,
        spd: enemyData.Stats.spd,
        eva: enemyData.Stats.eva,
        magAtk: enemyData.Stats.magAtk,
        magDef: enemyData.Stats.magDef,
        luk: enemyData.Stats.luk,
        wis: enemyData.Stats.wis,
        sprite: null,
        element: enemyData.Stats.element, // Example element multipliers
        learnedElementalWeaknesses: {
          fire: 0,
          ice: 0,
          water: 0,
          lightning: 0,
          physical: 0 // Track physical attack damage
        },
        learnedStatusImmunities: [],
        triedElements: {
          fire: false,
          ice: false,
          water: false,
          lightning: false,
          physical: false
        },
        statusEffects: [],
        immunities: enemyData.Stats.immunities || []
      };
      console.log('enemyObject: ', enemyObject);

      this.formattedEnemyObjects.push(enemyObject);
      console.log('this.formattedEnemyObjects: ', this.formattedEnemyObjects);
    });


    // Add the boss at the end of the fight
    this.formattedBossObject = {
      name: 'Enemy',
      description: `${this.bossObject.Name}, ${this.bossObject.Description}`,
      health: this.bossObject.Stats.health,
      mana: this.bossObject.Stats.mana,
      atk: this.bossObject.Stats.atk,
      def: this.bossObject.Stats.def,
      spd: this.bossObject.Stats.spd,
      eva: this.bossObject.Stats.eva,
      magAtk: this.bossObject.Stats.magAtk,
      magDef: this.bossObject.Stats.magDef,
      luk: this.bossObject.Stats.luk,
      wis: this.bossObject.Stats.wis,
      sprite: null,
      element: this.bossObject.Stats.element, // Example element multipliers
      learnedElementalWeaknesses: {
        fire: 0,
        ice: 0,
        water: 0,
        lightning: 0,
        physical: 0 // Track physical attack damage
      },
      learnedStatusImmunities: [],
      triedElements: {
        fire: false,
        ice: false,
        water: false,
        lightning: false,
        physical: false
      },
      statusEffects: [],
      immunities: this.bossObject.Stats.immunities || []
    };
    console.log('this.formattedBossObject: ', this.formattedBossObject);

    // Spawn enemies after data is ready
    this.spawnEnemies();

    this.scale.on('resize', this.resize, this), null, this.selectedLocation;

    this.enemy.actions = this.generateEnemyActions(this.enemy);

    // Generate enemy image based on news article and setting
    if (newsData.length > 0) {
      enemyImageBase64 = enemyImageBase64 || genericEnemyBase64 || 'asdf';
      // Initialize turn order and current turn index
      this.turnOrder = this.calculateTurnOrder();
      this.currentTurnIndex = 0;

      // Cooldown flag
      this.isCooldown = false;

      // Display UI elements
      this.createUI(this.selectedLocation);

      // Check whose turn it is and start the action immediately if it's the enemy's turn
      if (this.turnOrder[this.currentTurnIndex].name === 'Enemy') {
        this.enemyAction();
      } else {
        this.showPlayerActions();
      }
    }
  }

  spawnEnemies() {
    // Start the battle with the first enemy and progress through the list
    console.log('spawnEnemies: ');
    this.currentEnemyIndex = 0;

    this.battleSequence();
  }

  battleSequence() {
    console.log('battleSequence this.player: ', this.player);
    console.log('battleSequence this.playerObject: ', this.playerObject);
    console.log('battleSequence this.currentEnemyIndex: ', this.currentEnemyIndex);
    console.log('battleSequence this.enemyObjects.length: ', this.enemyObjects.length);
    if (this.currentEnemyIndex < this.formattedEnemyObjects.length) {
      console.log('this.currentEnemyIndex: ', this.currentEnemyIndex);
      let currentEnemy = this.formattedEnemyObjects[this.currentEnemyIndex];
      console.log('Starting Enemy Battle');
      console.log('currentEnemy: ', currentEnemy);
      this.player = this.playerObject;
      this.enemy = currentEnemy;

      console.log('Started Enemy Battle');
      // Transition to the next enemy after battle ends
      this.currentEnemyIndex++;
    } else {
      // After all small enemies, fight the boss
      console.log('this.formattedBossObject: ', this.formattedBossObject);
      console.log('Starting BOSS Battle');
      this.player = this.playerObject;
      this.enemy = this.formattedBossObject;

      console.log('Started BOSS Battle');
    }

    if (this.enemyHealthText) {

      this.enemy.actions = this.generateEnemyActions(this.enemy);

      this.enemyHealthText.setText(`Health: ${this.enemy.health}`);
      this.enemyManaText.setText(`Mana: ${this.enemy.mana}`);
      this.enemyDescription.setText(`${this.enemy.name}: ${this.enemy.description}`);
      this.turnOrder = this.calculateTurnOrder();
      this.currentTurnIndex = 0;

      // Cooldown flag
      this.isCooldown = false;

      // Display UI elements
      this.createUI(this.selectedLocation);

      // Check whose turn it is and start the action immediately if it's the enemy's turn
      if (this.turnOrder[this.currentTurnIndex].name === 'Enemy') {
        this.enemyAction();
      } else {
        this.showPlayerActions();
      }
    }

  }

  showLoadingIndicator() {
    this.loadingIndicator = this.add.text(this.scale.width / 2, this.scale.height / 2, 'Loading...', {
      fontSize: '32px',
      fill: '#fff',
      backgroundColor: '#000',
      padding: { left: 10, right: 10, top: 10, bottom: 10 }
    }).setOrigin(0.5);

    this.tweens.add({
      targets: this.loadingIndicator,
      alpha: { from: 1, to: 0.3 },
      duration: 500,
      yoyo: true,
      repeat: -1
    });
  }

  hideLoadingIndicator() {
    if (this.loadingIndicator) {
      this.loadingIndicator.destroy();
      this.loadingIndicator = null;
    }
  }

  addHelpText(message) {
    this.helpMessages.push(message);
    if (this.helpMessages.length > 3) {
      this.helpMessages.shift(); // Remove the oldest message if we have more than 3
    }
    this.updateHelpTextDisplay();
  }

  updateHelpTextDisplay() {
    if (this.helpMessages && Array.isArray(this.helpMessages)) {
      this.helpText.setText(this.helpMessages.join('\n'));
    } else {
      this.helpText.setText('');
    }
  }

  resize(gameSize, baseSize, displaySize, resolution, randomLocation) {
    let width = gameSize.width;
    let height = gameSize.height;

    if (width === undefined) { width = this.sys.game.config.width; }
    if (height === undefined) { height = this.sys.game.config.height; }

    this.cameras.resize(width, height);

    // Adjust other elements like UI, if necessary
    this.createUI(this.selectedLocation); // Recreate the UI on resize
  }

  generateEnemyActions(stats) {
    console.log('generateEnemyActions... stats: ', stats);
    let actions = {
      physical: ['Attack'],
      skills: [],
      magic: []
    };

    // Determine if attack is far greater than magic attack or vice versa
    console.log('generateEnemyActions... stats.magAtk: ', stats.magAtk);
    console.log('generateEnemyActions... stats.atk: ', stats.atk);
    const isPhysicalOnly = stats.atk > 2 * stats.magAtk;
    const isMagicOnly = stats.magAtk > 2 * stats.atk;
    console.log('generateEnemyActions... isPhysicalOnly: ', isPhysicalOnly);
    console.log('generateEnemyActions... isMagicOnly: ', isMagicOnly);

    // Add skills if atk is high and not exclusively magic
    if (!isMagicOnly) {
      console.log('generateEnemyActions... stats.element.fire: ', stats.element.fire);
      if (stats.element.fire <= 0) actions.skills.push('Burn');
      console.log('generateEnemyActions... stats.element.ice: ', stats.element.ice);
      if (stats.element.ice <= 0) actions.skills.push('Freeze');
      console.log('generateEnemyActions... stats.element.lightning: ', stats.element.lightning);
      if (stats.element.lightning <= 0) actions.skills.push('Stun');
      console.log('generateEnemyActions... stats.element.water: ', stats.element.water);
      if (stats.element.water <= 0) actions.skills.push('Poison');
    }
    console.log('generateEnemyActions... actions.skills: ', actions.skills);

    // Add magic attacks based on elemental strengths and not exclusively physical
    if (!isPhysicalOnly) {
      // Add more magic attacks if magAtk is high
      if (stats.magAtk > stats.atk) {
        console.log('generateEnemyActions... stats.element.fire: ', stats.element.fire);
        console.log('generateEnemyActions... stats.element.ice: ', stats.element.ice);
        console.log('generateEnemyActions... stats.element.lightning: ', stats.element.lightning);
        console.log('generateEnemyActions... stats.element.water: ', stats.element.water);
        if (stats.element.fire <= 0) actions.magic.push('fire');
        if (stats.element.ice <= 0) actions.magic.push('ice');
        if (stats.element.lightning <= 0) actions.magic.push('lightning');
        if (stats.element.water <= 0) actions.magic.push('water');
      }
    }
    console.log('generateEnemyActions... actions.magic: ', actions.magic);
    console.log('generateEnemyActions... actions: ', actions);

    return actions;
  }

  update() {
    if (!battleEnded) {
      if (this.player && this.player.health <= 0) {
        this.endBattle('lose');
      } else if (this.enemy && this.enemy.health <= 0) {
        battleEnded = true;
        this.endBattle('win');
      }
    }
  }

  saveGameState() {
    const gameData = getGameState();  // Fetch current game state
    saveGame('save1', gameData);      // Save to IndexedDB
    console.log('Game saved after battle.');
  }


  endBattle(result) {
    battleEnded = true;
    this.time.delayedCall(1000, () => {
      if (result === 'win') {
        // Handle victory logic
        this.addHelpText('You Won! Gaining XP...');
        this.enemy.sprite.visible = false; // Remove enemy sprite

        // Save the game state
        this.saveGameState();

        // Trigger the next battle in the sequence
        this.time.delayedCall(3000, () => {
          battleEnded = false;
          this.battleSequence();
        }, [], this);

      } else {
        // Handle defeat logic
        this.addHelpText('You Lost! Game Over... Please wait for the window to reload...');
        this.player.sprite.destroy(); // Remove player sprite
        this.time.delayedCall(5000, () => {
          // Refresh the whole page after the battle ends
          location.reload();
        }, [], this);
      }
    }, [], this);
  }

  checkForLevelUp() {
    // Check if the player has enough XP to level up
    const XP_THRESHOLD = 100; // Example XP threshold for leveling up

    if (this.player.Experience.atkXP >= XP_THRESHOLD) {
      this.player.Level++;
      this.player.Experience.atkXP -= XP_THRESHOLD;  // Carry over excess XP

      console.log(`You've leveled up! Now level: ${this.player.Level}`);

      // Trigger skill selection
      this.displayLevelUpScreen();  // Allow player to choose new skills/spells
    }
  }

  createUI(location) {
    // Clear existing UI elements if any
    if (this.uiContainer) {
      this.uiContainer.destroy(true);
    }

    // Create a container for all UI elements
    this.uiContainer = this.add.container(0, 0);

    // Set padding and element dimensions
    const padding = this.scale.width / 15;
    const topMargin = 200;
    const elementHeight = 30;
    const actionButtonHeight = 50;
    const halfWidth = this.scale.width / 2;

    // Help text at the very top
    this.helpText = this.add.text(padding, padding, '', {
      fontSize: '24px',
      fill: '#fff',
      wordWrap: { width: this.scale.width - 2 * padding }
    });
    this.uiContainer.add(this.helpText);
    this.addHelpText(`A battle has begun.`);

    // Player health and mana
    this.playerHealthText = this.add.text(padding, topMargin + elementHeight, `Health: ${this.player.health}`, { fontSize: '26px', fill: '#fff' });
    this.playerManaText = this.add.text(padding, topMargin + elementHeight * 2, `Mana: ${this.player.mana}`, { fontSize: '20px', fill: '#fff' });

    // Enemy health and mana
    this.enemyHealthText = this.add.text(this.scale.width - padding - 200, topMargin + elementHeight, `Health: ${this.enemy.health}`, { fontSize: '26px', fill: '#fff' });
    this.enemyManaText = this.add.text(this.scale.width - padding - 200, topMargin + elementHeight * 2, `Mana: ${this.enemy.mana}`, { fontSize: '20px', fill: '#fff' });

    // Add borders around health and mana areas
    const playerHealthBox = this.add.graphics().lineStyle(2, 0x00ff00).strokeRect(padding - 10, topMargin + elementHeight - 10, 200, 75);
    const enemyHealthBox = this.add.graphics().lineStyle(2, 0xff0000).strokeRect(this.scale.width - padding - 210, topMargin + elementHeight - 10, 200, 75);
    this.uiContainer.add(playerHealthBox);
    this.uiContainer.add(enemyHealthBox);

    // Player and enemy sprites
    this.player.sprite = this.add.sprite(padding + 100, topMargin + elementHeight * 10 + 50, 'npcBase64image'); // Adjust position as necessary
    this.enemy.sprite = this.add.sprite(this.scale.width - padding - 100, topMargin + elementHeight * 10 + 50, 'enemyImageBase64'); // Adjust position as necessary

    // Add hover animations
    this.add.tween({
      targets: this.player.sprite,
      y: this.player.sprite.y - 10,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.add.tween({
      targets: this.enemy.sprite,
      y: this.enemy.sprite.y - 10,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.uiContainer.add(this.player.sprite);
    this.uiContainer.add(this.enemy.sprite);

    // Player and enemy names and descriptions
    this.playerDescriptionText = `${this.player.name}: ${this.player.description}`;
    this.enemyDescriptionText = `${this.enemy.name}: ${this.enemy.description}`;

    this.playerDescription = this.add.text(padding, this.scale.height / 2, this.playerDescriptionText, { fontSize: '24px', fill: '#fff', wordWrap: { width: 200 } });
    this.enemyDescription = this.add.text(this.scale.width - padding - 200, this.scale.height / 2, this.enemyDescriptionText, { fontSize: '24px', fill: '#fff', wordWrap: { width: 200 } });

    // Add borders around descriptions
    this.playerDescriptionBox = this.add.graphics().lineStyle(2, 0x00ff00).strokeRect(padding - 10, this.scale.height / 2, 200, this.playerDescription.height + 20);
    this.enemyDescriptionBox = this.add.graphics().lineStyle(2, 0xff0000).strokeRect(this.scale.width - padding - 210, this.scale.height / 2, 200, this.enemyDescription.height + 20);
    this.uiContainer.add(this.playerDescriptionBox);
    this.uiContainer.add(this.enemyDescriptionBox);

    this.uiContainer.add(this.playerDescription);
    this.uiContainer.add(this.enemyDescription);

    // Turn order list
    this.turnOrderText = this.add.text(this.scale.width / 2, this.scale.height / 2, 'Turns:', { fontSize: '36px', fill: '#fff' }).setOrigin(0.5);
    this.updateTurnOrderDisplay();

    // Add elements to the UI container
    this.uiContainer.add([this.playerHealthText, this.playerManaText, this.enemyHealthText, this.enemyManaText, this.turnOrderText]);

    // Action buttons at the bottom
    this.actions = this.add.group();
    const actionNames = ['Attack', 'Defend', 'Spells', 'Skills', 'Heal'];
    const actionButtonWidth = (this.scale.width - padding * 2) / 5;

    actionNames.forEach((actionName, index) => {
      const x = (padding + halfWidth) - (actionNames.length * actionButtonWidth) / 2 + index * actionButtonWidth;
      const actionText = this.add.text(x, this.scale.height - actionButtonHeight - padding, actionName, {
        fontSize: '30px',
        fill: '#fff',
        backgroundColor: '#000',
        padding: { left: 20, right: 20, top: 10, bottom: 10 }
      }).setOrigin(0.5);
      actionText.setInteractive();
      actionText.on('pointerdown', () => this.handlePlayerAction(actionName));
      this.actions.add(actionText);
      this.uiContainer.add(actionText);
    });

    // Add animation and colorful effect to action buttons
    this.actions.children.iterate(actionText => {
      this.tweens.add({
        targets: actionText,
        scaleX: 1.1,
        scaleY: 1.1,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: 'Power1'
      });
    });

    // Add action box around action buttons
    this.actionBox = this.add.graphics().lineStyle(2, 0xffff00).strokeRect(padding, this.scale.height - actionButtonHeight - padding * 2, this.scale.width - padding * 2, actionButtonHeight + padding);
    this.uiContainer.add(this.actionBox);
  }

  chooseElement() {
    const elements = ['fire', 'ice', 'water', 'lightning'];
    return elements[Math.floor(Math.random() * elements.length)];
  }

  calculateTurnOrder() {
    let participants = [
      { name: 'Player', speed: this.player.spd, sprite: this.player.sprite },
      { name: 'Enemy', speed: this.enemy.spd, sprite: this.enemy.sprite }
    ];

    let turnOrder = [];
    let currentTime = [0, 0]; // Initialize current times for both participants
    let totalTurns = 0;

    // Calculate the total number of turns based on the highest speed
    let totalParticipantTurns = 100; // Arbitrary large number to ensure enough turns are calculated
    for (let i = 0; i < totalParticipantTurns; i++) {
      let nextTurnIndex = currentTime[0] / participants[0].speed <= currentTime[1] / participants[1].speed ? 0 : 1;
      turnOrder.push(participants[nextTurnIndex]);
      currentTime[nextTurnIndex] += 1; // Increment the chosen participant's elapsed time
      totalTurns++;
    }

    return turnOrder;
  }

  updateTurnOrderDisplay() {
    if (this.turnOrderList) {
      this.turnOrderList.destroy();
    }

    let orderText = '';
    for (let i = 0; i < 10; i++) {
      orderText += `${this.turnOrder[(this.currentTurnIndex + i) % this.turnOrder.length].name}\n`;
    }

    this.turnOrderList = this.add.text(this.scale.width / 2, this.scale.height / 2 + 200, orderText, { fontSize: '30px', fill: '#fff' }).setOrigin(0.5);

    this.turnOrderList.alpha = 0;
    this.tweens.add({
      targets: this.turnOrderList,
      alpha: 1,
      duration: 500,
      ease: 'Power1'
    });
  }

  applyHealingEffect(target) {
    let healingLight = this.add.graphics();
    healingLight.fillStyle(0x00ff00, 0.5); // Green color with some transparency
    healingLight.fillCircle(target.sprite.x, target.sprite.y, 50);
    this.tweens.add({
      targets: healingLight,
      alpha: { from: 1, to: 0 },
      duration: 1000,
      ease: 'Power1',
      onComplete: () => {
        healingLight.destroy();
      }
    });
  }

  applyEffect(target, color) {
    let effectLight = this.add.graphics();
    effectLight.fillStyle(color, 0.5);
    effectLight.fillCircle(target.x, target.y, 50);
    this.tweens.add({
      targets: effectLight,
      alpha: { from: 1, to: 0 },
      duration: 1000,
      ease: 'Power1',
      onComplete: () => {
        effectLight.destroy();
      }
    });
  }

  handlePlayerAction(action, elementType = null) {
    this.hideSubOptions(); // Ensure sub-options are hidden when a main action is chosen

    if (!this.isCooldown && this.turnOrder[this.currentTurnIndex].name === 'Player') {
      let damage = 0;
      let healing = 0;
      let critical = false;

      if (action === 'Spells' && !elementType) {
        this.showElementSelection();
        return;
      }

      if (action === 'Attack') {
        damage = this.calculateDamage(this.player.atk, this.enemy.def, this.player.luk, this.enemy.eva, this.player.acc, this.enemy);
        this.addHelpText(`Player attacks! ${critical ? 'Critical hit! ' : ''}Deals ${damage} damage.`);

        this.playAttackAnimation(this.player.sprite, this.enemy.sprite);
      } else if (action === 'Spells') {
        if (this.player.mana >= 10) {
          // Use calculateMagicDamageZ with wisdom (wis) and acc
          damage = this.calculateMagicDamage(this.player.magAtk, this.enemy.magDef, this.player.element[elementType], this.enemy.element[elementType], this.player.wis, this.enemy.wis);
          this.player.mana -= 10;
          this.addHelpText(`Player uses ${elementType} Spells! ${critical ? 'Critical hit! ' : ''}Deals ${damage} damage.`);

          this.playMagicAttackAnimation(this.player, this.enemy, elementType, damage, critical, this.enemy.element[elementType]);
        } else {
          this.addHelpText("Not enough mana!");
          return;
        }
      } else if (action === 'Defend') {
        this.player.def *= 4; // Temporary defense boost
        this.player.isDefending = true;
        this.addHelpText('Player defends, boosting defense for this turn.');
      } else if (action === 'Skills') {
        this.showSkillSelection();
        return;
      } else if (action === 'Heal') {
        if (this.player.mana >= 15) {
          // Use calculateHealingZ for the healing calculation
          healing = this.calculateHealing(this.player.magAtk);
          this.player.mana -= 15;
          this.player.health += healing;
          this.addHelpText(`Player uses Heal! Restores ${healing} health.`);
          this.showDamageIndicator(this.player, -healing, critical);
          this.applyHealingEffect(this.player);
        } else {
          this.addHelpText("Not enough mana!");
          return;
        }
      }

      // Update health and mana displays
      this.playerHealthText.setText(`Health: ${this.player.health}`);
      this.enemyHealthText.setText(`Health: ${this.enemy.health}`);
      this.playerManaText.setText(`Mana: ${this.player.mana}`);
      this.startCooldown();
      this.hidePlayerActions();
    }
  }

  calculateHealing(magAtk) {
    let variance = Phaser.Math.FloatBetween(0.9, 1.1);
    let baseHealing = Math.floor((4 * magAtk + 200) * variance);
    return Math.max(1, baseHealing); // Ensure minimum healing is 1
  }

  showSkillSelection() {
    this.hideSubOptions(); // Hide any existing sub-options

    const skills = ['Poison', 'Stun', 'Burn', 'Freeze']; // Example status effects
    this.skillButtons = this.add.group();

    // Create a new action box for skills above the original action box
    const skillBoxY = this.scale.height - 200 - 50; // Adjust as necessary
    const skillBoxWidth = this.scale.width - 40; // Adjust as necessary
    this.skillBox = this.add.graphics().lineStyle(2, 0x00ff00).strokeRect(20, skillBoxY, skillBoxWidth, 50);

    // Add skill buttons to the new action box
    skills.forEach((skill, index) => {
      const elementWidth = (this.scale.width - 100) / skills.length;
      const x = 100 + index * elementWidth; // Adjust spacing as necessary
      const skillText = this.add.text(x, skillBoxY + 25, skill, {
        fontSize: '30px',
        fill: '#fff',
        backgroundColor: '#000',
        padding: { left: 10, right: 10, top: 5, bottom: 5 }
      }).setOrigin(0.5);
      skillText.setInteractive();
      skillText.on('pointerdown', () => {
        this.playAttackAnimation(this.player.sprite, this.enemy.sprite);
        this.applyStatusEffect('Player', 'Enemy', skill);
        this.skillButtons.clear(true, true);
        this.startCooldown();
        this.hidePlayerActions();
        this.skillBox.destroy();
      });
      this.skillButtons.add(skillText);

      // Add animation and colorful effect
      this.tweens.add({
        targets: skillText,
        scaleX: 1.1,
        scaleY: 1.1,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: 'Power1'
      });
    });
  }

  showElementSelection() {
    this.hideSubOptions(); // Hide any existing sub-options

    const elements = ['Fire', 'Ice', 'Water', 'Lightning'];
    this.elementButtons = this.add.group();

    // Create a new action box for elements above the original action box
    const elementBoxY = this.scale.height - 200 - 50; // Adjust as necessary
    const elementBoxWidth = this.scale.width - 40; // Adjust as necessary
    this.elementBox = this.add.graphics().lineStyle(2, 0x00ff00).strokeRect(20, elementBoxY, elementBoxWidth, 50);

    // Add element buttons to the new action box
    elements.forEach((element, index) => {
      const elementWidth = (this.scale.width - 100) / elements.length;
      const x = 100 + index * elementWidth; // Adjust spacing as necessary
      const elementText = this.add.text(x, elementBoxY + 25, element, {
        fontSize: '30px',
        fill: '#fff',
        backgroundColor: '#000',
        padding: { left: 10, right: 10, top: 5, bottom: 5 }
      }).setOrigin(0.5);
      elementText.setInteractive();
      elementText.on('pointerdown', () => {
        this.handlePlayerAction('Spells', element.toLowerCase());
        this.elementButtons.clear(true, true);
        this.elementBox.destroy();
      });
      this.elementButtons.add(elementText);

      // Add animation and colorful effect
      this.tweens.add({
        targets: elementText,
        scaleX: 1.1,
        scaleY: 1.1,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: 'Power1'
      });
    });
  }

  hideSubOptions() {
    if (this.skillButtons) {
      this.skillBox.clear();
      this.skillButtons.clear(true, true);
    }
    if (this.elementButtons) {
      this.elementBox.clear();
      this.elementButtons.clear(true, true);
    }
  }

  enemyAction() {
    console.log('enemyAction...');
    console.log('performEnemyAction... this.turnOrder[this.currentTurnIndex].name: ', this.turnOrder[this.currentTurnIndex].name);

    if (this.turnOrder[this.currentTurnIndex].name === 'Enemy') {
      const performEnemyAction = () => {
        console.log('performEnemyAction...');
        console.log('performEnemyAction... this.isCooldown: ', this.isCooldown);

        if (!this.isCooldown) {
          let damage = 0;
          let critical = false;
          let actionType;
          let action;
          let highestDamage = 0;
          let bestElement = 'physical';

          // Periodically reset tried attacks and skills
          // Ensure triedElements are initialized properly
          if (!this.enemy.triedElements || this.enemy.triedElements.resetCounter >= 5) {
            this.enemy.triedElements = {
              magic: [],
              skills: [],
              physical: false, // Track whether the enemy has tried physical attacks
              resetCounter: 0
            };
          } else {
            this.enemy.triedElements.magic = this.enemy.triedElements.magic || [];
            this.enemy.triedElements.skills = this.enemy.triedElements.skills || [];
            this.enemy.triedElements.physical = this.enemy.triedElements.physical || false; // Default to false if undefined
          }

          console.log('Current triedElements:', this.enemy.triedElements);

          // Get valid actions
          const validMagic = this.enemy.actions.magic || [];
          const validSkills = this.enemy.actions.skills || [];

          // Find untried magic, skills, and check if physical has been tried
          const untriedMagic = validMagic.find(magic => !this.enemy.triedElements.magic.includes(magic));
          const untriedSkill = validSkills.find(skill => !this.enemy.triedElements.skills.includes(skill));
          const untriedPhysical = !this.enemy.triedElements.physical;

          if (untriedMagic) {
            // Prioritize untried magic
            actionType = 'magic';
            action = untriedMagic;
            this.enemy.triedElements.magic.push(action); // Mark as tried
          } else if (untriedSkill) {
            // If no untried magic, try untried skill
            actionType = 'skills';
            action = untriedSkill;
            this.enemy.triedElements.skills.push(action); // Mark as tried
          } else if (untriedPhysical) {
            // If no untried magic or skills, try physical attack
            actionType = 'physical';
            action = 'Attack';
            this.enemy.triedElements.physical = true; // Mark physical attack as tried
          } else {
            // All magic, skills, and physical attacks have been tried, fallback to best attack based on known weaknesses
            for (const [element, dmg] of Object.entries(this.enemy.learnedElementalWeaknesses)) {
              if (dmg > highestDamage) {
                highestDamage = dmg;
                bestElement = element;
              }
            }

            if (bestElement === 'physical') {
              actionType = 'physical';
              action = 'Attack';
            } else {
              actionType = 'magic';
              action = bestElement;
            }
          }

          // Log the selected action
          console.log('Enemy action selected:', actionType, action);

          // Execute the selected action
          this.executeEnemyAction(actionType, action, damage, critical, bestElement);

          // Update mana and reset counter if needed
          this.enemyManaText.setText(`Mana: ${this.enemy.mana}`);
          this.startCooldown();

        } else {
          console.log('Delaying Call to performEnemyAction...');
          this.time.delayedCall(200, performEnemyAction, [], this);
        }
      };

      performEnemyAction();
    } else {
      console.error('It is not currently the enemy\'s turn');
    }
  }

  // Helper method to handle execution of the action
  executeEnemyAction(actionType, action, damage, critical, bestElement) {
    if (actionType === 'physical') {
      // Physical attack
      damage = this.calculateDamage(this.enemy.atk, this.player.def, this.enemy.wis, this.player.eva, this.enemy.acc, this.player);
      this.addHelpText(`Enemy attacks! ${critical ? 'Critical hit! ' : ''}Deals ${damage} damage.`);
      this.playAttackAnimation(this.enemy.sprite, this.player.sprite);
      this.enemy.learnedElementalWeaknesses.physical = Math.max(this.enemy.learnedElementalWeaknesses.physical, damage);
    } else if (actionType === 'magic') {
      if (this.enemy.mana >= 10) {
        // Magic attack
        const elementType = action;
        damage = this.calculateMagicDamage(this.enemy.magAtk, this.player.magDef, this.enemy.element[elementType], this.player.element[elementType], this.enemy.wis, this.player.wis);
        this.enemy.mana -= 10;
        this.addHelpText(`Enemy uses ${elementType} Spell! ${critical ? 'Critical hit! ' : ''}Deals ${damage} damage.`);
        this.playMagicAttackAnimation(this.enemy, this.player, elementType, damage, critical, this.player.element[elementType]);
        this.enemy.learnedElementalWeaknesses[elementType] = Math.max(this.enemy.learnedElementalWeaknesses[elementType], damage);
      } else {
        // Fallback to physical if no mana
        this.executeEnemyAction('physical', 'Attack', damage, critical, 'physical');
      }
    } else if (actionType === 'skills') {
      this.playAttackAnimation(this.enemy.sprite, this.player.sprite);
      this.addHelpText(`Enemy uses ${action}!`);
      this.applyStatusEffect('Enemy', 'Player', action);
    }
  }

  applyStatusEffect(caster, target, statusEffect) {
    console.log('applyStatusEffect... caster: ', caster);
    console.log('applyStatusEffect... target: ', target);
    console.log('applyStatusEffect... statusEffect: ', statusEffect);

    this.time.delayedCall(150, () => {
      let targetCharacter = target === 'Player' ? this.player : this.enemy;
      let casterCharacter = caster === 'Player' ? this.player : this.enemy;

      console.log('applyStatusEffect... targetCharacter.immunities: ', targetCharacter.immunities);
      if (targetCharacter.immunities && targetCharacter.immunities.includes(statusEffect)) {
        console.log('applyStatusEffect... IMMUNE');
        this.addHelpText(`${targetCharacter.name} is immune to ${statusEffect}!`);
        this.showPhraseIndicator(targetCharacter.sprite, 'IMMUNE', '#2bf1ff');
        if (caster === 'Enemy') {
          this.enemy.learnedStatusImmunities[statusEffect] = true;
        }
      } else {
        console.log('applyStatusEffect... Not Immune');
        let existingEffect = targetCharacter.statusEffects.find(effect => effect.type === statusEffect);
        console.log('applyStatusEffect... existingEffect: ', existingEffect);
        if (existingEffect) {
          if (existingEffect.turns !== -1) { // Only refresh if it is not infinite
            if (statusEffect === 'Stun') existingEffect.turns = 1;
            else if (statusEffect === 'Freeze') existingEffect.turns = 5;
            this.addHelpText(`${targetCharacter.name} is already affected by ${statusEffect}. Duration refreshed.`);
          }
        } else {
          let turns = (statusEffect === 'Stun' ? 1 : (statusEffect === 'Freeze' ? 5 : 3)); // 3 turns for non-infinite status effects
          targetCharacter.statusEffects.push({ type: statusEffect, turns });
          this.addHelpText(`${targetCharacter.name} is now affected by ${statusEffect}!`);
        }
      }

      this.updateStatusIndicators(targetCharacter);
    }, [], this);
  }

  updateStatusIndicators(character) {
    if (character.statusIndicators) {
      character.statusIndicators.clear(true, true);
    }

    character.statusIndicators = this.add.group();
    const statusEffects = character.statusEffects;
    for (let i = 0; i < statusEffects.length; i++) {
      let statusText = this.add.text(character.sprite.x - 100, 300 + i * 30, `${statusEffects[i].type} (${statusEffects[i].turns > 0 ? statusEffects[i].turns : '∞'})`, { fontSize: '20px', fill: '#fff', backgroundColor: '#000', padding: { left: 10, right: 10, top: 5, bottom: 5 } });
      character.statusIndicators.add(statusText);
    }
  }

  showDamageIndicator(target, damage, critical, elementValue, additionalText, hideDamageNumber) {
    let fontColor = '#f0d735';
    let delaytime = 0;

    if (elementValue <= 0.0) {
      delaytime = 500;
      fontColor = elementValue < 0.0 ? '#0cc43d' : '#2bf1ff';
      const immunityText = elementValue < 0.0 ? 'BUFF' : 'IMMUNE';
      const displayText = this.add.text(target.sprite.x, target.sprite.y - 50, immunityText, { fontSize: '50px', fill: fontColor, fontStyle: 'bold' });
      this.tweens.add({
        targets: displayText,
        y: target.sprite.y - 250,
        alpha: { from: 1, to: 0 },
        duration: 2500,
        ease: 'Power1',
        onComplete: () => {
          displayText.destroy();
        }
      });
    }

    if (critical) {
      delaytime = 500;
      fontColor = '#f0d735'
      const displayText = this.add.text(target.sprite.x, target.sprite.y - 50, 'CRITICAL', { fontSize: '50px', fill: fontColor, fontStyle: 'bold' });
      this.tweens.add({
        targets: displayText,
        y: target.sprite.y - 250,
        alpha: { from: 1, to: 0 },
        duration: 2500,
        ease: 'Power1',
        onComplete: () => {
          displayText.destroy();
        }
      });
    }

    if (additionalText) {
      delaytime = 500;
      fontColor = '#f0d735'
      const displayText = this.add.text(target.sprite.x, target.sprite.y - 50, additionalText, { fontSize: '50px', fill: fontColor, fontStyle: 'bold' });
      this.tweens.add({
        targets: displayText,
        y: target.sprite.y - 250,
        alpha: { from: 1, to: 0 },
        duration: 2500,
        ease: 'Power1',
        onComplete: () => {
          displayText.destroy();
        }
      });
    }

    if (damage < 0) {
      fontColor = '#0cc43d'
    } else if (critical) {
      fontColor = '#f0d735'
    }

    this.time.delayedCall(delaytime, () => {
      target.health -= damage;

      this.playerHealthText.setText(`Health: ${this.player.health}`);
      this.enemyHealthText.setText(`Health: ${this.enemy.health}`);


      if (!hideDamageNumber) {
        const damageText = this.add.text(target.sprite.x, target.sprite.y - 50, damage, { fontSize: '60px', fill: fontColor, fontStyle: 'bold' });
        this.tweens.add({
          targets: damageText,
          y: target.sprite.y - 250,
          alpha: { from: 1, to: 0 },
          duration: 2500,
          ease: 'Power1',
          onComplete: () => {
            damageText.destroy();
          }
        });
      }
    }, [], this);
  }

  showPhraseIndicator(target, phrase, color) {
    let delaytime = 0;

    this.time.delayedCall(delaytime, () => {
      const damageText = this.add.text(target.x, target.y - 50, phrase, { fontSize: '60px', fill: color, fontStyle: 'bold' });
      this.tweens.add({
        targets: damageText,
        y: target.y - 250,
        alpha: { from: 1, to: 0 },
        duration: 2500,
        ease: 'Power1',
        onComplete: () => {
          damageText.destroy();
        }
      });
    }, [], this);
  }

  calculateDamage(atk, def, luk, eva, acc, target, elementValue) {
    let criticalChance = luk / 1000;
    let critical = Math.random() < criticalChance;
    let variance = Phaser.Math.FloatBetween(0.9, 1.1);

    let baseDamage;
    if (critical) {
      baseDamage = Math.floor((atk * 4) * variance);
    } else {
      baseDamage = Math.floor(((4 * atk) - (2 * def)) * variance);
    }

    baseDamage = Math.max(1, baseDamage); // Ensure minimum damage is 1
    let evaded = (Math.floor(Math.random() * 100) + 1) <= (acc - eva);
    this.showDamageIndicator(target, baseDamage, critical, elementValue, evaded ? 'MISS!' : null, evaded ? true : false);
    return evaded ? 0 : baseDamage;
  }

  calculateMagicDamage(magAtk, magDef, attackerElement, defenderElement, attackerWis, defenderWis) {
    console.log('calculateMagicDamage... magAtk: ', magAtk);
    console.log('calculateMagicDamage... magDef: ', magDef);
    console.log('calculateMagicDamage... attackerElement: ', attackerElement);
    console.log('calculateMagicDamage... defenderElement: ', defenderElement);
    console.log('calculateMagicDamage... attackerWis: ', attackerWis);
    console.log('calculateMagicDamage... defenderWis: ', defenderWis);
    let criticalChance = (Math.max(1, Math.floor(attackerWis - defenderWis))) / 100;
    let critical = Math.random() < criticalChance;
    let variance = Phaser.Math.FloatBetween(0.9, 1.1);

    let baseDamage;

    // If the target is to be healed, remove magic defense
    if (defenderElement < 0) {
      magDef = 0;
    } else if (defenderElement == 0) {
      return 0;
    }

    if (critical) {
      baseDamage = Math.floor((4 * magAtk) * variance)
    } else {
      baseDamage = Math.floor(((4 * magAtk) - (2 * magDef)) * variance);
    }

    baseDamage *= defenderElement;

    // Calculate Attacker's Elemental Affitiy
    if (attackerElement > 0) {          // Positive = Weak
      baseDamage /= attackerElement;  // Weak to this element, reduce damage
    } else if (attackerElement == 0) {  // 0 = Immune = Strong
      baseDamage *= 2;                // Resistant in this element, increase damage
    } else if (attackerElement < 0) {   // Can only be -1 indicating healing strength
      baseDamage *= 3;                // Strong in this element, Greatly increase damage
    }

    if (defenderElement < 0) {
      return Math.floor(baseDamage); // Allow negative values for potential healing
    } else {
      return Math.max(1, Math.floor(baseDamage)); // DO NOTAllow negative values for Unless it's a buff
    }
  }

  startCooldown() {
    console.log('startCooldown...');
    this.isCooldown = true;

    this.time.delayedCall(1000, () => {  // Delay of 1 second for a more natural response
      this.isCooldown = false;
      this.nextTurn();
      this.updateTurnOrderDisplay();  // Ensure UI updates immediately after turn change
    }, [], this);
  }

  nextTurn() {
    console.log('nextTurn...');
    if (this.turnOrder[this.currentTurnIndex].name === 'Player' && this.player.isDefending) {
      this.player.def /= 4; // Reset defense boost after turn
      this.player.isDefending = false;
    }
    if (this.turnOrder[this.currentTurnIndex].name === 'Enemy' && this.enemy.isDefending) {
      this.enemy.def /= 4; // Reset defense boost after turn
      this.enemy.isDefending = false;
    }

    // Move to the next character's turn
    this.currentTurnIndex = (this.currentTurnIndex + 1) % this.turnOrder.length;
    const currentCharacter = this.turnOrder[this.currentTurnIndex].name === 'Player' ? this.player : this.enemy;

    if (this.isCharacterFrozenOrStunned(currentCharacter)) {
      this.startCooldown();
    } else {
      if (this.turnOrder[this.currentTurnIndex].name === 'Player') {
        this.showPlayerActions();
      } else if (this.turnOrder[this.currentTurnIndex].name === 'Enemy') {
        this.hidePlayerActions();
        this.enemyAction();
      } else {
        console.error('this.turnOrder[this.currentTurnIndex].name: ', this.turnOrder[this.currentTurnIndex].name);
      }
      this.updateTurnOrderDisplay();
    }

    // Decrement status effect turns only here
    for (let effect of currentCharacter.statusEffects) {
      if (effect.turns > 0) {
        effect.turns--;
      }
    }

    this.handleStatusEffects();
  }

  isCharacterFrozenOrStunned(character) {
    console.log('isCharacterFrozenOrStunned... character: ', character);

    const frozenStatus = character.statusEffects.find(effect => effect.type === 'Freeze');
    const stunnedStatus = character.statusEffects.find(effect => effect.type === 'Stun');

    if (frozenStatus) {
      this.addHelpText(`${character.name} is frozen and skips a turn!`);
      return true;
    }

    if (stunnedStatus) {
      this.addHelpText(`${character.name} is stunned and skips a turn!`);
      return true;
    }

    return false;
  }

  handleStatusEffects() {
    const currentCharacter = this.turnOrder[this.currentTurnIndex].name === 'Player' ? this.player : this.enemy;

    for (let i = currentCharacter.statusEffects.length - 1; i >= 0; i--) {
      this.time.delayedCall(500 * i, () => {
        let effect = currentCharacter.statusEffects[i];
        let damage = 0;

        if (effect && effect.type) {

          switch (effect.type) {
            case 'Poison':
              damage = Math.floor(currentCharacter.health * 0.05);
              this.addHelpText(`${currentCharacter.name} takes poison damage!`);
              this.showDamageIndicator(currentCharacter, damage);
              break;
            case 'Burn':
              damage = Math.floor(currentCharacter.health * 0.05);
              this.addHelpText(`${currentCharacter.name} takes burn damage!`);
              this.showDamageIndicator(currentCharacter, damage);
              break;
            // Stun and Freeze are handled in isCharacterFrozenOrStunned method
          }

          if (currentCharacter.health <= 0) {
            this.endBattle(currentCharacter.name === 'Player' ? 'lose' : 'win');
          }
        }
      }, [], this);
    }

    // Filter out status effects with 0 turns left
    currentCharacter.statusEffects = currentCharacter.statusEffects.filter(effect => effect.turns !== 0);

    this.updateStatusIndicators(currentCharacter);
  }

  showPlayerActions() {
    this.actions.children.each(action => action.setVisible(true));
    this.actionBox.setVisible(true);
  }

  hidePlayerActions() {
    this.actions.children.each(action => action.setVisible(false));
    this.hideSubOptions(); // Ensure sub-options are hidden
    this.actionBox.setVisible(false);
  }

  playAttackAnimation(attacker, defender) {
    this.tweens.add({
      targets: attacker,
      x: defender.x - 50,
      duration: 300,
      yoyo: true,
      ease: 'Power1'
    });

    this.time.delayedCall(150, () => {
      this.tweens.add({
        targets: defender,
        angle: { from: -5, to: 5 },
        duration: 50,
        yoyo: true,
        repeat: 5,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          defender.angle = 0; // Reset defender angle
        }
      });
    }, [], this);
  }

  playMagicAttackAnimation(attacker, defender, elementType, damage, critical, elementValue) {
    let color;
    let statusEffect = null;

    switch (elementType) {
      case 'fire':
        color = 0xff4500; // Orange
        statusEffect = 'Burn';
        break;
      case 'ice':
        color = 0x00ffff; // Cyan
        statusEffect = 'Freeze';
        break;
      case 'water':
        color = 0x1e90ff; // DodgerBlue
        break;
      case 'lightning':
        color = 0xffff00; // Yellow
        break;
      default:
        color = 0xffffff; // Default to white
        break;
    }

    let magicBall = this.add.circle(attacker.sprite.x, attacker.sprite.y, 30, color);
    this.physics.add.existing(magicBall);
    this.physics.moveTo(magicBall, defender.sprite.x, defender.sprite.y, 500);

    this.time.delayedCall(800, () => {
      magicBall.destroy();
      this.applyEffect(defender.sprite, color);
      this.showDamageIndicator(defender, damage, critical, elementValue);

      // Inflict status effect if applicable and defender has immunities property
      if (statusEffect && defender.immunities && !defender.immunities.includes(statusEffect)) {
        this.applyStatusEffect(attacker.sprite.name, defender.name, statusEffect);
      }
    });
  }
}

const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [BattleScene],
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  }
};

const game = new Phaser.Game(config);

window.addEventListener('resize', () => {
  const newWidth = window.innerWidth;
  const newHeight = window.innerHeight;

  game.scale.resize(newWidth, newHeight);
  game.scene.scenes.forEach(scene => {
    scene.scale.resize(newWidth, newHeight);
    scene.children.list.forEach(child => {
      if (child.isText) {
        // Adjust font size or reposition texts if needed
        child.setFontSize(newHeight / 25); // Example adjustment
      }
    });
  });
});

function structureNewsData(articles) {
  return articles.map(article => {
    return {
      title: article.title,
      description: article.description,
      url: article.url
    };
  });
}
