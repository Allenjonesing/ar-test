// Simple FSM structure for enemies
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
      case 'flee':
        console.log('Enemy flees');
        break;
    }
  }
}

// Example Enemy Class
class Enemy {
  constructor(name) {
    this.name = name;
    this.health = Math.floor(Math.random() * 100);
    this.fsm = new FSM('idle');  // Start in idle state
  }

  update() {
    // Determine AI state transitions
    if (this.health < 20) {
      this.fsm.transition('flee');
    } else {
      this.fsm.transition('aggro');
    }

    this.fsm.act();
  }
}

// Initialize some enemies
const enemies = [];
for (let i = 0; i < 5; i++) {
  enemies.push(new Enemy('Enemy ' + i));
}

// Main game loop
function gameLoop() {
  enemies.forEach(enemy => enemy.update());
  requestAnimationFrame(gameLoop);
}

// Start the game loop
gameLoop();
