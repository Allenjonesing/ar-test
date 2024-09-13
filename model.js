//import * as tf from '@tensorflow/tfjs';
//import { train } from './train.js';

// Range Layer
class Range_ extends tf.layers.Layer {
  computeOutputShape(inputShape) {
    return inputShape;
  }

  call(input, kwargs) {
    return tf.tidy(() => {
      if (Array.isArray(input)) {
        input = input[0];
      }
      const [B, T] = input.shape;
      const range = tf.reshape(tf.range(0, T, 1, 'int32'), [1, T]);
      return range;
    });
  }

  static get className() {
    return 'Range';
  }
}
tf.serialization.registerClass(Range_);

// Log Layer
class LogLayer_ extends tf.layers.Layer {
  constructor(config) {
    super(config);
    this.config = config;
  }

  computeOutputShape(inputShape) {
    return inputShape;
  }

  call(input, kwargs) {
    return tf.tidy(() => {
      if (Array.isArray(input)) {
        input = input[0];
      }
      const x = tf.util.flatten(input.arraySync());
      console.log(this.config.name + '>', input.shape, x[0], x[x.length - 1]);
      return input;
    });
  }

  static get className() {
    return 'LogLayer';
  }
}
tf.serialization.registerClass(LogLayer_);

// Causal Self Attention Layer
class CausalSelfAttention_ extends tf.layers.Layer {
  constructor(config) {
    super(config);
    this.config = config;
    this.blockSize = config.blockSize;
    this.nEmbd = config.nEmbd;
    this.nHead = config.nHead;
    this.dropout = config.dropout;
    this.mask = tf.linalg.bandPart(tf.ones([config.blockSize, config.blockSize]), -1, 0);
  }

  computeOutputShape(inputShape) {
    return [null, this.blockSize, this.nEmbd];
  }

  getConfig() {
    const config = super.getConfig();
    return Object.assign({}, config, this.config);
  }

  call(input, kwargs) {
    return tf.tidy(() => {
      if (Array.isArray(input)) {
        input = input[0];
      }

      let [q, k, v] = tf.split(input, 3, -1);
      const [B, T, C] = k.shape;

      const splitHeads = (x) => tf.transpose(
        tf.reshape(x, [B, T, this.nHead, C / this.nHead]),
        [0, 2, 1, 3]
      );
      q = splitHeads(q);
      k = splitHeads(k);
      v = splitHeads(v);

      let att = tf.mul(
        tf.matMul(q, k, false, true),
        tf.div(1, tf.sqrt(tf.cast(k.shape[k.shape.length - 1], 'float32')))
      );

      att = tf.add(att, tf.mul(tf.sub(1, this.mask), -1e9));
      att = tf.softmax(att, -1);
      att = kwargs['training'] ? tf.dropout(att, this.dropout) : att;

      let y = tf.matMul(att, v);
      y = tf.transpose(y, [0, 2, 1, 3]);
      y = tf.reshape(y, [B, T, C]);

      return y;
    });
  }

  static get className() {
    return 'CausalSelfAttention';
  }
}
tf.serialization.registerClass(CausalSelfAttention_);

// GELU Activation Layer
class GELU_ extends tf.layers.Layer {
  computeOutputShape(inputShape) {
    return inputShape;
  }

  call(input, kwargs) {
    return tf.tidy(() => {
      if (Array.isArray(input)) {
        input = input[0];
      }
      const cdf = tf.mul(
        0.5,
        tf.add(
          1,
          tf.tanh(tf.mul(
            tf.sqrt(tf.div(2, Math.PI)),
            tf.add(input, tf.mul(0.044715, tf.pow(input, 3)))
          ))
        )
      );
      return tf.mul(input, cdf);
    });
  }

  static get className() {
    return 'GELU';
  }
}
tf.serialization.registerClass(GELU_);

// MLP Layer
function MLP(config) {
  const inputs = tf.input({ shape: [config.blockSize, config.nEmbd] });
  let x;
  x = tf.layers.dense({
    units: 4 * config.nEmbd,
    useBias: true
  }).apply(inputs);
  x = GELU_().apply(x);
  x = tf.layers.dense({
    units: config.nEmbd,
    useBias: true
  }).apply(x);
  return tf.model({ inputs: inputs, outputs: x });
}

// GPT Block
function Block(config) {
  const inputs = tf.input({ shape: [config.blockSize, config.nEmbd] });
  let x1, x2;

  x1 = tf.layers.layerNormalization({ epsilon: 1e-5 }).apply(inputs);
  x1 = CausalSelfAttention_(config).apply(x1);
  x1 = tf.layers.add().apply([inputs, x1]);

  x2 = tf.layers.layerNormalization({ epsilon: 1e-5 }).apply(x1);
  x2 = MLP(config).apply(x2);
  x2 = tf.layers.add().apply([x1, x2]);

  return tf.model({ inputs: inputs, outputs: x2 });
}

// GPT Model
function GPT(config) {
  const inputs = tf.input({ shape: [config.blockSize] });
  let x = tf.layers.embedding({
    inputDim: config.vocabSize,
    outputDim: config.nEmbd
  }).apply(inputs);

  for (let i = 0; i < config.nLayer; i++) {
    x = Block(config).apply(x);
  }

  x = tf.layers.layerNormalization({ epsilon: 1e-5 }).apply(x);
  x = tf.layers.dense({ units: config.vocabSize }).apply(x);

  return tf.model({ inputs: inputs, outputs: x });
}

// GPT LM Head Model
export class GPTLMHeadModel_ {
  constructor(config) {
    this.model = GPT(config);
  }

  async load(modelPath) {
    await this.model.loadWeights(modelPath);
  }

  async save(modelPath) {
    await this.model.save(modelPath);
  }

  generate(inputs, maxNewTokens) {
    const blockSize = this.model.inputs[0].shape[1];
    let idx = inputs;

    for (let step = 0; step < maxNewTokens; step++) {
      const idxCond = idx.shape[1] <= blockSize ? idx : idx.slice([0, -blockSize]);
      const logits = this.model.predict(idxCond);
      const nextToken = logits.softmax(-1).argMax(-1).expandDims(1);
      idx = idx.concat(nextToken, 1);
    }
    
    return idx;
  }
}

export const GPTLMHeadModel = (config) => new GPTLMHeadModel_(config);
