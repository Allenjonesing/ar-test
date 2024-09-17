let config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  physics: {
      default: 'arcade',
      arcade: {
          gravity: { y: 0 },
          debug: false
      }
  },
  scene: {
      preload: preload,
      create: create,
      update: update
  }
};

let game = new Phaser.Game(config);

// Global variables
let player, ball, opponent;
let cursors;
let playerScore = 0;
let opponentScore = 0;
let goalLeft, goalRight;
let actionMenu;

// Define player stats
let playerStats = {
    endurance: 80,
    attack: 60,
    pass: 70,
    block: 50,
    shoot: 85
};

// Define opponent stats
let opponentStats = {
    endurance: 70,
    attack: 75,
    pass: 65,
    block: 80,
    shoot: 60
};

function preload() {
    // Load player and ball assets
    this.load.image('player', 'path/to/player.png'); // Replace with actual path to the player sprite
    this.load.image('ball', 'path/to/ball.png');     // Replace with the ball sprite path
    this.load.image('opponent', 'path/to/opponent.png'); // Replace with the opponent sprite path
}

function create() {
    // Player setup
    player = this.physics.add.sprite(400, 300, 'player');
    player.setCollideWorldBounds(true);

    // Ball setup
    ball = this.physics.add.sprite(400, 400, 'ball');
    ball.setCollideWorldBounds(true);

    // Opponent setup
    opponent = this.physics.add.sprite(200, 200, 'opponent');
    opponent.setCollideWorldBounds(true);

    // Goals setup
    goalLeft = this.add.rectangle(50, 300, 20, 200, 0x00ff00); // Left goal
    this.physics.add.existing(goalLeft, true); // Physics object

    goalRight = this.add.rectangle(750, 300, 20, 200, 0xff0000); // Right goal
    this.physics.add.existing(goalRight, true); // Physics object

    // Add cursors for player control
    cursors = this.input.keyboard.createCursorKeys();

    // Collisions between player and ball
    this.physics.add.collider(player, opponent, startEncounter, null, this);

    // Collisions for goals
    this.physics.add.overlap(ball, goalLeft, scoreGoalRight, null, this);
    this.physics.add.overlap(ball, goalRight, scoreGoalLeft, null, this);
}

function update() {
    // Player movement logic
    if (cursors.left.isDown) {
        player.setVelocityX(-160);
    } else if (cursors.right.isDown) {
        player.setVelocityX(160);
    } else {
        player.setVelocityX(0);
    }

    if (cursors.up.isDown) {
        player.setVelocityY(-160);
    } else if (cursors.down.isDown) {
        player.setVelocityY(160);
    } else {
        player.setVelocityY(0);
    }

    // Ball logic can be removed since it's more RPG now
}

function startEncounter() {
    // Pause game movement when players meet
    this.physics.pause();

    // Display action menu
    displayActionMenu();
}

function displayActionMenu() {
  // Clear existing UI elements if any
  if (this.uiContainer) {
      this.uiContainer.destroy(true);
  }

  // Create a container for all UI elements
  this.uiContainer = this.add.container(0, 0);

  // Set padding and element dimensions
  const padding = this.scale.width / 15;
  const buttonWidth = 150;
  const buttonHeight = 50;
  const halfWidth = this.scale.width / 2;

  // Help text at the very top
  let menuTitle = this.add.text(halfWidth, padding, 'Choose an Action:', {
      fontSize: '32px',
      fill: '#fff'
  }).setOrigin(0.5);

  // Add the title to the container
  this.uiContainer.add(menuTitle);

  // Define the actions (Pass, Shoot, Hold, Use Technique)
  const actions = ['Pass', 'Shoot', 'Hold', 'Use Technique'];
  const buttonSpacing = 60;

  // Create buttons dynamically based on the actions
  actions.forEach((actionName, index) => {
      let x = halfWidth;  // Center the buttons horizontally
      let y = padding + buttonSpacing * (index + 1) + 50;

      // Create the action button
      let actionButton = this.add.text(x, y, actionName, {
          fontSize: '28px',
          fill: '#fff',
          backgroundColor: '#000',
          padding: { left: 20, right: 20, top: 10, bottom: 10 }
      }).setOrigin(0.5);

      // Set the button as interactive
      actionButton.setInteractive();

      // Define action on click
      actionButton.on('pointerdown', () => {
          this.handleActionSelection(actionName);
      });

      // Add the button to the UI container
      this.uiContainer.add(actionButton);
  });

  // Add a background for the action buttons
  let actionBox = this.add.graphics().lineStyle(2, 0xffff00).strokeRect(
      padding, padding * 3, this.scale.width - padding * 2, actions.length * buttonSpacing + padding
  );
  this.uiContainer.add(actionBox);
}

// Handle player action selection
function handleActionSelection(actionName) {
  console.log(`${actionName} selected`);

  // Remove the UI container after selection
  if (this.uiContainer) {
      this.uiContainer.destroy(true);
  }

  // Logic to handle the selected action (e.g., pass, shoot, etc.)
  switch (actionName) {
      case 'Pass':
          performPass();
          break;
      case 'Shoot':
          performShoot();
          break;
      case 'Hold':
          holdBall();
          break;
      case 'Use Technique':
          useTechnique();
          break;
      default:
          break;
  }
}

function performPass() {
    // Remove the action menu
    actionMenu.clear(true, true);  // Removes all UI elements in the menu

    let passSuccess = playerStats.pass > opponentStats.block * Math.random();  // Simple pass vs. block check
    if (passSuccess) {
        console.log('Pass succeeded!');
    } else {
        console.log('Pass intercepted by opponent!');
    }
    this.physics.resume();  // Resume game
}

function performShoot() {
    // Remove the action menu
    actionMenu.clear(true, true);  // Removes all UI elements in the menu

    let shootSuccess = playerStats.shoot > Math.random() * 100;  // Simple shoot chance
    if (shootSuccess) {
        console.log('Shot succeeded! Player scored.');
    } else {
        console.log('Shot failed!');
    }
    this.physics.resume();  // Resume game
}

function holdBall() {
    // Holding the ball doesn't involve stat comparison, player just continues to hold
    actionMenu.clear(true, true);
    console.log('Player holds the ball.');
    this.physics.resume();
}

function useTechnique() {
    // Placeholder for technique logic - this can involve special moves or powers
    actionMenu.clear(true, true);
    console.log('Player uses a special technique.');
    this.physics.resume();
}

function scoreGoalLeft(ball, goalRight) {
    playerScore += 1;
    resetBall();
    console.log("Player scored! Score: " + playerScore);
}

function scoreGoalRight(ball, goalLeft) {
    opponentScore += 1;
    resetBall();
    console.log("Opponent scored! Score: " + opponentScore);
}

function resetBall() {
    // Reset ball position and stop velocity
    ball.setPosition(400, 300);
    ball.setVelocity(0, 0);
}
