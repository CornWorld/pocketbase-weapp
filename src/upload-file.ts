import { getWx } from 'mp-web-polyfill/core'
import type PocketBase from 'pocketbase'

export interface UploadFileResult {
  response: Record<string, unknown>
  statusCode: number
}

/**
 * 磁盘文件上传(wx.uploadFile 桥):polyfill 的 FormData 只支持内存字节,
 * 小程序沙箱内的真实文件(相机/相册/USER_DATA_PATH)必须走 wx.uploadFile。
 * 仅覆盖「创建记录 + 文件字段」;更新场景 PB 支持 POST 语义时可复用。
 */
export async function uploadFile(
  pb: PocketBase,
  collection: string,
  fileField: string,
  filePath: string,
  body: Record<string, unknown> = {},
): Promise<UploadFileResult> {
  const wx = getWx()
  const upload = wx?.uploadFile
  if (!wx || !upload) throw new Error('uploadFile: 未找到 wx 宿主全局对象')

  const formData: Record<string, string> = {}
  for (const [key, value] of Object.entries(body)) {
    formData[key] = typeof value === 'string' ? value : JSON.stringify(value)
  }

  const token = pb.authStore.token
  return await new Promise<UploadFileResult>((resolve, reject) => {
    upload({
      url: `${pb.baseUrl}/api/collections/${collection}/records`,
      filePath,
      name: fileField,
      header: token !== '' ? { Authorization: token } : undefined,
      formData,
      success: (res) => {
        try {
          const parsed = JSON.parse(res.data) as Record<string, unknown>
          if (res.statusCode >= 400) {
            reject(new Error(`uploadFile: PB 响应 ${res.statusCode} — ${res.data}`))
          } else {
            resolve({ response: parsed, statusCode: res.statusCode })
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      },
      fail: (err) => reject(new Error(err.errMsg)),
    })
  })
}
