import { spawn } from 'node:child_process'
import { GpuInfo } from '../shared/types'

/** Chay 1 lenh, gom stdout+stderr. code=-1 neu khong chay duoc (vd khong co lenh). */
function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    try {
      const child = spawn(cmd, args, { windowsHide: true })
      child.stdout.on('data', (d) => (out += d.toString()))
      child.stderr.on('data', (d) => (out += d.toString()))
      child.on('error', () => resolve({ code: -1, out }))
      child.on('close', (code) => resolve({ code: code ?? -1, out }))
    } catch {
      resolve({ code: -1, out })
    }
  })
}

const CUDA_MIN = 12 // CTranslate2 4.x can CUDA 12 + cuDNN 9

/**
 * Quet GPU bang `nvidia-smi` (buoc an toan truoc khi cho tai goi tang toc).
 * - Khong co nvidia-smi -> khong phai may NVIDIA (hoac chua co driver) -> chay CPU.
 * - Co -> doc ten card + driver + "CUDA Version" (toi da driver ganh). Chi cho tang
 *   toc khi CUDA >= 12 (nếu không, khuyên cập nhật driver).
 */
export async function detectGpu(): Promise<GpuInfo> {
  const none = (reason: string): GpuInfo => ({
    hasNvidia: false,
    name: null,
    driverVersion: null,
    cudaVersion: null,
    cudaMajor: null,
    canAccelerate: false,
    reason
  })

  // 1) Ten card + driver (dang CSV de parse chac chan)
  const q = await run('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'])
  if (q.code !== 0) {
    return none('Không tìm thấy GPU NVIDIA (hoặc chưa cài driver). Sẽ dùng CPU.')
  }
  const firstLine = q.out.trim().split(/\r?\n/)[0] ?? ''
  const [name, driver] = firstLine.split(',').map((s) => s.trim())

  // 2) CUDA Version (chi hien o header cua `nvidia-smi` thuong, khong co trong --query)
  const p = await run('nvidia-smi', [])
  const m = p.out.match(/CUDA\s*Version:\s*([0-9]+)\.([0-9]+)/i)
  const cudaMajor = m ? Number(m[1]) : null
  const cudaVersion = m ? `${m[1]}.${m[2]}` : null

  const canAccelerate = cudaMajor != null && cudaMajor >= CUDA_MIN
  let reason: string | null = null
  if (!canAccelerate) {
    reason =
      cudaMajor != null
        ? `Driver hiện hỗ trợ tối đa CUDA ${cudaVersion} (cần CUDA ≥ ${CUDA_MIN}). Hãy cập nhật driver NVIDIA để tăng tốc; tạm thời vẫn dùng CPU tốt.`
        : 'Không đọc được phiên bản CUDA từ driver. Tạm thời dùng CPU.'
  }

  return {
    hasNvidia: true,
    name: name || null,
    driverVersion: driver || null,
    cudaVersion,
    cudaMajor,
    canAccelerate,
    reason
  }
}
