// Set up the canvas for game rendering
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Draw the NPC (represented as a circle)
const npc = { x: 250, y: 250, radius: 30, color: 'blue' };

function drawNPC() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.arc(npc.x, npc.y, npc.radius, 0, Math.PI * 2);
  ctx.fillStyle = npc.color;
  ctx.fill();
  ctx.closePath();
}

// Predefined NPC responses (friendly, neutral, hostile)
const npcResponses = [
  "Hello there, traveler! How can I assist you today?",
  "I have no time for idle chit-chat.",
  "Get out of my way before I lose my patience!"
];

// Load TensorFlow.js Toxicity model
let model;
async function loadModel() {
  const threshold = 0.9; // Model threshold to classify toxicity
  model = await toxicity.load(threshold);
  console.log('Toxicity model loaded');
}

// Use the model to predict the NPC's response tone
async function interactWithNPC() {
    // Pick a random NPC response
    const randomIndex = Math.floor(Math.random() * npcResponses.length);
    const npcResponse = npcResponses[randomIndex];
    
    // Display the response in the UI
    document.getElementById('ai-response').textContent = `NPC says: "${npcResponse}"`;
    
    // Use the Toxicity model to evaluate the response
    const predictions = await model.classify([npcResponse]);
  
    // Determine toxicity and adjust NPC mood based on any toxic prediction
    let isToxic = false;
    predictions.forEach(prediction => {
      if (prediction.results[0].match) {
        isToxic = true;
      }
    });
  
    // Change NPC color based on the tone (friendly = green, neutral = blue, hostile = red)
    if (isToxic) {
      npc.color = 'red';  // Hostile/Toxic
    } else if (randomIndex === 1) {
      npc.color = 'blue'; // Neutral
    } else {
      npc.color = 'green'; // Friendly
    }
  
    // Re-draw the NPC with updated color
    drawNPC();
  }
  
// Add event listener for player interaction (click on NPC)
canvas.addEventListener('click', function (e) {
  const dist = Math.sqrt(Math.pow(e.offsetX - npc.x, 2) + Math.pow(e.offsetY - npc.y, 2));
  
  if (dist <= npc.radius) {
    interactWithNPC();
  }
});

// Initial Setup
drawNPC();
loadModel();
