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

function preload() {
    // Load player and ball assets
    this.load.image('player', 'path/to/player.png'); // Replace with actual path to the player sprite
    this.load.image('ball', 'path/to/ball.png');     // Replace with the ball sprite path
    this.load.image('opponent', 'path/to/opponent.png'); // Replace with the opponent sprite path
}

function create() {
    // Set up initial text
    this.add.text(350, 250, 'Blitzball 2D', { fontSize: '32px', fill: '#fff' });

    // Player setup
    player = this.physics.add.sprite(400, 300, 'player');
    player.setCollideWorldBounds(true);

    // Ball setup
    ball = this.physics.add.sprite(400, 400, 'ball');
    ball.setCollideWorldBounds(true);
    ball.setBounce(0.8);

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
    this.physics.add.collider(player, ball, playerHitsBall, null, this);

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

    // Passing the ball when spacebar is pressed
    if (Phaser.Input.Keyboard.JustDown(cursors.space)) {
        passBall();
    }

    // Opponent AI: move towards the ball
    this.physics.moveToObject(opponent, ball, 100);
}

function playerHitsBall(player, ball) {
    // Ball is pushed by the player upon contact
    ball.setVelocity(player.body.velocity.x, player.body.velocity.y);
}

function passBall() {
    // Pass the ball based on the player's current velocity
    ball.setVelocity(player.body.velocity.x * 2, player.body.velocity.y * 2);
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
