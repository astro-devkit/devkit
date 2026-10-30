// DevKit AI Playground worker — runs a real LLM 100% on the visitor's device
// with Transformers.js v3. Nothing typed in the chat ever leaves the page:
// this worker only talks to the Hugging Face CDN (to download the model
// files once) and to the page that created it.
//
// Model: onnx-community/gemma-3-270m-it-ONNX (Google Gemma 3 270M IT),
// dtype q4f16 — the 4-bit weights live in onnx/model_q4f16.onnx_data
// (~272.6 MB; the plain q4 variant is ~322.9 MB, so q4f16 is the smaller
// download). Gemma's 262k-token vocabulary makes tokenizer.json ~20.3 MB,
// so the one-time download totals ~293 MB. Browser-cached after first load.
// Switched from SmolLM-135M on 2026-10-30 after load failures on a real
// phone (WebGPU adapters without shader-f16 are now skipped — see load()).
import { pipeline, TextStreamer, InterruptableStoppingCriteria } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

const MODEL_ID = 'onnx-community/gemma-3-270m-it-ONNX';
const DTYPE = 'q4f16';

let generator = null;
let streamer = null;
let stopper = null;
let backend = null;
let generating = false;

function post(msg) { self.postMessage(msg); }

async function load() {
  if (generator) { post({ type: 'ready', backend }); return; }
  const progress_callback = (data) => post({ type: 'progress', data });
  // Prefer WebGPU (fast, and avoids the single-threaded WASM limits of a
  // plain static host with no COOP/COEP headers); fall back to WASM.
  const attempts = [];
  if (self.navigator && 'gpu' in self.navigator) {
    try {
      const adapter = await self.navigator.gpu.requestAdapter();
      // q4f16 weights need the shader-f16 WebGPU feature. Many mobile GPUs
      // expose an adapter WITHOUT it, and session creation then fails —
      // skip WebGPU entirely on those and go straight to WASM.
      if (adapter && adapter.features && adapter.features.has('shader-f16')) attempts.push('webgpu');
    } catch (e) { /* no usable WebGPU adapter — WASM will handle it */ }
  }
  attempts.push('wasm');
  let lastErr = null;
  for (const device of attempts) {
    try {
      post({ type: 'phase', phase: 'loading-' + device });
      generator = await pipeline('text-generation', MODEL_ID, {
        dtype: DTYPE,
        device,
        progress_callback,
      });
      backend = device;
      post({ type: 'ready', backend });
      return;
    } catch (err) {
      lastErr = err;
      generator = null;
    }
  }
  throw lastErr || new Error('The model could not be loaded on this device.');
}

async function generate(data) {
  if (!generator) { post({ type: 'error', message: 'The model is not loaded yet.' }); return; }
  if (generating) return;
  generating = true;
  let tokenCount = 0;
  const start = performance.now();
  stopper = new InterruptableStoppingCriteria();
  streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    token_callback_function: () => { tokenCount += 1; },
    callback_function: (text) => {
      const secs = (performance.now() - start) / 1000;
      post({
        type: 'update',
        text,
        tokens: tokenCount,
        tps: secs > 0.05 ? tokenCount / secs : 0,
      });
    },
  });
  try {
    const temp = Math.max(0, Math.min(1.5, Number(data.temperature) || 0));
    const opts = {
      max_new_tokens: Math.max(16, Math.min(1024, data.maxNewTokens | 0 || 256)),
      streamer,
      stopping_criteria: stopper,
      return_full_text: false,
    };
    if (temp > 0) { opts.do_sample = true; opts.temperature = temp; }
    else { opts.do_sample = false; }
    const output = await generator(data.messages, opts);
    let text = '';
    if (Array.isArray(output) && output.length) {
      const gt = output[0].generated_text;
      if (typeof gt === 'string') text = gt;
      else if (Array.isArray(gt) && gt.length) text = gt[gt.length - 1].content || '';
    }
    const secs = (performance.now() - start) / 1000;
    post({
      type: 'complete',
      text,
      tokens: tokenCount,
      tps: secs > 0 ? tokenCount / secs : 0,
      seconds: secs,
    });
  } catch (err) {
    post({ type: 'error', message: 'Generation stopped: ' + (err && err.message ? err.message : String(err)) });
  } finally {
    generating = false;
    streamer = null;
    stopper = null;
  }
}

self.onmessage = async (e) => {
  const data = e.data || {};
  try {
    if (data.type === 'load') await load();
    else if (data.type === 'generate') await generate(data);
    else if (data.type === 'interrupt') { if (stopper) stopper.interrupt(); }
  } catch (err) {
    post({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
