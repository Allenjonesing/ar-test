import * as tf from '@tensorflow/tfjs';

// Modify this to point to your local model
const modelUrl = './model.js';  // Adjust to the correct path

// Load the GPT model from local files
async function loadModel() {
  const model = await tf.loadGraphModel(modelUrl);  // Load the model from the specified path
  return model;
}

// Generate an NPC response based on user input
async function generateNPCResponse(playerInput) {
  const model = await loadModel();

  // Tokenize the player input (basic tokenization, for demo purposes)
  const tokens = playerInput.split('').map(char => char.charCodeAt(0) % 100); // Example tokenization
  const paddedTokens = tokens.concat(Array(128 - tokens.length).fill(0));  // Padding

  // Convert the tokenized input into a tensor
  const inputTensor = tf.tensor2d([paddedTokens], [1, 128], 'int32');  // Ensure blockSize matches

  // Generate output using GPT-2 model (generate 50 tokens based on input)
  const generatedTokens = await model.execute({ 'input': inputTensor });
  const npcResponse = generatedTokens.dataSync();  // Convert the output to readable data

  // Convert tokens back to text (basic character conversion for demo)
  const npcResponseText = String.fromCharCode(...npcResponse.map(token => token % 128));  // Example token conversion
  return npcResponseText;
}

// Handle the user input and display NPC response
document.getElementById('send-btn').addEventListener('click', async () => {
  const userInput = document.getElementById('user-input').value;
  const npcResponse = await generateNPCResponse(userInput);
  document.getElementById('npc-response').innerText = `NPC: ${npcResponse}`;
});
