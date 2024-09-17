class BattleScene extends Phaser.Scene {
  constructor() {
      super({ key: 'BattleScene' });
      this.uiContainer = null;
  }

  preload() {
      // Load player and opponent assets
      this.load.image('player', 'path/to/player.png');  // Replace with actual path to the player sprite
      this.load.image('opponent', 'path/to/opponent.png');  // Replace with the opponent sprite path
  }

  create(data) {
      // Player setup
      this.player = this.physics.add.sprite(400, 300, 'player');
      this.player.setCollideWorldBounds(true);

      // Opponent setup
      this.opponent = this.physics.add.sprite(200, 200, 'opponent');
      this.opponent.setCollideWorldBounds(true);

      // Add cursors for player control
      this.cursors = this.input.keyboard.createCursorKeys();

      // Detect when player meets opponent
      this.physics.add.collider(this.player, this.opponent, this.startEncounter, null, this);
  }

  update() {
      // Player movement logic
      if (this.cursors.left.isDown) {
          this.player.setVelocityX(-160);
      } else if (this.cursors.right.isDown) {
          this.player.setVelocityX(160);
      } else {
          this.player.setVelocityX(0);
      }

      if (this.cursors.up.isDown) {
          this.player.setVelocityY(-160);
      } else if (this.cursors.down.isDown) {
          this.player.setVelocityY(160);
      } else {
          this.player.setVelocityY(0);
      }
  }

  startEncounter() {
      // Pause the game when player encounters the opponent
      this.physics.pause();
      this.displayActionMenu();
  }

  displayActionMenu() {
      // Clear existing UI elements if any
      if (this.uiContainer) {
          this.uiContainer.destroy(true);
      }

      // Create a container for all UI elements
      this.uiContainer = this.add.container(0, 0);

      // Set padding and element dimensions
      const padding = this.scale.width / 15;
      const buttonSpacing = 60;
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

  handleActionSelection(actionName) {
      console.log(`${actionName} selected`);

      // Remove the UI container after selection
      if (this.uiContainer) {
          this.uiContainer.destroy(true);
      }

      // Logic to handle the selected action (e.g., pass, shoot, etc.)
      switch (actionName) {
          case 'Pass':
              this.performPass();
              break;
          case 'Shoot':
              this.performShoot();
              break;
          case 'Hold':
              this.holdBall();
              break;
          case 'Use Technique':
              this.useTechnique();
              break;
          default:
              break;
      }

      // Resume the game after action selection
      this.physics.resume();
  }

  performPass() {
      console.log("Performing pass...");
      // Add pass logic here
  }

  performShoot() {
      console.log("Performing shoot...");
      // Add shoot logic here
  }

  holdBall() {
      console.log("Holding the ball...");
      // Add hold logic here
  }

  useTechnique() {
      console.log("Using technique...");
      // Add technique logic here
  }
}

// Main game configuration
const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [BattleScene],  // You can add more scenes like 'ExplorationScene' later
  physics: {
      default: 'arcade',
      arcade: {
          gravity: { y: 0 },
          debug: false
      }
  }
};

// Initialize the Phaser game
let game = new Phaser.Game(config);
