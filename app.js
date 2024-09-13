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

// Load Universal Sentence Encoder Model
let model;
async function loadModel() {
  model = await use.load();  // Load Universal Sentence Encoder model
  console.log('USE model loaded');
}

// Predefined NPC responses
const npcResponses = [
  "Hello! How can I assist you today?",
  "I'm busy right now, try again later.",
  "You shouldn't be here!"
];

// Generate an NPC response based on player input
async function generateNPCResponse(playerInput) {
  const embeddings = await model.embed([playerInput, ...npcResponses]);

  // Calculate similarity between player input and predefined NPC responses
  const playerEmbedding = embeddings.slice([0, 0], [1]); // First embedding is player input
  const npcEmbeddings = embeddings.slice([1, 0], [npcResponses.length]); // Remaining are NPC responses

  // Compute cosine similarity between player input and each NPC response
  let maxSimilarity = -Infinity;
  let bestResponse = "";

  for (let i = 0; i < npcResponses.length; i++) {
    const npcEmbedding = npcEmbeddings.slice([i, 0], [1]);
    const similarity = playerEmbedding.dot(npcEmbedding).dataSync()[0]; // Cosine similarity

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestResponse = npcResponses[i];
    }
  }

  // Display the best-matching NPC response
  document.getElementById('ai-response').textContent = `NPC says: "${bestResponse}"`;

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
loadModel();
