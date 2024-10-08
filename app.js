const costSavingMode = true;
const genericEnemyBase64 = 'na';
const genericPlayerBase64 = 'na';
const version = 'Alpha v0.1';
const letters = 'eeeeeeeeeeeetttttttttaaaaaaaaoooooooiiiiiinnnnnnsssssshhhhhhrrrrrddddllllccuummwwffggypbvkjxqz';

 // Fire Word
  const fireWords = [
    "fire", "blaze", "flame", "inferno", "ember", "bonfire", "conflagration", "torch", "ignition", "combustion", "spark",
    "scorch", "heat", "searing", "burn", "pyre", "incineration", "flare", "glow", "flicker", "ash"
  ]
 // Ice Word
 const iceWords = [
    "ice", "frost", "glacier", "icicle", "snow", "hail", "freeze", "frozen", "chill", "cold", "iceberg", "crystal",
    "floe", "permafrost", "rime", "slush", "icecap", "frostbite", "glacial", "cool", "subzero"
  ]
// Water Word
const waterWords = [
    "water", "aqua", "liquid", "stream", "river", "ocean", "sea", "lake", "pond", "pool", "wave", "rain", "flood",
    "torrent", "brook", "creek", "spring", "reservoir", "wet", "moisture", "dew"
  ]
 // Lightning Word
 const lightningWords =  [
    "lightning", "thunder", "bolt", "electricity", "storm", "flash", "strike", "spark", "charge", "electric", "shock",
    "jolt", "current", "energy", "surge", "electrical", "zigzag", "power", "blast", "discharge"
  ]
 // Poison Word
 const poisonWords =  [
    "poison", "toxin", "venom", "contaminant", "pollutant", "toxicant", "lethal", "deadly", "hazard", "noxious",
    "harmful", "toxic", "intoxicate", "contaminate", "infect", "corrupt", "bane", "potion", "antidote", "hazardous"
  ]
 // Stun Word
 const stunWords =  [
    "stun", "daze", "shock", "immobilize", "paralyze", "knockout", "astonish", "amaze", "startle", "bewilder",
    "stupefy", "freeze", "debilitate", "numb", "dumbfound", "overwhelm", "baffle", "astound", "disorient", "jar"
  ]
 // Heal Word
 const healWords =  [
    "heal", "cure", "restore", "recover", "mend", "repair", "revive", "rejuvenate", "regenerate", "remedy", "rehabilitate",
    "alleviate", "soothe", "relieve", "improve", "strengthen", "nurture", "remediate", "renew", "fix"
  ]


let enemyImageBase64 = '';
let npcBase64image = '';
let monsterDescription = '';
let battleEnded = false;
let newsData = []; // Global variable to store news articles
let personas;
let persona;

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

async function loadWordData() {
  try {
    const response = await fetch('./words.json'); // Fetch the JSON file from the same directory
    if (!response.ok) throw new Error('Failed to load word data.');
    wordData = await response.json();
    console.log("Word data loaded: ", wordData);
    return wordData;
  } catch (error) {
    console.error('Error loading word data:', error);
  }
}

class BattleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BattleScene' });
    this.helpMessages = [];
    this.loadingIndicator = null;
    this.isCooldown = false; // Tracks if player or enemy is in cooldown
    this.enemyActionCooldown = 0; // Timer for the next enemy action
    this.playerInputCooldown = 0; // Timer for the player action delay
    this.tileResetCooldown = 10000;
  }

  async create(data) {
    this.letterGrid = this.add.group();
    this.randomLetters = generateRandomLetters();
    console.log("this.randomLetters: ", this.randomLetters);

    this.letterGridArray = [];
    this.selectedLetters = [];

    // Create the 4x4 grid
    let letterIndex = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let randomLetter = this.randomLetters[letterIndex];
        letterIndex++;
        let letterText = this.add.text(this.scale.width / 2 + i * 100, this.scale.height / 2 + j * 100, randomLetter, { fontSize: '100px', fill: '#fff' });
        letterText.setInteractive();
        letterText.on('pointerdown', () => this.selectLetter(letterText));
        this.letterGrid.add(letterText);
        this.letterGridArray.push(letterText);
      }
    }

    console.log(`Random Letters: ${this.randomLetters}`);

    // Add the submit button in a similar manner
    this.submitButton = this.add.text(this.scale.width / 2, this.scale.height - 120, 'Submit', {
      fontSize: '30px',
      fill: '#fff',
      backgroundColor: '#000',
      padding: { left: 20, right: 20, top: 10, bottom: 10 }
    }).setOrigin(0.5);
    this.submitButton.setInteractive();
    this.submitButton.on('pointerdown', () => {
      if (!this.submitButton.disabled) {
        this.processWord(); // Process word submission
      }
    });

    // Initially disable the submit button until a valid word is selected
    this.disableSubmitButton();
    // Handle submit button click
    this.submitButton.on('pointerdown', () => {
      if (!this.submitButton.disabled) {
        this.submitWord(); // Handle word submission
      }
    });

    this.selectedWord = '';
    await loadWordData();


    this.subsets = findAllSubsets(this.randomLetters);
    console.log("Subsets Found:", this.subsets);
    this.validWords = findValidWordsFromWordDataAsArray(this.subsets);

    // Output valid words to the console
    console.log("Valid Words Found:", this.validWords);
    console.log("Valid Words Found (Formatted):", this.validWords.length > 0 ? this.validWords.join(', ') : 'No valid words found.');


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

    // Display UI elements
    this.createUI(this.selectedLocation);
  }

  selectLetter(letterText) {
    const index = this.selectedLetters.indexOf(letterText);

    // If the letter is already selected, remove it and reset the style
    if (index !== -1) {
      this.selectedLetters.splice(index, 1); // Remove the letter from selectedLetters
      letterText.setStyle({ fill: '#ffffff' }); // Reset color to default (or whatever deselected color)
    } else {
      // If the letter is not selected, add it and change the style
      this.selectedLetters.push(letterText);
      letterText.setStyle({ fill: '#00ff00' }); // Change color to show selection
    }

    this.processWord();
  }

  completeWord() {
    // Validate and perform actions based on the word
    this.processWord();
    this.resetGrid();
  }

  resetGrid() {
    this.selectedLetters.forEach(letter => letter.setStyle({ fill: '#fff' }));
    this.selectedLetters = [];
  }

  spawnEnemies() {
    // Start the battle with the first enemy and progress through the list
    console.log('spawnEnemies: ');
    this.currentEnemyIndex = 0;

    this.battleSequence();
  }

  processWord() {
    if (this.selectedLetters.length > 2) {
      this.selectedWord = this.selectedLetters.map(letter => letter.text).join('');
      console.log("Processing word:", this.selectedWord);
      // Check if the selected letters form a valid word and enable submit button if valid
      const isValidWord = this.isWordValid(this.selectedWord); // Check if it's a valid word
      console.log("isValidWord:", isValidWord);

      if (isValidWord) {
        this.enableSubmitButton();  // Enable the submit button if valid
      } else {
        this.disableSubmitButton(); // Disable the submit button if invalid
      }
    }
  }

  submitWord() {
    let damage = 0;
    let critical = false;
    console.log("Processing word:", this.selectedWord);
    if (this.selectedWord === 'fire') {
      // Example: Fire attack logic for the enemy
      damage = this.calculateMagicDamage(this.player.magAtk, this.enemy.magDef, this.player.element['fire'], this.enemy.element['fire'], this.player.wis, this.enemy.wis);
      //this.inflictDamage('fire', 100); // Fire deals 100 damage
      this.showDamageIndicator(this.enemy, damage, critical, this.enemy.element['fire'], null, false);
      this.addHelpText(`Player casts Fire! Deals 100 damage.`);
    } else if (this.selectedWord === 'heal') {
      // Example: Heal logic for the enemy
      //this.healPlayer(50); // Heal for 50 health
      healing = this.calculateHealing(this.enemy.magAtk);
      this.showDamageIndicator(this.player, healing, critical, 1, null, false);
      this.addHelpText(`Player heals! Restores 50 health.`);
    } else {
      // Default physical attack
      //this.inflictDamage('physical', chosenWord.length * 10); // Physical attack based on word length
      damage = this.selectedWord.length * 10;//word.length * 10; // Damage based on word length
      this.showDamageIndicator(this.enemy, damage, critical, 1, null, false);
      this.addHelpText(`Player attacks! Deals ${damage} damage.`);
    }
    this.resetGrid();
    this.disableSubmitButton();

  }

  inflictDamage(type, amount) {
    this.enemy.health -= amount;
  }

  healPlayer(amount) {
    this.player.health += amount;
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

      // Cooldown flag
      this.isCooldown = false;

      // Display UI elements
      this.createUI(this.selectedLocation);
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

  update(time, delta) {
    if (this.player && this.enemy) {

      // Check if the game has ended
      if (!battleEnded) {
        if (this.player.health <= 0) {
          this.endBattle('lose');
        } else if (this.enemy.health <= 0) {
          battleEnded = true;
          this.endBattle('win');
        }
      }

      // Enemy action logic with random interval (2 to 5 seconds)
      if (this.enemyActionCooldown <= 0) {
        this.enemyAction(); // Enemy takes an action
        this.enemyActionCooldown = Phaser.Math.Between(2000, 5000); // Set random delay for next enemy action (2 to 5 seconds)
      } else {
        this.enemyActionCooldown -= delta || 1; // Reduce the enemy cooldown by delta time
      }

      // Create the 4x4 grid
      // if (this.tileResetCooldown <= 0) {
      //   this.letterGridArray = [];
      //   this.selectedLetters = [];
    
      //   this.disableSubmitButton();

      //   let letterIndex = 0;
      //   for (let i = 0; i < 4; i++) {
      //     for (let j = 0; j < 4; j++) {
      //       let randomLetter = this.randomLetters[letterIndex];
      //       letterIndex++;
      //       let letterText = this.add.text(this.scale.width / 2 + i * 100, this.scale.height / 2 + j * 100, randomLetter, { fontSize: '100px', fill: '#fff' });
      //       letterText.setInteractive();
      //       letterText.on('pointerdown', () => this.selectLetter(letterText));
      //       this.letterGrid.add(letterText);
      //       this.letterGridArray.push(letterText);
      //     }
      //   }
      //   this.tileResetCooldown = Phaser.Math.Between(10000, 50000); // Set random delay for next enemy action (2 to 5 seconds)
      // } else {
      //   this.tileResetCooldown -= delta || 1; // Reduce the enemy cooldown by delta time
      // }

    }
  }

  // Function to check if the selected letters form a valid word
  isWordValid(word) {
    // Use your word validation logic here, for example:
    return wordData.includes(word); // Assuming wordData is an array of valid words
  }

  // Enable the submit button
  enableSubmitButton() {
    this.submitButton.setStyle({ fill: '#00ff00' });
    this.submitButton.disabled = false; // Enable the button
  }

  // Function to enable the submit button
  enableSubmitButton() {
    this.submitButton.setStyle({ fill: '#00ff00' }); // Green to indicate it's enabled
    this.submitButton.disabled = false; // Enable button
  }

  // Function to disable the submit button
  disableSubmitButton() {
    this.submitButton.setStyle({ fill: '#888888' }); // Gray to indicate it's disabled
    this.submitButton.disabled = true; // Disable button
  }

  endBattle(result) {
    battleEnded = true;
    this.time.delayedCall(1000, () => {
      if (result === 'win') {
        // Handle victory logic
        this.addHelpText('You Won! Gaining XP...');
        this.enemy.sprite.visible = false; // Remove enemy sprite

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

  handlePlayerAction(word) {
    let damage = 0;
    let healing = 0;
    let critical = false;

    if (word.toLowerCase() === 'fire') {
      // Handle fire-based attack
      damage = this.calculateMagicDamage(this.player.magAtk, this.enemy.magDef, this.player.element['fire'], this.enemy.element['fire'], this.player.wis, this.enemy.wis);
      this.addHelpText(`Player casts Fire! Deals ${damage} damage.`);
      this.showDamageIndicator(this.enemy, damage, critical, this.enemy.element['fire'], null, false);

      //this.inflictDamage('fire', damage); // Apply the damage logic
    } else if (word.toLowerCase() === 'heal') {
      // Handle healing logic
      healing = this.calculateHealing(this.player.magAtk);
      //this.healPlayer(healing);
      this.showDamageIndicator(this.player, healing, critical, 1, null, false);
      this.addHelpText(`Player heals! Restores ${healing} health.`);
    } else {
      // Handle physical attack if no special word is matched
      damage = word.length * 10; // Damage based on word length
      this.showDamageIndicator(this.enemy, damage, critical, 1, null, false);

      //this.inflictDamage('physical', damage);
      this.addHelpText(`Player uses a basic attack! Deals ${damage} damage.`);
    }

    // After performing the action, clear selected letters.
    this.resetGrid();
  }

  calculateHealing(magAtk) {
    let variance = Phaser.Math.FloatBetween(0.9, 1.1);
    let baseHealing = Math.floor((4 * magAtk + 200) * variance) * -1;
    return Math.max(1, baseHealing); // Ensure minimum healing is 1
  }

  enemyAction() {
    let damage = 0;
    let healing = 0;
    let critical = false;

    let chosenWord = getBestWord(this.validWords);
    if (fireWords.includes(chosenWord)) {
      // Example: Fire attack logic for the enemy
      damage = this.calculateMagicDamage(this.player.magAtk, this.enemy.magDef, this.player.element['fire'], this.enemy.element['fire'], this.player.wis, this.enemy.wis);
      //this.inflictDamage('fire', 100); // Fire deals 100 damage
      this.showDamageIndicator(this.player, damage, critical, this.player.element['fire'], null, false);
      this.addHelpText(f`Enemy casts ${chosenWord}! Deals ${damage} damage.`);
    } else if (iceWords.includes(chosenWord)) {
      // Example: Fire attack logic for the enemy
      damage = this.calculateMagicDamage(this.player.magAtk, this.enemy.magDef, this.player.element['ice'], this.enemy.element['ice'], this.player.wis, this.enemy.wis);
      //this.inflictDamage('fire', 100); // Fire deals 100 damage
      this.showDamageIndicator(this.player, damage, critical, this.player.element['ice'], null, false);
      this.addHelpText(f`Enemy casts ${chosenWord}! Deals ${damage} damage.`);
    } else if (waterWords.includes(chosenWord)) {
      // Example: Fire attack logic for the enemy
      damage = this.calculateMagicDamage(this.player.magAtk, this.enemy.magDef, this.player.element['ice'], this.enemy.element['ice'], this.player.wis, this.enemy.wis);
      //this.inflictDamage('fire', 100); // Fire deals 100 damage
      this.showDamageIndicator(this.player, damage, critical, this.player.element['ice'], null, false);
      this.addHelpText(f`Enemy casts ${chosenWord}! Deals ${damage} damage.`);
    } else if (lightningWords.includes(chosenWord)) {
      // Example: Fire attack logic for the enemy
      damage = this.calculateMagicDamage(this.player.magAtk, this.enemy.magDef, this.player.element['ice'], this.enemy.element['ice'], this.player.wis, this.enemy.wis);
      //this.inflictDamage('fire', 100); // Fire deals 100 damage
      this.showDamageIndicator(this.player, damage, critical, this.player.element['ice'], null, false);
      this.addHelpText(f`Enemy casts ${chosenWord}! Deals ${damage} damage.`);
    } else if (poisonWords.includes(chosenWord)) {
      // Example: Fire attack logic for the enemy
      damage = this.calculateMagicDamage(this.player.magAtk, this.enemy.magDef, this.player.element['ice'], this.enemy.element['ice'], this.player.wis, this.enemy.wis);
      //this.inflictDamage('fire', 100); // Fire deals 100 damage
      this.showDamageIndicator(this.player, damage, critical, this.player.element['ice'], null, false);
      this.addHelpText(f`Enemy casts ${chosenWord}! Deals ${damage} damage.`);
    } else if (stunWords.includes(chosenWord)) {
      // Example: Fire attack logic for the enemy
      damage = this.calculateMagicDamage(this.player.magAtk, this.enemy.magDef, this.player.element['ice'], this.enemy.element['ice'], this.player.wis, this.enemy.wis);
      //this.inflictDamage('fire', 100); // Fire deals 100 damage
      this.showDamageIndicator(this.player, damage, critical, this.player.element['ice'], null, false);
      this.addHelpText(f`Enemy casts ${chosenWord}! Deals ${damage} damage.`);
    } else if (healWords.includes(chosenWord)) {
        // Example: Heal logic for the enemy
      //this.healPlayer(50); // Heal for 50 health
      healing = this.calculateHealing(this.enemy.magAtk);
      this.showDamageIndicator(this.enemy, healing, critical, 1, null, false);
      this.addHelpText(`Enemy heals! Restores 50 health.`);
    } else {
      // Default physical attack
      //this.inflictDamage('physical', chosenWord.length * 10); // Physical attack based on word length
      damage = chosenWord.length * 10; // Damage based on word length
      this.showDamageIndicator(this.player, damage, critical, 1, null, false);
      this.addHelpText(`Enemy attacks! Deals ${damage} damage.`);
    }
  }

  // TODO
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
    let targetCharacter = target === 'Player' ? this.player : this.enemy;

    if (statusEffect === 'freeze') {
      // Apply freeze effect: the target skips its next turn.
      targetCharacter.statusEffects.push({ type: 'Freeze', turns: 1 });
      this.addHelpText(`${targetCharacter.name} is frozen and will miss their next turn!`);
    } else if (statusEffect === 'burn') {
      // Apply burn effect: the target takes damage over time.
      targetCharacter.statusEffects.push({ type: 'Burn', turns: 3 });
      this.addHelpText(`${targetCharacter.name} is burning! They will take damage for the next 3 turns.`);
    }

    // Call to update visual indicators of the status effect.
    this.updateStatusIndicators(targetCharacter);
  }

  // TODO
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

  // TODO
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

  // TODO
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

// Example of using WordsAPI in your script
async function isWordValidAccordingToWordsapiv1(word) {
  const apiKey = 'your_api_key_here'; // Replace with your actual API key
  const url = `https://wordsapiv1.p.mashape.com/words/${word}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Mashape-Key': apiKey,
        'X-Mashape-Host': 'wordsapiv1.p.mashape.com'
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.word === word;
    }
  } catch (error) {
    console.error('Error fetching word:', error);
  }
  return false;
}

// Example usage in finding valid words
async function findValidWordsFromWordsapiv1(subsets) {
  const validWords = [];
  for (const subset of subsets) {
    if (await isWordValidAccordingToWordsapiv1(subset)) {
      validWords.push(subset);
    }
  }
  return validWords;
}


// Example of checking valid words
function findValidWordsFromDictionary(subsets) {
  return subsets.filter(subset => wordData.includes(subset));
}

function findValidWordsFromWordData(subsets, wordData) {
  // Convert wordData to a Set for faster lookups (O(1) average lookup time)
  const wordDataSet = new Set(wordData);

  // Filter subsets based on presence in wordDataSet and return an array
  return subsets.filter(subset => wordDataSet.has(subset));
}

// Example of checking valid words from dictionary
function findValidWordsFromWordDataAsObject(subsets) {
  return subsets.filter(subset => subset in wordData);
}

// Example of using Wordnik API
async function isWordValidAccordingToWordnik(word) {
  const apiKey = 'your_wordnik_api_key_here'; // Replace with your Wordnik API key
  const url = `https://api.wordnik.com/v4/word.json/${word}/definitions?api_key=${apiKey}`;

  try {
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      return data.length > 0; // Word is valid if definitions exist
    }
  } catch (error) {
    console.error('Error fetching word from Wordnik:', error);
  }
  return false;
}

// Example usage
async function findValidWordsFromoWordnik(subsets) {
  const validWords = [];
  for (const subset of subsets) {
    if (await isWordValidAccordingToWordnik(subset)) {
      validWords.push(subset);
    }
  }
  return validWords;
}

// Function to generate all unique subsets (combinations) of exactly 3 letters
function findAllSubsets(chars) {
  const results = new Set();  // Use Set to automatically handle duplicates
  const n = chars.length;

  // Sort chars to avoid missing anagrams or permutations of valid words
  chars.sort();

  // Generate all combinations using bitwise approach
  for (let i = 0; i < (1 << n); i++) {
    let subset = '';
    for (let j = 0; j < n; j++) {
      if (i & (1 << j)) subset += chars[j];
    }

    // Only add subset if it has exactly 3 letters
    if (subset.length === 3) {
      results.add(subset);  // Add subset to Set (will ignore duplicates automatically)
    }
  }

  // Convert Set back to an array and return
  return Array.from(results);
}

// Example usage
const chars = ['a', 'b', 'c'];  // Example character array
const subsets = findAllSubsets(chars);
const validWords = findValidWordsFromDictionary(subsets, wordData);  // wordData should be your dictionary

console.log(validWords);

// Function to retrieve the longest word based on criteria, now accepting multiple prefixes
function getWordByCriteria(validWords, options = {}) {
  const {
    minLength = 0,
    maxLength = Infinity,
    preferredStarts = [],
    preferredEnd,
  } = options;

  // Handle null values for minLength and maxLength
  const actualMinLength = minLength !== null ? minLength : 0;
  const actualMaxLength = maxLength !== null ? maxLength : Infinity;

  // Filter based on criteria
  const filteredWords = validWords.filter((word) => {
    const startsWithPreferred =
      preferredStarts.length === 0 ||
      preferredStarts.some((prefix) => word.startsWith(prefix));
    return (
      word.length >= actualMinLength &&
      word.length <= actualMaxLength &&
      startsWithPreferred &&
      (!preferredEnd || word.endsWith(preferredEnd))
    );
  });

  // If no filtered words match the criteria, return a random word
  if (filteredWords.length === 0) {
    console.log("No words matching criteria found. Returning a random word.");
    return validWords[Math.floor(Math.random() * validWords.length)];
  }

  // Return the longest word from the filtered list
  return filteredWords.reduce((longest, word) =>
    word.length > longest.length ? word : longest
  );
}

// Function to generate 16 random letters
function generateRandomLetters() {
  const vowels = ['a', 'e', 'i', 'o', 'u'];
  let result = [];

  // Add each vowel at least once
  vowels.forEach(vowel => result.push(vowel));

  // Fill the rest of the result array with random consonants
  while (result.length < 16) {
    let randomLetter = letters[Math.floor(Math.random() * letters.length)];
    result.push(randomLetter);
  }

  // Shuffle the array to mix vowels and consonants
  for (let i = result.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];  // Swap elements
  }

  return result.join('');
}
// Helper function to generate combinations of specific lengths
function getCombinations(chars, minLength, maxLength) {
  const results = [];

  // Recursive function to generate combinations
  function combine(prefix, charsLeft) {
    if (prefix.length >= minLength && prefix.length <= maxLength) {
      results.push(prefix);
    }
    if (prefix.length < maxLength) {
      for (let i = 0; i < charsLeft.length; i++) {
        combine(prefix + charsLeft[i], charsLeft.slice(i + 1));
      }
    }
  }

  // Start combination generation with an empty prefix
  combine('', chars);
  return results;
}

function getBestWord(validWords) {
  console.log('getBestWord... validWords: ', validWords);
  const criteria = [
    { // Fire Word
      minLength: null,
      maxLength: null,
      preferredStarts: fireWords
    },
    { // Ice Word
      minLength: null,
      maxLength: null,
      preferredStarts: iceWords
    },
    { // Water Word
      minLength: null,
      maxLength: null,
      preferredStarts: waterWords
    },
    { // Lightning Word
      minLength: null,
      maxLength: null,
      preferredStarts: lightningWords
    },
    { // Poison Word
      minLength: null,
      maxLength: null,
      preferredStarts: poisonWords
    },
    { // Stun Word
      minLength: null,
      maxLength: null,
      preferredStarts: stunWords
    },
    { // Heal Word
      minLength: null,
      maxLength: null,
      preferredStarts: healWords
    },
    { // Large Word
      minLength: 8,
      maxLength: 16,
      preferredStarts: []
    },
    { // Medium Word
      minLength: 4,
      maxLength: 8,
      preferredStarts: []
    },
    { // Small Word
      minLength: 0,
      maxLength: 4,
      preferredStarts: []
    }
  ];

  let bestWord = null;

  // Iterate over each criterion and find the best word that matches
  console.log('getBestWord... criteria: ', criteria);
  for (let criterion of criteria) {
    console.log('getBestWord... criterion: ', criterion);
    const word = getWordByCriteria(validWords, criterion);
    console.log('getBestWord... word: ', word);
    if (word) {
      bestWord = word; // Prioritize later words
      console.log('getBestWord... bestWord: ', bestWord);
    }
  }

  return bestWord;
}