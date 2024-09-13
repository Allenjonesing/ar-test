import * as tf from '@tensorflow/tfjs';
import { GPTLMHeadModel } from './model.js';  // Importing the GPT model

const config = {
  nLayer: 3,
  nHead: 3,
  nEmbd: 48,
  vocabSize: 50257,  // Example vocab size for GPT-2
  blockSize: 128,
  dropout: 0.1,
};

async function loadModel() {
  const model = GPTLMHeadModel(config);  // Loading the GPT model from local files
  return model;
}

async function generateNPCResponse(playerInput) {
  const model = await loadModel();

  // Basic tokenization for demo purposes
  const tokens = playerInput.split('').map(char => char.charCodeAt(0) % 100);  // Example tokenization
  const paddedTokens = tokens.concat(Array(128 - tokens.length).fill(0));  // Padding

  // Convert the tokenized input into a tensor
  const inputTensor = tf.tensor2d([paddedTokens], [1, 128], 'int32');  // Ensure blockSize matches

  // Generate output using GPT model
  const generatedTokens = await model.generate(inputTensor, 50);  // Example to generate 50 tokens
  const npcResponse = generatedTokens.dataSync();

  // Convert tokens back to text (basic conversion)
  const npcResponseText = String.fromCharCode(...npcResponse.map(token => token % 128));  // Example conversion
  return npcResponseText;
}

document.getElementById('send-btn').addEventListener('click', async () => {
  const userInput = document.getElementById('user-input').value;
  const npcResponse = await generateNPCResponse(userInput);
  document.getElementById('npc-response').innerText = `NPC: ${npcResponse}`;
});
