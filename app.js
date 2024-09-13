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

// Load GPT-2 model for text generation
let model;
async function loadModel() {
  model = await gpt2.load(); // Load the GPT-2 model from the TensorFlow.js repository
  console.log('GPT-2 model loaded');
}

// Generate an NPC response using GPT-2 based on player input
async function generateNPCResponse(playerInput) {
  // Use GPT-2 to generate text based on the player's input
  const output = await model.generate(playerInput, { max_length: 50, temperature: 0.7 });
  
  const npcResponse = output.generated_text;

  // Display the generated NPC response
  document.getElementById('ai-response').textContent = `NPC says: "${npcResponse}"`;

  // Re-draw the NPC (you could change colors based on the response)
  drawNPC();
}

// Add event listener for player interaction (click on NPC)
canvas.addEventListener('click', function (e) {
  const dist = Math.sqrt(Math.pow(e.offsetX - npc.x, 2) + Math.pow(e.offsetY - npc.y, 2));

  if (dist <= npc.radius) {
    const playerInput = prompt("What would you like to say to the NPC?");  // Get player input
    generateNPCResponse(playerInput);  // Generate NPC response
  }
});

// Initial Setup
drawNPC();
loadModel();  // Load the GPT-2 model
