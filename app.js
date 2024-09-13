const TILE_SIZE = 32;
const MAP_WIDTH = 10;  // 10 tiles wide
const MAP_HEIGHT = 8;  // 8 tiles high
const TILE_TYPES = ['grass', 'water', 'mountain']; // Different tile types

// Generate a random map
function generateMap() {
  const map = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const row = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      const randomTile = TILE_TYPES[Math.floor(Math.random() * TILE_TYPES.length)];
      row.push(randomTile);
    }
    map.push(row);
  }
  return map;
}

// Render the map in HTML
function renderMap(map) {
  const gameElement = document.getElementById('game');
  gameElement.innerHTML = ''; // Clear any previous map
  map.forEach(row => {
    row.forEach(tile => {
      const tileElement = document.createElement('div');
      tileElement.className = 'tile ' + tile;
      tileElement.style.width = `${TILE_SIZE}px`;
      tileElement.style.height = `${TILE_SIZE}px`;
      gameElement.appendChild(tileElement);
    });
    gameElement.appendChild(document.createElement('br'));  // New line after each row
  });
}

const map = generateMap();
renderMap(map);

// Character Object
class Character {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.sprite = 'character';  // Placeholder for sprite class
  }

  render() {
    const characterElement = document.createElement('div');
    characterElement.className = this.sprite;
    characterElement.style.width = `${TILE_SIZE}px`;
    characterElement.style.height = `${TILE_SIZE}px`;
    characterElement.style.position = 'absolute';
    characterElement.style.left = `${this.x * TILE_SIZE}px`;
    characterElement.style.top = `${this.y * TILE_SIZE}px`;
    document.getElementById('game').appendChild(characterElement);
  }
}

const playerCharacter = new Character(5, 5);
playerCharacter.render();

// Consolidated FSM class
class FSM {
  constructor(initialState) {
    this.state = initialState;
  }

  transition(newState) {
    this.state = newState;
  }

  act() {
    switch (this.state) {
      case 'idle':
        console.log('Enemy is idle');
        break;
      case 'aggro':
        console.log('Enemy is chasing the player');
        break;
      case 'attack':
        console.log('Enemy attacks!');
        break;
      case 'magic':
        console.log('Enemy casts a spell');
        break;
      case 'flee':
        console.log('Enemy flees');
        break;
    }
  }
}

// Enemy class with FSM AI
class Enemy {
  constructor(name) {
    this.name = name;
    this.health = Math.floor(Math.random() * 100);
    this.fsm = new FSM('idle');  // Start in idle state
  }

  update() {
    // AI logic to change state
    if (this.health < 20) {
      this.fsm.transition('flee');
    } else if (Math.random() < 0.5) {
      this.fsm.transition('attack');
    } else {
      this.fsm.transition('magic');
    }

    this.fsm.act();
  }
}

const enemies = [];
for (let i = 0; i < 3; i++) {
  enemies.push(new Enemy('Goblin ' + i));
}

enemies.forEach(enemy => enemy.update());

// Combat system
class Combat {
  constructor(player, enemy) {
    this.player = player;
    this.enemy = enemy;
  }

  attack(attacker, defender) {
    const damage = Math.floor(Math.random() * 10) + 5;
    defender.health -= damage;
    console.log(`${attacker.name} attacks ${defender.name} for ${damage} damage!`);
    this.checkWinner();
  }

  magic(attacker, defender) {
    const damage = Math.floor(Math.random() * 15) + 10;
    defender.health -= damage;
    console.log(`${attacker.name} casts a spell on ${defender.name} for ${damage} damage!`);
    this.checkWinner();
  }

  useItem(attacker) {
    const heal = Math.floor(Math.random() * 10) + 5;
    attacker.health += heal;
    console.log(`${attacker.name} uses a potion and heals for ${heal} HP!`);
  }

  checkWinner() {
    if (this.player.health <= 0) {
      console.log(`${this.player.name} has been defeated!`);
    } else if (this.enemy.health <= 0) {
      console.log(`${this.enemy.name} has been defeated!`);
    }
  }

  startCombat() {
    // Example combat flow
    this.attack(this.player, this.enemy);
    this.attack(this.enemy, this.player);
  }
}

const playerCombatant = { name: 'Hero', health: 100 };
const enemyCombatant = { name: 'Goblin', health: 50 };
const combat = new Combat(playerCombatant, enemyCombatant);

combat.startCombat();

// Main game loop
function gameLoop() {
  enemies.forEach(enemy => enemy.update());
  requestAnimationFrame(gameLoop);
}

// Start the game loop
gameLoop();
