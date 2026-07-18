// AudioWorklet: lay tung khung PCM tu luong tieng he thong roi day ve renderer.
// Chay trong luong audio rieng (khong lam giat giao dien).
//
// LUU Y: file nay nam trong public/ va duoc nap bang './pcm-tap.js' — PHAI la
// file that cung nguon goc, KHONG dung blob: URL vi CSP (script-src 'self')
// cua app chan blob -> loi "Unable to load a worklet's module".
class PCMTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch && ch.length) this.port.postMessage(ch.slice(0))
    return true // giu worklet song
  }
}

registerProcessor('pcm-tap', PCMTap)
