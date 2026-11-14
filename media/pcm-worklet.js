"use strict";
(() => {
  // src/webview/pcm-worklet.ts
  var BATCH = 1600;
  var PcmTap = class extends AudioWorkletProcessor {
    buffer = new Float32Array(BATCH);
    filled = 0;
    stopped = false;
    captured = 0;
    ready = false;
    constructor() {
      super();
      this.port.onmessage = (event) => {
        if (event.data !== "flush") return;
        this.stopped = true;
        if (this.filled) {
          const tail = this.buffer.slice(0, this.filled);
          this.port.postMessage(tail, [tail.buffer]);
          this.filled = 0;
        }
        this.port.postMessage({ type: "flushed", samples: this.captured });
      };
    }
    process(inputs) {
      if (this.stopped) return false;
      const channel = inputs[0]?.[0];
      if (!channel) return true;
      if (!this.ready) {
        this.ready = true;
        this.port.postMessage({ type: "ready" });
      }
      this.captured += channel.length;
      let at = 0;
      while (at < channel.length) {
        const n = Math.min(BATCH - this.filled, channel.length - at);
        this.buffer.set(channel.subarray(at, at + n), this.filled);
        this.filled += n;
        at += n;
        if (this.filled === BATCH) {
          const out = this.buffer;
          this.port.postMessage(out, [out.buffer]);
          this.buffer = new Float32Array(BATCH);
          this.filled = 0;
        }
      }
      return true;
    }
  };
  registerProcessor("pcm-tap", PcmTap);
})();
