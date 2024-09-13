import gpt from 'gpt-tfjs'; // Import GPT module

// Access GPTLMHeadModel from the 'model' object
const { GPTLMHeadModel, generate } = gpt.model;  // GPTLMHeadModel and generate function

import * as tf from '@tensorflow/tfjs'; // Ensure TensorFlow.js is loaded

// Configuration for GPT model
const config = {
  nLayer: 3,
  nHead: 3,
  nEmbd: 48,
  vocabSize: 50257,  // This is standard for GPT-2 (change as needed)
  blockSize: 128,    // This could be the max length of the conversation
  dropout: 0.1,
};

// Load the GPT-2 model
async function loadModel() {
  const model = GPTLMHeadModel(config);  // Call GPTLMHeadModel to get the model
  return model;
}

// Generate an NPC response based on player input
async function generateNPCResponse(playerInput) {
  const model = await loadModel();

  // Tokenize the player input (this is a simplified tokenization)
  const tokens = playerInput.split('').map(char => char.charCodeAt(0) % config.vocabSize); // Basic char-to-code conversion

  // Pad or adjust the tokens to match the model's blockSize
  const paddedTokens = tokens.concat(Array(config.blockSize - tokens.length).fill(0));  // Padding

  // Convert the tokenized input into a tensor
  const inputTensor = tf.tensor2d([paddedTokens], [1, config.blockSize], 'int32');

  // Generate output using GPT-2 model (generate 50 tokens based on input)
  const generatedTokens = await generate(model, inputTensor, 50);  // Generate 50 tokens based on input

  // Convert tokens back to text (very basic conversion, adjust as needed)
  const npcResponse = generatedTokens.arraySync()[0]
    .map(token => String.fromCharCode(token % config.vocabSize))
    .join('');

  // Return the generated NPC response
  return npcResponse;
}

// Example: Run the conversation
(async () => {
  const npcResponse = await generateNPCResponse("Hello NPC! How are you?");
  console.log(`NPC says: ${npcResponse}`);
})();
